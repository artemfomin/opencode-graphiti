import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { GraphitiClient } from "./services/graphiti-client.js";
import { formatContext } from "./services/context.js";
import { getProjectNamespace, getProfileNamespace } from "./services/namespace.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { initConfig, getConfig, isConfigReady, type ConfigState } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryScope, MemoryType } from "./types/index.js";
import type { Episode, Node, Fact } from "./types/graphiti.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;
const TYPE_PREFIX_PATTERN = /^\[TYPE:\s*([^\]]+)\]\s*/;

function getKeywordPattern(patterns: string[]): RegExp {
  return new RegExp(`\\b(${patterns.join("|")})\\b`, "i");
}

const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`graphiti\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function detectMemoryKeyword(text: string, patterns: string[]): boolean {
  const textWithoutCode = removeCodeBlocks(text);
  const pattern = getKeywordPattern(patterns);
  return pattern.test(textWithoutCode);
}

function generateEpisodeName(content: string): string {
  return content.slice(0, 50).replace(/\n/g, " ").trim() + (content.length > 50 ? "..." : "");
}

function generateTypedContent(content: string, type: MemoryType): string {
  return `[TYPE: ${type}] ${content}`;
}

interface ParsedContent {
  type: string;
  content: string;
}

function parseTypePrefix(rawContent: string): ParsedContent {
  const match = rawContent.match(TYPE_PREFIX_PATTERN);
  if (match && match[1]) {
    return {
      type: match[1].trim(),
      content: rawContent.slice(match[0].length),
    };
  }
  return {
    type: "unknown",
    content: rawContent,
  };
}

function resolveGroupId(
  scope: MemoryScope | undefined,
  projectDir: string,
  profileGroupId: string
): string {
  if (scope === "user") {
    return profileGroupId;
  }
  return getProjectNamespace(projectDir);
}

export const GraphitiPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const configState = initConfig(directory);
  const injectedSessions = new Set<string>();

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

  return {
    "chat.message": async (input, output) => {
      if (configState.status !== "ready" || !graphitiClient) return;

      const config = configState.config;
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
            id: `graphiti-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: MEMORY_NUDGE_MESSAGE,
            synthetic: true,
          };
          output.parts.push(nudgePart);
        }

        const isFirstMessage = !injectedSessions.has(input.sessionID);

        if (isFirstMessage) {
          injectedSessions.add(input.sessionID);

          const projectNamespace = getProjectNamespace(directory);
          const profileGroupId = config.profileGroupId!;

          const [profileResult, projectEpisodesResult, relevantNodesResult, relevantFactsResult] =
            await Promise.all([
              config.injectProfile
                ? graphitiClient.searchNodes("user preferences", {
                    groupIds: [profileGroupId],
                    maxNodes: config.maxProfileItems,
                  })
                : Promise.resolve({ success: true as const, data: { nodes: [] } }),
              graphitiClient.getEpisodes({
                groupIds: [projectNamespace],
                maxEpisodes: config.maxProjectMemories,
              }),
              graphitiClient.searchNodes(userMessage, {
                groupIds: [projectNamespace],
                maxNodes: config.maxMemories,
              }),
              graphitiClient.searchFacts(userMessage, {
                groupIds: [projectNamespace],
                maxFacts: config.maxMemories,
              }),
            ]);

          const profile: Node[] = profileResult.success ? profileResult.data.nodes : [];
          const projectEpisodes: Episode[] = projectEpisodesResult.success
            ? projectEpisodesResult.data.episodes
            : [];
          const relevantNodes: Node[] = relevantNodesResult.success
            ? relevantNodesResult.data.nodes
            : [];
          const relevantFacts: Fact[] = relevantFactsResult.success
            ? relevantFactsResult.data.facts
            : [];

          const memoryContext = formatContext({
            profile,
            projectEpisodes,
            relevantNodes,
            relevantFacts,
          });

          if (memoryContext) {
            const contextPart: Part = {
              id: `graphiti-context-${Date.now()}`,
              sessionID: input.sessionID,
              messageID: output.message.id,
              type: "text",
              text: memoryContext,
              synthetic: true,
            };

            output.parts.unshift(contextPart);

            const duration = Date.now() - start;
            log("chat.message: context injected", {
              duration,
              contextLength: memoryContext.length,
            });
          }
        }
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },

    tool: {
      graphiti: tool({
        description:
          "Manage and query the Graphiti persistent memory system. Use 'search' to find relevant memories, 'add' to store new knowledge, 'profile' to view user profile, 'list' to see recent memories, 'forget' to remove a memory.",
        args: {
          mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "help"]).optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          type: tool.schema
            .enum([
              "project-config",
              "architecture",
              "error-solution",
              "preference",
              "learned-pattern",
              "conversation",
            ])
            .optional(),
          scope: tool.schema.enum(["user", "project"]).optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args: {
          mode?: string;
          content?: string;
          query?: string;
          type?: MemoryType;
          scope?: MemoryScope;
          memoryId?: string;
          limit?: number;
        }) {
          if (configState.status !== "ready" || !graphitiClient) {
            return JSON.stringify({
              success: false,
              error:
                configState.status === "ready"
                  ? "Graphiti client not initialized"
                  : `Graphiti not configured: ${(configState as { reason: string }).reason}`,
            });
          }

          const config = configState.config;
          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help": {
                return JSON.stringify({
                  success: true,
                  help: `Graphiti Memory System

Commands:
- add: Store a new memory
  Args: content (required), type?, scope?
  
- search: Search memories semantically
  Args: query (required), scope?
  
- profile: View user profile preferences
  Args: query? (filters profile results)
  
- list: List recent memories
  Args: scope?, limit?
  
- forget: Remove a memory by ID
  Args: memoryId (required)

Scopes:
- user: Cross-project preferences and knowledge
- project: Project-specific knowledge (default)

Types:
- project-config: Build commands, test setup
- architecture: Code structure, patterns
- error-solution: Bugs and fixes
- preference: User preferences
- learned-pattern: Development patterns
- conversation: Important discussion points`,
                });
              }

              case "add": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for add mode",
                  });
                }

                const sanitizedContent = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content)) {
                  return JSON.stringify({
                    success: false,
                    error: "Content is fully private and cannot be stored",
                  });
                }

                const scope = args.scope || "project";
                const type = args.type || "learned-pattern";
                const groupId = resolveGroupId(scope, directory, config.profileGroupId!);

                const episodeBody = generateTypedContent(sanitizedContent, type);
                const name = generateEpisodeName(sanitizedContent);
                const uuid = crypto.randomUUID();

                const result = await graphitiClient.addMemory({
                  name,
                  episodeBody,
                  groupId,
                  source: "text",
                  uuid,
                });

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to add memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  memoryId: uuid,
                  message: "Memory saved successfully",
                  scope,
                  type,
                });
              }

              case "search": {
                if (!args.query) {
                  return JSON.stringify({
                    success: false,
                    error: "query parameter is required for search mode",
                  });
                }

                const scope = args.scope;
                let groupIds: string[];

                if (scope === "user") {
                  groupIds = [config.profileGroupId!];
                } else if (scope === "project") {
                  groupIds = [getProjectNamespace(directory)];
                } else {
                  groupIds = [config.profileGroupId!, getProjectNamespace(directory)];
                }

                const [nodesResult, factsResult] = await Promise.all([
                  graphitiClient.searchNodes(args.query, {
                    groupIds,
                    maxNodes: args.limit || 10,
                  }),
                  graphitiClient.searchFacts(args.query, {
                    groupIds,
                    maxFacts: args.limit || 10,
                  }),
                ]);

                const results: Array<{ content: string; type: string; createdAt: string }> = [];
                let warning: string | undefined;

                if (nodesResult.success) {
                  for (const node of nodesResult.data.nodes) {
                    const parsed = parseTypePrefix(node.summary);
                    results.push({
                      content: parsed.content,
                      type: parsed.type,
                      createdAt: node.created_at,
                    });
                  }
                } else if (nodesResult.isUnreachable) {
                  warning = "Graphiti service temporarily unavailable";
                }

                if (factsResult.success) {
                  for (const fact of factsResult.data.facts) {
                    results.push({
                      content: fact.fact,
                      type: "fact",
                      createdAt: fact.created_at,
                    });
                  }
                }

                return JSON.stringify({
                  success: true,
                  results,
                  ...(warning && { warning }),
                });
              }

              case "profile": {
                const query = args.query || "user preferences";
                const profileGroupId = config.profileGroupId!;

                const result = await graphitiClient.searchNodes(query, {
                  groupIds: [profileGroupId],
                  maxNodes: config.maxProfileItems,
                });

                if (!result.success) {
                  if (result.isUnreachable) {
                    return JSON.stringify({
                      success: true,
                      profile: [],
                      warning: "Graphiti service temporarily unavailable",
                    });
                  }
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to fetch profile",
                  });
                }

                const profile = result.data.nodes.map((node) => ({
                  fact: node.summary || node.name,
                  createdAt: node.created_at,
                }));

                return JSON.stringify({
                  success: true,
                  profile,
                });
              }

              case "list": {
                const scope = args.scope || "project";
                const limit = args.limit || 20;
                const groupId = resolveGroupId(scope, directory, config.profileGroupId!);

                const result = await graphitiClient.getEpisodes({
                  groupIds: [groupId],
                  maxEpisodes: limit,
                });

                if (!result.success) {
                  if (result.isUnreachable) {
                    return JSON.stringify({
                      success: true,
                      scope,
                      count: 0,
                      memories: [],
                      warning: "Graphiti service temporarily unavailable",
                    });
                  }
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to list memories",
                  });
                }

                const memories = result.data.episodes.map((episode) => {
                  const parsed = parseTypePrefix(episode.content);
                  return {
                    memoryId: episode.uuid,
                    content: parsed.content,
                    type: parsed.type,
                    createdAt: episode.created_at,
                  };
                });

                return JSON.stringify({
                  success: true,
                  scope,
                  count: memories.length,
                  memories,
                });
              }

              case "forget": {
                if (!args.memoryId) {
                  return JSON.stringify({
                    success: false,
                    error: "memoryId parameter is required for forget mode",
                  });
                }

                const result = await graphitiClient.deleteEpisode(args.memoryId);

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to delete memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: "Memory deleted successfully",
                });
              }

              default:
                return JSON.stringify({
                  success: false,
                  error: `Unknown mode: ${mode}`,
                });
            }
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    },

    event: async () => {},
  };
};
