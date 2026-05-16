import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { GraphitiClient, type AddMemoryParams } from "./graphiti-client.js";
import {
  parseLegacyEpisode,
  runMigration,
  type MigrationContext,
} from "./migration.js";
import type { Episode } from "../types/graphiti.js";

type EpisodeFixture = Episode & { metadata?: Record<string, unknown>; id?: string };
type AddMemoryCall = AddMemoryParams;

const originalFetch = globalThis.fetch;

function episode(
  uuid: string,
  content: string,
  metadata?: Record<string, unknown>
): EpisodeFixture {
  return {
    uuid,
    id: uuid,
    name: content.slice(0, 30),
    content,
    source: "text",
    source_description: "fixture",
    created_at: "2026-01-01T00:00:00.000Z",
    group_id: "project-group",
    ...(metadata ? { metadata } : {}),
  };
}

function createContext(episodes: EpisodeFixture[], addResults?: Array<{ success: boolean; error?: string }>) {
  const calls: AddMemoryCall[] = [];
  let resultIndex = 0;
  const client = {
    getEpisodes: mock(async () => ({ success: true as const, data: { episodes } })),
    addMemory: mock(async (payload: AddMemoryCall) => {
      calls.push(payload);
      const result = addResults?.[resultIndex++];
      if (result && !result.success) {
        return { success: false as const, error: result.error ?? "failed", isUnreachable: false };
      }
      return { success: true as const, data: { message: "ok" } };
    }),
  } satisfies MigrationContext["client"];

  return { ctx: { client, groupId: "project-group" }, client, calls };
}

function createSSEResponse(data: object, headers?: Record<string, string>): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(data)}\n\n`, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      ...headers,
    },
  });
}

function initializeResponse(): Response {
  return createSSEResponse(
    {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: {} },
    },
    { "mcp-session-id": "session-1" }
  );
}

function toolResponse(data: object): Response {
  return createSSEResponse({
    jsonrpc: "2.0",
    id: 2,
    result: { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] },
  });
}

describe("parseLegacyEpisode", () => {
  it("parses a legacy type prefix and returns the remainder", () => {
    expect(parseLegacyEpisode("[TYPE: preference] use TS")).toEqual({
      legacyType: "preference",
      remainder: "use TS",
    });
  });

  it("returns null for bodies without a type prefix", () => {
    expect(parseLegacyEpisode("use TS")).toBeNull();
  });

  it("returns null for malformed empty type prefixes", () => {
    expect(parseLegacyEpisode("[TYPE: ] use TS")).toBeNull();
  });

  it("parses prefixes after leading whitespace", () => {
    expect(parseLegacyEpisode("  \n[TYPE: architecture] event bus")).toEqual({
      legacyType: "architecture",
      remainder: "event bus",
    });
  });
});

describe("runMigration", () => {
  it("reports mapped records in dry-run mode without writing", async () => {
    const { ctx, client } = createContext([
      episode("e1", "[TYPE: project-config] run tests in Docker"),
      episode("e2", "[TYPE: preference] terse output"),
      episode("e3", "[TYPE: architecture] CLI delegates to services"),
      episode("e4", "ordinary episode"),
    ]);

    const result = await runMigration(ctx, { dryRun: true });

    expect(result.status).toBe("dry-run");
    expect(result.counts.scanned).toBe(4);
    expect(result.counts.byOldType).toEqual({
      "project-config": 1,
      preference: 1,
      architecture: 1,
    });
    expect(result.counts.mappedByNewClass).toEqual({
      UserInstruction: 1,
      StylePreference: 1,
      ArchitecturalDecision: 1,
    });
    expect(result.counts.wouldWrite).toBe(3);
    expect(result.counts.written).toBe(0);
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("reports unmapped legacy types without writing or throwing", async () => {
    const { ctx, client } = createContext([
      episode("e1", "[TYPE: conversation] old chat"),
      episode("e2", "[TYPE: weird] unknown"),
    ]);

    const result = await runMigration(ctx, { dryRun: true });

    expect(result.counts.unmapped).toBe(2);
    expect(result.unmappedTypes).toEqual([
      { type: "conversation", count: 1 },
      { type: "weird", count: 1 },
    ]);
    expect(result.counts.wouldWrite).toBe(0);
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("writes mapped records in apply mode with migration metadata", async () => {
    const { ctx, calls } = createContext([
      episode("source-1", "[TYPE: project-config] use Bun"),
      episode("source-2", "[TYPE: learned-pattern] parser is regex-only"),
    ]);

    const result = await runMigration(ctx, { dryRun: false });

    expect(result.status).toBe("applied");
    expect(result.counts.written).toBe(2);
    expect(result.counts.failedWrites).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      source: "migration",
      groupId: "project-group",
      episodeBody: "use Bun",
      metadata: {
        mappedClass: "UserInstruction",
        migration: {
          source: "[TYPE: project-config]",
          sourceEpisodeId: "source-1",
        },
      },
    });
    expect((calls[0]!.metadata!.migration as { migratedAt?: string }).migratedAt).toBeString();
  });

  it("skips source records that already have migrated records in the same batch", async () => {
    const { ctx, client } = createContext([
      episode("source-1", "[TYPE: preference] prefer strict TS"),
      episode("migrated-1", "prefer strict TS", {
        migration: { source: "[TYPE: preference]", sourceEpisodeId: "source-1" },
      }),
    ]);

    const result = await runMigration(ctx, { dryRun: false });

    expect(result.counts.alreadyMigrated).toBe(1);
    expect(result.counts.wouldWrite).toBe(0);
    expect(result.counts.written).toBe(0);
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("counts failed writes without aborting the migration", async () => {
    const { ctx } = createContext(
      [
        episode("e1", "[TYPE: preference] one"),
        episode("e2", "[TYPE: preference] two"),
        episode("e3", "[TYPE: preference] three"),
      ],
      [{ success: true }, { success: false, error: "boom" }, { success: true }]
    );

    const result = await runMigration(ctx, { dryRun: false });

    expect(result.counts.written).toBe(2);
    expect(result.counts.failedWrites).toBe(1);
    expect(result.errors).toEqual(["boom"]);
  });

  it("passes the requested limit to getEpisodes", async () => {
    const episodes = Array.from({ length: 100 }, (_value, index) =>
      episode(`e${index}`, "[TYPE: preference] bounded")
    );
    const { ctx, client } = createContext(episodes);

    await runMigration(ctx, { dryRun: true, limit: 5 });

    expect(client.getEpisodes).toHaveBeenCalledWith({ groupIds: ["project-group"], maxEpisodes: 5 });
  });

  it("uses GraphitiClient addMemory sanitization for apply writes", async () => {
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") return initializeResponse();
      return toolResponse({ message: "ok" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new GraphitiClient("http://graphiti.test/mcp");
    const addClient = {
      getEpisodes: mock(async () => ({
        success: true as const,
        data: {
          episodes: [episode("e1", "[TYPE: preference] OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxx")],
        },
      })),
      addMemory: client.addMemory.bind(client),
    };
    await runMigration({ client: addClient, groupId: "project-group" }, { dryRun: false });

    const addCall = fetchMock.mock.calls.find((call) => {
      const body = JSON.parse(String(call[1]?.body));
      return body.params?.name === "add_memory";
    });
    const addRequest = JSON.parse(String(addCall?.[1]?.body));
    expect(addRequest.params.arguments.episode_body).toContain("[REDACTED:env_secret]");
    expect(addRequest.params.arguments.episode_body).not.toContain("sk-xxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("returns no-op for an empty store", async () => {
    const { ctx } = createContext([]);

    const result = await runMigration(ctx, { dryRun: true });

    expect(result.status).toBe("no-op");
    expect(result.counts.scanned).toBe(0);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
