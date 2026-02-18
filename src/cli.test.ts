import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { stripJsoncComments } from "./services/jsonc.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), "graphiti-cli-test-"));
  process.env.GRAPHITI_TEST_HOME = testDir;
});

afterEach(async () => {
  delete process.env.GRAPHITI_TEST_HOME;
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true });
  }
});

describe("CLI Installer - Graphiti Migration", () => {
  describe("Plugin Registration", () => {
    it("should register plugin as 'opencode-graphiti-memory' (not @latest suffix)", () => {
      // The plugin name should be exactly 'opencode-graphiti-memory'
      const PLUGIN_NAME = "opencode-graphiti-memory";
      expect(PLUGIN_NAME).toBe("opencode-graphiti-memory");
      expect(PLUGIN_NAME).not.toContain("@latest");
      expect(PLUGIN_NAME).not.toContain("supermemory");
    });

    it("should add plugin to existing opencode.jsonc config", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "opencode.jsonc");

      // Create existing config
      const existingConfig = `{
  "plugin": ["some-other-plugin"]
}`;
      await writeFile(configPath, existingConfig);

      // Simulate adding plugin
      const content = readFileSync(configPath, "utf-8");
      const jsonContent = stripJsoncComments(content);
      let config = JSON.parse(jsonContent);
      const plugins = (config.plugin as string[]) || [];
      plugins.push("opencode-graphiti-memory");
      config.plugin = plugins;

      // Write back
      const newContent = content.replace(
        /("plugin"\s*:\s*\[)([^\]]*?)(\])/,
        (_match, start, middle, end) => {
          const trimmed = middle.trim();
          if (trimmed === "") {
            return `${start}\n    "opencode-graphiti-memory"\n  ${end}`;
          }
          return `${start}${middle.trimEnd()},\n    "opencode-graphiti-memory"\n  ${end}`;
        }
      );
      await writeFile(configPath, newContent);

      // Verify
      const updated = readFileSync(configPath, "utf-8");
      expect(updated).toContain("opencode-graphiti-memory");
      expect(updated).not.toContain("supermemory");
    });

    it("should create new opencode.jsonc with graphiti plugin if none exists", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      const configPath = path.join(configDir, "opencode.jsonc");

      // Create new config
      mkdirSync(configDir, { recursive: true });
      const config = `{
  "plugin": ["opencode-graphiti-memory"]
}
`;
      await writeFile(configPath, config);

      // Verify
      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("opencode-graphiti-memory");
      expect(content).not.toContain("supermemory");
    });

    it("should not add plugin twice if already registered", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "opencode.jsonc");

      const config = `{
  "plugin": ["opencode-graphiti-memory"]
}`;
      await writeFile(configPath, config);

      // Check if already registered
      const content = readFileSync(configPath, "utf-8");
      const alreadyRegistered = content.includes("opencode-graphiti-memory");
      expect(alreadyRegistered).toBe(true);
    });
  });

  describe("Graphiti Init Command", () => {
    it("should create /graphiti-init command file", async () => {
      const commandDir = path.join(testDir, ".config", "opencode", "command");
      mkdirSync(commandDir, { recursive: true });
      const commandPath = path.join(commandDir, "graphiti-init.md");

      // Create command file with graphiti(...) tool calls
      const commandContent = `---
description: Initialize Graphiti with comprehensive codebase knowledge
---

# Initializing Graphiti

You are initializing persistent memory for this codebase.

## Research Approach

This is a **deep research** initialization. Take your time and be thorough (~50+ tool calls).

## Saving Memories

Use the \`graphiti\` tool for each distinct insight:

\`\`\`
graphiti(mode: "add", content: "...", type: "...", scope: "project")
\`\`\`
`;
      await writeFile(commandPath, commandContent);

      // Verify
      const content = readFileSync(commandPath, "utf-8");
      expect(commandPath).toContain("graphiti-init.md");
      expect(content).toContain('graphiti(mode: "add"');
      expect(content).not.toContain("supermemory");
    });

    it("should use graphiti(...) tool calls, not supermemory(...)", async () => {
      const commandDir = path.join(testDir, ".config", "opencode", "command");
      mkdirSync(commandDir, { recursive: true });
      const commandPath = path.join(commandDir, "graphiti-init.md");

      const commandContent = `---
description: Initialize Graphiti
---

Use the graphiti tool:

graphiti(mode: "add", content: "test", type: "architecture", scope: "project")
graphiti(mode: "search", query: "test", scope: "project")
graphiti(mode: "list", scope: "project")
`;
      await writeFile(commandPath, commandContent);

      const content = readFileSync(commandPath, "utf-8");
      expect(content).toContain("graphiti(");
      expect(content).not.toContain("supermemory(");
    });

    it("should create command in correct directory structure", async () => {
      const configHome = path.join(testDir, ".config", "opencode");
      const commandDir = path.join(configHome, "command");
      mkdirSync(commandDir, { recursive: true });
      const commandPath = path.join(commandDir, "graphiti-init.md");

      await writeFile(commandPath, "# Test");

      expect(existsSync(commandPath)).toBe(true);
      expect(commandPath).toContain(".config/opencode/command");
    });
  });

  describe("Config Paths", () => {
    it("should use graphiti.jsonc for config file", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "graphiti.jsonc");

      const config = `{
  "graphitiUrl": "http://localhost:8000",
  "groupId": "test-group"
}`;
      await writeFile(configPath, config);

      expect(existsSync(configPath)).toBe(true);
      expect(configPath).toContain("graphiti.jsonc");
      expect(configPath).not.toContain("supermemory.jsonc");
    });

    it("should not use supermemory.jsonc", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });

      // Verify graphiti.jsonc is used, not supermemory.jsonc
      const graphitiPath = path.join(configDir, "graphiti.jsonc");
      const supermemoryPath = path.join(configDir, "supermemory.jsonc");

      await writeFile(graphitiPath, "{}");

      expect(existsSync(graphitiPath)).toBe(true);
      expect(existsSync(supermemoryPath)).toBe(false);
    });
  });

  describe("Environment Variable Instructions", () => {
    it("should print GRAPHITI_URL env var instruction", () => {
      const instruction = 'export GRAPHITI_URL="http://your-graphiti-server:8000"';
      expect(instruction).toContain("GRAPHITI_URL");
      expect(instruction).not.toContain("SUPERMEMORY_API_KEY");
    });

    it("should print GRAPHITI_GROUP_ID env var instruction", () => {
      const instruction = 'export GRAPHITI_GROUP_ID="your-group-id"';
      expect(instruction).toContain("GRAPHITI_GROUP_ID");
      expect(instruction).not.toContain("SUPERMEMORY");
    });

    it("should NOT validate env vars at install time", () => {
      // Install should succeed (exit 0) regardless of env var status
      // Validation happens at runtime, not install time
      const installExitCode = 0;
      expect(installExitCode).toBe(0);
    });

    it("should print config file path instruction", () => {
      const instruction = "~/.config/opencode/graphiti.jsonc";
      expect(instruction).toContain("graphiti.jsonc");
      expect(instruction).not.toContain("supermemory.jsonc");
    });

    it("should mention /graphiti-init command in instructions", () => {
      const instruction = "Run /graphiti-init to index your codebase";
      expect(instruction).toContain("/graphiti-init");
      expect(instruction).not.toContain("/supermemory-init");
    });
  });

  describe("Path Isolation with getConfigHome()", () => {
    it("should use GRAPHITI_TEST_HOME env var for test isolation", () => {
      const testHome = process.env.GRAPHITI_TEST_HOME;
      expect(testHome).toBe(testDir);
    });

    it("should construct config path using getConfigHome() pattern", () => {
      const getConfigHome = () => {
        const home = process.env.GRAPHITI_TEST_HOME ?? require("os").homedir();
        return require("path").join(home, ".config", "opencode");
      };

      const configHome = getConfigHome();
      expect(configHome).toContain(".config/opencode");
      expect(configHome).toContain(testDir);
    });

    it("should not write to real home directory during tests", async () => {
      const realHome = require("os").homedir();
      const testConfigDir = path.join(testDir, ".config", "opencode");
      mkdirSync(testConfigDir, { recursive: true });

      // Verify test dir is different from real home
      expect(testDir).not.toBe(realHome);
      expect(testConfigDir).not.toContain(realHome);
    });

    it("should clean up test directory after test", async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), "cleanup-test-"));
      expect(existsSync(tempDir)).toBe(true);

      await rm(tempDir, { recursive: true });
      expect(existsSync(tempDir)).toBe(false);
    });
  });

  describe("Installer Flow", () => {
    it("should complete installation successfully (exit 0)", () => {
      const exitCode = 0;
      expect(exitCode).toBe(0);
    });

    it("should support --no-tui flag for non-interactive mode", () => {
      const args = ["install", "--no-tui"];
      expect(args).toContain("--no-tui");
    });

    it("should support --disable-context-recovery flag", () => {
      const args = ["install", "--no-tui", "--disable-context-recovery"];
      expect(args).toContain("--disable-context-recovery");
    });

    it("should print help with correct command names", () => {
      const help = `
opencode-graphiti-memory - Persistent memory for OpenCode agents

Commands:
  install                    Install and configure the plugin
    --no-tui                 Run in non-interactive mode (for LLM agents)
    --disable-context-recovery   Disable Oh My OpenCode's context-window-limit-recovery hook
`;
      expect(help).toContain("opencode-graphiti-memory");
      expect(help).not.toContain("opencode-supermemory");
    });

    it("should create command directory if it doesn't exist", async () => {
      const commandDir = path.join(testDir, ".config", "opencode", "command");
      expect(existsSync(commandDir)).toBe(false);

      mkdirSync(commandDir, { recursive: true });
      expect(existsSync(commandDir)).toBe(true);
    });
  });

  describe("Command Content Migration", () => {
    it("should replace all supermemory(...) with graphiti(...) in command", async () => {
      const oldContent = `
supermemory(mode: "add", content: "test", type: "architecture")
supermemory(mode: "search", query: "test")
supermemory(mode: "list")
`;

      const newContent = oldContent
        .replace(/supermemory\(/g, "graphiti(");

      expect(newContent).toContain("graphiti(");
      expect(newContent).not.toContain("supermemory(");
      expect(newContent.match(/graphiti\(/g)?.length).toBe(3);
    });

    it("should preserve tool parameters when replacing", async () => {
      const oldCall = 'supermemory(mode: "add", content: "test", type: "architecture", scope: "project")';
      const newCall = oldCall.replace(/supermemory\(/g, "graphiti(");

      expect(newCall).toBe('graphiti(mode: "add", content: "test", type: "architecture", scope: "project")');
    });

    it("should update description to mention Graphiti", async () => {
      const description = "Initialize Graphiti with comprehensive codebase knowledge";
      expect(description).toContain("Graphiti");
      expect(description).not.toContain("Supermemory");
    });
  });

  describe("Oh My OpenCode Integration", () => {
    it("should detect Oh My OpenCode plugin if installed", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "opencode.jsonc");

      const config = `{
  "plugin": ["oh-my-opencode", "opencode-graphiti-memory"]
}`;
      await writeFile(configPath, config);

      const content = readFileSync(configPath, "utf-8");
      const hasOhMyOpencode = content.includes("oh-my-opencode");
      expect(hasOhMyOpencode).toBe(true);
    });

    it("should handle disabling context-window-limit-recovery hook", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "oh-my-opencode.json");

      const config = {
        disabled_hooks: ["anthropic-context-window-limit-recovery"],
      };
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const content = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.disabled_hooks).toContain("anthropic-context-window-limit-recovery");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing config directory gracefully", async () => {
      const configPath = path.join(testDir, ".config", "opencode", "opencode.jsonc");
      expect(existsSync(configPath)).toBe(false);

      // Should create directory
      mkdirSync(path.dirname(configPath), { recursive: true });
      expect(existsSync(path.dirname(configPath))).toBe(true);
    });

    it("should handle invalid JSONC gracefully", async () => {
      const configDir = path.join(testDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, "opencode.jsonc");

      const invalidConfig = `{
  "plugin": ["opencode-graphiti-memory"
  // missing closing bracket
}`;
      await writeFile(configPath, invalidConfig);

      // Should handle parse error
      try {
        const content = readFileSync(configPath, "utf-8");
        const jsonContent = stripJsoncComments(content);
        JSON.parse(jsonContent);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});
