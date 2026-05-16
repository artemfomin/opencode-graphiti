import { tool } from "@opencode-ai/plugin";
import { GraphitiClient } from "../services/graphiti-client.js";
import { getProjectNamespace } from "../services/namespace.js";
import { stripPrivateContent, isFullyPrivate } from "../services/privacy.js";
import { performRecall } from "../services/recall.js";
import type { GraphitiConfig } from "../types/graphiti.js";
import type { MemoryScope, MemoryType } from "../types/index.js";
import {
  createRecallContext,
  generateEpisodeName,
  generateTypedContent,
  parseTypePrefix,
  resolveGroupId,
} from "../handlers/_internals.js";

export interface GraphitiToolDeps {
  graphitiClient: GraphitiClient | null;
  config: GraphitiConfig | null;
  disabledReason?: string;
  directory: string;
  projectNamespace: string;
}

interface GraphitiToolArgs {
  mode?: string;
  content?: string;
  query?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  memoryId?: string;
  limit?: number;
  topN?: number;
}

interface ReadyGraphitiToolDeps extends GraphitiToolDeps {
  graphitiClient: GraphitiClient;
  config: GraphitiConfig;
}

export function createGraphitiTool(deps: GraphitiToolDeps): ReturnType<typeof tool> {
  return tool({
    description:
      "Manage and query the Graphiti persistent memory system. Use 'search' to find relevant memories, 'add' to store new knowledge, 'profile' to view user profile, 'list' to see recent memories, 'forget' to remove a memory.",
    args: {
      mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "recall", "help"]).optional(),
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
      topN: tool.schema.number().optional(),
    },
    async execute(args: GraphitiToolArgs) {
      if (!deps.graphitiClient || !deps.config) {
        return JSON.stringify({
          success: false,
          error: deps.graphitiClient
            ? "Graphiti client not initialized"
            : `Graphiti not configured: ${deps.disabledReason ?? "unknown"}`,
        });
      }

      const readyDeps: ReadyGraphitiToolDeps = {
        ...deps,
        graphitiClient: deps.graphitiClient,
        config: deps.config,
      };

      try {
        switch (args.mode || "help") {
          case "help":
            return executeHelp();
          case "add":
            return executeAdd(args, readyDeps);
          case "search":
            return executeSearch(args, readyDeps);
          case "recall":
            return executeRecall(args, readyDeps);
          case "profile":
            return executeProfile(args, readyDeps);
          case "list":
            return executeList(args, readyDeps);
          case "forget":
            return executeForget(args, readyDeps);
          default:
            return JSON.stringify({ success: false, error: `Unknown mode: ${args.mode}` });
        }
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

function executeHelp(): string {
  return JSON.stringify({
    success: true,
    help: `Graphiti Memory Tool

Modes:
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

- recall: Retrieve bounded top-N memory recall
  Args: query?, topN?

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

async function executeAdd(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  if (!args.content) {
    return JSON.stringify({ success: false, error: "content parameter is required for add mode" });
  }

  const sanitizedContent = stripPrivateContent(args.content);
  if (isFullyPrivate(args.content)) {
    return JSON.stringify({ success: false, error: "Content is fully private and cannot be stored" });
  }

  const scope = args.scope || "project";
  const type = args.type || "learned-pattern";
  const groupId = resolveGroupId(scope, deps.directory, deps.config.profileGroupId!);
  const result = await deps.graphitiClient.addMemory({
    name: generateEpisodeName(sanitizedContent),
    episodeBody: generateTypedContent(sanitizedContent, type),
    groupId,
    source: "text",
  });

  if (!result.success) {
    return JSON.stringify({ success: false, error: result.error || "Failed to add memory" });
  }

  return JSON.stringify({ success: true, message: "Memory queued for processing", scope, type });
}

async function executeSearch(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  if (!args.query) {
    return JSON.stringify({ success: false, error: "query parameter is required for search mode" });
  }

  const groupIds = getSearchGroupIds(args.scope, deps);
  const [nodesResult, factsResult] = await Promise.all([
    deps.graphitiClient.searchNodes(args.query, { groupIds, maxNodes: args.limit || 10 }),
    deps.graphitiClient.searchFacts(args.query, { groupIds, maxFacts: args.limit || 10 }),
  ]);
  const results: Array<{ content: string; type: string; createdAt: string }> = [];
  let warning: string | undefined;

  if (nodesResult.success) {
    for (const node of nodesResult.data.nodes) {
      const parsed = parseTypePrefix(node.summary);
      results.push({ content: parsed.content, type: parsed.type, createdAt: node.created_at });
    }
  } else if (nodesResult.isUnreachable) {
    warning = "Graphiti service temporarily unavailable";
  }

  if (factsResult.success) {
    for (const fact of factsResult.data.facts) {
      results.push({ content: fact.fact, type: "fact", createdAt: fact.created_at });
    }
  }

  return JSON.stringify({ success: true, results, ...(warning && { warning }) });
}

async function executeRecall(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  const result = await performRecall(createRecallContext(deps.graphitiClient, deps.projectNamespace, deps.config), {
    query: args.query ?? "",
    trigger: "explicit-tool",
    topN: args.topN,
  });

  return JSON.stringify({
    success: result.status !== "failed-open",
    status: result.status,
    items: result.items.map((item) => ({ kind: item.kind, text: item.text })),
    bounded: result.bounded,
    rawCount: result.rawCount,
    reason: result.reason,
  });
}

async function executeProfile(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  const result = await deps.graphitiClient.searchNodes(args.query || "user preferences", {
    groupIds: [deps.config.profileGroupId!],
    maxNodes: deps.config.maxProfileItems,
  });

  if (!result.success) {
    if (result.isUnreachable) {
      return JSON.stringify({ success: true, profile: [], warning: "Graphiti service temporarily unavailable" });
    }
    return JSON.stringify({ success: false, error: result.error || "Failed to fetch profile" });
  }

  const profile = (result.data.nodes ?? []).map((node) => ({
    fact: node.summary || node.name,
    createdAt: node.created_at,
  }));
  return JSON.stringify({ success: true, profile });
}

async function executeList(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  const scope = args.scope || "project";
  const limit = args.limit || 20;
  const groupId = resolveGroupId(scope, deps.directory, deps.config.profileGroupId!);
  const result = await deps.graphitiClient.getEpisodes({ groupIds: [groupId], maxEpisodes: limit });

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
    return JSON.stringify({ success: false, error: result.error || "Failed to list memories" });
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
  return JSON.stringify({ success: true, scope, count: memories.length, memories });
}

async function executeForget(args: GraphitiToolArgs, deps: ReadyGraphitiToolDeps): Promise<string> {
  if (!args.memoryId) {
    return JSON.stringify({ success: false, error: "memoryId parameter is required for forget mode" });
  }

  const result = await deps.graphitiClient.deleteEpisode(args.memoryId);
  if (!result.success) {
    return JSON.stringify({ success: false, error: result.error || "Failed to delete memory" });
  }
  return JSON.stringify({ success: true, message: "Memory deleted successfully" });
}

function getSearchGroupIds(scope: MemoryScope | undefined, deps: ReadyGraphitiToolDeps): string[] {
  if (scope === "user") return [deps.config.profileGroupId!];
  if (scope === "project") return [getProjectNamespace(deps.directory)];
  return [deps.config.profileGroupId!, getProjectNamespace(deps.directory)];
}
