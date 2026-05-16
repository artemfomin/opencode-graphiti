import { describe, expect, it } from "bun:test";
import { parseMarkers } from "./markers.js";

describe("parseMarkers", () => {
  it("parses a single well-formed Restriction marker", () => {
    const result = parseMarkers("@graphiti Restriction: never run rm -rf in production");

    expect(result.malformed).toEqual([]);
    expect(result.markers).toEqual([
      {
        memoryClass: "Restriction",
        body: "never run rm -rf in production",
        rawLine: "@graphiti Restriction: never run rm -rf in production",
      },
    ]);
  });

  it("returns multiple markers in their original order", () => {
    const result = parseMarkers([
      "normal text",
      "@graphiti Restriction: never run rm -rf",
      "more text",
      "@graphiti UserInstruction: always run `bun test` after each edit",
      "@graphiti ArchitecturalDecision: use SQLite for local cache, not Redis",
    ].join("\n"));

    expect(result.malformed).toEqual([]);
    expect(result.markers.map((marker) => marker.memoryClass)).toEqual([
      "Restriction",
      "UserInstruction",
      "ArchitecturalDecision",
    ]);
    expect(result.markers.map((marker) => marker.body)).toEqual([
      "never run rm -rf",
      "always run `bun test` after each edit",
      "use SQLite for local cache, not Redis",
    ]);
  });

  it("canonicalizes class names case-insensitively", () => {
    const result = parseMarkers("@graphiti restriction: never rm -rf");

    expect(result.markers[0]?.memoryClass).toBe("Restriction");
    expect(result.markers[0]?.body).toBe("never rm -rf");
  });

  it("supports a custom prefix and keeps the default prefix separate", () => {
    expect(parseMarkers("@graf Restriction: body", { prefix: "@graf" }).markers).toEqual([
      {
        memoryClass: "Restriction",
        body: "body",
        rawLine: "@graf Restriction: body",
      },
    ]);
    expect(parseMarkers("@graf Restriction: body").markers).toEqual([]);
  });

  it("reports a marker with missing colon as missing-class", () => {
    const result = parseMarkers("@graphiti Restriction never run rm -rf");

    expect(result.markers).toEqual([]);
    expect(result.malformed).toEqual([
      {
        reason: "missing-class",
        rawLine: "@graphiti Restriction never run rm -rf",
      },
    ]);
  });

  it("reports an empty body", () => {
    const result = parseMarkers("@graphiti Restriction: ");

    expect(result.markers).toEqual([]);
    expect(result.malformed).toEqual([
      {
        reason: "empty-body",
        rawLine: "@graphiti Restriction: ",
      },
    ]);
  });

  it("reports an unknown class", () => {
    const result = parseMarkers("@graphiti Pizza: foo");

    expect(result.markers).toEqual([]);
    expect(result.malformed).toEqual([
      {
        reason: "unknown-class",
        rawLine: "@graphiti Pizza: foo",
      },
    ]);
  });

  it("ignores markers inside fenced code blocks", () => {
    const result = parseMarkers("```\n@graphiti Restriction: shouldNotCount\n```");

    expect(result).toEqual({ markers: [], malformed: [] });
  });

  it("ignores markers inside inline code", () => {
    const result = parseMarkers("Use `@graphiti Restriction: shouldNotCount` here");

    expect(result).toEqual({ markers: [], malformed: [] });
  });

  it("tolerates leading whitespace before the prefix", () => {
    const result = parseMarkers("  @graphiti Restriction: body");

    expect(result.markers).toEqual([
      {
        memoryClass: "Restriction",
        body: "body",
        rawLine: "  @graphiti Restriction: body",
      },
    ]);
  });

  it("retains raw redactable body text for later sanitizer integration", () => {
    const secret = "sk-LEAK-aaaaaaaaaaaaaaaaaaaa";
    const result = parseMarkers(`@graphiti Restriction: never log ${secret} here`);

    expect(result.markers[0]?.body).toBe(`never log ${secret} here`);
  });

  it("joins multi-line bodies with line continuation", () => {
    const text = [
      "@graphiti ArchitecturalDecision: use sqlite \\",
      " for local cache",
    ].join("\n");
    const result = parseMarkers(text);

    expect(result.markers).toEqual([
      {
        memoryClass: "ArchitecturalDecision",
        body: "use sqlite for local cache",
        rawLine: text,
      },
    ]);
  });

  it("preserves marker order when malformed entries are interleaved", () => {
    const result = parseMarkers([
      "@graphiti Restriction: never run X",
      "@graphiti Pizza: bad",
      "@graphiti UserInstruction: x",
    ].join("\n"));

    expect(result.markers.map((marker) => marker.memoryClass)).toEqual([
      "Restriction",
      "UserInstruction",
    ]);
    expect(result.malformed).toEqual([
      {
        reason: "unknown-class",
        rawLine: "@graphiti Pizza: bad",
      },
    ]);
  });

  it("returns empty arrays for empty input", () => {
    expect(parseMarkers("")).toEqual({ markers: [], malformed: [] });
  });

  it("keeps explicit marker output separate from conflicting normal text", () => {
    const result = parseMarkers([
      "@graphiti Restriction: never run X",
      "let's use X",
    ].join("\n"));

    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.body).toBe("never run X");
  });
});
