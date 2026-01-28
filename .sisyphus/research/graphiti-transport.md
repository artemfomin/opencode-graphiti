# Graphiti MCP Transport Research

**Research Date:** 2026-01-28  
**Test Endpoint:** `mcp.mem.artdevcraft.com`  
**Server Version:** 1.21.0  
**Protocol Version:** 2024-11-05

## Executive Summary

Graphiti MCP uses **HTTP Streamable transport with Server-Sent Events (SSE)** for responses. The protocol follows JSON-RPC 2.0 with stateful sessions managed via `mcp-session-id` headers. All responses are wrapped in SSE `event: message` envelopes.

---

## 1. HTTP Envelope Format

### Base URL
```
http://mcp.mem.artdevcraft.com/mcp/
```

**Note:** The endpoint enforces HTTPS redirect (308 Permanent Redirect). Use `-L` flag with curl to follow redirects.

### Required Headers

#### For All Requests
```http
Content-Type: application/json
Accept: application/json, text/event-stream
```

**Critical:** The `Accept` header MUST include both MIME types. Omitting `text/event-stream` results in:
```json
{
  "jsonrpc": "2.0",
  "id": "server-error",
  "error": {
    "code": -32600,
    "message": "Not Acceptable: Client must accept both application/json and text/event-stream"
  }
}
```

#### For Session-Aware Requests (after initialization)
```http
mcp-session-id: <session-id-from-initialize-response>
```

**Critical:** Requests to `tools/list`, `tools/call`, etc. MUST include the session ID. Missing session ID results in:
```json
{
  "jsonrpc": "2.0",
  "id": "server-error",
  "error": {
    "code": -32600,
    "message": "Bad Request: Missing session ID"
  }
}
```

### Request Format (JSON-RPC 2.0)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "<method-name>",
  "params": {
    // method-specific parameters
  }
}
```

### Response Format (SSE-wrapped JSON-RPC)

All responses are wrapped in Server-Sent Events format:

```
event: message
data: {"jsonrpc":"2.0","id":1,"result":{...}}
```

**Parsing Steps:**
1. Strip `event: message\n` prefix
2. Strip `data: ` prefix
3. Parse remaining JSON as JSON-RPC 2.0 response

---

## 2. MCP Initialization Sequence

### Step 1: Initialize Request

**Method:** `initialize`

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "test-client",
      "version": "1.0.0"
    }
  }
}
```

**Response Headers:**
```http
mcp-session-id: 047eb56945e0462b84daa562dd6d8f78
```

**Response Body (SSE-wrapped):**
```
event: message
data: {
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "experimental": {},
      "prompts": {"listChanged": false},
      "resources": {"subscribe": false, "listChanged": false},
      "tools": {"listChanged": false}
    },
    "serverInfo": {
      "name": "Graphiti Agent Memory",
      "version": "1.21.0"
    },
    "instructions": "Graphiti is a memory service for AI agents..."
  }
}
```

### Step 2: Extract Session ID

The server returns a **stateful session ID** in the response header:
```
mcp-session-id: 047eb56945e0462b84daa562dd6d8f78
```

**Critical:** Store this session ID and include it in ALL subsequent requests.

### Step 3: Session Management

- **Session Persistence:** Sessions are stateful and persist across requests
- **Session Scope:** Each session maintains its own context
- **Session Expiry:** Not documented; assume sessions expire after inactivity
- **No Explicit Close:** No `initialized` notification or explicit session close method observed

---

## 3. Response Parsing

### Success Response Structure

```
event: message
data: {
  "jsonrpc": "2.0",
  "id": <request-id>,
  "result": {
    // method-specific result
  }
}
```

### Error Response Structure

```
event: message
data: {
  "jsonrpc": "2.0",
  "id": "server-error",
  "error": {
    "code": -32600,
    "message": "Error description"
  }
}
```

### Tool Call Response Structure

Tool calls return structured content with both text and structured representations:

```
event: message
data: {
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\": \"ok\", \"message\": \"...\"}"
      }
    ],
    "structuredContent": {
      "status": "ok",
      "message": "Graphiti MCP server is running and connected to falkordb database"
    },
    "isError": false
  }
}
```

**Parsing Strategy:**
1. Use `structuredContent` for programmatic access (already parsed)
2. Use `content[0].text` for display/logging (JSON string)
3. Check `isError` flag for error handling

### Common Error Codes

| Code | Meaning | Cause |
|------|---------|-------|
| `-32600` | Invalid Request | Missing headers, missing session ID, or malformed request |
| `-32601` | Method Not Found | Invalid method name |
| `-32602` | Invalid Params | Missing or invalid parameters |

---

## 4. Verified Tool Names

**Source:** Live endpoint `tools/list` response (2026-01-28)

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| `add_memory` | Add episode to knowledge graph | `name`, `episode_body`, `group_id?`, `source?`, `source_description?`, `uuid?` |
| `search_nodes` | Search for entities in graph | `query`, `group_ids?`, `max_nodes?`, `entity_types?` |
| `search_memory_facts` | Search for relationships/facts | `query`, `group_ids?`, `max_facts?`, `center_node_uuid?` |
| `delete_entity_edge` | Delete a relationship | `uuid` |
| `delete_episode` | Delete an episode | `uuid` |
| `get_entity_edge` | Retrieve relationship by UUID | `uuid` |
| `get_episodes` | List episodes | `group_ids?`, `max_episodes?` |
| `clear_graph` | Clear graph data | `group_ids?` |
| `get_status` | Server health check | (no parameters) |

### Tool Name Discrepancies (README vs Server)

**Confirmed:** The plan's warning about tool name mismatches is **CORRECT**.

| README Name | Server Name (VERIFIED) | Status |
|-------------|------------------------|--------|
| `add_episode` | `add_memory` | ❌ Mismatch |
| `search_facts` | `search_memory_facts` | ❌ Mismatch |
| `search_nodes` | `search_nodes` | ✅ Match |

**Critical:** Always use the server-verified names (`add_memory`, `search_memory_facts`) in client implementations.

---

## 5. Streaming Behavior

### Transport Type
**HTTP Streamable with Server-Sent Events (SSE)**

### Response Delivery
- **Single Response:** Each request receives exactly ONE SSE message
- **No Streaming:** Despite using SSE transport, responses are NOT streamed incrementally
- **Immediate Completion:** The entire response is delivered in a single `event: message` block

### SSE Format
```
event: message
data: <complete-json-response>

```

**Note:** The trailing blank line is part of the SSE specification.

### Why SSE for Non-Streaming?

The server uses SSE transport for **protocol compatibility** with MCP clients, not for streaming. This allows:
1. Consistent transport layer across MCP implementations
2. Future extensibility for streaming responses
3. Compatibility with MCP client libraries expecting SSE

### Client Implementation Notes

1. **SSE Parser Required:** Clients must parse SSE format even though responses are single-shot
2. **No Chunking:** Do not implement incremental parsing; wait for complete message
3. **Connection Handling:** Each request-response is independent; no persistent SSE connection observed

---

## Implementation Checklist for Task 6

- [x] HTTP POST to `/mcp/` endpoint
- [x] Include `Content-Type: application/json` header
- [x] Include `Accept: application/json, text/event-stream` header
- [x] Send `initialize` request first
- [x] Extract `mcp-session-id` from response headers
- [x] Include `mcp-session-id` header in all subsequent requests
- [x] Parse SSE format: strip `event: message\ndata: ` prefix
- [x] Parse JSON-RPC 2.0 response
- [x] Handle `structuredContent` for tool call results
- [x] Use verified tool names (`add_memory`, `search_memory_facts`)
- [x] Implement error handling for `-32600` errors

---

## Example cURL Commands

### Initialize Session
```bash
curl -L -X POST http://mcp.mem.artdevcraft.com/mcp/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }' \
  -v 2>&1 | grep "mcp-session-id"
```

### List Tools
```bash
curl -L -X POST http://mcp.mem.artdevcraft.com/mcp/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'
```

### Call Tool
```bash
curl -L -X POST http://mcp.mem.artdevcraft.com/mcp/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_status",
      "arguments": {}
    }
  }'
```

---

## References

- **Server Source:** https://github.com/getzep/graphiti/blob/main/mcp_server/src/graphiti_mcp_server.py
- **MCP Protocol:** https://modelcontextprotocol.io/
- **JSON-RPC 2.0:** https://www.jsonrpc.org/specification
- **SSE Specification:** https://html.spec.whatwg.org/multipage/server-sent-events.html

---

## Next Steps (Task 6)

1. Implement HTTP client with SSE parsing
2. Implement session management (store/reuse `mcp-session-id`)
3. Implement JSON-RPC 2.0 request/response handling
4. Implement tool call wrappers for verified tool names
5. Add error handling for common error codes
6. Test against live endpoint before integration
