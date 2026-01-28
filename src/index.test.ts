import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "./config.js";
import { resetLogger } from "./services/logger.js";

const originalFetch = globalThis.fetch;

const mockToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
};

describe("GraphitiPlugin", () => {
  let testHome: string;
  let globalConfigPath: string;
  let projectDir: string;
  let mockFetch: ReturnType<typeof mock>;
  let mockCtx: PluginInput;

  function createSSEResponse(
    data: object,
    headers?: Record<string, string>
  ): Response {
    const sseBody = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
    return new Response(sseBody, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        ...headers,
      },
    });
  }

  function createInitializeResponse(sessionId: string): Response {
    return createSSEResponse(
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "Graphiti", version: "1.0.0" },
        },
      },
      { "mcp-session-id": sessionId }
    );
  }

  function createToolResponse(data: object): Response {
    return createSSEResponse({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      },
    });
  }

  beforeEach(() => {
    resetLogger();
    testHome = join(tmpdir(), `graphiti-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;

    globalConfigPath = join(testHome, ".config", "opencode", "graphiti.jsonc");
    projectDir = join(testHome, "test-project");
    mkdirSync(projectDir, { recursive: true });

    resetConfig();

    delete process.env.GRAPHITI_URL;
    delete process.env.GRAPHITI_GROUP_ID;

    mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        graphitiUrl: "http://localhost:8000",
        groupId: "test-group",
        profileGroupId: "test-profile-group",
        maxMemories: 5,
        maxProjectMemories: 10,
        maxProfileItems: 5,
        injectProfile: true,
        keywordPatterns: ["test-keyword"],
        compactionThreshold: 0.8,
      })
    );

    mockFetch = mock(() => Promise.resolve(new Response()));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    mockCtx = {
      directory: projectDir,
      client: {
        provider: {
          list: mock(() => Promise.resolve({ data: { all: [] } })),
        },
      },
    } as unknown as PluginInput;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    delete process.env.GRAPHITI_TEST_HOME;
    delete process.env.GRAPHITI_URL;
    delete process.env.GRAPHITI_GROUP_ID;
    resetConfig();
    resetLogger();
  });

  describe("Tool registration", () => {
    it("exposes graphiti tool (not supermemory)", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      expect(plugin.tool).toBeDefined();
      expect(plugin.tool!.graphiti).toBeDefined();
      expect((plugin.tool as Record<string, unknown>).supermemory).toBeUndefined();
    });
  });

  describe("mode: help", () => {
    it("returns static help text without API call", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "help" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.help).toBeDefined();
      expect(typeof parsed.help).toBe("string");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("defaults to help mode when no mode specified", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({}, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.help).toBeDefined();
    });
  });

  describe("mode: add", () => {
    it("requires content parameter", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "add" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("content");
    });

    it("generates UUID client-side and returns as memoryId", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "server-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "Test memory content",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.memoryId).toBeDefined();
      expect(typeof parsed.memoryId).toBe("string");
      expect(parsed.memoryId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("stores type as [TYPE: x] prefix in episode_body", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "Test memory content",
        type: "preference",
      }, mockToolContext);

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.arguments.episode_body).toContain("[TYPE: preference]");
    });

    it("uses profileGroupId for scope: user", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "User preference",
        scope: "user",
      }, mockToolContext);

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.arguments.group_id).toBe("test-profile-group");
    });

    it("uses getProjectNamespace() for scope: project (default)", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "Project config",
      }, mockToolContext);

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.arguments.group_id).toMatch(/^test-group_[a-f0-9]{8}$/);
    });

    it("strips private content before storing", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "API key is <private>sk-abc123</private>",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.arguments.episode_body).toContain("[REDACTED]");
      expect(toolBody.params.arguments.episode_body).not.toContain("sk-abc123");
    });

    it("rejects fully private content", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "<private>secret</private>",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("private");
    });

    it("generates deterministic name from content (first 50 chars)", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const longContent =
        "This is a very long memory content that exceeds fifty characters definitely";
      await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: longContent,
      }, mockToolContext);

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.arguments.name.length).toBeLessThanOrEqual(53);
      expect(toolBody.params.arguments.name).toContain("...");
    });

    it("returns memoryId, message, scope, type on success", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episode_uuid: "test-uuid" }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "Test",
        type: "preference",
        scope: "user",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.memoryId).toBeDefined();
      expect(parsed.message).toBe("Memory saved successfully");
      expect(parsed.scope).toBe("user");
      expect(parsed.type).toBe("preference");
      expect(parsed.id).toBeUndefined();
    });
  });

  describe("mode: search", () => {
    it("requires query parameter", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "search" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("query");
    });

    it("returns merged nodes and facts without similarity scores", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            nodes: [
              {
                uuid: "node-1",
                name: "Test Node",
                labels: [],
                summary: "[TYPE: preference] Dark mode preference",
                created_at: "2024-01-01T00:00:00Z",
                group_id: "test-group",
              },
            ],
          })
        )
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            facts: [
              {
                uuid: "fact-1",
                fact: "User prefers TypeScript",
                source_node_uuid: "n1",
                target_node_uuid: "n2",
                created_at: "2024-01-01T00:00:00Z",
                expired_at: null,
                group_id: "test-group",
              },
            ],
          })
        )
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "search",
        query: "test query",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBe(2);
      expect(parsed.results[0].similarity).toBeUndefined();
    });

    it("parses and strips [TYPE: x] prefix from results", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            nodes: [
              {
                uuid: "node-1",
                name: "Test",
                labels: [],
                summary: "[TYPE: preference] Dark mode",
                created_at: "2024-01-01T00:00:00Z",
                group_id: "test-group",
              },
            ],
          })
        )
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ facts: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "search",
        query: "test",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.results[0].type).toBe("preference");
      expect(parsed.results[0].content).toBe("Dark mode");
    });

    it("uses profileGroupId for scope: user", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ nodes: [] }))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ facts: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "search",
        query: "test",
        scope: "user",
      }, mockToolContext);

      const nodesCall = mockFetch.mock.calls[2]!;
      const nodesBody = JSON.parse(nodesCall[1].body);
      expect(nodesBody.params.arguments.group_ids).toEqual(["test-profile-group"]);
    });
  });

  describe("mode: profile", () => {
    it("returns profile nodes as facts", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            nodes: [
              {
                uuid: "p1",
                name: "Pref1",
                labels: ["Preference"],
                summary: "Prefers dark mode",
                created_at: "2024-01-01T00:00:00Z",
                group_id: "profile",
              },
            ],
          })
        )
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "profile" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.profile)).toBe(true);
      expect(parsed.profile[0].fact).toBe("Prefers dark mode");
      expect(parsed.profile[0].createdAt).toBeDefined();
    });

    it("uses default query when not provided", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ nodes: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({ mode: "profile" }, mockToolContext);

      const searchCall = mockFetch.mock.calls[1]!;
      const searchBody = JSON.parse(searchCall[1].body);
      expect(searchBody.params.arguments.query).toBe("user preferences");
    });

    it("uses custom query when provided", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ nodes: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "profile",
        query: "coding style",
      }, mockToolContext);

      const searchCall = mockFetch.mock.calls[1]!;
      const searchBody = JSON.parse(searchCall[1].body);
      expect(searchBody.params.arguments.query).toBe("coding style");
    });
  });

  describe("mode: list", () => {
    it("returns episodes with memoryId = uuid", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            episodes: [
              {
                uuid: "ep-uuid-123",
                name: "Test Episode",
                content: "[TYPE: preference] Test content",
                source: "text",
                source_description: "",
                created_at: "2024-01-01T00:00:00Z",
                group_id: "test-group",
              },
            ],
          })
        )
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "list" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.memories)).toBe(true);
      expect(parsed.memories[0].memoryId).toBe("ep-uuid-123");
      expect(parsed.memories[0].content).toBe("Test content");
      expect(parsed.memories[0].type).toBe("preference");
    });

    it("respects limit parameter", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episodes: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({
        mode: "list",
        limit: 5,
      }, mockToolContext);

      const listCall = mockFetch.mock.calls[1]!;
      const listBody = JSON.parse(listCall[1].body);
      expect(listBody.params.arguments.max_episodes).toBe(5);
    });

    it("defaults to limit 20", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ episodes: [] }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      await plugin.tool!.graphiti!.execute({ mode: "list" }, mockToolContext);

      const listCall = mockFetch.mock.calls[1]!;
      const listBody = JSON.parse(listCall[1].body);
      expect(listBody.params.arguments.max_episodes).toBe(20);
    });

    it("returns scope and count in response", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createToolResponse({
            episodes: [
              {
                uuid: "ep-1",
                name: "E1",
                content: "Content",
                source: "text",
                source_description: "",
                created_at: "2024-01-01T00:00:00Z",
                group_id: "g",
              },
            ],
          })
        )
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "list" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.scope).toBe("project");
      expect(parsed.count).toBe(1);
    });
  });

  describe("mode: forget", () => {
    it("requires memoryId parameter", async () => {
      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({ mode: "forget" }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("memoryId");
    });

    it("calls deleteEpisode with memoryId as uuid", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createToolResponse({ deleted: true }))
      );

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "forget",
        memoryId: "test-uuid-123",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe("Memory deleted successfully");

      const deleteCall = mockFetch.mock.calls[1]!;
      const deleteBody = JSON.parse(deleteCall[1].body);
      expect(deleteBody.params.arguments.uuid).toBe("test-uuid-123");
    });
  });

  describe("unconfigured state", () => {
    it("returns error when config not ready", async () => {
      rmSync(globalConfigPath, { force: true });
      resetConfig();

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);
      const result = await plugin.tool!.graphiti!.execute({
        mode: "add",
        content: "test",
      }, mockToolContext);
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not configured");
    });
  });
});

describe("chat.message hook", () => {
  let testHome: string;
  let globalConfigPath: string;
  let projectDir: string;
  let mockFetch: ReturnType<typeof mock>;

  function createSSEResponse(
    data: object,
    headers?: Record<string, string>
  ): Response {
    const sseBody = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
    return new Response(sseBody, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        ...headers,
      },
    });
  }

  function createInitializeResponse(sessionId: string): Response {
    return createSSEResponse(
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "Graphiti", version: "1.0.0" },
        },
      },
      { "mcp-session-id": sessionId }
    );
  }

  function createToolResponse(data: object): Response {
    return createSSEResponse({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      },
    });
  }

  beforeEach(() => {
    resetLogger();
    testHome = join(tmpdir(), `graphiti-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;

    globalConfigPath = join(testHome, ".config", "opencode", "graphiti.jsonc");
    projectDir = join(testHome, "test-project");
    mkdirSync(projectDir, { recursive: true });

    resetConfig();

    mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        graphitiUrl: "http://localhost:8000",
        groupId: "test-group",
        keywordPatterns: ["remember", "memorize"],
      })
    );

    mockFetch = mock(() => Promise.resolve(new Response()));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    resetConfig();
    resetLogger();
  });

  describe("keyword detection", () => {
    it("detects 'remember' keyword and adds nudge message", async () => {
      const mockCtx = {
        directory: projectDir,
        client: {
          provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) },
        },
      } as unknown as PluginInput;

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);

      const input = { sessionID: "test-session-keyword-1" };
      const output = {
        parts: [{ type: "text", text: "Please remember that I prefer TypeScript" }],
        message: { id: "msg-1" },
      };

      await plugin["chat.message"]?.(input as any, output as any);

      const nudgePart = output.parts.find(
        (p: any) => p.type === "text" && p.text?.includes("MEMORY TRIGGER")
      );
      expect(nudgePart).toBeDefined();
    });

    it("ignores keywords inside code blocks", async () => {
      const mockCtx = {
        directory: projectDir,
        client: {
          provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) },
        },
      } as unknown as PluginInput;

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);

      const input = { sessionID: "test-session-code-block" };
      const output = {
        parts: [{ type: "text", text: "```js\n// remember to add comment\n```" }],
        message: { id: "msg-1" },
      };

      await plugin["chat.message"]?.(input as any, output as any);

      const nudgePart = output.parts.find(
        (p: any) => p.type === "text" && p.text?.includes("MEMORY TRIGGER")
      );
      expect(nudgePart).toBeUndefined();
    });

    it("ignores keywords inside inline code", async () => {
      const mockCtx = {
        directory: projectDir,
        client: {
          provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) },
        },
      } as unknown as PluginInput;

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);

      const input = { sessionID: "test-session-inline-code" };
      const output = {
        parts: [{ type: "text", text: "Use `remember` function" }],
        message: { id: "msg-1" },
      };

      await plugin["chat.message"]?.(input as any, output as any);

      const nudgePart = output.parts.find(
        (p: any) => p.type === "text" && p.text?.includes("MEMORY TRIGGER")
      );
      expect(nudgePart).toBeUndefined();
    });
  });

  describe("context injection", () => {
    it("injects context on first message of session", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      for (let i = 0; i < 4; i++) {
        mockFetch.mockImplementationOnce(() =>
          Promise.resolve(createToolResponse({ nodes: [], episodes: [], facts: [] }))
        );
      }

      const mockCtx = {
        directory: projectDir,
        client: {
          provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) },
        },
      } as unknown as PluginInput;

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);

      const input = { sessionID: "new-session-123" };
      const output = {
        parts: [{ type: "text", text: "Hello" }],
        message: { id: "msg-1" },
      };

      await plugin["chat.message"]?.(input as any, output as any);

      expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    });

    it("does not inject context on subsequent messages", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(createInitializeResponse("session-456"))
      );

      for (let i = 0; i < 10; i++) {
        mockFetch.mockImplementationOnce(() =>
          Promise.resolve(createToolResponse({ nodes: [], episodes: [], facts: [] }))
        );
      }

      const mockCtx = {
        directory: projectDir,
        client: {
          provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) },
        },
      } as unknown as PluginInput;

      const { GraphitiPlugin } = await import("./index.js");
      const plugin = await GraphitiPlugin(mockCtx);

      const sessionID = `existing-session-${Date.now()}`;

      await plugin["chat.message"]?.(
        { sessionID } as any,
        { parts: [{ type: "text", text: "First" }], message: { id: "msg-1" } } as any
      );

      const callsAfterFirst = mockFetch.mock.calls.length;

      await plugin["chat.message"]?.(
        { sessionID } as any,
        { parts: [{ type: "text", text: "Second" }], message: { id: "msg-2" } } as any
      );

      expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});

describe("Type prefix handling", () => {
  it("extracts type and content from [TYPE: x] format", async () => {
    resetLogger();
    const testHome = join(tmpdir(), `graphiti-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;
    mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
    writeFileSync(
      join(testHome, ".config", "opencode", "graphiti.jsonc"),
      JSON.stringify({ graphitiUrl: "http://localhost:8000", groupId: "test" })
    );
    resetConfig();

    const mockFetch = mock(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{}}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
        })
      );
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    mockFetch.mockImplementationOnce(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{}}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
        })
      );
    });
    mockFetch.mockImplementationOnce(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[],"structuredContent":{"episodes":[{"uuid":"e1","name":"n","content":"[TYPE: preference] User prefers dark mode","source":"text","source_description":"","created_at":"2024-01-01T00:00:00Z","group_id":"g"}]},"isError":false}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } })
      );
    });

    const { GraphitiPlugin } = await import("./index.js");
    const plugin = await GraphitiPlugin({
      directory: testHome,
      client: { provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) } },
    } as any);

    const result = await plugin.tool!.graphiti!.execute({ mode: "list" }, mockToolContext);
    const parsed = JSON.parse(result as string);

    expect(parsed.memories[0].type).toBe("preference");
    expect(parsed.memories[0].content).toBe("User prefers dark mode");

    globalThis.fetch = originalFetch;
    rmSync(testHome, { recursive: true, force: true });
    resetConfig();
    resetLogger();
  });

  it("handles content without prefix as type unknown", async () => {
    resetLogger();
    const testHome = join(tmpdir(), `graphiti-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;
    mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
    writeFileSync(
      join(testHome, ".config", "opencode", "graphiti.jsonc"),
      JSON.stringify({ graphitiUrl: "http://localhost:8000", groupId: "test" })
    );
    resetConfig();

    const mockFetch = mock(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{}}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
        })
      );
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    mockFetch.mockImplementationOnce(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{}}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
        })
      );
    });
    mockFetch.mockImplementationOnce(() => {
      const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[],"structuredContent":{"episodes":[{"uuid":"e1","name":"n","content":"Plain content without prefix","source":"text","source_description":"","created_at":"2024-01-01T00:00:00Z","group_id":"g"}]},"isError":false}}\n\n`;
      return Promise.resolve(
        new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } })
      );
    });

    const { GraphitiPlugin } = await import("./index.js");
    const plugin = await GraphitiPlugin({
      directory: testHome,
      client: { provider: { list: mock(() => Promise.resolve({ data: { all: [] } })) } },
    } as any);

    const result = await plugin.tool!.graphiti!.execute({ mode: "list" }, mockToolContext);
    const parsed = JSON.parse(result as string);

    expect(parsed.memories[0].type).toBe("unknown");
    expect(parsed.memories[0].content).toBe("Plain content without prefix");

    globalThis.fetch = originalFetch;
    rmSync(testHome, { recursive: true, force: true });
    resetConfig();
    resetLogger();
  });
});
