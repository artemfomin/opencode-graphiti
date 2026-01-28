# opencode-graphiti

OpenCode plugin for persistent memory using [Graphiti](https://github.com/getzep/graphiti) MCP server.

Your agent remembers what you tell it - across sessions, across projects.

## Installation

### For Humans

```bash
bunx opencode-graphiti@latest install
```

Then set your Graphiti server URL and group ID:

```bash
export GRAPHITI_URL="http://your-graphiti-server:8000/mcp/"
export GRAPHITI_GROUP_ID="your-group-id"
```

**Or let your agent do it** - paste this into OpenCode:
```
Install opencode-graphiti by following https://raw.githubusercontent.com/yourusername/opencode-graphiti/main/README.md
```

### For LLM Agents

<details>
<summary>Instructions for LLM Agents (click to expand)</summary>

If you're an LLM agent helping set up opencode-graphiti, follow these steps:

#### Step 1: Run the installer

```bash
bunx opencode-graphiti@latest install --no-tui
```

This will:
- Register the plugin in `~/.config/opencode/opencode.jsonc`
- Create the `/graphiti-init` command

#### Step 2: Verify the config

```bash
cat ~/.config/opencode/opencode.jsonc
```

Should contain:
```json
{
  "plugin": ["opencode-graphiti"]
}
```

If not, add it manually:

**JSONC:**
```jsonc
{
  "plugin": [
    "opencode-graphiti"
    // ... other plugins
  ]
}
```

**JSON:**
```json
{
  "plugin": ["opencode-graphiti"]
}
```

#### Step 3: Configure Graphiti connection

Set required environment variables:

```bash
export GRAPHITI_URL="http://your-graphiti-server:8000/mcp/"
export GRAPHITI_GROUP_ID="your-group-id"
```

Or create `~/.config/opencode/graphiti.jsonc`:

```jsonc
{
  "graphitiUrl": "http://localhost:8000/mcp/",
  "groupId": "myteam"
}
```

#### Step 4: Verify setup

Tell the user to restart OpenCode and run:

```bash
opencode -c
```

They should see `graphiti` in the tools list. If not, check:
1. Is `GRAPHITI_URL` and `GRAPHITI_GROUP_ID` set?
2. Is the plugin in `opencode.jsonc`?
3. Check logs: `tail ~/.opencode-graphiti.log`

#### Step 5: Initialize codebase memory (optional)

Run `/graphiti-init` to have the agent explore and memorize the codebase.

</details>

## Features

### Context Injection

On first message, the agent receives (invisible to user):
- User profile (cross-project preferences)
- Project memories (all project knowledge)
- Relevant memories (semantic search)

Example of what the agent sees:
```
[GRAPHITI]

User Profile:
- Prefers concise responses
- Expert in TypeScript

Project Knowledge:
- Uses Bun, not Node.js
- Build: bun run build

Relevant Memories:
- Build fails if .env.local missing
```

The agent uses this context automatically - no manual prompting needed.

### Keyword Detection

Say "remember", "save this", "don't forget" etc. and the agent auto-saves to memory.

```
You: "Remember that this project uses bun"
Agent: [saves to project memory]
```

Add custom triggers via `keywordPatterns` config.

### Codebase Indexing

Run `/graphiti-init` to explore and memorize your codebase structure, patterns, and conventions.

### Preemptive Compaction

When context hits 80% capacity:
1. Triggers OpenCode's summarization
2. Injects project memories into summary context
3. Saves session summary as a memory

This preserves conversation context across compaction events.

### Privacy

```
API key is <private>sk-abc123</private>
```

Content in `<private>` tags is never stored.

## Tool Usage

The `graphiti` tool is available to the agent:

| Mode | Args | Description |
|------|------|-------------|
| `add` | `content`, `type?`, `scope?` | Store memory |
| `search` | `query`, `scope?` | Search memories |
| `profile` | `query?` | View user profile |
| `list` | `scope?`, `limit?` | List memories |
| `forget` | `memoryId`, `scope?` | Delete memory |
| `help` | - | Show help text |

**Scopes:** `user` (cross-project), `project` (default)

**Types:** `project-config`, `architecture`, `error-solution`, `preference`, `learned-pattern`, `conversation`

## Memory Scoping

| Scope | Namespace | Persists |
|-------|-----------|----------|
| User | `{groupId}_profile` | All projects |
| Project | `{groupId}_{projectName}_{hash}` | This project |

## Configuration

Create `~/.config/opencode/graphiti.jsonc`:

```jsonc
{
  // Graphiti MCP server URL (required)
  "graphitiUrl": "http://localhost:8000/mcp/",
  
  // Base group ID for namespacing (required)
  "groupId": "myteam",
  
  // Profile namespace (optional, default: "{groupId}_profile")
  "profileGroupId": "myteam_profile",
  
  // Max memories injected per request (default: 5)
  "maxMemories": 5,
  
  // Max project memories listed (default: 10)
  "maxProjectMemories": 10,
  
  // Max profile facts injected (default: 5)
  "maxProfileItems": 5,
  
  // Include user profile in context (default: true)
  "injectProfile": true,
  
  // Extra keyword patterns for memory detection (regex)
  "keywordPatterns": ["log\\s+this", "write\\s+down"],
  
  // Context usage ratio that triggers compaction (default: 0.80)
  "compactionThreshold": 0.80
}
```

**Required fields:** `graphitiUrl`, `groupId`

**Environment variables** (take precedence over config file):
- `GRAPHITI_URL` - MCP server URL
- `GRAPHITI_GROUP_ID` - Base group ID

### Local Project Override

Create `.opencode/graphiti.jsonc` in your project root to override settings:

```jsonc
{
  "groupId": "project-specific-id",
  "maxProjectMemories": 20
}
```

Local config merges with global config. Environment variables take highest precedence.

## Usage with Oh My OpenCode

If you're using [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode), disable its built-in auto-compact hook to let graphiti handle context compaction:

Add to `~/.config/opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["anthropic-context-window-limit-recovery"]
}
```

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

Local install:

```jsonc
{
  "plugin": ["file:///path/to/opencode-graphiti"]
}
```

## Logs

```bash
tail -f ~/.opencode-graphiti.log
```

## License

MIT
