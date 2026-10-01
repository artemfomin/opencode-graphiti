# src/ - PLUGIN RUNTIME

Score 11 (recursive: files 25 +3, code ratio +2, index.ts +2, symbols 122 +2, exports 48 +2; subdirs 3, own config, centrality unmeasured = 0). 8-15 band, created as distinct domain: shipped plugin + CLI code vs root packaging/release. Covers `src/`, `services/`, `types/`, `__tests__/` (all scored <8, no own file).

## OVERVIEW
`GraphitiPlugin` (index.ts) wires OpenCode hooks to a Graphiti MCP server; `cli.ts` is the separate `opencode-graphiti install` binary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Hooks, `graphiti` tool modes | `index.ts` | `chat.message`, `tool.graphiti`, `event` |
| Config load/precedence | `config.ts` | Zod schema, module singleton |
| Installer | `cli.ts` | argv dispatch runs at import time; tests never import it |
| MCP transport | `services/graphiti-client.ts` | JSON-RPC 2.0 POST, SSE `data:` line, `mcp-session-id` header |
| Auto-compaction | `services/compaction.ts` | thresholds + pending queue below |
| Project/profile namespace | `services/namespace.ts` | git-origin hash |
| Injected context text | `services/context.ts` | `[GRAPHITI]` header + 3 sections |
| `<private>` redaction | `services/privacy.ts` | `[REDACTED]` replacement |
| Synthetic msg/part IDs | `services/ids.ts` | `msg_`/`prt_` prefixes required by OpenCode Zod |
| Home/config/log paths | `services/paths.ts` | `getConfigHome`/`getDataHome`/`getLogPath` |
| Wire types + guards | `types/graphiti.ts` | snake_case fields mirror Graphiti |

## RUNTIME FLOW
- Plugin init: `initConfig(directory)`; not `ready` -> hooks no-op, tool returns JSON error.
- `chat.message`: keyword match (code blocks/inline code stripped first) appends nudge part; first message per session runs 4 parallel queries (profile nodes, project episodes, nodes, facts) and `unshift`s one synthetic context part.
- `tool.graphiti`: modes add|search|profile|list|forget|help (default help); always returns `JSON.stringify` output, never throws.
  - `add`/`list`: scope default project (index.ts 351, 478); `add` type default learned-pattern.
  - `search`: scope user -> profile only, project -> project only, absent -> profile + project (388-397).
  - `profile`/`forget`: ignore scope; `forget` calls `deleteEpisode(memoryId)` with no group check (443-450, 521-529).
- `event`: compaction handles `message.updated`, `session.idle`, `session.deleted`. Ratio >= threshold (default 0.80), >=50k tokens, 30s cooldown, 200k default limit -> inject prompt, `session.summarize`, then "Continue" via `promptAsync` after 500ms.
- Summary saved as `[TYPE: conversation] [Session Summary]` episode; unreachable -> `~/.opencode/graphiti-pending/*.json` (no reader exists in src).

## NAMESPACES
- groupId: `GRAPHITI_GROUP_ID` > local > global file; else `${userId}_${sanitized package.json name|basename}` only when `projectDir` given.
- Project ns: `${groupId}_${sha256(normalized origin[/repo prefix] or abs dir).slice(0,8)}`, cached per dir.
- Profile ns: `profileGroupId ?? userId ?? ${groupId}_profile`.

## CONVENTIONS
- `GraphitiResult<T>`: `isUnreachable: true` for HTTP/timeout/session/JSON-RPC errors; `false` only for tool `isError`.
- TS params camelCase; tool-call args converted to snake_case in `graphiti-client.ts`.
- Memory type stored as `[TYPE: x] ` prefix; `parseTypePrefix` strips on read.
- Plugin code logs only via `services/logger.ts` (appends `~/.opencode-graphiti.log`); `console` only in `cli.ts`.
- Imports mostly use `.js` suffix; `logger.ts` and some tests omit it.

## TESTS
- `__tests__/`: `example.test.ts` + `integration.test.ts` (gating: root); other tests sit beside source.
- Isolation: temp home via root's test-home env override, plus `resetConfig()`/`resetLogger()` in hooks.
- `compaction.test.ts` (7) and `integration.test.ts` (3) contain fixed `setTimeout` waits.

## ANTI-PATTERNS
- Never hand-build IDs for injected messages/parts: `ids.ts` header says synthetic entries MUST use its helpers to pass OpenCode prefix validation.
- Never call `getConfig()` (or `namespace.ts`/`compaction.ts` paths using it) before `initConfig` is ready: it throws (process singleton).
- Never report a tool `isError` as unreachable: compaction pending-queue fallback keys on `isUnreachable`.

## GOTCHAS
- Compaction writes OpenCode on-disk storage directly (`~/.opencode/messages`, `parts`).
- Invalid `compactionThreshold` (<=0, >1) silently -> 0.8; invalid keyword regex dropped; user patterns append to defaults, never replace.
- Unparseable or schema-invalid JSONC config file is silently ignored.
- `namespace.ts` has unused copies of `sanitizeNamespace`/`extractProjectName`; live ones are in `config.ts`.
