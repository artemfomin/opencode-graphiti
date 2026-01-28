import { appendFileSync, writeFileSync } from "fs";
import { getLogPath } from "./paths";

let _initialized = false;
let _logPath: string | null = null;

function ensureInitialized(): string {
  if (!_initialized) {
    _logPath = getLogPath();
    writeFileSync(_logPath, `\n--- Session started: ${new Date().toISOString()} ---\n`, { flag: "a" });
    _initialized = true;
  }
  return _logPath!;
}

export function log(message: string, data?: unknown) {
  const logPath = ensureInitialized();
  const timestamp = new Date().toISOString();
  const line = data 
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`;
  appendFileSync(logPath, line);
}

export function resetLogger(): void {
  _initialized = false;
  _logPath = null;
}
