import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { stripJsoncComments } from "./services/jsonc.js";
import { log } from "./services/logger.js";
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

const DEFAULT_MEMORY_CONFIG = { enabled: true };

const DEFAULT_CAPTURE_CONFIG = {
  enabled: true,
  trivialMessageMinLength: 4,
  explicitClassMarkers: ["@graphiti"],
  ratificationKeywords: {
    positive: ["works", "good", "thanks", "perfect", "merged", "great"],
    negative: ["wrong", "no", "doesn't work", "revert", "broken"],
  },
  ratificationWindowTurns: 1,
  unverifiedAutoExpireMs: 86_400_000,
};

const DEFAULT_SHADOW_EXTRACTOR_CONFIG = {
  enabled: true,
  timeoutMs: 8000,
  maxConcurrency: 1,
};

const DEFAULT_RECALL_CONFIG = {
  enabled: true,
  topN: 5,
  broadcastCompat: false,
};

const DEFAULT_MARKERS_CONFIG = {
  enabled: true,
  prefix: "@graphiti",
};

const BooleanSectionSchema = z
  .object({ enabled: z.boolean().optional() })
  .optional();

const CaptureConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    trivialMessageMinLength: z.number().optional(),
    explicitClassMarkers: z.array(z.string()).optional(),
    ratificationKeywords: z
      .object({
        positive: z.array(z.string()).optional(),
        negative: z.array(z.string()).optional(),
      })
      .optional(),
    ratificationWindowTurns: z.number().optional(),
    unverifiedAutoExpireMs: z.number().optional(),
  })
  .optional();

const ShadowExtractorConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    timeoutMs: z.number().optional(),
    maxConcurrency: z.number().optional(),
  })
  .optional();

const RecallConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    topN: z.number().optional(),
    broadcastCompat: z.boolean().optional(),
  })
  .optional();

const MarkersConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    prefix: z.string().optional(),
  })
  .optional();

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
  memory: BooleanSectionSchema,
  capture: CaptureConfigSchema,
  shadowExtractor: ShadowExtractorConfigSchema,
  recall: RecallConfigSchema,
  markers: MarkersConfigSchema,
});

type PartialGraphitiConfig = z.infer<typeof GraphitiConfigSchema>;
type MergeableSectionKey = keyof Pick<
  PartialGraphitiConfig,
  "memory" | "shadowExtractor" | "recall" | "markers"
>;

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

function parseBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;

  log("[config] ignoring invalid boolean env override", { name, value: raw });
  return undefined;
}

function parseNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;

  const value = Number.parseFloat(raw);
  if (Number.isFinite(value)) return value;

  log("[config] ignoring invalid numeric env override", { name, value: raw });
  return undefined;
}

function assignSection<T extends object>(
  merged: PartialGraphitiConfig,
  key: MergeableSectionKey,
  value: T | undefined
): void {
  if (value === undefined) return;

  if (key === "memory") {
    merged.memory = { ...(merged.memory ?? {}), ...value };
  } else if (key === "shadowExtractor") {
    merged.shadowExtractor = { ...(merged.shadowExtractor ?? {}), ...value };
  } else if (key === "recall") {
    merged.recall = { ...(merged.recall ?? {}), ...value };
  } else {
    merged.markers = { ...(merged.markers ?? {}), ...value };
  }
}

function mergeCaptureConfig(
  merged: PartialGraphitiConfig,
  value: PartialGraphitiConfig["capture"]
): void {
  if (value === undefined) return;

  merged.capture = {
    ...(merged.capture ?? {}),
    ...value,
    ratificationKeywords: {
      ...(merged.capture?.ratificationKeywords ?? {}),
      ...(value.ratificationKeywords ?? {}),
    },
  };
}

function applyEnvOverrides(merged: PartialGraphitiConfig): PartialGraphitiConfig {
  const config: PartialGraphitiConfig = { ...merged };

  const memoryEnabled = parseBooleanEnv("GRAPHITI_MEMORY_ENABLED");
  if (memoryEnabled !== undefined) {
    config.memory = { ...(config.memory ?? {}), enabled: memoryEnabled };
  }

  const captureEnabled = parseBooleanEnv("GRAPHITI_CAPTURE_ENABLED");
  if (captureEnabled !== undefined) {
    config.capture = { ...(config.capture ?? {}), enabled: captureEnabled };
  }

  const shadowEnabled = parseBooleanEnv("GRAPHITI_SHADOW_ENABLED");
  if (shadowEnabled !== undefined) {
    config.shadowExtractor = {
      ...(config.shadowExtractor ?? {}),
      enabled: shadowEnabled,
    };
  }

  const shadowTimeoutMs = parseNumberEnv("GRAPHITI_SHADOW_TIMEOUT_MS");
  if (shadowTimeoutMs !== undefined) {
    config.shadowExtractor = {
      ...(config.shadowExtractor ?? {}),
      timeoutMs: shadowTimeoutMs,
    };
  }

  if (process.env.GRAPHITI_SHADOW_PROVIDER !== undefined) {
    config.shadowExtractor = {
      ...(config.shadowExtractor ?? {}),
      provider: process.env.GRAPHITI_SHADOW_PROVIDER,
    };
  }

  if (process.env.GRAPHITI_SHADOW_MODEL !== undefined) {
    config.shadowExtractor = {
      ...(config.shadowExtractor ?? {}),
      model: process.env.GRAPHITI_SHADOW_MODEL,
    };
  }

  const recallTopN = parseNumberEnv("GRAPHITI_RECALL_TOP_N");
  if (recallTopN !== undefined) {
    config.recall = { ...(config.recall ?? {}), topN: recallTopN };
  }

  const recallBroadcastCompat = parseBooleanEnv(
    "GRAPHITI_RECALL_BROADCAST_COMPAT"
  );
  if (recallBroadcastCompat !== undefined) {
    config.recall = {
      ...(config.recall ?? {}),
      broadcastCompat: recallBroadcastCompat,
    };
  }

  return config;
}

function buildMemoryConfig(merged: PartialGraphitiConfig) {
  return {
    memory: {
      ...DEFAULT_MEMORY_CONFIG,
      ...(merged.memory ?? {}),
    },
    capture: {
      ...DEFAULT_CAPTURE_CONFIG,
      ...(merged.capture ?? {}),
      ratificationKeywords: {
        ...DEFAULT_CAPTURE_CONFIG.ratificationKeywords,
        ...(merged.capture?.ratificationKeywords ?? {}),
      },
    },
    shadowExtractor: {
      ...DEFAULT_SHADOW_EXTRACTOR_CONFIG,
      ...(merged.shadowExtractor ?? {}),
    },
    recall: {
      ...DEFAULT_RECALL_CONFIG,
      ...(merged.recall ?? {}),
    },
    markers: {
      ...DEFAULT_MARKERS_CONFIG,
      ...(merged.markers ?? {}),
    },
  };
}

function validateMemoryConfig(
  config: ReturnType<typeof buildMemoryConfig>
): string | null {
  if (config.shadowExtractor.timeoutMs <= 0) {
    return "shadowExtractor.timeoutMs must be greater than 0";
  }
  if (config.shadowExtractor.maxConcurrency <= 0) {
    return "shadowExtractor.maxConcurrency must be greater than 0";
  }
  if (config.recall.topN <= 0) {
    return "recall.topN must be greater than 0";
  }
  if (config.capture.trivialMessageMinLength < 0) {
    return "capture.trivialMessageMinLength must be greater than or equal to 0";
  }
  if (config.capture.ratificationWindowTurns < 0) {
    return "capture.ratificationWindowTurns must be greater than or equal to 0";
  }
  if (config.capture.unverifiedAutoExpireMs < 0) {
    return "capture.unverifiedAutoExpireMs must be greater than or equal to 0";
  }

  return null;
}

function normalizeGraphitiUrl(url: string): string {
  let normalized = url.replace(/\/+$/, "");
  if (!normalized.endsWith("/mcp")) {
    normalized += "/mcp";
  }
  return normalized;
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

  assignSection(merged, "memory", global?.memory);
  assignSection(merged, "memory", local?.memory);
  mergeCaptureConfig(merged, global?.capture);
  mergeCaptureConfig(merged, local?.capture);
  assignSection(merged, "shadowExtractor", global?.shadowExtractor);
  assignSection(merged, "shadowExtractor", local?.shadowExtractor);
  assignSection(merged, "recall", global?.recall);
  assignSection(merged, "recall", local?.recall);
  assignSection(merged, "markers", global?.markers);
  assignSection(merged, "markers", local?.markers);

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

  const merged = applyEnvOverrides(mergeConfigs(globalConfig, localConfig));

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
  const memoryConfig = buildMemoryConfig(merged);
  const invalidReason = validateMemoryConfig(memoryConfig);
  if (invalidReason !== null) {
    _configState = { status: "invalid", reason: invalidReason };
    return _configState;
  }

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
    ...memoryConfig,
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
