import { log } from "../services/logger.js";
import {
  captureMessagePartUpdated,
  captureSessionCompacted,
  captureSessionIdle,
  captureToolExecuteAfter,
} from "../services/capture.js";
import { performRecall, type RecalledItem } from "../services/recall.js";
import { GraphitiClient } from "../services/graphiti-client.js";
import type { GraphitiConfig } from "../types/graphiti.js";
import {
  createCaptureContext,
  createRecallContext,
  getNumberProperty,
  getRecord,
  getStringProperty,
  type EventHookData,
} from "./_internals.js";

export interface EventHandlerDeps {
  graphitiClient: GraphitiClient;
  config: GraphitiConfig;
  projectNamespace: string;
  pendingCompactionRecall: Map<string, RecalledItem[]>;
  compactionHook: { event: (eventData: EventHookData) => Promise<void> } | null;
}

export function createEventHandler(deps: EventHandlerDeps) {
  return async (eventData: EventHookData) => {
    const { compactionHook, graphitiClient, projectNamespace, config, pendingCompactionRecall } = deps;

    if (compactionHook) {
      await compactionHook.event(eventData);
    }

    try {
      const captureContext = createCaptureContext(graphitiClient, projectNamespace, config);
      const properties = getRecord(eventData.event.properties);

      switch (eventData.event.type) {
        case "tool.execute.after": {
          const toolName = getStringProperty(properties, ["toolName", "tool", "name", "id"]) ?? "unknown";
          const args = getRecord(properties.args);
          const sessionId = getStringProperty(properties, ["sessionID", "sessionId"]) ?? "unknown-session";
          await captureToolExecuteAfter(captureContext, {
            toolName,
            args,
            result: properties.result,
            exitCode: getNumberProperty(properties, ["exitCode", "code"]),
            sessionId,
            timestamp: Date.now(),
          });
          break;
        }
        case "message.part.updated": {
          const part = getRecord(properties.part);
          captureMessagePartUpdated(captureContext, {
            partType: getStringProperty(properties, ["partType", "type"])
              ?? getStringProperty(part, ["type"])
              ?? "unknown",
            text: getStringProperty(properties, ["text"])
              ?? getStringProperty(part, ["text"]),
            sessionId: getStringProperty(properties, ["sessionID", "sessionId"])
              ?? getStringProperty(part, ["sessionID", "sessionId"])
              ?? "unknown-session",
            messageId: getStringProperty(properties, ["messageID", "messageId"])
              ?? getStringProperty(part, ["messageID", "messageId"])
              ?? "unknown-message",
            timestamp: Date.now(),
          });
          break;
        }
        case "session.idle": {
          captureSessionIdle(captureContext, {
            sessionId: getStringProperty(properties, ["sessionID", "sessionId"])
              ?? "unknown-session",
            timestamp: Date.now(),
          });
          break;
        }
        case "session.compacted": {
          const sessionId = getStringProperty(properties, ["sessionID", "sessionId"])
            ?? "unknown-session";
          await captureSessionCompacted(captureContext, {
            sessionId,
            summary: getStringProperty(properties, ["summary", "text", "content"]),
            timestamp: Date.now(),
          });
          const recallResult = await performRecall(
            createRecallContext(graphitiClient, projectNamespace, config),
            { query: "", trigger: "compaction-refresh" }
          );
          // In-memory one-shot cache for the next chat.message in the compacted session.
          if (recallResult.items.length > 0) {
            pendingCompactionRecall.set(sessionId, recallResult.items);
          }
          break;
        }
      }
    } catch (error) {
      log("event: capture ERROR", { type: eventData.event.type, error: String(error) });
    }
  };
}
