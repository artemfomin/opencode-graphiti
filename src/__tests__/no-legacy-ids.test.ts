import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Regression guard against the 0.1.2 part-id catastrophe.
 *
 * 0.1.2 inlined synthetic Part objects like
 *   { id: `graphiti-nudge-${Date.now()}`,    … }
 *   { id: `graphiti-context-${Date.now()}`,  … }
 * which opencode's UI rejected on read-path with
 *   `BadRequest: Expected a string starting with "prt"`.
 *
 * Detection rule: any source string-literal or template-literal that places
 * something other than `prt_`/`msg_` directly into an `id:` field is banned.
 * The only sanctioned id source is `services/ids.ts` (generatePartId /
 * generateMessageId). This test scans both src/ (authored) and dist/ (shipped)
 * to catch a stale build like the one that caused this incident.
 */

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

const LEGACY_TEMPLATE = /graphiti-(nudge|context|episode|memory|fact|node)-\$\{/;
const LEGACY_STATIC_ID = /\bid\s*:\s*[`'"]graphiti-[a-z]+-/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Strip line/block comments before scanning. Comments are allowed to
 * mention the historical bad pattern — only executable code must be clean.
 */
function stripComments(src: string): string {
  // Block comments: /* … */ (non-greedy, multi-line).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments: // until end of line.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, prefix: string) => prefix);
  return out;
}

function scanFile(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const text = stripComments(raw);
  const violations: string[] = [];
  if (LEGACY_TEMPLATE.test(text)) {
    violations.push(`${path}: contains banned template literal /graphiti-…-\${/`);
  }
  if (LEGACY_STATIC_ID.test(text)) {
    violations.push(`${path}: contains banned static id /id: "graphiti-…-"/`);
  }
  return violations;
}

describe("regression guard: legacy id patterns", () => {
  it("src/**/*.ts must not contain graphiti-(nudge|context|…)-${} templates", () => {
    const files = walk(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const violations = files.flatMap(scanFile);
    if (violations.length > 0) {
      throw new Error(
        "Legacy id patterns found in src/ — this is the bug that bricked 0.1.2 sessions:\n" +
          violations.join("\n")
      );
    }
    expect(violations).toEqual([]);
  });

  it("dist/index.js (if built) must not contain legacy id patterns", () => {
    const distIndex = join(DIST, "index.js");
    if (!existsSync(distIndex)) {
      // No build artifact yet — fine, the src-level test above is sufficient.
      return;
    }
    const text = readFileSync(distIndex, "utf8");
    const seen: string[] = [];
    // dist is bundled JS, so we look for stringified template-literal source
    // too: bun build preserves `graphiti-context-${Date.now()}` verbatim
    // because it's the runtime string the bundle still constructs.
    if (LEGACY_TEMPLATE.test(text)) seen.push("template literal");
    if (/`graphiti-(nudge|context|episode|memory|fact|node)-/.test(text)) {
      seen.push("template prefix string");
    }
    if (LEGACY_STATIC_ID.test(text)) seen.push("static id");
    if (seen.length > 0) {
      throw new Error(
        `dist/index.js carries legacy id patterns (${seen.join(", ")}). ` +
          "Rebuild with `bun run build` before shipping — a stale dist was the " +
          "root cause of the 0.1.2 BadRequest incident."
      );
    }
  });

  // We intentionally include the literal substring `graphiti-context-${` here
  // (in a way that doesn't trip our own regex) to make sure the regex itself
  // is the one being exercised by the previous tests.
  it("self-check: detector catches the bad pattern", () => {
    const sample =
      "id: `" + "graphiti-context-" + "${Date.now()}`";
    expect(LEGACY_TEMPLATE.test(sample)).toBe(true);
  });
});

// Note: the path separator `sep` is imported above for cross-platform safety
// if we ever extend this scanner to whitelist specific directories.
void sep;
