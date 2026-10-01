# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-02T01:38:44+03:00
**Commit:** a900aea (a900aeaf6a40d279c38274a6ae912c0aa5818097)
**Branch:** artemfomin/init-deep-agents-md

## OVERVIEW
`@ceris/opencode-graphiti` v0.1.3 (MIT, ESM): OpenCode plugin that gives agents persistent memory via a Graphiti MCP server.
Stack: TypeScript 5.7 strict, Bun for build/test, runtime deps `@opencode-ai/plugin` and `zod` v4.

## STRUCTURE
```
./
|-- src/                 # plugin + CLI source, tests colocated (see src/AGENTS.md)
|   |-- services/        # transport, compaction, namespace, privacy, utils
|   |-- types/           # Graphiti wire types + guards
|   `-- __tests__/       # example + gated integration test
|-- scripts/release.sh   # version bump + local commit + tag (bash, jq)
|-- .github/workflows/release.yml  # v* tag -> typecheck, test, build, npm publish
|-- .sisyphus/research/graphiti-transport.md  # MCP transport research (2026-01-28)
`-- README.md, package.json, tsconfig.json, bun.lock, .gitignore
```
33 tracked files. Package publishes `dist/` only: `main` dist/index.js, `types` dist/index.d.ts,
bin `opencode-graphiti` -> dist/cli.js. package.json `opencode` block: type plugin, hooks `chat.message`, `event`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Plugin entry, hooks, `graphiti` tool | src/index.ts | 566 lines; runtime flow in src/AGENTS.md |
| Installer CLI | src/cli.ts | 456 lines; bin `opencode-graphiti` |
| Config load/precedence | src/config.ts | 247 lines; singleton |
| Compaction + summary memory | src/services/compaction.ts | 611 lines, largest file |
| MCP client (JSON-RPC over HTTP/SSE) | src/services/graphiti-client.ts | 310 lines |
| Wire types + guards | src/types/graphiti.ts | most-imported module (text fan-in 9) |
| Release / publish | scripts/release.sh, .github/workflows/release.yml | tag-driven |
| Transport protocol background | .sisyphus/research/graphiti-transport.md | 375-line research note |
| User-facing docs | README.md | 357 lines |

## CODE MAP
Exports from text scan; reference centrality UNMEASURED (no LSP/AST available).
Text import fan-in (not semantic refs): types/graphiti.ts 9, config.ts 7, services/logger.ts 5,
graphiti-client.ts 4, paths.ts 4, jsonc.ts 3, ids.ts 3, namespace.ts 3.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| GraphitiPlugin | const Plugin | src/index.ts | unmeasured | only package export; returns hooks + `graphiti` tool |
| initConfig/getConfig/isConfigReady/resetConfig, ConfigState | fn/type | src/config.ts | unmeasured | config singleton |
| GraphitiClient, GraphitiResult | class/type | src/services/graphiti-client.ts | unmeasured | MCP JSON-RPC over HTTP/SSE |
| createCompactionHook | fn | src/services/compaction.ts | unmeasured | preemptive compaction + summary memory |
| getProjectNamespace/getProfileNamespace/normalizeGitRemoteUrl | fn | src/services/namespace.ts | unmeasured | group ids |
| formatContext | fn | src/services/context.ts | unmeasured | injected context text |
| GraphitiConfig, Episode, Node, Fact (+guards) | types | src/types/graphiti.ts | unmeasured | wire shapes |

14 production source files (non-test TS, incl. export-less src/cli.ts); 13 of them export,
48 top-level exports total; 11 `*.test.ts` files.

## CONVENTIONS
- tsconfig: `moduleResolution: bundler`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`; unused locals/params allowed.
- `rootDir src`, include `src/**/*`: tests are typechecked and get declarations emitted.
- Build = two `bun build --target node` bundles (index, cli) + `tsc --emitDeclarationOnly`.
- Runtime config precedence (highest first): env `GRAPHITI_URL`, `GRAPHITI_GROUP_ID`, `GRAPHITI_USER_ID`;
  project `.opencode/graphiti.jsonc`; global `~/.config/opencode/graphiti.jsonc`.
  URL normalized to end with `/mcp`.
- `GRAPHITI_TEST_HOME` overrides the home dir everywhere (tests).
- Tests: Bun runner, `*.test.ts` beside source.

## ANTI-PATTERNS (THIS PROJECT)
- `scripts/release.sh` is a release action, not validation: it mutates package.json and creates a commit + tag.
- Integration tests hit a live Graphiti and mutate a unique test group; gated by `RUN_INTEGRATION_TESTS=1`.
- Use `bunx ... install`; `setup` is a deprecated alias.

## UNIQUE STYLES
- CI exists only for releases: `v*` tags trigger release.yml; no PR/push CI.
- Runtime internals (hook flow, compaction thresholds, namespace hashing, test isolation) live in src/AGENTS.md.

## COMMANDS
Declared in package.json/README/CI; not run as part of this file's validation.
```bash
bun install
bun run build        # dist/index.js, dist/cli.js, .d.ts
bun run dev          # tsc --watch
bun run typecheck    # tsc --noEmit
bun test             # unit; integration skipped unless env set
RUN_INTEGRATION_TESTS=1 GRAPHITI_URL=<url> bun test   # live Graphiti
./scripts/release.sh [patch|minor|major]   # bash+jq; commit + tag; then git push && git push --tags
```
CI (release.yml, ubuntu, Node 20 + setup-bun): bun install -> typecheck -> bun test -> build ->
`npm publish --access public` (secret `NPM_TOKEN`).
Consumer install: `bunx @ceris/opencode-graphiti@latest install [--no-tui] [--disable-context-recovery]`.

## NOTES
- `.gitignore` ignores `AGENTS.md` (all paths), `.sisyphus`, `.knowledge/`, `.claude/`, `.serena/`, `dist`.
  Committing AGENTS.md files needs `git add -f` or a .gitignore change.
- `.sisyphus/research/graphiti-transport.md` is tracked despite the ignore (force-added).
- `release.sh` needs bash + jq (no Windows-native equivalent); everything else runs via `bun`.
- `.omo/` is untracked init-deep scaffolding.
