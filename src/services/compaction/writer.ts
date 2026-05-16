import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GraphitiClient } from "../graphiti-client.js";
import { getConfig } from "../../config.js";
import { log } from "../logger.js";
import { getDataHome } from "../paths.js";
import { PENDING_DIR, type PendingPayload } from "./types.js";

export function createCompactionPrompt(projectMemories: string[]): string {
  const memoriesSection = projectMemories.length > 0 
    ? `
## Project Knowledge (from Graphiti)
The following project-specific knowledge should be preserved and referenced in the summary:
${projectMemories.map(m => `- ${m}`).join('\n')}
`
    : '';

  return `[COMPACTION CONTEXT INJECTION]

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that failed and should not be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session
${memoriesSection}
This context is critical for maintaining continuity after compaction.
`;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("econnrefused") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("unreachable")
    );
  }
  return false;
}

async function saveToPendingQueue(summary: string, projectNamespace: string): Promise<void> {
  const pendingPath = join(getDataHome(), PENDING_DIR);
  await mkdir(pendingPath, { recursive: true });

  const timestamp = new Date().toISOString();
  const hash = projectNamespace.slice(-8);
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${hash}.json`;

  const payload: PendingPayload = {
    version: 1,
    timestamp,
    projectNamespace,
    summary,
    type: "conversation",
    retryCount: 0,
  };

  await writeFile(join(pendingPath, filename), JSON.stringify(payload, null, 2));
  log("[compaction] Graphiti unreachable, saved to pending queue", { filename });
}

export function createSummaryMemoryWriter(tags: { projectNamespace: string }) {
  let graphitiClient: GraphitiClient | null = null;

  function getGraphitiClient(): GraphitiClient {
    if (!graphitiClient) {
      const config = getConfig();
      graphitiClient = new GraphitiClient(config.graphitiUrl);
    }
    return graphitiClient;
  }

  async function fetchProjectMemoriesForCompaction(): Promise<string[]> {
    try {
      const config = getConfig();
      const client = getGraphitiClient();
      const result = await client.getEpisodes({
        groupIds: [tags.projectNamespace],
        maxEpisodes: config.maxProjectMemories,
      });

      if (!result.success) {
        log("[compaction] failed to fetch project memories", { error: result.error });
        return [];
      }

      const episodes = result.data.episodes || [];
      return episodes.map((ep) => ep.content || ep.name || "").filter(Boolean);
    } catch (err) {
      log("[compaction] failed to fetch project memories", { error: String(err) });
      return [];
    }
  }

  async function saveSummaryAsMemory(sessionID: string, summaryContent: string): Promise<void> {
    if (!summaryContent || summaryContent.length < 100) {
      log("[compaction] summary too short to save", { sessionID, length: summaryContent.length });
      return;
    }

    const episodeBody = `[TYPE: conversation] [Session Summary]\n${summaryContent}`;

    try {
      const client = getGraphitiClient();
      const result = await client.addMemory({
        name: "Session Summary",
        episodeBody,
        groupId: tags.projectNamespace,
        source: "compaction",
        sourceDescription: "Session compaction summary",
      });

      if (result.success) {
        log("[compaction] summary saved as memory", { sessionID });
      } else {
        if (result.isUnreachable) {
          await saveToPendingQueue(summaryContent, tags.projectNamespace);
        } else {
          log("[compaction] failed to save summary", { error: result.error });
        }
      }
    } catch (err) {
      if (isNetworkError(err)) {
        await saveToPendingQueue(summaryContent, tags.projectNamespace);
      } else {
        log("[compaction] failed to save summary", { error: String(err) });
      }
    }
  }

  return {
    fetchProjectMemoriesForCompaction,
    saveSummaryAsMemory,
  };
}
