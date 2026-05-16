import { describe, expect, test } from "bun:test";
import {
  ALL_MEMORY_CLASSES,
  DETERMINISTIC_MEMORY_CLASSES,
  MemoryClassSchema,
  MemorySourceSchema,
  SHADOW_MEMORY_CLASSES,
} from "./memory.js";

describe("memory taxonomy", () => {
  test("defines deterministic memory classes", () => {
    expect(DETERMINISTIC_MEMORY_CLASSES).toHaveLength(8);
    expect(DETERMINISTIC_MEMORY_CLASSES).toEqual([
      "UserInstruction",
      "Restriction",
      "StylePreference",
      "Problem",
      "FixAttempt",
      "Achievement",
      "FileEdit",
      "CommandRun",
    ]);
  });

  test("defines shadow memory classes", () => {
    expect(SHADOW_MEMORY_CLASSES).toHaveLength(9);
    expect(SHADOW_MEMORY_CLASSES).toEqual([
      "ArchitecturalDecision",
      "Decision",
      "BusinessEntity",
      "BusinessProcess",
      "UseCase",
      "InfrastructureComponent",
      "DataModel",
      "Strategy",
      "Reflection",
    ]);
  });

  test("combines memory classes without duplicates", () => {
    expect(new Set(ALL_MEMORY_CLASSES).size).toBe(ALL_MEMORY_CLASSES.length);
  });

  test("validates memory class values", () => {
    expect(MemoryClassSchema.parse("UserInstruction")).toBe("UserInstruction");
    expect(MemoryClassSchema.safeParse("Random").success).toBe(false);
  });

  test("validates memory source values", () => {
    expect(MemorySourceSchema.parse("deterministic")).toBe("deterministic");
    expect(MemorySourceSchema.safeParse("agent").success).toBe(false);
  });
});
