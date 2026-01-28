import { test, describe, expect, afterEach } from "bun:test";
import { GraphitiClient } from "../services/graphiti-client.js";
import type { Episode } from "../types/graphiti.js";

// Conditional gating: skip if env vars not set
const SKIP_INTEGRATION =
  !process.env.RUN_INTEGRATION_TESTS || !process.env.GRAPHITI_URL;

if (SKIP_INTEGRATION) {
  test.skip(
    "Integration tests skipped (set RUN_INTEGRATION_TESTS=true and GRAPHITI_URL)",
    () => {}
  );
} else {
  describe("Graphiti Integration", () => {
    const GRAPHITI_URL = process.env.GRAPHITI_URL!;
    const TEST_GROUP_ID = `test_graphiti_${Date.now()}`;
    let client: GraphitiClient;

    // Helper: Wait for episode to be ingested (async processing)
    async function waitForEpisode(
      groupId: string,
      uuid: string,
      maxRetries = 10,
      delayMs = 500
    ): Promise<boolean> {
      for (let i = 0; i < maxRetries; i++) {
        const result = await client.getEpisodes({
          groupIds: [groupId],
          maxEpisodes: 100,
        });

        if (
          result.success &&
          result.data.episodes?.some((ep: Episode) => ep.uuid === uuid)
        ) {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return false;
    }

    // Cleanup after each test
    afterEach(async () => {
      if (client) {
        await client.clearGraph({ groupIds: [TEST_GROUP_ID] });
      }
    });

    test("round-trip: add → wait → search → delete → cleanup", async () => {
      client = new GraphitiClient(GRAPHITI_URL);

      // 1. Generate UUID client-side
      const testUuid = crypto.randomUUID();
      const testContent = `Integration test content ${Date.now()}`;

      // 2. Add memory with explicit UUID
      const addResult = await client.addMemory({
        name: "Integration Test Memory",
        episodeBody: testContent,
        groupId: TEST_GROUP_ID,
        source: "text",
        uuid: testUuid,
      });

      expect(addResult.success).toBe(true);
      if (addResult.success) {
        expect(addResult.data.episode_uuid).toBe(testUuid);
      }

      // 3. Wait for ingestion (async processing)
      const ingested = await waitForEpisode(TEST_GROUP_ID, testUuid);
      expect(ingested).toBe(true);

      // 4. Search for the added memory
      const searchResult = await client.searchNodes(testContent, {
        groupIds: [TEST_GROUP_ID],
        maxNodes: 10,
      });

      expect(searchResult.success).toBe(true);
      if (searchResult.success) {
        expect(searchResult.data.nodes.length).toBeGreaterThan(0);
      }

      // 5. Delete using the known UUID
      const deleteResult = await client.deleteEpisode(testUuid);
      expect(deleteResult.success).toBe(true);
      if (deleteResult.success) {
        expect(deleteResult.data.deleted).toBe(true);
      }

      // 6. Cleanup happens in afterEach
    });

    test("error handling: unreachable server", async () => {
      // Use invalid URL to simulate unreachable server
      const invalidClient = new GraphitiClient("http://invalid.local:9999/", {
        timeoutMs: 2000,
      });

      const result = await invalidClient.getStatus();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.isUnreachable).toBe(true);
        expect(result.error).toBeTruthy();
      }
    });

    test("cleanup: clearGraph removes all episodes in group", async () => {
      client = new GraphitiClient(GRAPHITI_URL);

      // Add multiple episodes
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();

      await client.addMemory({
        name: "Test 1",
        episodeBody: "First test episode",
        groupId: TEST_GROUP_ID,
        source: "text",
        uuid: uuid1,
      });

      await client.addMemory({
        name: "Test 2",
        episodeBody: "Second test episode",
        groupId: TEST_GROUP_ID,
        source: "text",
        uuid: uuid2,
      });

      // Wait for both to be ingested
      await waitForEpisode(TEST_GROUP_ID, uuid1);
      await waitForEpisode(TEST_GROUP_ID, uuid2);

      // Verify episodes exist
      const beforeClear = await client.getEpisodes({
        groupIds: [TEST_GROUP_ID],
      });
      expect(beforeClear.success).toBe(true);
      if (beforeClear.success) {
        expect(beforeClear.data.episodes.length).toBeGreaterThanOrEqual(2);
      }

      // Clear the graph
      const clearResult = await client.clearGraph({
        groupIds: [TEST_GROUP_ID],
      });
      expect(clearResult.success).toBe(true);

      // Verify episodes are gone
      const afterClear = await client.getEpisodes({
        groupIds: [TEST_GROUP_ID],
      });
      expect(afterClear.success).toBe(true);
      if (afterClear.success) {
        expect(afterClear.data.episodes.length).toBe(0);
      }
    });
  });
}
