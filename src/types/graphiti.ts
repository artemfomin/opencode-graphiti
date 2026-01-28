export interface GraphitiConfig {
  graphitiUrl: string;
  groupId: string;
  profileGroupId?: string;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  keywordPatterns?: string[];
  compactionThreshold?: number;
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

  return true;
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
