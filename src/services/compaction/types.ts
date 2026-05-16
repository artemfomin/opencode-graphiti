export const DEFAULT_THRESHOLD = 0.80;
export const MIN_TOKENS_FOR_COMPACTION = 50_000;
export const COMPACTION_COOLDOWN_MS = 30_000;
export const DEFAULT_CONTEXT_LIMIT = 200_000;
export const PENDING_DIR = "graphiti-pending";

export interface CompactionState {
  lastCompactionTime: Map<string, number>;
  compactionInProgress: Set<string>;
  summarizedSessions: Set<string>;
}

export interface TokenInfo {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

export interface MessageInfo {
  id: string;
  role: string;
  sessionID: string;
  providerID?: string;
  modelID?: string;
  tokens?: TokenInfo;
  summary?: boolean;
  finish?: boolean;
}

export interface StoredMessage {
  agent?: string;
  model?: { providerID?: string; modelID?: string };
}

export interface SummarizeContext {
  sessionID: string;
  providerID: string;
  modelID: string;
  usageRatio: number;
  directory: string;
  agent?: string;
}

export interface CompactionOptions {
  threshold?: number;
  getModelLimit?: (providerID: string, modelID: string) => number | undefined;
}

export interface PendingPayload {
  version: number;
  timestamp: string;
  projectNamespace: string;
  summary: string;
  type: string;
  retryCount: number;
}

export interface CompactionContext {
  directory: string;
  client: {
    session: {
      summarize: (params: { path: { id: string }; body: { providerID: string; modelID: string }; query: { directory: string } }) => Promise<unknown>;
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: MessageInfo }> }>;
      promptAsync: (params: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> }; query: { directory: string } }) => Promise<unknown>;
    };
    tui: {
      showToast: (params: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>;
    };
  };
}
