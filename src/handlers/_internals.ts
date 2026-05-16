import type { Part } from "@opencode-ai/sdk";
import { GraphitiClient } from "../services/graphiti-client.js";
import { getProjectNamespace } from "../services/namespace.js";
import { generatePartId, assertValidPartId } from "../services/ids.js";
import type { CaptureContext } from "../services/capture.js";
import type { RecallContext, RecalledItem } from "../services/recall.js";
import type { GraphitiConfig } from "../types/graphiti.js";
import type { MemoryScope, MemoryType } from "../types/index.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;
const TYPE_PREFIX_PATTERN = /^\[TYPE:\s*([^\]]+)\]\s*/;

function getKeywordPattern(patterns: string[]): RegExp {
  return new RegExp(`\\b(${patterns.join("|")})\\b`, "i");
}

export const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`graphiti\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

export function detectMemoryKeyword(text: string, patterns: string[]): boolean {
  const textWithoutCode = removeCodeBlocks(text);
  const pattern = getKeywordPattern(patterns);
  return pattern.test(textWithoutCode);
}

export function generateEpisodeName(content: string): string {
  return content.slice(0, 50).replace(/\n/g, " ").trim() + (content.length > 50 ? "..." : "");
}

export function generateTypedContent(content: string, type: MemoryType): string {
  return `[TYPE: ${type}] ${content}`;
}

interface ParsedContent {
  type: string;
  content: string;
}

export type EventHookData = { event: { type: string; properties?: unknown } };

/**
 * Narrows untyped OpenCode event payloads to indexable property bags.
 * TODO: replace with SDK event property types when they are available.
 */
function toPropertyBag(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? toPropertyBag(value) : {};
}

export function getStringProperty(record: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function getNumberProperty(record: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number") return value;
  }
  return undefined;
}

export function createCaptureContext(
  client: GraphitiClient,
  groupId: string,
  config: GraphitiConfig
): CaptureContext {
  return {
    client,
    groupId,
    config: config.capture,
    markers: config.markers,
  };
}

export function createRecallContext(
  client: GraphitiClient,
  projectGroupId: string,
  config: GraphitiConfig
): RecallContext {
  return {
    client,
    config: config.recall,
    projectGroupId,
    profileGroupId: config.profileGroupId,
  };
}

function formatRecallBlock(items: RecalledItem[]): string {
  if (items.length === 0) return "";

  return [
    `[MEMORY RECALL - top ${items.length}]`,
    ...items.map((item) => `- (${item.kind}) ${item.text}`),
  ].join("\n");
}

export function injectRecallPart(
  output: { parts: Part[]; message: { id: string } },
  sessionID: string,
  items: RecalledItem[]
): void {
  const recallContext = formatRecallBlock(items);
  if (!recallContext) return;

  const recallPart: Part = {
    id: generatePartId(),
    sessionID,
    messageID: output.message.id,
    type: "text",
    text: recallContext,
    synthetic: true,
  };

  assertValidPartId(recallPart.id);
  output.parts.unshift(recallPart);
}

export function parseTypePrefix(rawContent: string): ParsedContent {
  const match = rawContent.match(TYPE_PREFIX_PATTERN);
  if (match && match[1]) {
    return {
      type: match[1].trim(),
      content: rawContent.slice(match[0].length),
    };
  }
  return {
    type: "unknown",
    content: rawContent,
  };
}

export function resolveGroupId(
  scope: MemoryScope | undefined,
  projectDir: string,
  profileGroupId: string
): string {
  if (scope === "user") {
    return profileGroupId;
  }
  return getProjectNamespace(projectDir);
}
