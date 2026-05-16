import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphitiClient } from "./graphiti-client.js";
import { resetLogger } from "./logger.js";
import {
  performRecall,
  type RecallContext,
  type RecallTrigger,
} from "./recall.js";
import type { Episode, Fact, Node } from "../types/graphiti.js";

type RecallClient = Pick<GraphitiClient, "searchNodes" | "searchFacts" | "getEpisodes">;

function createNode(uuid: string, summary = `Node ${uuid}`): Node {
  return {
    uuid,
    name: uuid,
    labels: [],
    summary,
    created_at: "2026-01-01T00:00:00Z",
    group_id: "project-group",
  };
}

function createFact(uuid: string, fact = `Fact ${uuid}`): Fact {
  return {
    uuid,
    fact,
    source_node_uuid: `${uuid}-source`,
    target_node_uuid: `${uuid}-target`,
    created_at: "2026-01-01T00:00:00Z",
    expired_at: null,
    group_id: "project-group",
  };
}

function createEpisode(uuid: string, content = `Episode ${uuid}`): Episode {
  return {
    uuid,
    name: uuid,
    content,
    source: "message",
    source_description: "test",
    created_at: "2026-01-01T00:00:00Z",
    group_id: "project-group",
  };
}

function createContext(overrides: Partial<RecallContext> = {}) {
  const client: RecallClient = {
    searchNodes: mock(async () => ({ success: true as const, data: { nodes: [] } })),
    searchFacts: mock(async () => ({ success: true as const, data: { facts: [] } })),
    getEpisodes: mock(async () => ({ success: true as const, data: { episodes: [] } })),
  };

  const ctx: RecallContext = {
    client,
    config: { enabled: true, topN: 5, broadcastCompat: false },
    projectGroupId: "project-group",
    profileGroupId: "profile-group",
    ...overrides,
  };

  return { ctx, client };
}

function runRecall(ctx: RecallContext, trigger: RecallTrigger = "session-start", query = "test query") {
  return performRecall(ctx, { query, trigger });
}

describe("performRecall", () => {
  let testHome: string;

  beforeEach(() => {
    mock.restore();
    resetLogger();
    testHome = join(tmpdir(), `graphiti-recall-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;
  });

  afterEach(() => {
    resetLogger();
    delete process.env.GRAPHITI_TEST_HOME;
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("returns bounded top-N results from large node and fact result sets", async () => {
    const nodes = Array.from({ length: 50 }, (_, index) => createNode(`node-${index}`));
    const facts = Array.from({ length: 50 }, (_, index) => createFact(`fact-${index}`));
    const { ctx, client } = createContext();

    client.searchNodes = mock(async () => ({ success: true as const, data: { nodes } }));
    client.searchFacts = mock(async () => ({ success: true as const, data: { facts } }));

    const result = await runRecall(ctx);

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(5);
    expect(result.rawCount).toBe(100);
    expect(result.bounded).toBe(true);
  });

  it("returns disabled without client calls when recall is disabled", async () => {
    const { ctx, client } = createContext({
      config: { enabled: false, topN: 5, broadcastCompat: false },
    });

    const result = await runRecall(ctx);

    expect(result.status).toBe("disabled");
    expect(result.items).toEqual([]);
    expect(client.searchNodes).not.toHaveBeenCalled();
    expect(client.searchFacts).not.toHaveBeenCalled();
    expect(client.getEpisodes).not.toHaveBeenCalled();
  });

  it("uses broadcast fallback only when broadcastCompat is true on session start", async () => {
    const { ctx, client } = createContext({
      config: { enabled: true, topN: 5, broadcastCompat: true },
    });
    client.getEpisodes = mock(async () => ({
      success: true as const,
      data: { episodes: [createEpisode("episode-1")] },
    }));

    const result = await runRecall(ctx);

    expect(result.status).toBe("broadcast-fallback");
    expect(result.items).toHaveLength(1);
    expect(client.getEpisodes).toHaveBeenCalled();
  });

  it("does not call getEpisodes for default session-start recall when a query exists", async () => {
    const { ctx, client } = createContext();

    await runRecall(ctx, "session-start", "specific user request");

    expect(client.searchNodes).toHaveBeenCalled();
    expect(client.searchFacts).toHaveBeenCalled();
    expect(client.getEpisodes).not.toHaveBeenCalled();
  });

  it("fails open without throwing when all client reads throw", async () => {
    const { ctx, client } = createContext();
    client.searchNodes = mock(async () => { throw new Error("nodes down"); });
    client.searchFacts = mock(async () => { throw new Error("facts down"); });

    const result = await runRecall(ctx);

    expect(result.status).toBe("failed-open");
    expect(result.items).toEqual([]);
    expect(result.reason).toContain("nodes down");
  });

  it("keeps successful partial results when one read fails", async () => {
    const { ctx, client } = createContext();
    client.searchNodes = mock(async () => ({
      success: true as const,
      data: { nodes: [createNode("node-1", "Successful node")] },
    }));
    client.searchFacts = mock(async () => { throw new Error("facts down"); });

    const result = await runRecall(ctx);

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.text).toBe("Successful node");
  });

  it("strips private blocks from recalled text", async () => {
    const { ctx, client } = createContext();
    client.searchNodes = mock(async () => ({
      success: true as const,
      data: { nodes: [createNode("node-1", "Keep <private>secret</private> visible")] },
    }));

    const result = await runRecall(ctx);

    expect(result.items[0]?.text).toBe("Keep [REDACTED] visible");
    expect(result.items[0]?.text).not.toContain("secret");
  });

  it("drops fully private recalled items", async () => {
    const { ctx, client } = createContext();
    client.searchNodes = mock(async () => ({
      success: true as const,
      data: { nodes: [createNode("node-1", "<private>secret</private>")] },
    }));

    const result = await runRecall(ctx);

    expect(result.status).toBe("ok");
    expect(result.items).toEqual([]);
    expect(result.rawCount).toBe(1);
  });

  it("honors a topN override", async () => {
    const { ctx, client } = createContext({
      config: { enabled: true, topN: 10, broadcastCompat: false },
    });
    client.searchNodes = mock(async () => ({
      success: true as const,
      data: { nodes: [createNode("node-1"), createNode("node-2"), createNode("node-3")] },
    }));

    const result = await performRecall(ctx, { query: "test", trigger: "explicit-tool", topN: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.bounded).toBe(true);
  });

  it("treats non-positive topN as disabled", async () => {
    const { ctx, client } = createContext();

    const result = await performRecall(ctx, { query: "test", trigger: "explicit-tool", topN: 0 });

    expect(result.status).toBe("disabled");
    expect(result.reason).toBe("non-positive topN");
    expect(client.searchNodes).not.toHaveBeenCalled();
  });

  it("passes explicit tool queries and topN bounds to search calls", async () => {
    const { ctx, client } = createContext();

    const result = await performRecall(ctx, {
      query: "react hooks",
      trigger: "explicit-tool",
      topN: 3,
    });

    expect(result.trigger).toBe("explicit-tool");
    expect(client.searchNodes).toHaveBeenCalledWith("react hooks", {
      groupIds: ["project-group"],
      maxNodes: 3,
    });
    expect(client.searchFacts).toHaveBeenCalledWith("react hooks", {
      groupIds: ["project-group"],
      maxFacts: 3,
    });
  });

  it("dedupes merged results by uuid", async () => {
    const { ctx, client } = createContext({
      config: { enabled: true, topN: 5, broadcastCompat: true },
    });
    client.searchNodes = mock(async () => ({
      success: true as const,
      data: { nodes: [createNode("shared-id", "Node text")] },
    }));
    client.getEpisodes = mock(async () => ({
      success: true as const,
      data: { episodes: [createEpisode("shared-id", "Episode text")] },
    }));

    const result = await runRecall(ctx);

    expect(result.items).toHaveLength(1);
    expect(result.rawCount).toBe(2);
  });
});
