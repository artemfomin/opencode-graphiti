import type { GraphitiClient, GraphitiResult } from "./graphiti-client.js";
import type { Episode, Fact, Node } from "../types/graphiti.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";
import { log } from "./logger.js";

export type RecallTrigger = "session-start" | "compaction-refresh" | "explicit-tool";

export interface RecallConfig {
  enabled: boolean;
  topN: number;
  broadcastCompat: boolean;
}

export interface RecallContext {
  client: Pick<GraphitiClient, "searchNodes" | "searchFacts" | "getEpisodes">;
  config: RecallConfig;
  projectGroupId: string;
  profileGroupId?: string;
}

export interface RecallInput {
  query: string;
  trigger: RecallTrigger;
  topN?: number;
}

export interface RecalledItem {
  kind: "episode" | "node" | "fact";
  text: string;
  raw: Episode | Node | Fact;
}

export interface RecallResult {
  status: "ok" | "disabled" | "broadcast-fallback" | "failed-open";
  trigger: RecallTrigger;
  items: RecalledItem[];
  rawCount: number;
  bounded: boolean;
  reason?: string;
}

type RawRecallItem =
  | { kind: "episode"; raw: Episode; text: string }
  | { kind: "node"; raw: Node; text: string }
  | { kind: "fact"; raw: Fact; text: string };

type ReadResult<T> = { items: T[]; successfulReads: number; error?: string };

export async function performRecall(ctx: RecallContext, input: RecallInput): Promise<RecallResult> {
  if (!ctx.config.enabled) {
    return disabledResult(input.trigger);
  }

  const topN = input.topN ?? ctx.config.topN;
  if (topN <= 0) {
    return disabledResult(input.trigger, "non-positive topN");
  }

  const rawResult = ctx.config.broadcastCompat && input.trigger === "session-start"
    ? await readBroadcastFallback(ctx, input.query, topN)
    : await readTopN(ctx, input, topN);

  if (rawResult.successfulReads === 0 && rawResult.error) {
    log("recall: failed open", { trigger: input.trigger, error: rawResult.error });
    return {
      status: "failed-open",
      trigger: input.trigger,
      items: [],
      rawCount: 0,
      bounded: false,
      reason: rawResult.error,
    };
  }

  if (rawResult.error) {
    log("recall: partial failure", { trigger: input.trigger, error: rawResult.error });
  }

  const deduped = dedupeRawItems(rawResult.items);
  const boundedRaw = deduped.slice(0, topN);
  const items = boundedRaw.flatMap(toRecalledItem);

  return {
    status: ctx.config.broadcastCompat && input.trigger === "session-start" ? "broadcast-fallback" : "ok",
    trigger: input.trigger,
    items,
    rawCount: rawResult.items.length,
    bounded: deduped.length > topN,
  };
}

function disabledResult(trigger: RecallTrigger, reason?: string): RecallResult {
  return { status: "disabled", trigger, items: [], rawCount: 0, bounded: false, reason };
}

async function readTopN(
  ctx: RecallContext,
  input: RecallInput,
  topN: number
): Promise<ReadResult<RawRecallItem>> {
  if (!input.query.trim() && input.trigger === "session-start") {
    const episodes = await safeRead(() => ctx.client.getEpisodes({
      groupIds: [ctx.projectGroupId],
      maxEpisodes: topN,
    }));

    return {
      items: episodes.data?.episodes.map((episode) => ({
        kind: "episode" as const,
        raw: episode,
        text: episode.content,
      })) ?? [],
      successfulReads: episodes.success ? 1 : 0,
      error: episodes.error,
    };
  }

  const [nodes, facts] = await Promise.all([
    safeRead(() => ctx.client.searchNodes(input.query, {
      groupIds: [ctx.projectGroupId],
      maxNodes: topN,
    })),
    safeRead(() => ctx.client.searchFacts(input.query, {
      groupIds: [ctx.projectGroupId],
      maxFacts: topN,
    })),
  ]);

  return {
    items: [
      ...(nodes.data?.nodes.map((node) => ({ kind: "node" as const, raw: node, text: node.summary })) ?? []),
      ...(facts.data?.facts.map((fact) => ({ kind: "fact" as const, raw: fact, text: fact.fact })) ?? []),
    ],
    successfulReads: Number(nodes.success) + Number(facts.success),
    error: [nodes.error, facts.error].filter(Boolean).join("; ") || undefined,
  };
}

async function readBroadcastFallback(
  ctx: RecallContext,
  query: string,
  topN: number
): Promise<ReadResult<RawRecallItem>> {
  const [episodes, nodes, facts] = await Promise.all([
    safeRead(() => ctx.client.getEpisodes({ groupIds: [ctx.projectGroupId], maxEpisodes: topN })),
    safeRead(() => ctx.client.searchNodes(query, { groupIds: [ctx.projectGroupId], maxNodes: topN })),
    safeRead(() => ctx.client.searchFacts(query, { groupIds: [ctx.projectGroupId], maxFacts: topN })),
  ]);

  return {
    items: [
      ...(episodes.data?.episodes.map((episode) => ({
        kind: "episode" as const,
        raw: episode,
        text: episode.content,
      })) ?? []),
      ...(nodes.data?.nodes.map((node) => ({ kind: "node" as const, raw: node, text: node.summary })) ?? []),
      ...(facts.data?.facts.map((fact) => ({ kind: "fact" as const, raw: fact, text: fact.fact })) ?? []),
    ],
    successfulReads: Number(episodes.success) + Number(nodes.success) + Number(facts.success),
    error: [episodes.error, nodes.error, facts.error].filter(Boolean).join("; ") || undefined,
  };
}

async function safeRead<T>(read: () => Promise<GraphitiResult<T>>): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const result = await read();
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function dedupeRawItems(items: RawRecallItem[]): RawRecallItem[] {
  const seen = new Set<string>();
  const deduped: RawRecallItem[] = [];

  for (const item of items) {
    const id = getRawId(item.raw);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    deduped.push(item);
  }

  return deduped;
}

function getRawId(raw: Episode | Node | Fact): string | undefined {
  return raw.uuid;
}

function toRecalledItem(item: RawRecallItem): RecalledItem[] {
  if (isFullyPrivate(item.text)) {
    return [];
  }

  return [{ kind: item.kind, text: stripPrivateContent(item.text), raw: item.raw }];
}
