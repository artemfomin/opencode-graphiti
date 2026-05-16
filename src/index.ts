import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import { GraphitiClient } from "./services/graphiti-client.js";
import { getProjectNamespace } from "./services/namespace.js";
import { initConfig, type ConfigState } from "./config.js";
import { log } from "./services/logger.js";
import { createCompactionHook, type CompactionContext } from "./services/compaction.js";
import type { RecalledItem } from "./services/recall.js";
import { createChatMessageHandler } from "./handlers/chat-message.js";
import { createEventHandler } from "./handlers/event-handler.js";
import { createGraphitiTool } from "./tools/graphiti-tool.js";

/**
 * Adapts the OpenCode SDK client to the narrower compaction surface.
 * TODO: remove this boundary cast when the SDK exposes complete client method types.
 */
function toCompactionClient(client: PluginInput["client"]): CompactionContext["client"] {
  return client as unknown as CompactionContext["client"];
}

export const GraphitiPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const configState = initConfig(directory);
  const injectedSessions = new Set<string>();
  const pendingCompactionRecall = new Map<string, RecalledItem[]>();

  log("Plugin init", {
    directory,
    configured: configState.status === "ready",
    reason: configState.status !== "ready" ? (configState as { reason: string }).reason : undefined,
  });

  if (configState.status !== "ready") {
    log("Plugin disabled", { reason: (configState as { reason: string }).reason });
  }

  let graphitiClient: GraphitiClient | null = null;
  if (configState.status === "ready") {
    graphitiClient = new GraphitiClient(configState.config.graphitiUrl);
  }

  const modelLimits = new Map<string, number>();

  const projectNamespace = configState.status === "ready" ? getProjectNamespace(directory) : "";
  const compactionHook = configState.status === "ready"
    ? createCompactionHook(
        {
          directory,
          client: toCompactionClient(ctx.client),
        },
        { projectNamespace },
        {
          threshold: configState.config.compactionThreshold,
          getModelLimit: (providerID, modelID) => modelLimits.get(`${providerID}/${modelID}`),
        }
      )
    : null;

  (async () => {
    try {
      const response = await ctx.client.provider.list();
      if (response.data?.all) {
        for (const provider of response.data.all) {
          if (provider.models) {
            for (const [modelId, model] of Object.entries(provider.models)) {
              if (model.limit?.context) {
                modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
              }
            }
          }
        }
      }
      log("Model limits loaded", { count: modelLimits.size });
    } catch (error) {
      log("Failed to fetch model limits", { error: String(error) });
    }
  })();

  if (configState.status !== "ready" || !graphitiClient) {
    return {
      "chat.message": async () => {},
      tool: {
        graphiti: createGraphitiTool({
          graphitiClient,
          config: null,
          disabledReason: configState.status === "ready"
            ? "Graphiti client not initialized"
            : (configState as { reason: string }).reason,
          directory,
          projectNamespace,
        }),
      },
      event: async (eventData) => {
        if (compactionHook) {
          await compactionHook.event(eventData);
        }
      },
    };
  }

  const readyConfig = (configState as Extract<ConfigState, { status: "ready" }>).config;

  return {
    "chat.message": createChatMessageHandler({
      graphitiClient,
      config: readyConfig,
      projectNamespace,
      injectedSessions,
      pendingCompactionRecall,
    }),

    tool: {
      graphiti: createGraphitiTool({
        graphitiClient,
        config: readyConfig,
        directory,
        projectNamespace,
      }),
    },

    event: createEventHandler({
      graphitiClient,
      config: readyConfig,
      projectNamespace,
      pendingCompactionRecall,
      compactionHook,
    }),
  };
};

export default GraphitiPlugin;

