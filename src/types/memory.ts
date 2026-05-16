import { z } from "zod";

export const DETERMINISTIC_MEMORY_CLASSES = [
  "UserInstruction",
  "Restriction",
  "StylePreference",
  "Problem",
  "FixAttempt",
  "Achievement",
  "FileEdit",
  "CommandRun",
] as const;

export const SHADOW_MEMORY_CLASSES = [
  "ArchitecturalDecision",
  "Decision",
  "BusinessEntity",
  "BusinessProcess",
  "UseCase",
  "InfrastructureComponent",
  "DataModel",
  "Strategy",
  "Reflection",
] as const;

export const ALL_MEMORY_CLASSES = [
  ...DETERMINISTIC_MEMORY_CLASSES,
  ...SHADOW_MEMORY_CLASSES,
] as const;

export type DeterministicMemoryClass =
  (typeof DETERMINISTIC_MEMORY_CLASSES)[number];
export type ShadowMemoryClass = (typeof SHADOW_MEMORY_CLASSES)[number];
export type MemoryClass = (typeof ALL_MEMORY_CLASSES)[number];
export const MemoryClassSchema = z.enum(ALL_MEMORY_CLASSES);

export const MEMORY_SOURCES = [
  "deterministic",
  "shadow",
  "marker",
  "compaction",
  "migration",
] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export const MemorySourceSchema = z.enum(MEMORY_SOURCES);

export const RATIFICATION_STATUSES = [
  "unverified",
  "ratified",
  "rejected",
] as const;
export type RatificationStatus = (typeof RATIFICATION_STATUSES)[number];
export const RatificationStatusSchema = z.enum(RATIFICATION_STATUSES);
