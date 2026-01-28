import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig, getConfig, isConfigReady, resetConfig } from "./config.js";

describe("config", () => {
  let testHome: string;
  let globalConfigPath: string;
  let projectDir: string;
  let localConfigPath: string;

  beforeEach(() => {
    // Create isolated test environment
    testHome = join(tmpdir(), `graphiti-test-${Date.now()}`);
    mkdirSync(testHome, { recursive: true });
    process.env.GRAPHITI_TEST_HOME = testHome;

    globalConfigPath = join(testHome, ".config", "opencode", "graphiti.jsonc");
    projectDir = join(testHome, "test-project");
    localConfigPath = join(projectDir, ".opencode", "graphiti.jsonc");

    // Reset config state
    resetConfig();

    // Clear env vars
    delete process.env.GRAPHITI_URL;
    delete process.env.GRAPHITI_GROUP_ID;
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    delete process.env.GRAPHITI_TEST_HOME;
    delete process.env.GRAPHITI_URL;
    delete process.env.GRAPHITI_GROUP_ID;
  });

  describe("ConfigState pattern", () => {
    test("initConfig returns unconfigured when no config exists", () => {
      const state = initConfig(projectDir);
      expect(state.status).toBe("unconfigured");
      if (state.status === "unconfigured") {
        expect(state.reason).toContain("graphitiUrl");
      }
    });

    test("isConfigReady returns false when unconfigured", () => {
      initConfig(projectDir);
      expect(isConfigReady()).toBe(false);
    });

    test("getConfig throws when not ready", () => {
      initConfig(projectDir);
      expect(() => getConfig()).toThrow();
    });

    test("resetConfig clears cached state", () => {
      // Set up valid config
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
        })
      );

      const state1 = initConfig(projectDir);
      expect(state1.status).toBe("ready");

      resetConfig();

      // After reset, should re-read config
      const state2 = initConfig(projectDir);
      expect(state2.status).toBe("ready");
    });
  });

  describe("global config loading", () => {
    test("loads from ~/.config/opencode/graphiti.jsonc", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "global-group",
          maxMemories: 10,
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
        expect(state.config.groupId).toBe("global-group");
        expect(state.config.maxMemories).toBe(10);
      }
    });

    test("handles JSONC comments", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        `{
          // This is a comment
          "graphitiUrl": "http://localhost:8000",
          "groupId": "test-group", // inline comment
          /* multi-line
             comment */
          "maxMemories": 5
        }`
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.maxMemories).toBe(5);
      }
    });

    test("handles invalid JSONC gracefully", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(globalConfigPath, "{ invalid json }");

      const state = initConfig(projectDir);
      expect(state.status).toBe("unconfigured");
    });
  });

  describe("local config override", () => {
    test("loads from {projectDir}/.opencode/graphiti.jsonc", () => {
      mkdirSync(join(projectDir, ".opencode"), { recursive: true });
      writeFileSync(
        localConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:9000",
          groupId: "local-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:9000/mcp/");
        expect(state.config.groupId).toBe("local-group");
      }
    });

    test("local overrides global for scalars", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "global-group",
          maxMemories: 10,
          injectProfile: true,
        })
      );

      mkdirSync(join(projectDir, ".opencode"), { recursive: true });
      writeFileSync(
        localConfigPath,
        JSON.stringify({
          maxMemories: 20,
          injectProfile: false,
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
        expect(state.config.groupId).toBe("global-group");
        expect(state.config.maxMemories).toBe(20); // local override
        expect(state.config.injectProfile).toBe(false); // local override
      }
    });

    test("keywordPatterns concatenates (default + global + local)", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
          keywordPatterns: ["global1", "global2"],
        })
      );

      mkdirSync(join(projectDir, ".opencode"), { recursive: true });
      writeFileSync(
        localConfigPath,
        JSON.stringify({
          keywordPatterns: ["local1", "local2"],
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        const patterns = state.config.keywordPatterns || [];
        // Should contain defaults + global + local (in order)
        expect(patterns).toContain("remember");
        expect(patterns).toContain("global1");
        expect(patterns).toContain("global2");
        expect(patterns).toContain("local1");
        expect(patterns).toContain("local2");
        // Check order: defaults first, then global, then local
        const rememberIdx = patterns.indexOf("remember");
        const global1Idx = patterns.indexOf("global1");
        const local1Idx = patterns.indexOf("local1");
        expect(rememberIdx).toBeLessThan(global1Idx);
        expect(global1Idx).toBeLessThan(local1Idx);
      }
    });
  });

  describe("environment variable precedence", () => {
    test("GRAPHITI_URL overrides all config files", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
        })
      );

      process.env.GRAPHITI_URL = "http://env-host:7000";

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://env-host:7000/mcp/");
      }
    });

    test("GRAPHITI_GROUP_ID overrides all config files", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "file-group",
        })
      );

      process.env.GRAPHITI_GROUP_ID = "env-group";

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.groupId).toBe("env-group");
      }
    });
  });

  describe("graphitiUrl normalization", () => {
    test("adds /mcp/ to bare URL", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
      }
    });

    test("adds /mcp/ to URL with trailing slash", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000/",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
      }
    });

    test("adds trailing slash to /mcp", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000/mcp",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
      }
    });

    test("preserves correct /mcp/ format", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000/mcp/",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.graphitiUrl).toBe("http://localhost:8000/mcp/");
      }
    });
  });

  describe("required fields validation", () => {
    test("missing graphitiUrl returns unconfigured", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("unconfigured");
      if (state.status === "unconfigured") {
        expect(state.reason).toContain("graphitiUrl");
      }
    });

    test("missing groupId returns unconfigured", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("unconfigured");
      if (state.status === "unconfigured") {
        expect(state.reason).toContain("groupId");
      }
    });

    test("both required fields present returns ready", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
    });
  });

  describe("default values", () => {
    test("applies defaults for optional fields", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.maxMemories).toBe(5);
        expect(state.config.maxProjectMemories).toBe(10);
        expect(state.config.maxProfileItems).toBe(5);
        expect(state.config.injectProfile).toBe(true);
        expect(state.config.compactionThreshold).toBe(0.8);
        expect(state.config.profileGroupId).toBe("test-group_profile");
        expect(state.config.keywordPatterns).toContain("remember");
      }
    });

    test("profileGroupId defaults to {groupId}_profile", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "my-group",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.profileGroupId).toBe("my-group_profile");
      }
    });

    test("custom profileGroupId overrides default", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "my-group",
          profileGroupId: "custom-profile",
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.profileGroupId).toBe("custom-profile");
      }
    });
  });

  describe("invalid regex patterns", () => {
    test("filters out invalid regex patterns", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
          keywordPatterns: ["valid", "[invalid", "also-valid"],
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        const patterns = state.config.keywordPatterns || [];
        expect(patterns).toContain("valid");
        expect(patterns).toContain("also-valid");
        expect(patterns).not.toContain("[invalid");
      }
    });
  });

  describe("compactionThreshold validation", () => {
    test("rejects values <= 0", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
          compactionThreshold: 0,
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.compactionThreshold).toBe(0.8); // default
      }
    });

    test("rejects values > 1", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
          compactionThreshold: 1.5,
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.compactionThreshold).toBe(0.8); // default
      }
    });

    test("accepts valid values (0 < x <= 1)", () => {
      mkdirSync(join(testHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          graphitiUrl: "http://localhost:8000",
          groupId: "test-group",
          compactionThreshold: 0.75,
        })
      );

      const state = initConfig(projectDir);
      expect(state.status).toBe("ready");
      if (state.status === "ready") {
        expect(state.config.compactionThreshold).toBe(0.75);
      }
    });
  });
});
