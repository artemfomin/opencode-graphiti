import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { stripJsoncComments } from "./services/jsonc.js";
import { getConfigHome } from "./services/paths.js";
import type { GraphitiConfig } from "./types/graphiti.js";

const DEFAULT_KEYWORD_PATTERNS = [
  "remember",
  "memorize",
  "save\\s+this",
  "note\\s+this",
  "keep\\s+in\\s+mind",
  "don'?t\\s+forget",
  "learn\\s+this",
  "store\\s+this",
  "record\\s+this",
  "make\\s+a\\s+note",
  "take\\s+note",
  "jot\\s+down",
  "commit\\s+to\\s+memory",
  "remember\\s+that",
  "never\\s+forget",
  "always\\s+remember",
];

const GraphitiConfigSchema = z.object({
  graphitiUrl: z.string().optional(),
  groupId: z.string().optional(),
  userId: z.string().optional(),
  profileGroupId: z.string().optional(),
  maxMemories: z.number().optional(),
  maxProjectMemories: z.number().optional(),
  maxProfileItems: z.number().optional(),
  injectProfile: z.boolean().optional(),
  keywordPatterns: z.array(z.string()).optional(),
  compactionThreshold: z.number().optional(),
});

type PartialGraphitiConfig = z.infer<typeof GraphitiConfigSchema>;

export type ConfigState =
  | { status: "ready"; config: GraphitiConfig }
  | { status: "unconfigured"; reason: string }
  | { status: "invalid"; reason: string };

let _configState: ConfigState | null = null;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function validateCompactionThreshold(value: number | undefined): number {
  if (value === undefined || typeof value !== "number" || isNaN(value)) {
    return 0.8;
  }
  if (value <= 0 || value > 1) return 0.8;
  return value;
}

function normalizeGraphitiUrl(url: string): string {
  let normalized = url.replace(/\/+$/, "");
  if (!normalized.endsWith("/mcp")) {
    normalized += "/mcp";
  }
  return normalized + "/";
}

function sanitizeNamespace(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractProjectName(projectDir: string): string {
  const packageJsonPath = join(projectDir, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name && typeof pkg.name === "string" && pkg.name.trim()) {
        return pkg.name;
      }
    } catch {
      // Fall through to directory name
    }
  }

  return basename(projectDir);
}

function loadJsoncFile(path: string): PartialGraphitiConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, "utf-8");
    const json = stripJsoncComments(content);
    const parsed = JSON.parse(json);
    return GraphitiConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}

function mergeConfigs(
  global: PartialGraphitiConfig | null,
  local: PartialGraphitiConfig | null
): PartialGraphitiConfig {
  const merged: PartialGraphitiConfig = {};

  if (global?.graphitiUrl) merged.graphitiUrl = global.graphitiUrl;
  if (local?.graphitiUrl) merged.graphitiUrl = local.graphitiUrl;

  if (global?.groupId) merged.groupId = global.groupId;
  if (local?.groupId) merged.groupId = local.groupId;

  if (global?.userId) merged.userId = global.userId;
  if (local?.userId) merged.userId = local.userId;

  if (global?.profileGroupId) merged.profileGroupId = global.profileGroupId;
  if (local?.profileGroupId) merged.profileGroupId = local.profileGroupId;

  if (global?.maxMemories !== undefined)
    merged.maxMemories = global.maxMemories;
  if (local?.maxMemories !== undefined) merged.maxMemories = local.maxMemories;

  if (global?.maxProjectMemories !== undefined)
    merged.maxProjectMemories = global.maxProjectMemories;
  if (local?.maxProjectMemories !== undefined)
    merged.maxProjectMemories = local.maxProjectMemories;

  if (global?.maxProfileItems !== undefined)
    merged.maxProfileItems = global.maxProfileItems;
  if (local?.maxProfileItems !== undefined)
    merged.maxProfileItems = local.maxProfileItems;

  if (global?.injectProfile !== undefined)
    merged.injectProfile = global.injectProfile;
  if (local?.injectProfile !== undefined)
    merged.injectProfile = local.injectProfile;

  if (global?.compactionThreshold !== undefined)
    merged.compactionThreshold = global.compactionThreshold;
  if (local?.compactionThreshold !== undefined)
    merged.compactionThreshold = local.compactionThreshold;

  const keywordPatterns: string[] = [
    ...DEFAULT_KEYWORD_PATTERNS,
    ...(global?.keywordPatterns ?? []),
    ...(local?.keywordPatterns ?? []),
  ];
  merged.keywordPatterns = keywordPatterns.filter(isValidRegex);

  return merged;
}

export function initConfig(projectDir?: string): ConfigState {
  if (_configState !== null) {
    return _configState;
  }

  const globalConfigPath = join(getConfigHome(), "graphiti.jsonc");
  const globalConfig = loadJsoncFile(globalConfigPath);

  let localConfig: PartialGraphitiConfig | null = null;
  if (projectDir) {
    const localConfigPath = join(projectDir, ".opencode", "graphiti.jsonc");
    localConfig = loadJsoncFile(localConfigPath);
  }

  const merged = mergeConfigs(globalConfig, localConfig);

  const graphitiUrl =
    process.env.GRAPHITI_URL ?? merged.graphitiUrl ?? undefined;
  const userId =
    process.env.GRAPHITI_USER_ID ?? merged.userId ?? undefined;
  let groupId = process.env.GRAPHITI_GROUP_ID ?? merged.groupId ?? undefined;

  if (!graphitiUrl) {
    _configState = {
      status: "unconfigured",
      reason: "Missing required field: graphitiUrl",
    };
    return _configState;
  }

  if (!groupId && userId && projectDir) {
    const projectName = extractProjectName(projectDir);
    const sanitizedName = sanitizeNamespace(projectName);
    groupId = `${userId}_${sanitizedName}`;
  }

  if (!groupId) {
    _configState = {
      status: "unconfigured",
      reason: "Missing required field: groupId",
    };
    return _configState;
  }

  const defaultProfileGroupId = userId ?? `${groupId}_profile`;

  const config: GraphitiConfig = {
    graphitiUrl: normalizeGraphitiUrl(graphitiUrl),
    groupId,
    userId,
    profileGroupId: merged.profileGroupId ?? defaultProfileGroupId,
    maxMemories: merged.maxMemories ?? 5,
    maxProjectMemories: merged.maxProjectMemories ?? 10,
    maxProfileItems: merged.maxProfileItems ?? 5,
    injectProfile: merged.injectProfile ?? true,
    keywordPatterns: merged.keywordPatterns ?? DEFAULT_KEYWORD_PATTERNS,
    compactionThreshold: validateCompactionThreshold(
      merged.compactionThreshold
    ),
  };

  _configState = { status: "ready", config };
  return _configState;
}

export function getConfig(): GraphitiConfig {
  if (_configState === null || _configState.status !== "ready") {
    throw new Error(
      "Config not initialized or not ready. Call initConfig() first and check isConfigReady()."
    );
  }
  return _configState.config;
}

export function isConfigReady(): boolean {
  return _configState !== null && _configState.status === "ready";
}

export function resetConfig(): void {
  _configState = null;
}
