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

// Scenario 5 — compaction + migration consistency
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

describe("Scenario 5 — compaction + migration consistency", () => {
  afterEach(restoreFetch);

  it("captureSessionCompacted writes a deterministic record with session.compacted subkind", async () => {
    const { client, addMemoryCalls } = createTransportMock();
    const ctx = buildCaptureCtx(client);

    const result = await captureSessionCompacted(ctx, {
      summary: "we shipped v2.0 and deployed to production successfully",
      sessionId: "s1",
    });

    expect(result.written).toBe(1);
    expect(result.classes).toContain("Achievement");
    expect(addMemoryCalls.length).toBe(1);

    const call = addMemoryCalls[0]!;
    expect(call.metadata).toBeDefined();
    expect((call.metadata as Record<string, unknown>).subkind).toBe("session.compacted");
    expect(call.source).toBe("deterministic");
  });

  it("migration dry-run counts correctly and does not write", async () => {
    restoreFetch();
    const legacyEpisode = createEpisode(
      "legacy-ep-1",
      "[TYPE: project-config] Always use strict mode in TypeScript"
    );

    // Method-level mock for migration
    const addMemoryFn = mock(async () => ({
      success: true as const,
      data: { message: "ok" },
    }));
    const getEpisodesFn = mock(async () => ({
      success: true as const,
      data: { episodes: [legacyEpisode] },
    }));

    const ctx: MigrationContext = {
      client: { addMemory: addMemoryFn, getEpisodes: getEpisodesFn },
      groupId: "integration-test-group",
    };

    const result = await runMigration(ctx, { dryRun: true });
    expect(result.status).toBe("dry-run");
    expect(result.counts.wouldWrite).toBe(1);
    expect(getEpisodesFn).toHaveBeenCalledTimes(1);
    // No actual writes in dry-run
    expect(addMemoryFn).not.toHaveBeenCalled();
  });

  it("migration apply writes once, then re-run with migrated record writes zero", async () => {
    restoreFetch();
    const legacyId = "legacy-ep-apply-1";
    const legacyEpisode = createEpisode(
      legacyId,
      "[TYPE: project-config] Always use strict mode in TypeScript"
    );

    let writeCount = 0;
    const addMemoryFn = mock(async () => {
      writeCount += 1;
      return { success: true as const, data: { message: "ok" } };
    });

    // First run: only the legacy episode
    const getEpisodesFn1 = mock(async () => ({
      success: true as const,
      data: { episodes: [legacyEpisode] },
    }));

    const ctx1: MigrationContext = {
      client: { addMemory: addMemoryFn, getEpisodes: getEpisodesFn1 },
      groupId: "integration-test-group",
    };

    const result1 = await runMigration(ctx1, { dryRun: false });
    expect(result1.status).toBe("applied");
    expect(result1.counts.written).toBe(1);

    // Second run: include the original legacy episode PLUS a fake migrated record
    // whose metadata.migration.sourceEpisodeId points to the legacy episode
    const migratedEpisode = {
      ...createEpisode("migrated-ep-1", "Always use strict mode in TypeScript"),
      metadata: {
        migration: {
          source: "[TYPE: project-config]",
          sourceEpisodeId: legacyId,
          migratedAt: new Date().toISOString(),
        },
        mappedClass: "UserInstruction",
      },
    } as unknown as Episode;

    writeCount = 0;
    addMemoryFn.mockClear();

    const getEpisodesFn2 = mock(async () => ({
      success: true as const,
      data: { episodes: [legacyEpisode, migratedEpisode] },
    }));

    const ctx2: MigrationContext = {
      client: { addMemory: addMemoryFn, getEpisodes: getEpisodesFn2 },
      groupId: "integration-test-group",
    };

    const result2 = await runMigration(ctx2, { dryRun: false });
    // The legacy episode should now be detected as already-migrated
    expect(result2.counts.alreadyMigrated).toBe(1);
    expect(result2.counts.written).toBe(0);
    expect(addMemoryFn).not.toHaveBeenCalled();
  });
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

