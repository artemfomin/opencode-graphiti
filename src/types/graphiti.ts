export interface GraphitiConfig {
  graphitiUrl: string;
  groupId: string;
  userId?: string;
  profileGroupId?: string;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  keywordPatterns?: string[];
  compactionThreshold?: number;
  memory: {
    enabled: boolean;
  };
  capture: {
    enabled: boolean;
    trivialMessageMinLength: number;
    explicitClassMarkers: string[];
    ratificationKeywords: {
      positive: string[];
      negative: string[];
    };
    ratificationWindowTurns: number;
    unverifiedAutoExpireMs: number;
  };
  shadowExtractor: {
    enabled: boolean;
    provider?: string;
    model?: string;
    timeoutMs: number;
    maxConcurrency: number;
  };
  recall: {
    enabled: boolean;
    topN: number;
    broadcastCompat: boolean;
  };
  markers: {
    enabled: boolean;
    prefix: string;
  };
}

export interface Episode {
  uuid: string;
  name: string;
  content: string;
  source: string;
  source_description: string;
  created_at: string;
  group_id: string;
}

export interface Node {
  uuid: string;
  name: string;
  labels: string[];
  summary: string;
  created_at: string;
  group_id: string;
  attributes?: Record<string, unknown>;
}

export interface Fact {
  uuid: string;
  fact: string;
  source_node_uuid: string;
  target_node_uuid: string;
  created_at: string;
  expired_at: string | null;
  group_id: string;
}

export function isGraphitiConfig(value: unknown): value is GraphitiConfig {
  if (typeof value !== "object" || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj.graphitiUrl !== "string") return false;
  if (typeof obj.groupId !== "string") return false;

  if (obj.userId !== undefined && typeof obj.userId !== "string")
    return false;

  if (
    obj.profileGroupId !== undefined &&
    typeof obj.profileGroupId !== "string"
  )
    return false;
  if (obj.maxMemories !== undefined && typeof obj.maxMemories !== "number")
    return false;
  if (
    obj.maxProjectMemories !== undefined &&
    typeof obj.maxProjectMemories !== "number"
  )
    return false;
  if (
    obj.maxProfileItems !== undefined &&
    typeof obj.maxProfileItems !== "number"
  )
    return false;
  if (obj.injectProfile !== undefined && typeof obj.injectProfile !== "boolean")
    return false;
  if (
    obj.keywordPatterns !== undefined &&
    (!Array.isArray(obj.keywordPatterns) ||
      !obj.keywordPatterns.every((p) => typeof p === "string"))
  )
    return false;
  if (
    obj.compactionThreshold !== undefined &&
    typeof obj.compactionThreshold !== "number"
  )
    return false;

  if (!isBooleanSection(obj.memory)) return false;
  if (!isCaptureConfig(obj.capture)) return false;
  if (!isShadowExtractorConfig(obj.shadowExtractor)) return false;
  if (!isRecallConfig(obj.recall)) return false;
  if (!isMarkersConfig(obj.markers)) return false;

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBooleanSection(value: unknown): value is { enabled: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).enabled === "boolean"
  );
}

function isCaptureConfig(value: unknown): boolean {
  if (!isBooleanSection(value)) return false;
  const obj = value as Record<string, unknown>;
  const keywords = obj.ratificationKeywords as Record<string, unknown> | undefined;

  return (
    typeof obj.trivialMessageMinLength === "number" &&
    isStringArray(obj.explicitClassMarkers) &&
    typeof keywords === "object" &&
    keywords !== null &&
    isStringArray(keywords.positive) &&
    isStringArray(keywords.negative) &&
    typeof obj.ratificationWindowTurns === "number" &&
    typeof obj.unverifiedAutoExpireMs === "number"
  );
}

function isShadowExtractorConfig(value: unknown): boolean {
  if (!isBooleanSection(value)) return false;
  const obj = value as Record<string, unknown>;

  return (
    (obj.provider === undefined || typeof obj.provider === "string") &&
    (obj.model === undefined || typeof obj.model === "string") &&
    typeof obj.timeoutMs === "number" &&
    typeof obj.maxConcurrency === "number"
  );
}

function isRecallConfig(value: unknown): boolean {
  if (!isBooleanSection(value)) return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.topN === "number" && typeof obj.broadcastCompat === "boolean"
  );
}

function isMarkersConfig(value: unknown): boolean {
  if (!isBooleanSection(value)) return false;
  return typeof (value as Record<string, unknown>).prefix === "string";
}

export function isEpisode(value: unknown): value is Episode {
  if (typeof value !== "object" || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj.uuid !== "string") return false;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.content !== "string") return false;
  if (typeof obj.source !== "string") return false;
  if (typeof obj.source_description !== "string") return false;
  if (typeof obj.created_at !== "string") return false;
  if (typeof obj.group_id !== "string") return false;

  return true;
}

export function isNode(value: unknown): value is Node {
  if (typeof value !== "object" || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj.uuid !== "string") return false;
  if (typeof obj.name !== "string") return false;
  if (
    !Array.isArray(obj.labels) ||
    !obj.labels.every((l) => typeof l === "string")
  )
    return false;
  if (typeof obj.summary !== "string") return false;
  if (typeof obj.created_at !== "string") return false;
  if (typeof obj.group_id !== "string") return false;

  if (obj.attributes !== undefined && typeof obj.attributes !== "object")
    return false;

  return true;
}

export function isFact(value: unknown): value is Fact {
  if (typeof value !== "object" || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj.uuid !== "string") return false;
  if (typeof obj.fact !== "string") return false;
  if (typeof obj.source_node_uuid !== "string") return false;
  if (typeof obj.target_node_uuid !== "string") return false;
  if (typeof obj.created_at !== "string") return false;
  if (
    obj.expired_at !== null &&
    obj.expired_at !== undefined &&
    typeof obj.expired_at !== "string"
  )
    return false;
  if (typeof obj.group_id !== "string") return false;

  return true;
}
