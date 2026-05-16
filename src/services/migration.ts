import type { GraphitiClient } from "./graphiti-client.js";
import type { Episode } from "../types/graphiti.js";
import type { MemoryClass } from "../types/memory.js";
import { log } from "./logger.js";

export const LEGACY_TYPE_TO_NEW_CLASS: Record<string, MemoryClass | "__unmapped__"> = {
  "project-config": "UserInstruction",
  architecture: "ArchitecturalDecision",
  "error-solution": "FixAttempt",
  preference: "StylePreference",
  "learned-pattern": "Reflection",
  conversation: "__unmapped__",
};

export interface MigrationContext {
  client: Pick<GraphitiClient, "addMemory" | "getEpisodes">;
  groupId: string;
  limit?: number;
}

export interface MigrationOptions {
  dryRun: boolean;
  limit?: number;
}

export interface MigrationCounts {
  scanned: number;
  byOldType: Record<string, number>;
  mappedByNewClass: Record<string, number>;
  unmapped: number;
  alreadyMigrated: number;
  wouldWrite: number;
  written: number;
  failedWrites: number;
}

export interface MigrationResult {
  status: "dry-run" | "applied" | "no-op";
  counts: MigrationCounts;
  unmappedTypes: Array<{ type: string; count: number }>;
  errors: string[];
}

type EpisodeWithMetadata = Episode & {
  id?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};

const TYPE_PREFIX_PATTERN = /^\s*\[TYPE:\s*([^\]]+)\]\s*/;
const DEFAULT_LIMIT = 1000;
const MAX_SAMPLED_ITEMS = 20;

export function parseLegacyEpisode(
  body: string
): { legacyType: string; remainder: string } | null {
  const match = body.match(TYPE_PREFIX_PATTERN);
  const legacyType = match?.[1]?.trim();
  if (!match || !legacyType) return null;

  return {
    legacyType,
    remainder: body.slice(match[0].length),
  };
}

export async function runMigration(
  ctx: MigrationContext,
  opts: MigrationOptions
): Promise<MigrationResult> {
  const counts = createCounts();
  const unmappedTypeCounts = new Map<string, number>();
  const errors: string[] = [];
  const maxEpisodes = ctx.limit ?? opts.limit ?? DEFAULT_LIMIT;

  const episodesResult = await ctx.client.getEpisodes({
    groupIds: [ctx.groupId],
    maxEpisodes,
  });

  if (!episodesResult.success) {
    return {
      status: "no-op",
      counts,
      unmappedTypes: [],
      errors: [episodesResult.error],
    };
  }

  const episodes = episodesResult.data.episodes as EpisodeWithMetadata[];
  const migratedSourceIds = getMigratedSourceIds(episodes);

  counts.scanned = episodes.length;

  for (const episode of episodes) {
    const parsed = parseLegacyEpisode(getEpisodeBody(episode));
    if (!parsed) continue;

    increment(counts.byOldType, parsed.legacyType);
    const episodeId = getEpisodeId(episode);
    if (isAlreadyMigrated(episode, parsed.legacyType, episodeId, migratedSourceIds)) {
      counts.alreadyMigrated += 1;
      continue;
    }

    const mappedClass = LEGACY_TYPE_TO_NEW_CLASS[parsed.legacyType] ?? "__unmapped__";
    if (mappedClass === "__unmapped__") {
      counts.unmapped += 1;
      incrementMap(unmappedTypeCounts, parsed.legacyType);
      continue;
    }

    increment(counts.mappedByNewClass, mappedClass);

    if (opts.dryRun) {
      counts.wouldWrite += 1;
      continue;
    }

    const writeResult = await ctx.client.addMemory({
      name: createMigrationName(parsed.remainder),
      episodeBody: parsed.remainder,
      groupId: ctx.groupId,
      source: "migration",
      metadata: {
        migration: {
          source: `[TYPE: ${parsed.legacyType}]`,
          sourceEpisodeId: episodeId,
          migratedAt: new Date().toISOString(),
        },
        mappedClass,
      },
    });

    if (writeResult.success) {
      counts.written += 1;
    } else {
      counts.failedWrites += 1;
      if (errors.length < MAX_SAMPLED_ITEMS) errors.push(writeResult.error);
      safeLog("[migration] failed to write migrated memory", {
        sourceEpisodeId: episodeId,
        error: writeResult.error,
      });
    }
  }

  const status = getStatus(opts.dryRun, counts);
  const unmappedTypes = Array.from(unmappedTypeCounts.entries())
    .slice(0, MAX_SAMPLED_ITEMS)
    .map(([type, count]) => ({ type, count }));

  safeLog("[migration] completed", { groupId: ctx.groupId, status, counts, unmappedTypes });

  return { status, counts, unmappedTypes, errors };
}

function createCounts(): MigrationCounts {
  return {
    scanned: 0,
    byOldType: {},
    mappedByNewClass: {},
    unmapped: 0,
    alreadyMigrated: 0,
    wouldWrite: 0,
    written: 0,
    failedWrites: 0,
  };
}

function getEpisodeBody(episode: EpisodeWithMetadata): string {
  return episode.content || episode.body || episode.name || "";
}

function getEpisodeId(episode: EpisodeWithMetadata): string {
  return episode.uuid || episode.id || episode.name;
}

function getMetadata(episode: EpisodeWithMetadata): Record<string, unknown> {
  return episode.metadata ?? episode.attributes ?? {};
}

function getMigrationMetadata(episode: EpisodeWithMetadata): Record<string, unknown> {
  const migration = getMetadata(episode).migration;
  return typeof migration === "object" && migration !== null
    ? (migration as Record<string, unknown>)
    : {};
}

function getMigratedSourceIds(episodes: EpisodeWithMetadata[]): Set<string> {
  const sourceIds = new Set<string>();
  for (const episode of episodes) {
    const sourceEpisodeId = getMigrationMetadata(episode).sourceEpisodeId;
    if (typeof sourceEpisodeId === "string" && sourceEpisodeId) {
      sourceIds.add(sourceEpisodeId);
    }
  }
  return sourceIds;
}

function isAlreadyMigrated(
  episode: EpisodeWithMetadata,
  legacyType: string,
  episodeId: string,
  migratedSourceIds: Set<string>
): boolean {
  const migration = getMigrationMetadata(episode);
  return (
    migration.sourceEpisodeId === episodeId ||
    migration.source === `[TYPE: ${legacyType}]` ||
    migratedSourceIds.has(episodeId)
  );
}

function createMigrationName(remainder: string): string {
  const trimmed = remainder.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Migrated legacy memory";
  return trimmed.slice(0, 50) + (trimmed.length > 50 ? "..." : "");
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function getStatus(dryRun: boolean, counts: MigrationCounts): MigrationResult["status"] {
  if (
    counts.scanned === 0 ||
    (counts.wouldWrite === 0 && counts.written === 0 && counts.unmapped === 0 && counts.alreadyMigrated === 0)
  ) {
    return "no-op";
  }
  return dryRun ? "dry-run" : "applied";
}

function safeLog(message: string, data?: unknown): void {
  try {
    log(message, data);
  } catch {
    // Migration must keep reporting through stdout even when daemon log storage is unavailable.
  }
}
