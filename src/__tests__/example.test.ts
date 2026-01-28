import { describe, it, expect, beforeEach } from "bun:test";
import { resetLogger } from "../services/logger";

describe("Example Test Suite", () => {
  beforeEach(() => {
    // Reset logger state before each test to prevent side effects
    resetLogger();
  });

  it("should pass a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("should handle string operations", () => {
    const message = "Hello, World!";
    expect(message).toContain("World");
  });

  it("should work with objects", () => {
    const obj = { name: "test", value: 42 };
    expect(obj.value).toBe(42);
  });
});
