/**
 * Memory Integration Tests (Task 10)
 *
 * Proves that Tasks 1-9 components work together:
 *   - sanitizer is never bypassed on any write path
 *   - no broadcast injection by default
 *   - capture + marker + shadow + recall coexist
 *   - shadow extractor timeout does not block deterministic capture
 *   - compaction + migration consistency
 *   - optional real-backend gate
 */
import { afterEach, beforeEach, describe, expect, it, mock, test } from "bun:test";
import { GraphitiClient, type AddMemoryParams, type GraphitiResult } from "../../services/graphiti-client.js";
import {
  captureChatMessage,
  captureSessionCompacted,
  type CaptureContext,
} from "../../services/capture.js";
import {
  ShadowExtractor,
  type ShadowExtractorProvider,
  type ShadowExtractorOptions,
} from "../../services/shadow-extractor.js";
import {
  performRecall,
  type RecallContext,
} from "../../services/recall.js";
import {
  runMigration,
  type MigrationContext,
} from "../../services/migration.js";
import type { Episode, Node, Fact } from "../../types/graphiti.js";
import type { SanitizedPayload } from "../../services/sanitizer.js";

// в”Ђв”Ђв”Ђ Secret fixture used across all scenarios в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export const RAW_API_KEY = "sk-leak-AAAAAAAAAAAAAAAAAAAAAAAA";
export const RAW_EMAIL = "bob@example.com";
export const RAW_BEARER = "abcdef.ghi.jklmno";
export const SECRET_TEXT = [
  `OPENAI_API_KEY=${RAW_API_KEY} must not be sent`,
  `to ${RAW_EMAIL} with Authorization: Bearer ${RAW_BEARER}`,
].join(" ");

export function assertNoRawSecrets(text: string, label: string): void {
  expect(text).not.toContain(RAW_API_KEY);
  expect(text).not.toContain(RAW_EMAIL);
  expect(text).not.toContain(RAW_BEARER);
}

/** Stricter check: raw secrets absent AND at least one [REDACTED:] present. */
export function assertRedacted(text: string, label: string): void {
  assertNoRawSecrets(text, label);
  expect(text).toMatch(/\[REDACTED:/);
}

// в”Ђв”Ђв”Ђ Transport-level mock helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface RecordedAddMemoryCall {
  name: string;
  episode_body: string;
  source: string;
  metadata?: Record<string, unknown>;
  group_id?: string;
}

const originalFetch = globalThis.fetch;

/**
 * Creates a real GraphitiClient backed by a mocked fetch.
 * Records all add_memory tool-call arguments for inspection.
 */
export function createTransportMock() {
  const addMemoryCalls: RecordedAddMemoryCall[] = [];
  let callCount = 0;

  const mockFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // First request is always initialize
    if (body.method === "initialize") {
      const sseBody = `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "MockGraphiti", version: "0.0.0" },
        },
      })}\n\n`;
      return new Response(sseBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "mock-session-1",
        },
      });
    }

    // Tool calls
    if (body.method === "tools/call") {
      const toolName = body.params?.name;
      const toolArgs = body.params?.arguments ?? {};

      if (toolName === "add_memory") {
        addMemoryCalls.push({
          name: toolArgs.name as string,
          episode_body: toolArgs.episode_body as string,
          source: toolArgs.source as string,
          metadata: toolArgs.metadata as Record<string, unknown>,
          group_id: toolArgs.group_id as string | undefined,
        });
      }

      const sseBody = `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: '{"message":"ok"}' }],
          structuredContent: { message: "ok" },
          isError: false,
        },
      })}\n\n`;
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    // Fallback
    return new Response("", { status: 404 });
  });

  globalThis.fetch = mockFetch as unknown as typeof fetch;
  const client = new GraphitiClient("http://mock-graphiti.test/mcp/");
  return { client, addMemoryCalls, mockFetch };
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// в”Ђв”Ђв”Ђ Capture context builder в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export function buildCaptureCtx(client: Pick<GraphitiClient, "addMemory">): CaptureContext {
  return {
    client,
    groupId: "integration-test-group",
    config: {
      enabled: true,
      trivialMessageMinLength: 4,
      explicitClassMarkers: ["@graphiti"],
      ratificationKeywords: { positive: [], negative: [] },
      ratificationWindowTurns: 1,
      unverifiedAutoExpireMs: 86_400_000,
    },
    markers: { enabled: true, prefix: "@graphiti" },
  };
}

// в”Ђв”Ђв”Ђ Method-level mock helpers (for recall / migration) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export function createNode(uuid: string, summary: string): Node {
  return {
    uuid,
    name: uuid,
    labels: [],
    summary,
    created_at: "2026-01-01T00:00:00Z",
    group_id: "integration-test-group",
  };
}

export function createFact(uuid: string, fact: string): Fact {
  return {
    uuid,
    fact,
    source_node_uuid: `${uuid}-src`,
    target_node_uuid: `${uuid}-tgt`,
    created_at: "2026-01-01T00:00:00Z",
    expired_at: null,
    group_id: "integration-test-group",
  };
}

export function createEpisode(uuid: string, content: string, extra?: Partial<Episode>): Episode {
  return {
    uuid,
    name: uuid,
    content,
    source: "message",
    source_description: "test",
    created_at: "2026-01-01T00:00:00Z",
    group_id: "integration-test-group",
    ...extra,
  };
}

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
export { afterEach, beforeEach, describe, expect, it, mock, test };
export { GraphitiClient, captureChatMessage, captureSessionCompacted, ShadowExtractor, performRecall, runMigration };
export type {
  AddMemoryParams,
  CaptureContext,
  Episode,
  Fact,
  GraphitiResult,
  MigrationContext,
  Node,
  RecallContext,
  SanitizedPayload,
  ShadowExtractorOptions,
  ShadowExtractorProvider,
};


