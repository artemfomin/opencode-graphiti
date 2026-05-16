import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger.js";
import { getDataHome } from "../paths.js";
import {
  assertValidMessageId,
  assertValidPartId,
  generateMessageId,
  generatePartId,
} from "../ids.js";
import type { StoredMessage } from "./types.js";

const MESSAGE_STORAGE = () => join(getDataHome(), "messages");
const PART_STORAGE = () => join(getDataHome(), "parts");

export function getMessageDir(sessionID: string): string | null {
  const messageStorage = MESSAGE_STORAGE();
  if (!existsSync(messageStorage)) return null;

  const directPath = join(messageStorage, sessionID);
  if (existsSync(directPath)) return directPath;

  for (const dir of readdirSync(messageStorage)) {
    const sessionPath = join(messageStorage, dir, sessionID);
    if (existsSync(sessionPath)) return sessionPath;
  }

  return null;
}

function getOrCreateMessageDir(sessionID: string): string {
  const messageStorage = MESSAGE_STORAGE();
  if (!existsSync(messageStorage)) {
    mkdirSync(messageStorage, { recursive: true });
  }

  const directPath = join(messageStorage, sessionID);
  if (existsSync(directPath)) return directPath;

  for (const dir of readdirSync(messageStorage)) {
    const sessionPath = join(messageStorage, dir, sessionID);
    if (existsSync(sessionPath)) return sessionPath;
  }

  mkdirSync(directPath, { recursive: true });
  return directPath;
}

export function findNearestMessageWithFields(messageDir: string): StoredMessage | null {
  try {
    const files = readdirSync(messageDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8");
        const msg = JSON.parse(content) as StoredMessage;
        if (msg.agent && msg.model?.providerID && msg.model?.modelID) {
          return msg;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function injectHookMessage(
  sessionID: string,
  hookContent: string,
  originalMessage: {
    agent?: string;
    model?: { providerID?: string; modelID?: string };
    path?: { cwd?: string; root?: string };
  }
): boolean {
  if (!hookContent || hookContent.trim().length === 0) {
    log("[compaction] attempted to inject empty content, skipping");
    return false;
  }

  const messageDir = getOrCreateMessageDir(sessionID);
  const fallback = findNearestMessageWithFields(messageDir);

  const now = Date.now();
  const messageID = generateMessageId();
  const partID = generatePartId();
  // Defense-in-depth: never write a part/message with an id that opencode's
  // read-path schema would reject. See services/ids.ts for context.
  assertValidMessageId(messageID);
  assertValidPartId(partID);

  const resolvedAgent = originalMessage.agent ?? fallback?.agent ?? "general";
  const resolvedModel =
    originalMessage.model?.providerID && originalMessage.model?.modelID
      ? { providerID: originalMessage.model.providerID, modelID: originalMessage.model.modelID }
      : fallback?.model?.providerID && fallback?.model?.modelID
        ? { providerID: fallback.model.providerID, modelID: fallback.model.modelID }
        : undefined;

  const messageMeta = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: now },
    agent: resolvedAgent,
    model: resolvedModel,
    path: originalMessage.path?.cwd
      ? { cwd: originalMessage.path.cwd, root: originalMessage.path.root ?? "/" }
      : undefined,
  };

  const textPart = {
    id: partID,
    type: "text",
    text: hookContent,
    synthetic: true,
    time: { start: now, end: now },
    messageID,
    sessionID,
  };

  try {
    writeFileSync(join(messageDir, `${messageID}.json`), JSON.stringify(messageMeta, null, 2));

    const partDir = join(PART_STORAGE(), messageID);
    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true });
    }
    writeFileSync(join(partDir, `${partID}.json`), JSON.stringify(textPart, null, 2));

    log("[compaction] hook message injected", { sessionID, messageID });
    return true;
  } catch (err) {
    log("[compaction] failed to inject hook message", { error: String(err) });
    return false;
  }
}
