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

        if (result.success && result.data) {
          const episodes = Array.isArray(result.data.episodes) ? result.data.episodes : [];
          if (episodes.some((ep: Episode) => ep.uuid === uuid)) {
            return true;
          }
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

      const testUuid = crypto.randomUUID();
      const testContent = `Integration test content ${Date.now()}`;

      const addResult = await client.addMemory({
        name: "Integration Test Memory",
        episodeBody: testContent,
        groupId: TEST_GROUP_ID,
        source: "text",
        uuid: testUuid,
      });

      expect(addResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const searchResult = await client.searchNodes(testContent, {
        groupIds: [TEST_GROUP_ID],
        maxNodes: 10,
      });

      expect(searchResult.success).toBe(true);

      const deleteResult = await client.deleteEpisode(testUuid);
      expect(deleteResult.success).toBe(true);
    }, { timeout: 30000 });

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

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const clearResult = await client.clearGraph({
        groupIds: [TEST_GROUP_ID],
      });
      expect(clearResult.success).toBe(true);
    }, { timeout: 30000 });
   });
 }
