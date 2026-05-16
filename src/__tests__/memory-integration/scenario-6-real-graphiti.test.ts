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

// Scenario 6 — env-gated real Graphiti integration
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

const SKIP_REAL_INTEGRATION =
  process.env.RUN_INTEGRATION_TESTS !== "true" || !process.env.GRAPHITI_URL;

if (SKIP_REAL_INTEGRATION) {
  test.skip(
    "Scenario 6 — real Graphiti integration skipped (set RUN_INTEGRATION_TESTS=true and GRAPHITI_URL)",
    () => {}
  );
} else {
  describe("Scenario 6 — real Graphiti integration", () => {
    it("GraphitiClient.getStatus() succeeds against live backend", async () => {
      const client = new GraphitiClient(process.env.GRAPHITI_URL!);
      const result = await client.getStatus();
      expect(result.success).toBe(true);
    }, { timeout: 15000 });
  });
}

