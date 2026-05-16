import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { GraphitiClient } from "./graphiti-client.js";
import { GraphitiClient as RealGraphitiClient } from "./graphiti-client.js";
import {
  captureChatMessage,
  captureMessagePartUpdated,
  captureSessionCompacted,
  captureSessionIdle,
  captureToolExecuteAfter,
  isTrivialMessage,
  RESTRICTION_PATTERNS,
  STYLE_PREFERENCE_PATTERNS,
  PROBLEM_PATTERNS,
  FIX_ATTEMPT_PATTERNS,
  ACHIEVEMENT_PATTERNS,
  type CaptureContext,
} from "./capture.js";

const originalFetch = globalThis.fetch;

type AddMemoryCall = Parameters<GraphitiClient["addMemory"]>[0];

function createContext(overrides: Partial<CaptureContext> = {}) {
  const calls: AddMemoryCall[] = [];
  const client = {
    addMemory: mock(async (payload: AddMemoryCall) => {
      calls.push(payload);
      return { success: true as const, data: { message: "ok" } };
    }),
  } satisfies Pick<GraphitiClient, "addMemory">;

  const ctx: CaptureContext = {
    client,
    groupId: "project-group",
    config: {
      enabled: true,
      trivialMessageMinLength: 4,
      explicitClassMarkers: ["@graphiti"],
      ratificationKeywords: { positive: [], negative: [] },
      ratificationWindowTurns: 1,
      unverifiedAutoExpireMs: 86_400_000,
    },
    markers: { enabled: true, prefix: "@graphiti" },
    ...overrides,
  };

  return { ctx, calls, client };
}

function classNames(calls: AddMemoryCall[]) {
  return calls.map((call) => (call as { metadata?: Record<string, unknown> }).metadata?.memoryClass);
}

function episodeBody(call: AddMemoryCall): string {
  return (call as { episodeBody: string }).episodeBody;
}

function createSSEResponse(data: object, headers?: Record<string, string>): Response {
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

describe("deterministic capture", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports regex constants that match deterministic user-side signals", () => {
    expect(RESTRICTION_PATTERNS.test("never run rm -rf in production")).toBe(true);
    expect(STYLE_PREFERENCE_PATTERNS.test("prefer concise responses")).toBe(true);
    expect(PROBLEM_PATTERNS.test("the build is broken")).toBe(true);
    expect(FIX_ATTEMPT_PATTERNS.test("I tried restarting it")).toBe(true);
    expect(ACHIEVEMENT_PATTERNS.test("the fix is passing")).toBe(true);
  });

  it("ignores trivial messages without markers", async () => {
    const { ctx, calls } = createContext();

    for (const text of ["ok", "thanks", "👍", "yo"]) {
      await captureChatMessage(ctx, {
        text,
        role: "user",
        sessionId: "s1",
        messageId: `m-${text}`,
      });
    }

    expect(calls).toHaveLength(0);
    expect(isTrivialMessage("```ts\nconst value = 1;\n```", 4)).toBe(true);
  });

  it("captures user instructions chronologically", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "Please document the deployment command",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
      timestamp: 10,
    });
    await captureChatMessage(ctx, {
      text: "Also record the rollback procedure",
      role: "user",
      sessionId: "s1",
      messageId: "m2",
      timestamp: 20,
    });

    expect(classNames(calls)).toEqual(["UserInstruction", "UserInstruction"]);
    expect(calls[0]!.metadata?.timestamp).toBeLessThan(calls[1]!.metadata?.timestamp as number);
  });

  it("detects restriction patterns alongside user instructions", async () => {
    const { ctx, calls } = createContext();

    const result = await captureChatMessage(ctx, {
      text: "never run rm -rf in production",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(result.written).toBe(2);
    expect(classNames(calls)).toEqual(["Restriction", "UserInstruction"]);
  });

  it("detects style preferences alongside user instructions", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "prefer concise responses",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual(["StylePreference", "UserInstruction"]);
  });

  it("detects problem patterns alongside user instructions", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "the build is broken",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual(["Problem", "UserInstruction"]);
  });

  it("lets markers override trivial filtering", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "@graphiti Restriction: no prod deploys on Friday",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual(["Restriction"]);
    expect(episodeBody(calls[0]!)).toBe("no prod deploys on Friday");
  });

  it("keeps marker class precedence while non-trivial bodies still run regex detection", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "@graphiti Achievement: release shipped\nThe build is broken and must not be deployed",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual([
      "Achievement",
      "Restriction",
      "Problem",
      "UserInstruction",
    ]);
  });

  it("captures multiple markers and a user instruction for non-trivial full text", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: [
        "Please preserve these explicit memories",
        "@graphiti Restriction: never skip docker tests",
        "@graphiti StylePreference: prefer short summaries",
      ].join("\n"),
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual([
      "Restriction",
      "StylePreference",
      "UserInstruction",
    ]);
  });

  it("skips assistant pattern detection but still captures explicit markers", async () => {
    const { ctx, calls } = createContext();

    await captureChatMessage(ctx, {
      text: "never do this\n@graphiti Restriction: assistant marker body",
      role: "assistant",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(classNames(calls)).toEqual(["Restriction"]);
  });

  it("returns disabled without writing", async () => {
    const { ctx, client } = createContext({
      config: {
        enabled: false,
        trivialMessageMinLength: 4,
        explicitClassMarkers: ["@graphiti"],
        ratificationKeywords: { positive: [], negative: [] },
        ratificationWindowTurns: 1,
        unverifiedAutoExpireMs: 86_400_000,
      },
    });

    const result = await captureChatMessage(ctx, {
      text: "never deploy broken builds",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(result).toEqual({ written: 0, skipped: 0, classes: [], reason: "disabled" });
    expect(client.addMemory).not.toHaveBeenCalled();
  });

  it("captures file-edit tool executions", async () => {
    const { ctx, calls } = createContext();

    const result = await captureToolExecuteAfter(ctx, {
      toolName: "edit",
      args: { filePath: "src/foo.ts" },
      sessionId: "s1",
    });

    expect(result.classes).toEqual(["FileEdit"]);
    expect(episodeBody(calls[0]!)).toContain("src/foo.ts");
  });

  it("captures command-run tool executions with exit code metadata", async () => {
    const { ctx, calls } = createContext();

    const result = await captureToolExecuteAfter(ctx, {
      toolName: "bash",
      args: { command: "ls" },
      exitCode: 0,
      sessionId: "s1",
    });

    expect(result.classes).toEqual(["CommandRun"]);
    expect(episodeBody(calls[0]!)).toContain("ls");
    expect(calls[0]!.metadata?.exitCode).toBe(0);
  });

  it("ignores unknown tool executions", async () => {
    const { ctx } = createContext();

    const result = await captureToolExecuteAfter(ctx, {
      toolName: "weird-tool",
      args: {},
      sessionId: "s1",
    });

    expect(result).toEqual({ written: 0, skipped: 0, classes: [] });
  });

  it("uses GraphitiClient sanitizer before transport for secret-bearing captures", async () => {
    const mockFetch = mock((url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (body.method === "initialize") {
        return Promise.resolve(createInitializeResponse("session-123"));
      }
      return Promise.resolve(createToolResponse({ episode_uuid: "ep-1" }));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const client = new RealGraphitiClient("http://test.example.com/mcp/");
    const { ctx } = createContext({ client });

    await captureChatMessage(ctx, {
      text: "never leak OPENAI_API_KEY=sk-leak-XXXXXXXXXXXXXXXXXXXXXXXX",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    const toolCall = mockFetch.mock.calls.find((call) => {
      const body = JSON.parse(String(call[1]?.body));
      return body.params?.name === "add_memory";
    });
    const requestBody = JSON.parse(String(toolCall![1]?.body));
    const episodeBody = requestBody.params.arguments.episode_body as string;
    expect(episodeBody).toContain("[REDACTED:env_secret]");
    expect(episodeBody).not.toContain("sk-leak-XXXXXXXXXXXXXXXXXXXXXXXX");
  });

  it("writes deterministic Achievement for session compaction summaries", async () => {
    const { ctx, calls } = createContext();

    const result = await captureSessionCompacted(ctx, {
      sessionId: "s1",
      summary: "Compaction preserved verified release progress",
    });

    expect(result.classes).toEqual(["Achievement"]);
    expect(calls[0]!.metadata?.subkind).toBe("session.compacted");
  });

  it("does not write session compaction without a summary", async () => {
    const { ctx, calls } = createContext();

    const result = await captureSessionCompacted(ctx, { sessionId: "s1" });

    expect(result).toEqual({ written: 0, skipped: 0, classes: [], reason: "empty-summary" });
    expect(calls).toHaveLength(0);
  });

  it("exposes no-op stubs for message parts and idle sessions", () => {
    const { ctx } = createContext();

    expect(captureMessagePartUpdated(ctx, {
      partType: "text",
      text: "hello",
      sessionId: "s1",
      messageId: "m1",
    })).toEqual({ written: 0, skipped: 0, classes: [] });
    expect(captureSessionIdle(ctx, { sessionId: "s1" })).toEqual({
      written: 0,
      skipped: 0,
      classes: [],
    });
  });
});
