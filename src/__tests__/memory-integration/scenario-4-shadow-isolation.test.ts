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

// Scenario 4 — shadow extractor isolation
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

describe("Scenario 4 — shadow extractor isolation", () => {
  afterEach(restoreFetch);

  it("shadow timeout does not block deterministic capture", async () => {
    const { client, addMemoryCalls } = createTransportMock();

    // Provider that never resolves в†’ always times out
    const neverProvider: ShadowExtractorProvider = {
      name: "never-resolves",
      extract: () => new Promise(() => {}), // never resolves
    };

    const extractor = new ShadowExtractor({
      enabled: true,
      timeoutMs: 100, // very short timeout
      maxConcurrency: 1,
      provider: neverProvider,
      client,
      groupId: "integration-test-group",
    });

    // Fire shadow extraction (will time out)
    const shadowResult = await extractor.run({ text: "decide to use sqlite" });
    expect(shadowResult.status).toBe("timeout");
    expect(shadowResult.written).toBe(0);

    // Deterministic capture must still work after shadow timeout
    const ctx = buildCaptureCtx(client);
    const captureResult = await captureChatMessage(ctx, {
      text: "We decided to use sqlite for local storage; please remember this preference",
      role: "user",
      sessionId: "s1",
      messageId: "m1",
    });

    expect(captureResult.written).toBeGreaterThanOrEqual(1);
    expect(addMemoryCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

