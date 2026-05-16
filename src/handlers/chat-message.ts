import type { Part } from "@opencode-ai/sdk";
import { log } from "../services/logger.js";
import { captureChatMessage } from "../services/capture.js";
import { performRecall, type RecalledItem } from "../services/recall.js";
import { generatePartId, assertValidPartId } from "../services/ids.js";
import { GraphitiClient } from "../services/graphiti-client.js";
import type { GraphitiConfig } from "../types/graphiti.js";
import {
  createCaptureContext,
  createRecallContext,
  detectMemoryKeyword,
  injectRecallPart,
  MEMORY_NUDGE_MESSAGE,
} from "./_internals.js";

export interface ChatMessageHandlerDeps {
  graphitiClient: GraphitiClient;
  config: GraphitiConfig;
  projectNamespace: string;
  injectedSessions: Set<string>;
  pendingCompactionRecall: Map<string, RecalledItem[]>;
}

export function createChatMessageHandler(deps: ChatMessageHandlerDeps) {
  return async (
    input: { sessionID: string },
    output: { parts: Part[]; message: { id: string } }
  ) => {
    const { graphitiClient, config, projectNamespace, injectedSessions, pendingCompactionRecall } = deps;
    const start = Date.now();

    try {
      const textParts = output.parts.filter(
        (p): p is Part & { type: "text"; text: string } => p.type === "text"
      );

      if (textParts.length === 0) {
        log("chat.message: no text parts found");
        return;
      }

      const userMessage = textParts.map((p) => p.text).join("\n");

      if (!userMessage.trim()) {
        log("chat.message: empty message, skipping");
        return;
      }

      log("chat.message: processing", {
        messagePreview: userMessage.slice(0, 100),
        partsCount: output.parts.length,
        textPartsCount: textParts.length,
      });

      if (detectMemoryKeyword(userMessage, config.keywordPatterns || [])) {
        log("chat.message: memory keyword detected");
        const nudgePart: Part = {
          id: generatePartId(),
          sessionID: input.sessionID,
          messageID: output.message.id,
          type: "text",
          text: MEMORY_NUDGE_MESSAGE,
          synthetic: true,
        };
        // Defense-in-depth: opencode read-path rejects ids without `prt_`
        // prefix (Zod startsWith). 0.1.2 shipped `graphiti-nudge-${ts}` and
        // bricked sessions in the UI — never let that ship again.
        assertValidPartId(nudgePart.id);
        output.parts.push(nudgePart);
      }

      const compactionRecall = pendingCompactionRecall.get(input.sessionID);
      if (compactionRecall) {
        pendingCompactionRecall.delete(input.sessionID);
        injectRecallPart(output, input.sessionID, compactionRecall);
      }

      const isFirstMessage = !injectedSessions.has(input.sessionID);

      if (isFirstMessage) {
        injectedSessions.add(input.sessionID);

        const recallResult = await performRecall(
          createRecallContext(graphitiClient, projectNamespace, config),
          { query: userMessage, trigger: "session-start" }
        );
        injectRecallPart(output, input.sessionID, recallResult.items);

        if (recallResult.items.length > 0) {
          const duration = Date.now() - start;
          log("chat.message: recall injected", {
            duration,
            items: recallResult.items.length,
            status: recallResult.status,
          });
        }
      }

      if (isFirstMessage) {
        try {
          await captureChatMessage(
            createCaptureContext(graphitiClient, projectNamespace, config),
            {
              text: userMessage,
              role: "user",
              sessionId: input.sessionID,
              messageId: output.message.id,
              timestamp: Date.now(),
            }
          );
        } catch (error) {
          log("chat.message: capture ERROR", { error: String(error) });
        }
      }
    } catch (error) {
      log("chat.message: ERROR", { error: String(error) });
    }
  };
}
