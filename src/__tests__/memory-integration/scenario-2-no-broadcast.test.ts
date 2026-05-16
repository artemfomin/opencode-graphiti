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

// Scenario 2 — no broadcast injection by default
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

describe("Scenario 2 — no broadcast injection by default", () => {
  it("broadcastCompat=false returns at most topN items without calling getEpisodes", async () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      createNode(`node-${i}`, `Node summary ${i}`)
    );
    const facts = Array.from({ length: 50 }, (_, i) =>
      createFact(`fact-${i}`, `Fact text ${i}`)
    );
    const episodes = Array.from({ length: 50 }, (_, i) =>
      createEpisode(`ep-${i}`, `Episode content ${i}`)
    );

    const searchNodesFn = mock(async () => ({
      success: true as const,
      data: { nodes },
    }));
    const searchFactsFn = mock(async () => ({
      success: true as const,
      data: { facts },
    }));
    const getEpisodesFn = mock(async () => ({
      success: true as const,
      data: { episodes },
    }));

    const ctx: RecallContext = {
      client: {
        searchNodes: searchNodesFn,
        searchFacts: searchFactsFn,
        getEpisodes: getEpisodesFn,
      },
      config: { enabled: true, topN: 5, broadcastCompat: false },
      projectGroupId: "integration-test-group",
    };

    const result = await performRecall(ctx, {
      query: "test",
      trigger: "session-start",
    });

    expect(result.status).toBe("ok");
    expect(result.items.length).toBeLessThanOrEqual(5);
    // getEpisodes should NOT be called in default path with a non-empty query
    expect(getEpisodesFn).not.toHaveBeenCalled();
  });

  it("broadcastCompat=true triggers broadcast-fallback status and calls getEpisodes", async () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      createNode(`node-${i}`, `Node summary ${i}`)
    );
    const facts = Array.from({ length: 50 }, (_, i) =>
      createFact(`fact-${i}`, `Fact text ${i}`)
    );
    const episodes = Array.from({ length: 50 }, (_, i) =>
      createEpisode(`ep-${i}`, `Episode content ${i}`)
    );

    const getEpisodesFn = mock(async () => ({
      success: true as const,
      data: { episodes },
    }));

    const ctx: RecallContext = {
      client: {
        searchNodes: mock(async () => ({
          success: true as const,
          data: { nodes },
        })),
        searchFacts: mock(async () => ({
          success: true as const,
          data: { facts },
        })),
        getEpisodes: getEpisodesFn,
      },
      config: { enabled: true, topN: 5, broadcastCompat: true },
      projectGroupId: "integration-test-group",
    };

    const result = await performRecall(ctx, {
      query: "test",
      trigger: "session-start",
    });

    expect(result.status).toBe("broadcast-fallback");
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(getEpisodesFn).toHaveBeenCalled();
  });
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

