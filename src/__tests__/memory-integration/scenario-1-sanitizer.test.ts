import {
  afterEach,
  describe,
  expect,
  it,
  mock,
  test,
  GraphitiClient,
  captureChatMessage,
  captureSessionCompacted,
  ShadowExtractor,
  performRecall,
  runMigration,
  createTransportMock,
  restoreFetch,
  buildCaptureCtx,
  createNode,
  createFact,
  createEpisode,
  assertNoRawSecrets,
  assertRedacted,
  RAW_API_KEY,
  RAW_EMAIL,
  RAW_BEARER,
  SECRET_TEXT,
  type Episode,
  type MigrationContext,
  type RecallContext,
  type RecordedAddMemoryCall,
  type ShadowExtractorProvider,
} from './_helpers.js';

// Scenario 1 — sanitizer is never bypassed
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

describe("Scenario 1 — sanitizer is never bypassed", () => {
  afterEach(restoreFetch);

  it("deterministic capture: secrets are redacted in transport payload", async () => {
    const { client, addMemoryCalls } = createTransportMock();
    const ctx = buildCaptureCtx(client);

    await captureChatMessage(ctx, {
      text: SECRET_TEXT,
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(addMemoryCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of addMemoryCalls) {
      assertRedacted(call.episode_body, `deterministic:${call.name}`);
    }
  });

  it("shadow extractor: secrets are redacted in transport payload", async () => {
    const { client, addMemoryCalls } = createTransportMock();

    const provider: ShadowExtractorProvider = {
      name: "mock-provider",
      extract: async () =>
        JSON.stringify({
          candidates: [
            {
              memoryClass: "ArchitecturalDecision",
              name: "Decision about secrets",
              body: SECRET_TEXT,
              confidence: 0.9,
            },
          ],
        }),
    };

    const extractor = new ShadowExtractor({
      enabled: true,
      timeoutMs: 5000,
      maxConcurrency: 1,
      provider,
      client,
      groupId: "integration-test-group",
    });

    const result = await extractor.run({ text: "some conversation" });
    expect(result.status).toBe("ok");
    expect(result.written).toBe(1);

    expect(addMemoryCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of addMemoryCalls) {
      assertRedacted(call.episode_body, `shadow:${call.name}`);
    }
  });

  it("marker via capture: secrets are redacted in transport payload", async () => {
    const { client, addMemoryCalls } = createTransportMock();
    const ctx = buildCaptureCtx(client);

    await captureChatMessage(ctx, {
      text: `@graphiti Restriction: ${SECRET_TEXT}`,
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(addMemoryCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of addMemoryCalls) {
      assertRedacted(call.episode_body, `marker:${call.name}`);
    }
  });

  it("compaction: secrets are redacted in transport payload", async () => {
    const { client, addMemoryCalls } = createTransportMock();
    const ctx = buildCaptureCtx(client);

    await captureSessionCompacted(ctx, {
      sessionId: "s1",
      summary: `We shipped v2.0 and leaked ${SECRET_TEXT}`,
    });

    expect(addMemoryCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of addMemoryCalls) {
      assertRedacted(call.episode_body, `compaction:${call.name}`);
    }
  });

  it("migration: secrets are redacted in transport payload", async () => {
    const { client, addMemoryCalls } = createTransportMock();

    // Build a migration context with the real client (transport-mocked).
    // We need getEpisodes to return a legacy episode containing secrets.
    // But since we're using the transport mock, we need to handle the get_episodes call.
    // Override the fetch mock to return legacy episodes for get_episodes.
    const legacyBody = `[TYPE: project-config] ${SECRET_TEXT}`;
    const legacyEpisode: Episode = createEpisode("legacy-1", legacyBody);

    // Re-mock fetch to handle get_episodes too
    restoreFetch();
    const migrationCalls: RecordedAddMemoryCall[] = [];

    const migrationMockFetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};

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
            "mcp-session-id": "mock-session-migration",
          },
        });
      }

      if (body.method === "tools/call") {
        const toolName = body.params?.name;
        const toolArgs = body.params?.arguments ?? {};

        if (toolName === "get_episodes") {
          const sseBody = `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              structuredContent: { result: { episodes: [legacyEpisode] } },
              isError: false,
            },
          })}\n\n`;
          return new Response(sseBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }

        if (toolName === "add_memory") {
          migrationCalls.push({
            name: toolArgs.name as string,
            episode_body: toolArgs.episode_body as string,
            source: toolArgs.source as string,
            metadata: toolArgs.metadata as Record<string, unknown>,
            group_id: toolArgs.group_id as string | undefined,
          });
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
      }

      return new Response("", { status: 404 });
    });

    globalThis.fetch = migrationMockFetch as unknown as typeof fetch;
    const migrationClient = new GraphitiClient("http://mock-graphiti.test/mcp/");

    const migCtx: MigrationContext = {
      client: migrationClient,
      groupId: "integration-test-group",
    };

    const result = await runMigration(migCtx, { dryRun: false });
    expect(result.status).toBe("applied");
    expect(result.counts.written).toBe(1);

    expect(migrationCalls.length).toBe(1);
    assertRedacted(migrationCalls[0]!.episode_body, "migration");
  });
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

