# Memory Architecture Overview

> Release identity: `2.0-preview-001`
> npm package version: `2.0.0-preview.1`
> Status: preview — implementation tasks 1-8 complete; validation pending Tasks 10-11

## Overview

`2.0-preview-001` describes a D+E hybrid memory architecture with an optional F overlay. The design keeps the main agent path predictable, records deterministic facts from opencode hooks, and uses a shadow extractor for higher-level project knowledge that rules cannot classify well.

Compared with `0.1.3`, the preview scope changes the memory model from broad first-turn context injection and end-of-session summary blobs to structured, bounded capture and recall. The current `0.1.3` package writes mostly compaction summaries, relies on agent-chosen `graphiti.add` calls, and can inject large context blocks on the first message. The preview architecture plans typed memory episodes, a single sanitizer boundary, top-N recall, and explicit user markers.

Approach E supplies deterministic capture from opencode event structure. Approach D adds a fail-open shadow extractor for architectural and business context. Approach F adds explicit user control through `@graphiti` markers.

## Memory Taxonomy

The preview taxonomy has deterministic classes for operational facts and shadow classes for inferred project knowledge. Each Graphiti write uses a JSON envelope with a class discriminator, evidence, session metadata, confidence, and class-specific fields.

### Deterministic Classes

| Class | Purpose |
|---|---|
| `UserInstruction` | Stores user instructions verbatim with session and turn order so instruction history stays reconstructible. |
| `Restriction` | Stores rules, bans, and constraints stated by the user or project guidance. |
| `StylePreference` | Stores writing, coding, and interaction preferences that should shape future work. |
| `Problem` | Stores errors, failing checks, symptoms, scope, and current status. |
| `FixAttempt` | Links an attempted fix to a problem and records whether the attempt failed, partially worked, rolled back, or is expected to succeed after validation. |
| `Achievement` | Stores verified outcomes, tied to evidence such as tool output, patches, or test results. |
| `FileEdit` | Records deterministic file change metadata such as path, operation, diff hash, and line count. |
| `CommandRun` | Records command metadata such as command text, working directory, exit code, duration, and evidence. |

### Shadow Classes

| Class | Purpose |
|---|---|
| `ArchitecturalDecision` | Stores ADR-style project decisions with context, decision, consequences, and alternatives. |
| `Decision` | Stores smaller tactical decisions that are useful later but do not need ADR shape. |
| `BusinessEntity` | Stores named actors, objects, documents, services, or project concepts with descriptive context. |
| `BusinessProcess` | Stores multi-step workflows with actors, triggers, outcomes, and steps. |
| `UseCase` | Stores actor, goal, preconditions, main flow, optional alternate flows, and postconditions. |
| `InfrastructureComponent` | Stores services, databases, queues, caches, gateways, and related deployment context. |
| `DataModel` | Stores schemas, fields, types, and invariants. |
| `Strategy` | Stores plans, approaches, applicability conditions, and success criteria. |
| `Reflection` | Stores lessons and follow-up insight, upgraded from deterministic candidates when evidence supports it. |

## Capture Hooks

The architecture uses five primary capture hooks:

| Hook | Planned role |
|---|---|
| `chat.message` | Capture user instructions, restrictions, style preferences, explicit markers, and first-turn recall context. |
| `tool.execute.after` | Capture command results and tool outcomes as `CommandRun`, `Problem`, or supporting evidence. |
| `message.part.updated` | Capture assistant text, reasoning, patch, and step-finish events for deterministic classes and shadow batches. |
| `session.idle` | Flush shadow batches and build a session digest from verified session memory. |
| `session.compacted` | Refresh recall after compaction and force pending shadow extraction before the compacted context is reused. |

Deterministic capture filters trivial messages, keeps user instructions chronological, and ties every episode to evidence. Candidate achievements stay tied to validation signals such as exit code, patch evidence, or later ratification.

## Shadow Extractor

The shadow extractor is enabled in preview. It runs outside the main agent path, batches recent user text, assistant text, and tool context, and emits only schema-valid episodes with evidence that appears in the recent parts.

Planned behavior:

- Enabled by default for preview.
- Fail-open, so extractor errors do not block chat, tools, compaction, or recall.
- Schema-validated before write.
- Sanitized before the extractor sees text and again before Graphiti write.
- Disable-able through config or environment.
- Drops output when evidence substring validation fails.

The extractor targets `ArchitecturalDecision`, `Decision`, `BusinessEntity`, `BusinessProcess`, `UseCase`, `InfrastructureComponent`, `DataModel`, `Strategy`, and `Reflection`.

## Explicit `@graphiti` Markers

Explicit markers are the highest-priority override. A user marker such as `@graphiti restriction:` or `@graphiti decision:` selects the target class before deterministic or shadow classification.

Markers still pass through the same sanitizer and schema validation as every other Graphiti write. They do not bypass privacy checks, evidence checks, or class contracts.

## Recall

Preview recall is bounded by top-N retrieval. The default top-N is 5. Recall triggers are:

- Session start or first user message in a session.
- Post-compaction refresh after `session.compacted`.
- Explicit `graphiti.recall` tool calls with query, optional class filters, and optional limit.

Broadcast first-turn injection is disabled by default. The planned recall path returns a focused memory block rather than flooding prompt context with every matching node. Agents can call `graphiti.recall` when the user prompt or current task makes prior memory relevant.

## Privacy And Sanitization

Every Graphiti write crosses a single sanitizer boundary. This includes deterministic capture, shadow extraction, explicit markers, compaction summaries, migration writes, and direct memory tools.

Redaction categories:

- API keys, access tokens, bearer tokens, and OAuth secrets.
- Passwords, private keys, and credential-like environment variables.
- Email addresses and other direct personal contact data when not needed for the memory purpose.
- Raw stack traces or command output sections that contain secret-like values.
- `<private>` blocks and other private markers before any external write.

The sanitizer preserves useful non-secret context, such as the type of credential removed, command shape, file path, error class, or affected subsystem.

## Migration

Legacy episodes that use `[TYPE: x]` prefixes migrate through a CLI planned for Task 8. The migration maps old memory types to the new taxonomy when the mapping is unambiguous.

The migration modes are:

- `--dry-run`, reports proposed changes without writing.
- `--apply`, writes migrated episodes.

Running migration without flags is a no-op. Re-runs are idempotent, so repeated dry runs or apply runs should not duplicate migrated episodes.

## Configuration

Configuration precedence is `defaults → config file → env`.

### `memory`

| Key | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Enables the preview memory architecture. |
| `projectNamespace` | current project namespace | Scopes memory to the active project. |
| `maxMemoriesOnStart` | `5` | Top-N memories to recall at session start. |
| `maxDigestsAfterCompaction` | `3` | Session digests to include after compaction. |
| `recallEntityTypes` | deterministic and shadow recall classes | Limits class types searched by default recall. |

### `capture`

| Key | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Enables deterministic capture hooks. |
| `userInstructionVerbatim` | `true` | Stores user instructions verbatim. |
| `writeFileEditsForLinesAbove` | `20` | Records larger file edits as `FileEdit`. |
| `writeCommandRunsForExitNonZero` | `true` | Records failed commands as `CommandRun` and candidate `Problem` evidence. |
| `stripPrivateBeforeWrite` | `true` | Applies privacy stripping before memory writes. |

### `shadowExtractor`

| Key | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Enables shadow extraction in preview. |
| `model` | `openai/gpt-4o-mini` | Model used for shadow classification. |
| `batchSize` | `5` | Turns per extraction batch. |
| `batchIntervalMs` | `30000` | Time-based batch flush interval. |
| `confidenceThreshold` | `0.7` | Minimum confidence for write candidates. |
| `failOpen` | `true` | Keeps runtime behavior moving when extraction fails. |

### `recall`

| Key | Default | Purpose |
|---|---:|---|
| `topN` | `5` | Bounded recall count. |
| `onSessionStart` | `true` | Runs recall at session start or first user message. |
| `afterCompaction` | `true` | Refreshes recall after compaction. |
| `toolEnabled` | `true` | Exposes explicit `graphiti.recall`. |
| `broadcastCompat` | `false` | Restores old broadcast-style prompt injection only when an operator turns it on. |

### `markers`

| Key | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Enables explicit marker parsing. |
| `prefixes` | `["@graphiti"]` | Marker prefixes that select memory class overrides. |
| `highestPriority` | `true` | Gives user markers priority over deterministic and shadow classification. |
| `requireValidation` | `true` | Requires sanitizer and schema validation for marker writes. |

Environment-variable overrides include:

- `GRAPHITI_MEMORY_ENABLED`
- `GRAPHITI_CAPTURE_ENABLED`
- `GRAPHITI_SHADOW_ENABLED`
- `GRAPHITI_SHADOW_MODEL`
- `GRAPHITI_SHADOW_BATCH_SIZE`
- `GRAPHITI_SHADOW_BATCH_INTERVAL_MS`
- `GRAPHITI_RECALL_TOP_N`
- `GRAPHITI_RECALL_BROADCAST_COMPAT`
- `GRAPHITI_MARKERS_ENABLED`

## Rollback

Two rollback controls are planned for preview operators:

- Set `recall.broadcastCompat=true` or `GRAPHITI_RECALL_BROADCAST_COMPAT=true` to re-enable legacy-style broadcast recall if bounded recall blocks a workflow.
- Set `GRAPHITI_SHADOW_ENABLED=false` or `shadowExtractor.enabled=false` to disable shadow extraction while leaving deterministic capture and explicit recall available.

The architecture source remains available at [`.knowledge/memory-architecture.md`](../.knowledge/memory-architecture.md) as the original exploration document.
