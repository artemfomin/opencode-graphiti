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
 */

export function generateMessageId(): string {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 14);
  return `msg_${timestamp}${random}`;
}

export function generatePartId(): string {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 10);
  return `prt_${timestamp}${random}`;
}
