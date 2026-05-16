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

// Scenario 3 — full session: capture + marker + shadow + recall + sanitization
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

describe("Scenario 3 — capture + marker + recall + sanitization in one session", () => {
  afterEach(restoreFetch);

  it("multi-line message with marker + restriction pattern + secret produces sanitized writes", async () => {
    const { client, addMemoryCalls } = createTransportMock();
    const ctx = buildCaptureCtx(client);

    // Line 1 is a marker, line 2 is regular text with restriction pattern + secrets
    const msg = [
      `@graphiti Restriction: never log secrets in prod`,
      `OPENAI_API_KEY=${RAW_API_KEY} must not be sent to ${RAW_EMAIL} with Authorization: Bearer ${RAW_BEARER}; please remember that`,
    ].join("\n");

    const result = await captureChatMessage(ctx, {
      text: msg,
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(result.written).toBeGreaterThanOrEqual(1);

    // Collect all classes from transport calls
    const writtenClasses = addMemoryCalls.map(
      (c) => (c.metadata as Record<string, unknown>)?.memoryClass
    );

    // Marker-derived Restriction must exist
    expect(writtenClasses).toContain("Restriction");

    // Note: the regex Restriction detector is SKIPPED because capture.ts
    // deduplicates by class — the marker write already added "Restriction"
    // to result.classes, so the regex detector's `result.classes.includes("Restriction")`
    // check prevents a second write. This is correct behavior.

    // UserInstruction for the full message (non-trivial text remains after marker stripped)
    expect(writtenClasses).toContain("UserInstruction");

    // ALL writes must have no raw secrets at the transport level
    for (const call of addMemoryCalls) {
      assertNoRawSecrets(call.episode_body, `scenario3:${call.name}`);
    }

    // At least one write should contain [REDACTED:] (the ones with the secret text)
    const anyRedacted = addMemoryCalls.some((c) => /\[REDACTED:/.test(c.episode_body));
    expect(anyRedacted).toBe(true);

    const shadowProvider: ShadowExtractorProvider & { extract: ReturnType<typeof mock> } = {
      extract: mock(async () =>
        JSON.stringify({
          candidates: [
            {
              memoryClass: "Decision",
              name: "Use configured group",
              body: "Shadow extraction writes should use the configured group.",
            },
          ],
        })
      ),
    };
    const shadowExtractor = new ShadowExtractor({
      enabled: true,
      timeoutMs: 1000,
      maxConcurrency: 1,
      provider: shadowProvider,
      client,
      groupId: "integration-test-group",
    });

    const shadowResult = await shadowExtractor.run({ text: msg });
    expect(shadowResult.status).toBe("ok");

    const shadowCall = addMemoryCalls.find((call) => call.source === "shadow");
    expect(shadowCall?.group_id).toBe("integration-test-group");
    expect(shadowCall?.metadata?.groupId).toBeUndefined();
  });

  it("recall returns bounded, privacy-stripped results", async () => {
    // Build recall context with mock data
    const nodes = [
      createNode("n1", "Restriction: never deploy on fridays"),
      createNode("n2", `Secret note: ${RAW_EMAIL} owns the server`),
      createNode("n3", "<private>internal secret</private> but public part"),
      createNode("n4", "UserInstruction: run tests before merge"),
      createNode("n5", "ArchitecturalDecision: use sqlite"),
      createNode("n6", "Extra node beyond topN"),
    ];

    const ctx: RecallContext = {
      client: {
        searchNodes: mock(async () => ({
          success: true as const,
          data: { nodes },
        })),
        searchFacts: mock(async () => ({
          success: true as const,
          data: { facts: [] },
        })),
        getEpisodes: mock(async () => ({
          success: true as const,
          data: { episodes: [] },
        })),
      },
      config: { enabled: true, topN: 5, broadcastCompat: false },
      projectGroupId: "integration-test-group",
    };

    const result = await performRecall(ctx, {
      query: "restriction",
      trigger: "session-start",
    });

    expect(result.status).toBe("ok");
    expect(result.items.length).toBeLessThanOrEqual(5);

    // Privacy: <private> tags are stripped in recall
    for (const item of result.items) {
      expect(item.text).not.toContain("<private>");
      expect(item.text).not.toContain("internal secret");
    }
  });
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

