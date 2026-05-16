import { log } from "../logger.js";
import {
  COMPACTION_COOLDOWN_MS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_THRESHOLD,
  MIN_TOKENS_FOR_COMPACTION,
  type CompactionContext,
  type CompactionOptions,
  type CompactionState,
  type MessageInfo,
  type SummarizeContext,
} from "./types.js";
import { findNearestMessageWithFields, getMessageDir, injectHookMessage } from "./storage.js";
import { createCompactionPrompt, createSummaryMemoryWriter } from "./writer.js";

export type {
  CompactionContext,
  CompactionOptions,
  CompactionState,
  MessageInfo,
  PendingPayload,
  StoredMessage,
  SummarizeContext,
  TokenInfo,
} from "./types.js";

export function createCompactionHook(
  ctx: CompactionContext,
  tags: { projectNamespace: string },
  options?: CompactionOptions
) {
  const state: CompactionState = {
    lastCompactionTime: new Map(),
    compactionInProgress: new Set(),
    summarizedSessions: new Set(),
  };

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const getModelLimit = options?.getModelLimit;
  const { fetchProjectMemoriesForCompaction, saveSummaryAsMemory } = createSummaryMemoryWriter(tags);

  async function injectCompactionContext(summarizeCtx: SummarizeContext): Promise<void> {
    log("[compaction] injecting context", { sessionID: summarizeCtx.sessionID });

    const projectMemories = await fetchProjectMemoriesForCompaction();
    const prompt = createCompactionPrompt(projectMemories);

    const success = injectHookMessage(summarizeCtx.sessionID, prompt, {
      agent: summarizeCtx.agent,
      model: { providerID: summarizeCtx.providerID, modelID: summarizeCtx.modelID },
      path: { cwd: summarizeCtx.directory },
    });

    if (success) {
      log("[compaction] context injected with project memories", { 
        sessionID: summarizeCtx.sessionID,
        memoriesCount: projectMemories.length 
      });
    }
  }

  async function checkAndTriggerCompaction(sessionID: string, lastAssistant: MessageInfo): Promise<void> {
    if (state.compactionInProgress.has(sessionID)) return;

    const lastCompaction = state.lastCompactionTime.get(sessionID) ?? 0;
    if (Date.now() - lastCompaction < COMPACTION_COOLDOWN_MS) return;

    if (lastAssistant.summary === true) return;

    const tokens = lastAssistant.tokens;
    if (!tokens) return;

    let modelID = lastAssistant.modelID ?? "";
    let providerID = lastAssistant.providerID ?? "";
    let agent: string | undefined;

    const messageDir = getMessageDir(sessionID);
    const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;
    
    if (!providerID || !modelID) {
      if (storedMessage?.model?.providerID) providerID = storedMessage.model.providerID;
      if (storedMessage?.model?.modelID) modelID = storedMessage.model.modelID;
    }
    agent = storedMessage?.agent;

    const configLimit = getModelLimit?.(providerID, modelID);
    const contextLimit = configLimit ?? DEFAULT_CONTEXT_LIMIT;
    const totalUsed = tokens.input + tokens.cache.read + tokens.output;

    if (totalUsed < MIN_TOKENS_FOR_COMPACTION) return;

    const usageRatio = totalUsed / contextLimit;

    log("[compaction] checking", {
      sessionID,
      totalUsed,
      contextLimit,
      usageRatio: usageRatio.toFixed(2),
      threshold,
    });

    if (usageRatio < threshold) return;

    state.compactionInProgress.add(sessionID);
    state.lastCompactionTime.set(sessionID, Date.now());

    if (!providerID || !modelID) {
      state.compactionInProgress.delete(sessionID);
      return;
    }

    await ctx.client.tui.showToast({
      body: {
        title: "Preemptive Compaction",
        message: `Context at ${(usageRatio * 100).toFixed(0)}% - compacting with Graphiti context...`,
        variant: "warning",
        duration: 3000,
      },
    }).catch(() => {});

    log("[compaction] triggering compaction", { sessionID, usageRatio });

    try {
      await injectCompactionContext({
        sessionID,
        providerID,
        modelID,
        usageRatio,
        directory: ctx.directory,
        agent,
      });

      state.summarizedSessions.add(sessionID);

      await ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory: ctx.directory },
      });

      await ctx.client.tui.showToast({
        body: {
          title: "Compaction Complete",
          message: "Session compacted with Graphiti context. Resuming...",
          variant: "success",
          duration: 2000,
        },
      }).catch(() => {});

      state.compactionInProgress.delete(sessionID);

      setTimeout(async () => {
        try {
          const messageDir = getMessageDir(sessionID);
          const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;

          await ctx.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              agent: storedMessage?.agent,
              parts: [{ type: "text", text: "Continue" }],
            },
            query: { directory: ctx.directory },
          });
        } catch {}
      }, 500);
    } catch (err) {
      log("[compaction] compaction failed", { sessionID, error: String(err) });
      state.compactionInProgress.delete(sessionID);
    }
  }

  async function handleSummaryMessage(sessionID: string, _messageInfo: MessageInfo): Promise<void> {
    log("[compaction] handleSummaryMessage called", { sessionID, inSet: state.summarizedSessions.has(sessionID) });
    
    if (!state.summarizedSessions.has(sessionID)) return;

    state.summarizedSessions.delete(sessionID);
    log("[compaction] capturing summary for memory", { sessionID });

    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const messages = (resp.data ?? resp) as Array<{ info: MessageInfo; parts?: Array<{ type: string; text?: string }> }>;
      
      const summaryMessage = messages.find(m => 
        m.info.role === "assistant" && 
        m.info.summary === true
      );

      log("[compaction] looking for summary message", { 
        sessionID, 
        found: !!summaryMessage,
        hasParts: !!summaryMessage?.parts
      });

      if (summaryMessage?.parts) {
        const textParts = summaryMessage.parts.filter(p => p.type === "text" && p.text);
        const summaryContent = textParts.map(p => p.text).join("\n");
        
        log("[compaction] summary content", { 
          sessionID, 
          textPartsCount: textParts.length,
          contentLength: summaryContent.length 
        });
        
        if (summaryContent) {
          await saveSummaryAsMemory(sessionID, summaryContent);
        }
      }
    } catch (err) {
      log("[compaction] failed to capture summary", { error: String(err) });
    }
  }

  return {
    async event({ event }: { event: { type: string; properties?: unknown } }) {
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastCompactionTime.delete(sessionInfo.id);
          state.compactionInProgress.delete(sessionInfo.id);
          state.summarizedSessions.delete(sessionInfo.id);
        }
        return;
      }

      if (event.type === "message.updated") {
        const info = props?.info as MessageInfo | undefined;
        if (!info) return;

        const sessionID = info.sessionID;
        if (!sessionID) return;

        if (info.role === "assistant" && info.summary === true && info.finish) {
          await handleSummaryMessage(sessionID, info);
          return;
        }

        if (info.role !== "assistant" || !info.finish) return;

        await checkAndTriggerCompaction(sessionID, info);
        return;
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (!sessionID) return;

        try {
          const resp = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { directory: ctx.directory },
          });

          const messages = (resp.data ?? resp) as Array<{ info: MessageInfo }>;
          const assistants = messages
            .filter((m) => m.info.role === "assistant")
            .map((m) => m.info);

          if (assistants.length === 0) return;

          const lastAssistant = assistants[assistants.length - 1]!;

          if (!lastAssistant.providerID || !lastAssistant.modelID) {
            const messageDir = getMessageDir(sessionID);
            const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;
            if (storedMessage?.model?.providerID && storedMessage?.model?.modelID) {
              lastAssistant.providerID = storedMessage.model.providerID;
              lastAssistant.modelID = storedMessage.model.modelID;
            }
          }

          await checkAndTriggerCompaction(sessionID, lastAssistant);
        } catch {}
      }
    },
  };
}
