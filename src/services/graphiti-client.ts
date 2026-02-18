import type { Episode, Node, Fact } from "../types/graphiti.js";

const DEFAULT_TIMEOUT_MS = 30000;

export type GraphitiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; isUnreachable: boolean };

export interface GraphitiClientOptions {
  timeoutMs?: number;
}

export interface AddMemoryParams {
  name: string;
  episodeBody: string;
  groupId?: string;
  source?: string;
  sourceDescription?: string;
  uuid?: string;
}

export interface SearchNodesParams {
  groupIds?: string[];
  maxNodes?: number;
  entityTypes?: string[];
}

export interface SearchFactsParams {
  groupIds?: string[];
  maxFacts?: number;
  centerNodeUuid?: string;
}

export interface GetEpisodesParams {
  groupIds?: string[];
  maxEpisodes?: number;
}

export interface ClearGraphParams {
  groupIds?: string[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    protocolVersion?: string;
    capabilities?: unknown;
    serverInfo?: unknown;
  };
  error?: {
    code: number;
    message: string;
  };
}

export class GraphitiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(baseUrl: string, options?: GraphitiClientOptions) {
    this.baseUrl = baseUrl;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), this.timeoutMs);
    });

    return Promise.race([fetch(url, options), timeoutPromise]);
  }

  private parseSSEResponse(sseText: string): JsonRpcResponse {
    const lines = sseText.split("\n");
    const dataLine = lines.find((line) => line.startsWith("data: "));

    if (!dataLine) {
      throw new Error("Invalid SSE format: no data line");
    }

    const jsonText = dataLine.substring(6);
    return JSON.parse(jsonText) as JsonRpcResponse;
  }

  private async sendRequest(
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      ...(params && { params }),
    };

    const response = await this.fetchWithTimeout(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const responseText = await response.text();
    const jsonRpcResponse = this.parseSSEResponse(responseText);

    if (method === "initialize" && !this.sessionId) {
      const newSessionId = response.headers.get("mcp-session-id");
      if (newSessionId) {
        this.sessionId = newSessionId;
      }
    }

    return jsonRpcResponse;
  }

  private async ensureSession(): Promise<GraphitiResult<void>> {
    if (this.sessionId) {
      return { success: true, data: undefined };
    }

    try {
      const response = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "opencode-graphiti-memory", version: "1.0.0" },
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
          isUnreachable: true,
        };
      }

      return { success: true, data: undefined };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, isUnreachable: true };
    }
  }

  private async callTool<T>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<GraphitiResult<T>> {
    try {
      const sessionResult = await this.ensureSession();
      if (!sessionResult.success) {
        return sessionResult as GraphitiResult<T>;
      }

      const response = await this.sendRequest("tools/call", {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
          isUnreachable: true,
        };
      }

      const result = response.result;
      if (!result) {
        return {
          success: false,
          error: "No result in response",
          isUnreachable: true,
        };
      }

      if (result.isError) {
        const errorContent = result.structuredContent?.error as string | undefined;
        const textContent = result.content?.[0]?.text;
        let errorMessage = "Tool execution failed";

        if (errorContent) {
          errorMessage = errorContent;
        } else if (textContent) {
          try {
            const parsed = JSON.parse(textContent);
            errorMessage = parsed.error || textContent;
          } catch {
            errorMessage = textContent;
          }
        }

        return {
          success: false,
          error: errorMessage,
          isUnreachable: false,
        };
      }

      // Server wraps response in { result: ... }, unwrap it
      const structuredContent = result.structuredContent as { result?: T } | T;
      const data = (structuredContent && typeof structuredContent === 'object' && 'result' in structuredContent)
        ? (structuredContent as { result: T }).result
        : structuredContent as T;
      return { success: true, data };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, isUnreachable: true };
    }
  }

  async getStatus(): Promise<GraphitiResult<{ status: string; message?: string }>> {
    return this.callTool("get_status", {});
  }

  async addMemory(
    params: AddMemoryParams
  ): Promise<GraphitiResult<{ message: string }>> {
    const args: Record<string, unknown> = {
      name: params.name,
      episode_body: params.episodeBody,
    };

    if (params.groupId) args.group_id = params.groupId;
    if (params.source) args.source = params.source;
    if (params.sourceDescription) args.source_description = params.sourceDescription;
    if (params.uuid) args.uuid = params.uuid;

    return this.callTool("add_memory", args);
  }

  async searchNodes(
    query: string,
    params?: SearchNodesParams
  ): Promise<GraphitiResult<{ nodes: Node[] }>> {
    const args: Record<string, unknown> = { query };

    if (params?.groupIds) args.group_ids = params.groupIds;
    if (params?.maxNodes) args.max_nodes = params.maxNodes;
    if (params?.entityTypes) args.entity_types = params.entityTypes;

    return this.callTool("search_nodes", args);
  }

  async searchFacts(
    query: string,
    params?: SearchFactsParams
  ): Promise<GraphitiResult<{ facts: Fact[] }>> {
    const args: Record<string, unknown> = { query };

    if (params?.groupIds) args.group_ids = params.groupIds;
    if (params?.maxFacts) args.max_facts = params.maxFacts;
    if (params?.centerNodeUuid) args.center_node_uuid = params.centerNodeUuid;

    return this.callTool("search_memory_facts", args);
  }

  async getEpisodes(
    params?: GetEpisodesParams
  ): Promise<GraphitiResult<{ episodes: Episode[] }>> {
    const args: Record<string, unknown> = {};

    if (params?.groupIds) args.group_ids = params.groupIds;
    if (params?.maxEpisodes) args.max_episodes = params.maxEpisodes;

    return this.callTool("get_episodes", args);
  }

  async deleteEpisode(uuid: string): Promise<GraphitiResult<{ message: string }>> {
    return this.callTool("delete_episode", { uuid });
  }

  async clearGraph(
    params?: ClearGraphParams
  ): Promise<GraphitiResult<{ message: string }>> {
    const args: Record<string, unknown> = {};

    if (params?.groupIds) args.group_ids = params.groupIds;

    return this.callTool("clear_graph", args);
  }
}
