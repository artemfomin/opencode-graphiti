import { log } from "./logger.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";

export type SanitizerSource =
  | "deterministic"
  | "shadow"
  | "marker"
  | "compaction"
  | "migration";

export interface SanitizerInput {
  name?: string;
  body: string;
  source: SanitizerSource;
  metadata?: Record<string, unknown>;
}

export interface SanitizedPayload {
  readonly __sanitized: true;
  name?: string;
  body: string;
  source: SanitizerSource;
  metadata: Record<string, unknown>;
  redactions: { count: number; categories: string[] };
}

type RedactionCategory =
  | "api_key"
  | "token"
  | "password"
  | "email"
  | "env_secret"
  | "credential"
  | "fully-private";

interface RedactionRule {
  pattern: RegExp;
  category: RedactionCategory;
  replacement: string | ((match: string, ...captures: string[]) => string);
}

const SANITIZED_BRAND = Symbol("graphiti.sanitized");

const REDACTION_RULES: RedactionRule[] = [
  {
    pattern:
      /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)\s*=\s*([^\s]+)/gi,
    category: "env_secret",
    replacement: (match: string, value: string) =>
      match.replace(value, "[REDACTED:env_secret]"),
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    category: "api_key",
    replacement: "[REDACTED:api_key]",
  },
  {
    pattern: /\bgh[opusr]_[A-Za-z0-9]{36,}\b/g,
    category: "api_key",
    replacement: "[REDACTED:api_key]",
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    category: "credential",
    replacement: "[REDACTED:credential]",
  },
  {
    pattern: /\b(Authorization:\s*Bearer\s+)([^\s)]+)/gi,
    category: "token",
    replacement: (_match: string, prefix: string) => `${prefix}[REDACTED:token]`,
  },
  {
    pattern: /\b(token|api_key|apikey)=([^\s&]+)/gi,
    category: "token",
    replacement: (_match: string, key: string) => `${key}=[REDACTED:token]`,
  },
  {
    pattern: /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:/@\s]+:)([^@\s]+)(@)/g,
    category: "password",
    replacement: (_match: string, prefix: string, _password: string, suffix: string) =>
      `${prefix}[REDACTED:password]${suffix}`,
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    category: "email",
    replacement: "[REDACTED:email]",
  },
];

export function sanitizeForGraphiti(input: SanitizerInput): SanitizedPayload {
  try {
    return createSanitizedPayload(input);
  } catch (error) {
    log("[sanitizer] failed closed", { error: String(error), source: input.source });
    return brandPayload({
      name: input.name,
      body: "[REDACTED:fully-private]",
      source: input.source,
      metadata: input.metadata ?? {},
      redactions: { count: 1, categories: ["fully-private"] },
    });
  }
}

export function assertSanitized(payload: unknown): asserts payload is SanitizedPayload {
  if (!isSanitizedPayload(payload)) {
    throw new Error("Graphiti write payload must be sanitized before use");
  }
}

function createSanitizedPayload(input: SanitizerInput): SanitizedPayload {
  const categories = new Set<RedactionCategory>();
  let count = 0;
  const strippedBody = stripPrivateContent(input.body);

  if (isFullyPrivate(strippedBody)) {
    categories.add("fully-private");
    return brandPayload({
      name: input.name,
      body: "[REDACTED:fully-private]",
      source: input.source,
      metadata: input.metadata ?? {},
      redactions: { count: 1, categories: Array.from(categories) },
    });
  }

  let body = strippedBody;
  for (const rule of REDACTION_RULES) {
    body = body.replace(rule.pattern, (...args: string[]) => {
      count += 1;
      categories.add(rule.category);
      if (typeof rule.replacement === "function") {
        return rule.replacement(args[0]!, ...args.slice(1, -2));
      }
      return rule.replacement;
    });
  }

  if (body.trim() === "") {
    count += 1;
    categories.add("fully-private");
    body = "[REDACTED:fully-private]";
  }

  return brandPayload({
    name: input.name,
    body,
    source: input.source,
    metadata: input.metadata ?? {},
    redactions: { count, categories: Array.from(categories) },
  });
}

function isSanitizedPayload(payload: unknown): payload is SanitizedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { __sanitized?: unknown }).__sanitized === true &&
    (payload as { [SANITIZED_BRAND]?: unknown })[SANITIZED_BRAND] === true
  );
}

function brandPayload(
  payload: Omit<SanitizedPayload, "__sanitized">
): SanitizedPayload {
  const branded = payload as SanitizedPayload & { [SANITIZED_BRAND]: true };
  Object.defineProperty(branded, "__sanitized", {
    value: true,
    enumerable: false,
  });
  Object.defineProperty(branded, SANITIZED_BRAND, {
    value: true,
    enumerable: false,
  });
  return branded;
}
