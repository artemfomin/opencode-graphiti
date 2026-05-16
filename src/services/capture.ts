import type { GraphitiClient } from "./graphiti-client.js";
import { parseMarkers } from "./markers.js";
import { log } from "./logger.js";
import type { MemoryClass } from "../types/memory.js";

export interface CaptureContext {
  client: Pick<GraphitiClient, "addMemory">;
  groupId: string;
  config: {
    enabled: boolean;
    trivialMessageMinLength: number;
    explicitClassMarkers: string[];
    ratificationKeywords: { positive: string[]; negative: string[] };
    ratificationWindowTurns: number;
    unverifiedAutoExpireMs: number;
  };
  markers: { enabled: boolean; prefix: string };
}

export interface ChatMessageInput {
  text: string;
  role: "user" | "assistant" | "system";
  sessionId: string;
  messageId: string;
  timestamp?: number;
}

export interface ToolExecuteAfterInput {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  exitCode?: number;
  sessionId: string;
  timestamp?: number;
}

export interface MessagePartUpdatedInput {
  partType: string;
  text?: string;
  sessionId: string;
  messageId: string;
  timestamp?: number;
}

export interface SessionIdleInput { sessionId: string; timestamp?: number; }
export interface SessionCompactedInput { sessionId: string; summary?: string; timestamp?: number; }

export interface CaptureWriteResult {
  written: number;
  skipped: number;
  classes: MemoryClass[];
  reason?: string;
}

export const RESTRICTION_PATTERNS = /\b(never|don'?t|do\s+not|forbid|forbidden|must\s+not|no\s+more|stop)\b/i;
export const STYLE_PREFERENCE_PATTERNS = /\b(prefer(?:s|red)?|always|consistently|by\s+default)\b/i;
export const PROBLEM_PATTERNS = /\b(broken|crashes|fails?|error|exception|stack\s*trace|hangs|times?\s*out|panics?|deadlock)\b/i;
export const FIX_ATTEMPT_PATTERNS = /\b(tried|attempted|tried\s+to|let'?s\s+try|reverted)\b/i;
export const ACHIEVEMENT_PATTERNS = /\b(fixed|works|passing|landed|merged|deployed|shipped)\b/i;

const IGNORABLE_MESSAGES = new Set([
  "ok",
  "okay",
  "k",
  "thanks",
  "thx",
  "ty",
  "yes",
  "no",
  "sure",
  "got it",
  "cool",
  "nice",
  "great",
  "done",
  "cancel",
]);

const CODE_FENCE_ONLY_PATTERN = /^```[\s\S]*```$/;
const EMOJI_ONLY_PATTERN = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+$/u;

type Candidate = {
  memoryClass: MemoryClass;
  body: string;
  name: string;
  metadata: Record<string, unknown>;
};

export function isTrivialMessage(text: string, minLength: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length < minLength) return true;
  if (IGNORABLE_MESSAGES.has(trimmed.toLowerCase())) return true;
  if (CODE_FENCE_ONLY_PATTERN.test(trimmed)) return true;
  return EMOJI_ONLY_PATTERN.test(trimmed) && !/[\p{L}\p{N}]/u.test(trimmed);
}

export async function captureChatMessage(
  ctx: CaptureContext,
  input: ChatMessageInput
): Promise<CaptureWriteResult> {
  if (!ctx.config.enabled) {
    return { written: 0, skipped: 0, classes: [], reason: "disabled" };
  }

  const result = createEmptyResult();
  const markerResult = ctx.markers.enabled
    ? parseMarkers(input.text, { prefix: ctx.markers.prefix })
    : { markers: [], malformed: [] };

  for (const marker of markerResult.markers) {
    await writeCandidate(ctx, result, {
      memoryClass: marker.memoryClass,
      body: marker.body,
      name: generateName(marker.memoryClass, marker.body),
      metadata: {
        memoryClass: marker.memoryClass,
        source: "marker",
        role: input.role,
        sessionId: input.sessionId,
        messageId: input.messageId,
        rawLine: marker.rawLine,
        timestamp: input.timestamp ?? Date.now(),
      },
    });
  }

  if (input.role !== "user") return result;

  const markerLines = markerResult.markers.map((marker) => marker.rawLine);
  const textWithoutMarkers = stripMarkerLines(input.text, markerLines);

  if (isMessageTrivialForInstruction(input.text, ctx.config.trivialMessageMinLength, markerLines)) {
    if (result.written === 0) result.reason = "trivial";
    return result;
  }

  for (const detector of getPatternDetectors()) {
    if (result.classes.includes(detector.memoryClass)) continue;
    if (detector.pattern.test(textWithoutMarkers)) {
      await writeCandidate(ctx, result, {
        memoryClass: detector.memoryClass,
        body: input.text,
        name: generateName(detector.memoryClass, input.text),
        metadata: {
          memoryClass: detector.memoryClass,
          detector: `regex:${detector.memoryClass}`,
          role: input.role,
          sessionId: input.sessionId,
          messageId: input.messageId,
          timestamp: input.timestamp ?? Date.now(),
        },
      });
    }
  }

  await writeCandidate(ctx, result, {
    memoryClass: "UserInstruction",
    body: input.text,
    name: generateName("UserInstruction", input.text),
    metadata: {
      memoryClass: "UserInstruction",
      chronological: true,
      sessionId: input.sessionId,
      messageId: input.messageId,
      timestamp: input.timestamp ?? Date.now(),
    },
  });

  return result;
}

export async function captureToolExecuteAfter(
  ctx: CaptureContext,
  input: ToolExecuteAfterInput
): Promise<CaptureWriteResult> {
  if (!ctx.config.enabled) {
    return { written: 0, skipped: 0, classes: [], reason: "disabled" };
  }

  const toolName = input.toolName.toLowerCase();
  const result = createEmptyResult();

  if (/(edit|write|patch)/.test(toolName)) {
    const paths = getToolPaths(input.args);
    const body = paths.length > 0
      ? `File edit via ${input.toolName}: ${paths.join(", ")}`
      : `File edit via ${input.toolName}`;
    await writeCandidate(ctx, result, {
      memoryClass: "FileEdit",
      body,
      name: generateName("FileEdit", body),
      metadata: {
        memoryClass: "FileEdit",
        toolName: input.toolName,
        paths,
        sessionId: input.sessionId,
        timestamp: input.timestamp ?? Date.now(),
      },
    });
    return result;
  }

  if (/(bash|shell|cmd|pwsh|powershell)/.test(toolName)) {
    const command = typeof input.args.command === "string" ? input.args.command : "";
    const body = `Command run via ${input.toolName}: ${command || "<unknown>"}${input.exitCode === undefined ? "" : ` (exit ${input.exitCode})`}`;
    await writeCandidate(ctx, result, {
      memoryClass: "CommandRun",
      body,
      name: generateName("CommandRun", body),
      metadata: {
        memoryClass: "CommandRun",
        toolName: input.toolName,
        command,
        exitCode: input.exitCode,
        sessionId: input.sessionId,
        timestamp: input.timestamp ?? Date.now(),
      },
    });
  }

  return result;
}

export function captureMessagePartUpdated(
  ctx: CaptureContext,
  input: MessagePartUpdatedInput
): CaptureWriteResult {
  // no-op in this task -- captured by Task 4 stub for Task 10 integration proof.
  safeLog("[capture] message.part.updated stub", {
    partType: input.partType,
    sessionId: input.sessionId,
    messageId: input.messageId,
  });
  return { written: 0, skipped: 0, classes: [] };
}

export function captureSessionIdle(
  ctx: CaptureContext,
  input: SessionIdleInput
): CaptureWriteResult {
  safeLog("[capture] session.idle stub", { sessionId: input.sessionId });
  return { written: 0, skipped: 0, classes: [] };
}

export async function captureSessionCompacted(
  ctx: CaptureContext,
  input: SessionCompactedInput
): Promise<CaptureWriteResult> {
  if (!ctx.config.enabled) {
    return { written: 0, skipped: 0, classes: [], reason: "disabled" };
  }

  if (!input.summary || isTrivialMessage(input.summary, ctx.config.trivialMessageMinLength)) {
    return { written: 0, skipped: 0, classes: [], reason: "empty-summary" };
  }

  const result = createEmptyResult();
  await writeCandidate(ctx, result, {
    memoryClass: "Achievement",
    body: input.summary,
    name: generateName("Achievement", input.summary),
    metadata: {
      memoryClass: "Achievement",
      subkind: "session.compacted",
      sessionId: input.sessionId,
      timestamp: input.timestamp ?? Date.now(),
    },
  });
  return result;
}

function isMessageTrivialForInstruction(
  text: string,
  minLength: number,
  markerLines: string[]
): boolean {
  if (isTrivialMessage(text, minLength)) return true;
  if (markerLines.length === 0) return false;

  const textWithoutMarkers = stripMarkerLines(text, markerLines);
  return isTrivialMessage(textWithoutMarkers, minLength);
}

function stripMarkerLines(text: string, markerLines: string[]): string {
  return markerLines.reduce(
    (remaining, markerLine) => remaining.replace(markerLine, ""),
    text
  );
}

function getPatternDetectors(): Array<{ memoryClass: MemoryClass; pattern: RegExp }> {
  return [
    { memoryClass: "Restriction", pattern: RESTRICTION_PATTERNS },
    { memoryClass: "StylePreference", pattern: STYLE_PREFERENCE_PATTERNS },
    { memoryClass: "Problem", pattern: PROBLEM_PATTERNS },
    { memoryClass: "FixAttempt", pattern: FIX_ATTEMPT_PATTERNS },
    { memoryClass: "Achievement", pattern: ACHIEVEMENT_PATTERNS },
  ];
}

async function writeCandidate(
  ctx: CaptureContext,
  result: CaptureWriteResult,
  candidate: Candidate
): Promise<void> {
  try {
    const writeResult = await ctx.client.addMemory({
      name: candidate.name,
      episodeBody: candidate.body,
      groupId: ctx.groupId,
      source: "deterministic",
      metadata: candidate.metadata,
    });

    if (writeResult.success) {
      result.written += 1;
      addDistinctClass(result.classes, candidate.memoryClass);
    } else {
      result.skipped += 1;
      safeLog("[capture] addMemory failed", { error: writeResult.error, memoryClass: candidate.memoryClass });
    }
  } catch (error) {
    result.skipped += 1;
    safeLog("[capture] addMemory threw", { error: String(error), memoryClass: candidate.memoryClass });
  }
}

function createEmptyResult(): CaptureWriteResult {
  return { written: 0, skipped: 0, classes: [] };
}

function addDistinctClass(classes: MemoryClass[], memoryClass: MemoryClass): void {
  if (!classes.includes(memoryClass)) classes.push(memoryClass);
}

function safeLog(message: string, data?: unknown): void {
  try {
    log(message, data);
  } catch {
    // Capture is fail-open and must never make hooks or unit tests fail on logging I/O.
  }
}

function generateName(memoryClass: MemoryClass, body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  const preview = compact.slice(0, 80);
  return `${memoryClass}: ${preview}${compact.length > 80 ? "..." : ""}`;
}

function getToolPaths(args: Record<string, unknown>): string[] {
  return [args.filePath, args.path, args.target]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}
