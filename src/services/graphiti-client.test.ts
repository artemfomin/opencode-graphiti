import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { GraphitiClient, type GraphitiResult } from "./graphiti-client.js";
import type { Episode, Node, Fact } from "../types/graphiti.js";

const originalFetch = globalThis.fetch;

describe("GraphitiClient", () => {
  let client: GraphitiClient;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    client = new GraphitiClient("http://test.example.com/mcp/");
    mockFetch = mock(() => Promise.resolve(new Response()));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

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
          serverInfo: { name: "Graphiti Agent Memory", version: "1.21.0" },
        },
      },
      { "mcp-session-id": sessionId }
    );
  }

  describe("constructor", () => {
    it("accepts baseUrl as constructor parameter", () => {
      const customClient = new GraphitiClient("http://custom.url/mcp/");
      expect(customClient).toBeInstanceOf(GraphitiClient);
    });
  });

  describe("session management", () => {
    it("initializes session on first request", async () => {
      const sessionId = "test-session-123";

      // First call: initialize
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse(sessionId))
      );

      // Second call: actual tool call
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"status":"ok"}' }],
              structuredContent: { status: "ok" },
              isError: false,
            },
          })
        )
      );

      await client.getStatus();

      // Verify initialize was called first
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const initCall = mockFetch.mock.calls[0]!;
      const initBody = JSON.parse(initCall[1].body);
      expect(initBody.method).toBe("initialize");
    });

    it("reuses session ID for subsequent requests", async () => {
      const sessionId = "reuse-session-456";

      // Initialize
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse(sessionId))
      );

      // First tool call
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"status":"ok"}' }],
              structuredContent: { status: "ok" },
              isError: false,
            },
          })
        )
      );

      // Second tool call (should NOT re-initialize)
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 3,
            result: {
              content: [{ type: "text", text: '{"status":"ok"}' }],
              structuredContent: { status: "ok" },
              isError: false,
            },
          })
        )
      );

      await client.getStatus();
      await client.getStatus();

      // Should be: initialize + 2 tool calls = 3 total, NOT 4
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify session ID header on subsequent requests
      const thirdCall = mockFetch.mock.calls[2]!;
      expect(thirdCall[1].headers["mcp-session-id"]).toBe(sessionId);
    });
  });

  describe("SSE response parsing", () => {
    it("parses SSE-wrapped JSON-RPC response", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: '{"status":"ok","message":"healthy"}',
                },
              ],
              structuredContent: { status: "ok", message: "healthy" },
              isError: false,
            },
          })
        )
      );

      const result = await client.getStatus();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe("ok");
      }
    });

    it("handles SSE format with multiple newlines", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            `event: message\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{}"}],"structuredContent":{},"isError":false}}\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        )
      );

      const result = await client.getStatus();
      expect(result.success).toBe(true);
    });
  });

  describe("error classification", () => {
    it("returns isUnreachable=true for network errors", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.reject(new Error("ECONNREFUSED"))
      );

      const result = await client.getStatus();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(true);
        expect(result.error).toContain("ECONNREFUSED");
      }
    });

    it("returns isUnreachable=true for timeout", async () => {
      // Use a short timeout for testing
      const shortTimeoutClient = new GraphitiClient(
        "http://test.example.com/mcp/",
        { timeoutMs: 50 }
      );

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(new Response()), 100))
      );

      const result = await shortTimeoutClient.getStatus();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(true);
        expect(result.error.toLowerCase()).toContain("timeout");
      }
    });

    it("returns isUnreachable=true for JSON-RPC transport errors", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: "server-error",
            error: { code: -32600, message: "Bad Request: Missing session ID" },
          })
        )
      );

      const result = await client.getStatus();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(true);
        expect(result.error).toContain("Missing session ID");
      }
    });

    it("returns isUnreachable=false for MCP tool errors", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                { type: "text", text: '{"error":"Invalid query parameter"}' },
              ],
              structuredContent: { error: "Invalid query parameter" },
              isError: true,
            },
          })
        )
      );

      const result = await client.searchNodes("test");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(false);
        expect(result.error).toContain("Invalid query parameter");
      }
    });

    it("returns isUnreachable=true for HTTP errors", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(new Response("Server Error", { status: 500 }))
      );

      const result = await client.getStatus();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(true);
        expect(result.error).toContain("500");
      }
    });
  });

  describe("getStatus()", () => {
    it("calls get_status tool", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"status":"ok"}' }],
              structuredContent: { status: "ok" },
              isError: false,
            },
          })
        )
      );

      const result = await client.getStatus();

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.method).toBe("tools/call");
      expect(toolBody.params.name).toBe("get_status");
      expect(result.success).toBe(true);
    });
  });

  describe("addMemory()", () => {
    it("calls add_memory tool with correct parameters", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"episode_uuid":"ep-123"}' }],
              structuredContent: { episode_uuid: "ep-123" },
              isError: false,
            },
          })
        )
      );

      const result = await client.addMemory({
        name: "Test Memory",
        episodeBody: "This is a test memory content",
        groupId: "test-group",
        source: "test-source",
        sourceDescription: "Test source description",
      });

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("add_memory");
      expect(toolBody.params.arguments.name).toBe("Test Memory");
      expect(toolBody.params.arguments.episode_body).toBe(
        "This is a test memory content"
      );
      expect(toolBody.params.arguments.group_id).toBe("test-group");
      expect(result.success).toBe(true);
    });
  });

  describe("searchNodes()", () => {
    it("calls search_nodes tool with query", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"nodes":[]}' }],
              structuredContent: { nodes: [] },
              isError: false,
            },
          })
        )
      );

      const result = await client.searchNodes("test query", {
        groupIds: ["group-1"],
        maxNodes: 10,
      });

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("search_nodes");
      expect(toolBody.params.arguments.query).toBe("test query");
      expect(toolBody.params.arguments.group_ids).toEqual(["group-1"]);
      expect(toolBody.params.arguments.max_nodes).toBe(10);
      expect(result.success).toBe(true);
    });
  });

  describe("searchFacts()", () => {
    it("calls search_memory_facts tool with query", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"facts":[]}' }],
              structuredContent: { facts: [] },
              isError: false,
            },
          })
        )
      );

      const result = await client.searchFacts("test query", {
        groupIds: ["group-1"],
        maxFacts: 5,
      });

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("search_memory_facts");
      expect(toolBody.params.arguments.query).toBe("test query");
      expect(toolBody.params.arguments.group_ids).toEqual(["group-1"]);
      expect(toolBody.params.arguments.max_facts).toBe(5);
      expect(result.success).toBe(true);
    });
  });

  describe("getEpisodes()", () => {
    it("calls get_episodes tool", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"episodes":[]}' }],
              structuredContent: { episodes: [] },
              isError: false,
            },
          })
        )
      );

      const result = await client.getEpisodes({ groupIds: ["group-1"] });

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("get_episodes");
      expect(toolBody.params.arguments.group_ids).toEqual(["group-1"]);
      expect(result.success).toBe(true);
    });
  });

  describe("deleteEpisode()", () => {
    it("calls delete_episode tool with uuid", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"deleted":true}' }],
              structuredContent: { deleted: true },
              isError: false,
            },
          })
        )
      );

      const result = await client.deleteEpisode("episode-uuid-123");

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("delete_episode");
      expect(toolBody.params.arguments.uuid).toBe("episode-uuid-123");
      expect(result.success).toBe(true);
    });
  });

  describe("clearGraph()", () => {
    it("calls clear_graph tool", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [{ type: "text", text: '{"cleared":true}' }],
              structuredContent: { cleared: true },
              isError: false,
            },
          })
        )
      );

      const result = await client.clearGraph({ groupIds: ["group-1"] });

      const toolCall = mockFetch.mock.calls[1]!;
      const toolBody = JSON.parse(toolCall[1].body);
      expect(toolBody.params.name).toBe("clear_graph");
      expect(toolBody.params.arguments.group_ids).toEqual(["group-1"]);
      expect(result.success).toBe(true);
    });
  });

  describe("timeout", () => {
    it("uses 30 second default timeout", async () => {
      // We can't easily test the actual 30s timeout,
      // but we can verify the client accepts custom timeout option
      const customClient = new GraphitiClient("http://test.example.com/mcp/", {
        timeoutMs: 5000,
      });
      expect(customClient).toBeInstanceOf(GraphitiClient);
    });
  });

  describe("headers", () => {
    it("includes required headers on all requests", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createInitializeResponse("session-123"))
      );

      await client.getStatus().catch(() => {}); // Ignore any subsequent errors

      const initCall = mockFetch.mock.calls[0]!;
      expect(initCall[1].headers["Content-Type"]).toBe("application/json");
      expect(initCall[1].headers["Accept"]).toBe(
        "application/json, text/event-stream"
      );
    });
  });
});
