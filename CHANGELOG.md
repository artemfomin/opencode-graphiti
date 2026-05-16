# Changelog

## 2.0.0-preview.1 — 2.0-preview-001 (preview)

Release label: `2.0-preview-001`. npm version: `2.0.0-preview.1`. Status: preview — implementation Tasks 1-8 complete; validation pending Tasks 10-11. The maintainer cuts the release manually; agents do not run `scripts/release.sh`, `git commit`, `git tag`, `git push`, or `npm publish`.

- Memory architecture: D+E hybrid with optional F overlay (`@graphiti` markers).
- Deterministic capture hooks across `chat.message`, `tool.execute.after`, `message.part.updated`, `session.idle`, `session.compacted`.
- Shadow extractor enabled by default with Zod schema validation, `AbortSignal`-based timeouts, concurrency cap, and fail-open isolation; disable via `shadowExtractor.enabled=false` or `GRAPHITI_SHADOW_ENABLED=false`.
- Explicit `@graphiti Class: body` markers with highest priority; ignored inside fenced/inline code; bodies still pass through the sanitizer on write.
- Top-N recall (default `recall.topN=5`) replaces first-turn broadcast injection. Triggers: session start, post-compaction refresh, explicit `graphiti.recall` mode on the existing MCP tool. Rollback flag: `recall.broadcastCompat=true`.
- Single sanitizer boundary at `src/services/sanitizer.ts` applied to every Graphiti write (deterministic, shadow, marker, compaction, migration). Redactions: `[REDACTED:api_key|token|password|email|env_secret|credential|fully-private]`.
- Migration CLI for legacy `[TYPE: x]` episodes: `opencode-graphiti migrate [--dry-run|--apply] [--group-id <id>] [--limit <n>]`. Dry-run is the default; `--apply` is idempotent; source episodes are never deleted.
- New configuration sections: `memory`, `capture`, `shadowExtractor`, `recall`, `markers`. Env overrides: `GRAPHITI_MEMORY_ENABLED`, `GRAPHITI_CAPTURE_ENABLED`, `GRAPHITI_SHADOW_ENABLED`, `GRAPHITI_SHADOW_TIMEOUT_MS`, `GRAPHITI_SHADOW_PROVIDER`, `GRAPHITI_SHADOW_MODEL`, `GRAPHITI_RECALL_TOP_N`, `GRAPHITI_RECALL_BROADCAST_COMPAT`. Precedence: defaults → config file → env.

See [`docs/releases/2.0-preview-001.md`](docs/releases/2.0-preview-001.md) for the full preview release notes.

## Unreleased

### Fixed

- **Synthetic part ids now provably match opencode's read-path schema.** The
  generators in `src/services/ids.ts` return branded `PartId` / `MessageId`
  types, and every injection point (`chat.message` nudge + context injection,
  compaction hook) calls `assertValidPartId` / `assertValidMessageId` before
  the value can reach `output.parts` or disk. A regression like the 0.1.2
  one (`graphiti-nudge-${Date.now()}`) is now a TypeScript compile error
  **and** a runtime throw before any storage write.
- **CI regression guard.** `src/__tests__/no-legacy-ids.test.ts` scans both
  `src/**` and the built `dist/index.js` for banned literal patterns:
  - template literals of the form `graphiti-<word>-${…}`
  - static fields like `` id: "graphiti-nudge-…" ``
  The dist check exists specifically to catch the failure mode that caused
  this incident — shipping a stale bundle whose source was already fixed.

### Migration notes — upgrading from 0.1.2

If you ever installed `@ceris/opencode-graphiti@0.1.2`, opencode may have
written synthetic parts to disk with ids like `graphiti-nudge-<ts>` /
`graphiti-context-<ts>`. opencode's UI rejects those on read-path with:

```
BadRequest: Expected a string starting with "prt", got "graphiti-context-…"
  at [0]["parts"][0]["id"]
```

The bug was fixed in 0.1.3, but two failure modes can keep it alive after
the upgrade:

1. **Stale package cache.** opencode resolves plugins from its own package
   cache before the config-dir `node_modules`. Even after `bun install`
   bumps `~/.config/opencode/package.json` to `^0.1.3`, the cached 0.1.2
   build in `~/.cache/opencode/node_modules/@ceris/opencode-graphiti/` may
   still be picked up. Symptom: new sessions still write `graphiti-…-<ts>`
   part files into `~/.local/share/opencode/storage/part/`.

   Fix:

   ```bash
   # close every opencode window first
   rm -rf ~/.cache/opencode/node_modules/@ceris/opencode-graphiti
   rm -rf ~/.cache/opencode/packages/@ceris/opencode-graphiti*    # if present
   ```

   On Windows / PowerShell:

   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\node_modules\@ceris\opencode-graphiti"
   Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\@ceris*" -ErrorAction SilentlyContinue
   ```

2. **Poisoned session storage.** Old part files with `graphiti-…-<ts>` ids
   on disk continue to brick the affected sessions even after the plugin
   itself is clean. They are synthetic injections (memory nudges and
   context summaries) — safe to remove.

   ```bash
   # backup first
   mkdir -p ~/opencode-graphiti-storage-backup
   find ~/.local/share/opencode/storage/part -name 'graphiti-*.json' \
     -exec cp --parents {} ~/opencode-graphiti-storage-backup \;
   # then delete
   find ~/.local/share/opencode/storage/part -name 'graphiti-*.json' -delete
   ```

   On Windows / PowerShell, the equivalent pattern is in `scripts/` /
   `docs/` — see this repo's history for the inline script.

3. **Pin the version in `opencode.json`.** Use an explicit pin so opencode
   re-resolves on next launch instead of silently falling back to the cache:

   ```jsonc
   "plugin": [
     "@ceris/opencode-graphiti@0.1.3"
   ]
   ```

## 0.1.3

- Switched synthetic Part / Message id generators to opencode's
  `prt_<hex(now)><base36>` / `msg_<hex(now)><base36>` format. Fixes
  `BadRequest: Expected a string starting with "prt"` introduced in 0.1.2.

## 0.1.2

- Memory keyword nudge feature (regression: synthetic part ids used the
  non-conforming pattern `graphiti-nudge-${Date.now()}`, breaking session
  reads in the UI).

## 0.1.1, 0.1.0

- Initial releases. See git history.
