import { describe, it, expect } from "bun:test";
import { generateMessageId, generatePartId } from "./ids.js";

describe("ids", () => {
  describe("generatePartId", () => {
    it("starts with the 'prt_' prefix required by opencode schema", () => {
      const id = generatePartId();
      expect(id.startsWith("prt_")).toBe(true);
      // opencode validates with z.string().startsWith("prt"); the underscore is
      // ours but the prefix check passes either way. Both characteristics
      // matter for read-path API compatibility.
      expect(id).toMatch(/^prt_[0-9a-z]+$/);
    });

    it("produces a different id on each call", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generatePartId());
      }
      // 100 calls in a tight loop may share a Date.now() millisecond, but
      // the random suffix should differentiate them.
      expect(ids.size).toBe(100);
    });

    it("has a stable structural shape", () => {
      const id = generatePartId();
      // prt_ + hex-timestamp (>=11 chars for Date.now() in 2024+) + 8-char base36
      expect(id.length).toBeGreaterThanOrEqual("prt_".length + 11 + 8);
    });
  });

  describe("generateMessageId", () => {
    it("starts with the 'msg_' prefix required by opencode schema", () => {
      const id = generateMessageId();
      expect(id.startsWith("msg_")).toBe(true);
      expect(id).toMatch(/^msg_[0-9a-z]+$/);
    });

    it("produces a different id on each call", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }
      expect(ids.size).toBe(100);
    });
  });
});
