import { describe, expect, it } from "bun:test";
import { assertSanitized, sanitizeForGraphiti } from "./sanitizer.js";

describe("sanitizeForGraphiti", () => {
  it("redacts OpenAI-style API keys", () => {
    const payload = sanitizeForGraphiti({
      body: "please don't leak sk-abcdef0123456789ABCDEFGHIJ",
      source: "deterministic",
    });

    expect(payload.body).toContain("[REDACTED:api_key]");
    expect(payload.body).not.toContain("sk-abcdef0123456789ABCDEFGHIJ");
    expect(payload.redactions.count).toBeGreaterThanOrEqual(1);
    expect(payload.redactions.categories).toContain("api_key");
  });

  it("redacts GitHub personal access tokens", () => {
    const token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const payload = sanitizeForGraphiti({
      body: `token ${token}`,
      source: "deterministic",
    });

    expect(payload.body).toContain("[REDACTED:api_key]");
    expect(payload.body).not.toContain(token);
    expect(payload.redactions.categories).toContain("api_key");
  });

  it("redacts AWS access keys", () => {
    const payload = sanitizeForGraphiti({
      body: "aws AKIAIOSFODNN7EXAMPLE",
      source: "deterministic",
    });

    expect(payload.body).toContain("[REDACTED:credential]");
    expect(payload.body).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(payload.redactions.categories).toContain("credential");
  });

  it("redacts bearer tokens inside stack traces while keeping frame text", () => {
    const payload = sanitizeForGraphiti({
      body: "Error: failed\n    at someFn (Authorization: Bearer abc.def.ghi)",
      source: "shadow",
    });

    expect(payload.body).toContain("at someFn");
    expect(payload.body).toContain("Authorization: Bearer [REDACTED:token]");
    expect(payload.body).not.toContain("abc.def.ghi");
    expect(payload.redactions.categories).toContain("token");
  });

  it("redacts passwords in database URLs while preserving host and path", () => {
    const payload = sanitizeForGraphiti({
      body: "DATABASE_URL=postgres://user:pw@host/db",
      source: "marker",
    });

    expect(payload.body).toContain("postgres://user:[REDACTED:password]@host/db");
    expect(payload.body).not.toContain("user:pw@host");
    expect(payload.redactions.categories).toContain("password");
  });

  it("redacts email addresses", () => {
    const payload = sanitizeForGraphiti({
      body: "contact alice@example.com",
      source: "deterministic",
    });

    expect(payload.body).toBe("contact [REDACTED:email]");
    expect(payload.redactions.categories).toContain("email");
  });

  it("redacts env-style credential values", () => {
    const payload = sanitizeForGraphiti({
      body: "OPENAI_API_KEY=sk-real-secret-here",
      source: "migration",
    });

    expect(payload.body).toContain("OPENAI_API_KEY=[REDACTED:env_secret]");
    expect(payload.body).not.toContain("sk-real-secret-here");
    expect(payload.redactions.categories).toContain("env_secret");
  });

  it("strips private sentinel content", () => {
    const payload = sanitizeForGraphiti({
      body: "hello <private>secret notes</private> world",
      source: "deterministic",
    });

    expect(payload.body).not.toContain("secret notes");
    expect(payload.body).toBe("hello [REDACTED] world");
  });

  it("marks fully private inputs", () => {
    const payload = sanitizeForGraphiti({
      body: "<private>secret notes</private>",
      source: "deterministic",
    });

    expect(payload.body).toBe("[REDACTED:fully-private]");
    expect(payload.redactions.categories).toContain("fully-private");
  });

  it("leaves ordinary text unchanged", () => {
    const payload = sanitizeForGraphiti({
      body: "refactor authentication module",
      source: "deterministic",
    });

    expect(payload.body).toBe("refactor authentication module");
    expect(payload.redactions.count).toBe(0);
    expect(payload.redactions.categories).toEqual([]);
  });

  it("brands sanitized payloads for runtime boundary checks", () => {
    const payload = sanitizeForGraphiti({
      body: "safe memory",
      source: "deterministic",
    });

    expect(() => assertSanitized(payload)).not.toThrow();
    expect(() =>
      assertSanitized({
        body: "safe memory",
        source: "deterministic",
        metadata: {},
        redactions: { count: 0, categories: [] },
      })
    ).toThrow();
  });

  it("counts multiple redaction categories", () => {
    const payload = sanitizeForGraphiti({
      body: "email bob@example.com key sk-abcdef0123456789ABCDEFGHIJ",
      source: "deterministic",
    });

    expect(payload.redactions.count).toBeGreaterThanOrEqual(2);
    expect(payload.redactions.categories).toContain("email");
    expect(payload.redactions.categories).toContain("api_key");
  });
});
