/**
 * Identifier generators for opencode entities.
 *
 * opencode's server-side schema validates incoming IDs with Zod prefix
 * constraints (e.g. `starts_with("prt")` for part IDs and `starts_with("msg")`
 * for message IDs). Any synthetic part or message we inject into opencode's
 * data flow MUST use these helpers so the IDs survive read-path validation.
 *
 * Format mirrors what opencode itself emits:
 *   - message: `msg_<hex(now)><base36-random[12]>`
 *   - part:    `prt_<hex(now)><base36-random[8]>`
 *
 * Regression history: 0.1.2 used `graphiti-nudge-${Date.now()}` and
 * `graphiti-context-${Date.now()}` which silently passed write-path but blew
 * up the UI on read-path with `BadRequest: Expected a string starting with
 * "prt"`. Branded types below make that regression a compile error.
 */

/** Branded type: a string proven to satisfy opencode part-id schema. */
export type PartId = string & { readonly __brand: "PartId" };

/** Branded type: a string proven to satisfy opencode message-id schema. */
export type MessageId = string & { readonly __brand: "MessageId" };

const PART_ID_PATTERN = /^prt_[0-9a-z]+$/;
const MESSAGE_ID_PATTERN = /^msg_[0-9a-z]+$/;

export function generateMessageId(): MessageId {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 14);
  return `msg_${timestamp}${random}` as MessageId;
}

export function generatePartId(): PartId {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 10);
  return `prt_${timestamp}${random}` as PartId;
}

/**
 * Runtime guard: throws if `id` does not match opencode's part-id contract.
 * Use on every synthetic part right before it is pushed into `output.parts`,
 * so an SDK-level regression can never make it to disk.
 */
export function assertValidPartId(id: string): asserts id is PartId {
  if (!PART_ID_PATTERN.test(id)) {
    throw new Error(
      `[opencode-graphiti] invalid PartId ${JSON.stringify(id)} — must match ${PART_ID_PATTERN}`
    );
  }
}

/** Runtime guard counterpart for message ids. */
export function assertValidMessageId(id: string): asserts id is MessageId {
  if (!MESSAGE_ID_PATTERN.test(id)) {
    throw new Error(
      `[opencode-graphiti] invalid MessageId ${JSON.stringify(id)} — must match ${MESSAGE_ID_PATTERN}`
    );
  }
}
