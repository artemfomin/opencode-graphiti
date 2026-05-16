import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getLogPath } from "./paths";

let _initialized = false;
let _logPath: string | null = null;

function ensureInitialized(): string | null {
  if (!_initialized) {
    const logPath = getLogPath();

    try {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, `\n--- Session started: ${new Date().toISOString()} ---\n`, { flag: "a" });
      _logPath = logPath;
    } catch {
      _logPath = null;
    }

    _initialized = true;
  }

  return _logPath;
}

function stringifyData(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return "[unserializable]";
  }
}

function debugDrop(message: string): void {
  if (process.env.DEBUG) {
    console.error(`[opencode-graphiti logger disabled] ${message}`);
  }
}

export function log(message: string, data?: unknown) {
  const logPath = ensureInitialized();
  if (logPath === null) {
    debugDrop(message);
    return;
  }

  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] ${message}: ${stringifyData(data)}\n`
    : `[${timestamp}] ${message}\n`;

  try {
    appendFileSync(logPath, line);
  } catch {
    _logPath = null;
    debugDrop(message);
  }
}

export function resetLogger(): void {
  _initialized = false;
  _logPath = null;
}

export function __isLoggerReadyForTesting(): boolean {
  return _initialized && _logPath !== null;
}
