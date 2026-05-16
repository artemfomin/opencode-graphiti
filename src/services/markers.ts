import { ALL_MEMORY_CLASSES, type MemoryClass } from "../types/memory.js";

export interface ParsedMarker {
  memoryClass: MemoryClass;
  body: string;
  rawLine: string;
}

export interface MalformedMarker {
  reason: "missing-class" | "unknown-class" | "empty-body" | "malformed-prefix";
  rawLine: string;
}

export interface MarkerParseResult {
  markers: ParsedMarker[];
  malformed: MalformedMarker[];
}

export interface MarkerParserOptions {
  /** Marker prefix from config.markers.prefix; defaults to "@graphiti". */
  prefix?: string;
}

const DEFAULT_PREFIX = "@graphiti";
const FENCE_PREFIX = "```";
const INLINE_CODE_PATTERN = /`[^`]*`/g;

const MEMORY_CLASS_BY_LOWERCASE = new Map<string, MemoryClass>(
  ALL_MEMORY_CLASSES.map((memoryClass) => [memoryClass.toLowerCase(), memoryClass])
);

interface LogicalLine {
  rawLine: string;
  scanLine: string;
  nextIndex: number;
}

export function parseMarkers(
  text: string,
  options: MarkerParserOptions = {}
): MarkerParseResult {
  if (text === "") {
    return { markers: [], malformed: [] };
  }

  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const prefixPattern = new RegExp(`^\\s*${escapeRegExp(prefix)}(?<afterPrefix>[\\s\\S]*)$`, "i");
  const markers: ParsedMarker[] = [];
  const malformed: MalformedMarker[] = [];
  const lines = text.split(/\r?\n/);
  const codeFenceLines = getCodeFenceLines(lines);

  for (let lineIndex = 0; lineIndex < lines.length;) {
    if (codeFenceLines[lineIndex]) {
      lineIndex += 1;
      continue;
    }

    const logicalLine = collectLogicalLine(lines, codeFenceLines, lineIndex);
    lineIndex = logicalLine.nextIndex;

    const prefixMatch = logicalLine.scanLine.match(prefixPattern);
    if (!prefixMatch?.groups) {
      continue;
    }

    const rawPrefixMatch = logicalLine.rawLine.match(prefixPattern);
    const afterPrefix = rawPrefixMatch?.groups?.["afterPrefix"] ?? "";
    if (afterPrefix !== "" && !/^\s/.test(afterPrefix)) {
      malformed.push({ reason: "malformed-prefix", rawLine: logicalLine.rawLine });
      continue;
    }

    const parsed = parseMarkerPayload(afterPrefix, logicalLine.rawLine);
    if ("reason" in parsed) {
      malformed.push(parsed);
    } else {
      markers.push(parsed);
    }
  }

  return { markers, malformed };
}

function parseMarkerPayload(
  afterPrefix: string,
  rawLine: string
): ParsedMarker | MalformedMarker {
  const colonIndex = afterPrefix.indexOf(":");
  if (colonIndex === -1) {
    return { reason: "missing-class", rawLine };
  }

  const rawClass = afterPrefix.slice(0, colonIndex).trim();
  if (rawClass === "") {
    return { reason: "missing-class", rawLine };
  }

  const memoryClass = MEMORY_CLASS_BY_LOWERCASE.get(rawClass.toLowerCase());
  if (!memoryClass) {
    return { reason: "unknown-class", rawLine };
  }

  const body = normalizeContinuedBody(afterPrefix.slice(colonIndex + 1));
  if (body === "") {
    return { reason: "empty-body", rawLine };
  }

  return { memoryClass, body, rawLine };
}

function collectLogicalLine(
  lines: string[],
  codeFenceLines: boolean[],
  startIndex: number
): LogicalLine {
  const rawLines = [lines[startIndex] ?? ""];
  const scanLines = [removeInlineCode(lines[startIndex] ?? "")];
  let currentIndex = startIndex;

  while (lineContinues(rawLines[rawLines.length - 1] ?? "")) {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= lines.length || codeFenceLines[nextIndex]) {
      break;
    }

    rawLines.push(lines[nextIndex] ?? "");
    scanLines.push(removeInlineCode(lines[nextIndex] ?? ""));
    currentIndex = nextIndex;
  }

  return {
    rawLine: rawLines.join("\n"),
    scanLine: scanLines.join("\n"),
    nextIndex: currentIndex + 1,
  };
}

function normalizeContinuedBody(body: string): string {
  return body
    .split("\n")
    .map((line) => stripContinuation(line).trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripContinuation(line: string): string {
  return lineContinues(line) ? line.replace(/\\\s*$/, "") : line;
}

function lineContinues(line: string): boolean {
  return /\\\s*$/.test(line);
}

function getCodeFenceLines(lines: string[]): boolean[] {
  const codeFenceLines = new Array<boolean>(lines.length).fill(false);
  let inFence = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const isFenceBoundary = line.trimStart().startsWith(FENCE_PREFIX);

    if (isFenceBoundary) {
      codeFenceLines[lineIndex] = true;
      inFence = !inFence;
      continue;
    }

    codeFenceLines[lineIndex] = inFence;
  }

  return codeFenceLines;
}

function removeInlineCode(line: string): string {
  return line.replace(INLINE_CODE_PATTERN, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
