import os from 'os';
import path from 'path';

export function getHomedir(): string {
  return process.env.GRAPHITI_TEST_HOME ?? os.homedir();
}

export function getConfigHome(): string {
  return path.join(getHomedir(), '.config', 'opencode');
}

export function getDataHome(): string {
  return path.join(getHomedir(), '.opencode');
}

export function getLogPath(): string {
  return path.join(getHomedir(), '.opencode-graphiti-memory.log');
}
