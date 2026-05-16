import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GraphitiResult } from "./graphiti-client.js";
import { resetLogger } from "./logger.js";
import type { SanitizedPayload } from "./sanitizer.js";
import {
  ShadowExtractor,
  type ShadowExtractorProvider,
} from "./shadow-extractor.js";

type AddMemoryResult = GraphitiResult<{ message: string }>;

interface MockClient extends Pick<MockGraphitiClient, "addMemory"> {}

interface MockGraphitiClient {
  addMemory: ReturnType<typeof mock> &
    ((
      payload: SanitizedPayload,
      extra?: { groupId?: string; sourceDescription?: string; uuid?: string }
    ) => Promise<AddMemoryResult>);
}

function createClient(results: AddMemoryResult[] = []): MockGraphitiClient {
  const addMemory = mock(
    async (
      _payload: SanitizedPayload,
      _extra?: { groupId?: string; sourceDescription?: string; uuid?: string }
    ): Promise<AddMemoryResult> =>
      results.shift() ?? { success: true, data: { message: "ok" } }
  ) as MockGraphitiClient["addMemory"];

  return { addMemory };
}

function createProvider(rawJson: string): ShadowExtractorProvider & {
  extract: ReturnType<typeof mock>;
} {
  return {
    name: "mock-provider",
    extract: mock(async () => rawJson),
  };
}

function createExtractor(opts: {
  provider?: ShadowExtractorProvider | null;
  client?: MockGraphitiClient;
  enabled?: boolean;
  timeoutMs?: number;
  maxConcurrency?: number;
  groupId?: string;
}) {
  const client = opts.client ?? createClient();
  const provider =
    opts.provider === undefined ? createProvider('{"candidates":[]}') : opts.provider;

  return {
    client,
    provider,
    extractor: new ShadowExtractor({
      enabled: opts.enabled ?? true,
      timeoutMs: opts.timeoutMs ?? 1000,
      maxConcurrency: opts.maxConcurrency ?? 1,
      provider,
      client,
      groupId: opts.groupId ?? "test-group",
    }),
  };
}

describe("ShadowExtractor", () => {
  let testHome: string;
  let savedGraphitiTestHome: string | undefined;

  beforeEach(async () => {
    savedGraphitiTestHome = process.env.GRAPHITI_TEST_HOME;
    testHome = await mkdtemp(path.join(tmpdir(), "shadow-extractor-test-"));
    process.env.GRAPHITI_TEST_HOME = testHome;
    resetLogger();
  });

  afterEach(async () => {
    resetLogger();
    if (savedGraphitiTestHome === undefined) {
      delete process.env.GRAPHITI_TEST_HOME;
    } else {
      process.env.GRAPHITI_TEST_HOME = savedGraphitiTestHome;
    }
    await rm(testHome, { recursive: true, force: true });
  });

  it("writes a sanitized shadow payload for a valid ArchitecturalDecision", async () => {
    const rawJson = JSON.stringify({
      candidates: [
        {
          memoryClass: "ArchitecturalDecision",
          name: "Use sanitized shadow writes",
          body: "The system should pass shadow candidates through sanitizer.",
          evidence: "pass shadow candidates through sanitizer",
          confidence: 0.92,
        },
      ],
    });
    const { extractor, client } = createExtractor({
      provider: createProvider(rawJson),
    });

    const result = await extractor.run({
      text: "Decision: pass shadow candidates through sanitizer.",
      metadata: { sessionId: "s1" },
    });

    expect(result.status).toBe("ok");
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(client.addMemory).toHaveBeenCalledTimes(1);

    const payload = client.addMemory.mock.calls[0]![0] as SanitizedPayload;
    expect(payload.__sanitized).toBe(true);
    expect(payload.source).toBe("shadow");
    expect(payload.body).toContain("pass shadow candidates through sanitizer");
    expect(payload.metadata.memoryClass).toBe("ArchitecturalDecision");
    expect(payload.metadata.evidence).toBe("pass shadow candidates through sanitizer");
    expect(payload.metadata.confidence).toBe(0.92);
    expect(payload.metadata.sessionId).toBe("s1");
  });

  it("passes configured groupId as addMemory extra for sanitized shadow writes", async () => {
    const rawJson = JSON.stringify({
      candidates: [
        {
          memoryClass: "Decision",
          name: "Remember integration group",
          body: "Shadow writes should use the configured integration group.",
        },
      ],
    });
    const { extractor, client } = createExtractor({
      provider: createProvider(rawJson),
      groupId: "integration-test-group",
    });

    const result = await extractor.run({ text: "remember the configured group" });

    expect(result.status).toBe("ok");
    expect(client.addMemory).toHaveBeenCalledTimes(1);

    const [payload, extra] = client.addMemory.mock.calls[0]!;
    expect((payload as SanitizedPayload).metadata.groupId).toBeUndefined();
    expect(extra).toEqual({ groupId: "integration-test-group" });
  });

  it("short-circuits when disabled by config", async () => {
    const provider = createProvider('{"candidates":[]}');
    const { extractor } = createExtractor({ enabled: false, provider });

    const result = await extractor.run({ text: "anything" });

    expect(result).toEqual({ status: "disabled", written: 0, skipped: 0 });
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it("short-circuits silently when provider is null", async () => {
    const { extractor, client } = createExtractor({ provider: null });

    const result = await extractor.run({ text: "anything" });

    expect(result).toEqual({ status: "disabled", written: 0, skipped: 0 });
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("fails open on provider timeout and aborts the signal", async () => {
    let aborted = false;
    const provider: ShadowExtractorProvider & { extract: ReturnType<typeof mock> } = {
      extract: mock(
        ({ signal }) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          })
      ),
    };
    const client = createClient();
    const { extractor } = createExtractor({ provider, client, timeoutMs: 50 });

    const result = await extractor.run({ text: "timeout" });

    expect(result.status).toBe("timeout");
    expect(result.reason).toBe("shadow extractor timeout");
    expect(aborted).toBe(true);
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("fails open when provider throws", async () => {
    const provider: ShadowExtractorProvider & { extract: ReturnType<typeof mock> } = {
      extract: mock(async () => {
        throw new Error("boom");
      }),
    };
    const client = createClient();
    const { extractor } = createExtractor({ provider, client });

    const result = await extractor.run({ text: "error" });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("boom");
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON output", async () => {
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider("not json"),
      client,
    });

    const result = await extractor.run({ text: "invalid" });

    expect(result.status).toBe("invalid-output");
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("rejects schema-invalid candidate classes", async () => {
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [{ memoryClass: "Pizza", name: "x", body: "y" }],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: "pizza" });

    expect(result.status).toBe("invalid-output");
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("rejects deterministic classes", async () => {
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [
            { memoryClass: "UserInstruction", name: "x", body: "y" },
          ],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: "user instruction" });

    expect(result.status).toBe("invalid-output");
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("returns no-candidates for valid empty output", async () => {
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(JSON.stringify({ candidates: [] })),
      client,
    });

    const result = await extractor.run({ text: "nothing important" });

    expect(result).toEqual({ status: "no-candidates", written: 0, skipped: 0 });
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("continues after per-candidate write failures", async () => {
    const client = createClient([
      { success: true, data: { message: "ok" } },
      { success: false, error: "e", isUnreachable: false },
      { success: true, data: { message: "ok" } },
    ]);
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [
            { memoryClass: "Decision", name: "one", body: "body one" },
            { memoryClass: "Strategy", name: "two", body: "body two" },
            { memoryClass: "Reflection", name: "three", body: "body three" },
          ],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: "three candidates" });

    expect(result.status).toBe("ok");
    expect(result.written).toBe(2);
    expect(result.skipped).toBe(1);
    expect(client.addMemory).toHaveBeenCalledTimes(3);
  });

  it("continues after per-candidate write throws", async () => {
    const addMemory = mock(async () => {
      throw new Error("write boom");
    }) as MockGraphitiClient["addMemory"];
    const client = { addMemory };
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [{ memoryClass: "Decision", name: "one", body: "body one" }],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: "write throws" });

    expect(result.status).toBe("ok");
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips new extraction when maxConcurrency is reached", async () => {
    let releaseProvider: ((rawJson: string) => void) | undefined;
    const provider: ShadowExtractorProvider & { extract: ReturnType<typeof mock> } = {
      extract: mock(
        () =>
          new Promise<string>((resolve) => {
            releaseProvider = resolve;
          })
      ),
    };
    const { extractor } = createExtractor({ provider, maxConcurrency: 1 });

    const firstRun = extractor.run({ text: "slow" });
    const secondResult = await extractor.run({ text: "skip" });
    releaseProvider?.(JSON.stringify({ candidates: [] }));
    const firstResult = await firstRun;

    expect(secondResult).toEqual({
      status: "skipped-busy",
      written: 0,
      skipped: 1,
    });
    expect(firstResult.status).toBe("no-candidates");
    expect(provider.extract).toHaveBeenCalledTimes(1);
  });

  it("redacts secrets in candidate bodies before writing", async () => {
    const secret = "sk-leak-abc123ABC123def456DEF456";
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [
            {
              memoryClass: "Decision",
              name: "secret body",
              body: `Do not store ${secret}`,
            },
          ],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: secret });

    const payload = client.addMemory.mock.calls[0]![0] as SanitizedPayload;
    expect(result.status).toBe("ok");
    expect(payload.body).toContain("[REDACTED:api_key]");
    expect(payload.body).not.toContain(secret);
    const sanitizer = payload.metadata.sanitizer as {
      redactions: { count: number; categories: string[] };
    };
    expect(sanitizer.redactions.count).toBeGreaterThanOrEqual(1);
    expect(sanitizer.redactions.categories).toContain("api_key");
  });

  it("redacts secrets in candidate names before writing", async () => {
    const secret = "sk-leak-abc123ABC123def456DEF456";
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [
            {
              memoryClass: "Decision",
              name: `secret ${secret}`,
              body: "Secret should not remain in the episode name.",
            },
          ],
        })
      ),
      client,
    });

    const result = await extractor.run({ text: secret });

    const payload = client.addMemory.mock.calls[0]![0] as SanitizedPayload;
    expect(result.status).toBe("ok");
    expect(payload.name).toContain("[REDACTED:api_key]");
    expect(payload.name).not.toContain(secret);
  });

  it("redacts secrets in evidence and caller metadata before writing", async () => {
    const secret = "sk-leak-abc123ABC123def456DEF456";
    const client = createClient();
    const { extractor } = createExtractor({
      provider: createProvider(
        JSON.stringify({
          candidates: [
            {
              memoryClass: "Decision",
              name: "metadata secret",
              body: "Metadata secrets should be redacted.",
              evidence: `quote ${secret}`,
            },
          ],
        })
      ),
      client,
    });

    await extractor.run({
      text: secret,
      metadata: { nested: { token: secret } },
    });

    const payload = client.addMemory.mock.calls[0]![0] as SanitizedPayload;
    expect(payload.metadata.evidence).toBe("quote [REDACTED:api_key]");
    expect(payload.metadata.nested).toEqual({ token: "[REDACTED:api_key]" });
    expect(JSON.stringify(payload.metadata)).not.toContain(secret);
  });
});
