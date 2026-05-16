import { z } from "zod";
import type { GraphitiClient } from "./graphiti-client.js";
import {
  sanitizeForGraphiti,
  type SanitizedPayload,
  type SanitizerInput,
} from "./sanitizer.js";
import { log } from "./logger.js";
import {
  SHADOW_MEMORY_CLASSES,
  type MemoryClass,
  type ShadowMemoryClass,
} from "../types/memory.js";

const LOG_PREFIX = "[shadow-extractor]";
const TIMEOUT_REASON = "shadow extractor timeout";

const ShadowOutputSchema = z.object({
  candidates: z.array(
    z.object({
      memoryClass: z.enum(SHADOW_MEMORY_CLASSES),
      name: z.string().min(1),
      body: z.string().min(1),
      evidence: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
  ),
});

export interface ShadowExtractorProvider {
  /** Returns a JSON string (raw model output) or throws. Implementations MUST respect signal aborts. */
  extract(input: { prompt: string; signal: AbortSignal }): Promise<string>;
  /** Optional readable name for logging. */
  readonly name?: string;
}

export interface ShadowExtractorOptions {
  enabled: boolean;
  timeoutMs: number;
  maxConcurrency: number;
  provider: ShadowExtractorProvider | null;
  client: Pick<GraphitiClient, "addMemory">;
  groupId: string;
}

export interface ShadowCandidate {
  /** One of SHADOW_MEMORY_CLASSES values. */
  memoryClass: MemoryClass;
  name: string;
  body: string;
  evidence?: string;
  confidence?: number;
}

export interface ShadowExtractionResult {
  status:
    | "ok"
    | "disabled"
    | "skipped-busy"
    | "timeout"
    | "error"
    | "invalid-output"
    | "no-candidates";
  written: number;
  skipped: number;
  reason?: string;
  candidates?: ShadowCandidate[];
}

export interface ShadowExtractorInput {
  /** Conversation excerpt or compaction text the extractor inspects. */
  text: string;
  /** Optional metadata stored alongside the resulting Graphiti episode. */
  metadata?: Record<string, unknown>;
}

export function parseAndValidate(rawJson: string): ShadowCandidate[] {
  const parsed = JSON.parse(rawJson) as unknown;
  return ShadowOutputSchema.parse(parsed).candidates;
}

export class ShadowExtractor {
  private readonly opts: ShadowExtractorOptions;
  private inFlight = 0;

  constructor(opts: ShadowExtractorOptions) {
    this.opts = opts;
  }

  async run(input: ShadowExtractorInput): Promise<ShadowExtractionResult> {
    if (!this.opts.enabled || this.opts.provider === null) {
      return { status: "disabled", written: 0, skipped: 0 };
    }

    if (this.inFlight >= this.opts.maxConcurrency) {
      log(`${LOG_PREFIX} skipped busy`, { maxConcurrency: this.opts.maxConcurrency });
      return { status: "skipped-busy", written: 0, skipped: 1 };
    }

    this.inFlight += 1;
    try {
      return await this.extractAndWrite(input);
    } finally {
      this.inFlight -= 1;
    }
  }

  private async extractAndWrite(
    input: ShadowExtractorInput
  ): Promise<ShadowExtractionResult> {
    const rawJson = await this.callProvider(input);
    if (rawJson.status !== "ok") return rawJson.result;

    const candidates = this.parseCandidates(rawJson.value);
    if (candidates.status !== "ok") return candidates.result;
    if (candidates.value.length === 0) {
      return { status: "no-candidates", written: 0, skipped: 0 };
    }

    const writeCounts = await this.writeCandidates(candidates.value, input.metadata);
    return {
      status: "ok",
      written: writeCounts.written,
      skipped: writeCounts.skipped,
      candidates: candidates.value,
    };
  }

  private async callProvider(
    input: ShadowExtractorInput
  ): Promise<
    | { status: "ok"; value: string }
    | { status: "failed"; result: ShadowExtractionResult }
  > {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new DOMException(TIMEOUT_REASON, "AbortError"));
      }, this.opts.timeoutMs);
    });

    try {
      const providerPromise = this.opts.provider!.extract({
        prompt: buildPrompt(input.text),
        signal: controller.signal,
      });
      const rawJson = await Promise.race([providerPromise, timeoutPromise]);
      return { status: "ok", value: rawJson };
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        log(`${LOG_PREFIX} timeout`, { provider: this.opts.provider!.name });
        return {
          status: "failed",
          result: {
            status: "timeout",
            written: 0,
            skipped: 0,
            reason: TIMEOUT_REASON,
          },
        };
      }

      const reason = error instanceof Error ? error.message : String(error);
      log(`${LOG_PREFIX} provider error`, { reason, provider: this.opts.provider!.name });
      return {
        status: "failed",
        result: { status: "error", written: 0, skipped: 0, reason },
      };
    } finally {
      clearTimeout(timeout!);
    }
  }

  private parseCandidates(
    rawJson: string
  ):
    | { status: "ok"; value: ShadowCandidate[] }
    | { status: "failed"; result: ShadowExtractionResult } {
    try {
      return { status: "ok", value: parseAndValidate(rawJson) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`${LOG_PREFIX} invalid output`, { reason });
      return {
        status: "failed",
        result: { status: "invalid-output", written: 0, skipped: 0, reason },
      };
    }
  }

  private async writeCandidates(
    candidates: ShadowCandidate[],
    callerMetadata: Record<string, unknown> | undefined
  ): Promise<{ written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const payload = buildSanitizedPayload(candidate, callerMetadata ?? {});
      try {
        const result = await this.opts.client.addMemory(payload, {
          groupId: this.opts.groupId,
        });
        if (result.success) {
          written += 1;
          continue;
        }

        skipped += 1;
        log(`${LOG_PREFIX} write skipped`, { error: result.error });
      } catch (error) {
        skipped += 1;
        log(`${LOG_PREFIX} write error`, { error: toErrorMessage(error) });
      }
    }

    return { written, skipped };
  }
}

function buildPrompt(text: string): string {
  return [
    "Extract only high-value shadow memory candidates from this conversation excerpt.",
    `Allowed memoryClass values: ${SHADOW_MEMORY_CLASSES.join(", ")}.`,
    'Return JSON only, for example {"candidates":[{"memoryClass":"Decision","name":"short name","body":"memory body","evidence":"supporting quote","confidence":0.8}]}',
    "Conversation excerpt:",
    text,
  ].join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildSanitizedPayload(
  candidate: ShadowCandidate,
  callerMetadata: Record<string, unknown> | undefined
): SanitizedPayload {
  const namePayload = sanitizeForGraphiti({
    source: "shadow",
    body: candidate.name,
  });
  const evidence = sanitizeOptionalText(candidate.evidence);
  const caller = sanitizeMetadata(callerMetadata ?? {});
  const input: SanitizerInput = {
    source: "shadow",
    name: namePayload.body,
    body: candidate.body,
    metadata: buildMetadata(candidate, caller.metadata, namePayload, evidence),
  };
  const payload = sanitizeForGraphiti(input);
  const redactions = mergeRedactions(
    payload.redactions,
    namePayload.redactions,
    evidence.redactions,
    caller.redactions
  );
  payload.redactions = redactions;
  payload.metadata = {
    ...payload.metadata,
    sanitizer: {
      sanitized: true,
      source: payload.source,
      redactions,
    },
  };
  return payload;
}

function buildMetadata(
  candidate: ShadowCandidate,
  callerMetadata: Record<string, unknown> | undefined,
  namePayload: SanitizedPayload,
  evidence: { value: string | undefined; redactions: SanitizedPayload["redactions"] }
): Record<string, unknown> {
  return {
    ...(callerMetadata ?? {}),
    memoryClass: candidate.memoryClass as ShadowMemoryClass,
    ...(evidence.value !== undefined && { evidence: evidence.value }),
    ...(candidate.confidence !== undefined && { confidence: candidate.confidence }),
    ...(namePayload.redactions.count > 0 && {
      nameRedactions: namePayload.redactions,
    }),
    ...(evidence.redactions.count > 0 && {
      evidenceRedactions: evidence.redactions,
    }),
  };
}

function mergeRedactions(
  ...redactionSets: SanitizedPayload["redactions"][]
): SanitizedPayload["redactions"] {
  return {
    count: redactionSets.reduce((count, redactions) => count + redactions.count, 0),
    categories: Array.from(
      new Set(redactionSets.flatMap((redactions) => redactions.categories))
    ),
  };
}

function sanitizeOptionalText(value: string | undefined): {
  value: string | undefined;
  redactions: SanitizedPayload["redactions"];
} {
  if (value === undefined) {
    return { value: undefined, redactions: { count: 0, categories: [] } };
  }

  const payload = sanitizeForGraphiti({ source: "shadow", body: value });
  return { value: payload.body, redactions: payload.redactions };
}

function sanitizeMetadata(metadata: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  redactions: SanitizedPayload["redactions"];
} {
  const entries = Object.entries(metadata).map(([key, value]) => {
    const sanitized = sanitizeMetadataValue(value);
    return [key, sanitized] as const;
  });

  return {
    metadata: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
    redactions: mergeRedactions(...entries.map(([, item]) => item.redactions)),
  };
}

function sanitizeMetadataValue(value: unknown): {
  value: unknown;
  redactions: SanitizedPayload["redactions"];
} {
  if (typeof value === "string") {
    return sanitizeOptionalText(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(sanitizeMetadataValue);
    return {
      value: items.map((item) => item.value),
      redactions: mergeRedactions(...items.map((item) => item.redactions)),
    };
  }

  if (typeof value === "object" && value !== null) {
    const sanitized = sanitizeMetadata(value as Record<string, unknown>);
    return { value: sanitized.metadata, redactions: sanitized.redactions };
  }

  return { value, redactions: { count: 0, categories: [] } };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
