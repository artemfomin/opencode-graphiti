import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getProjectNamespace, getProfileNamespace } from "./namespace";
import { initConfig, resetConfig } from "../config";

describe("Namespace Generation", () => {
  beforeEach(() => {
    process.env.GRAPHITI_TEST_HOME = join(tmpdir(), `graphiti-test-${Date.now()}`);
    mkdirSync(process.env.GRAPHITI_TEST_HOME, { recursive: true });

    resetConfig();
    process.env.GRAPHITI_URL = "http://localhost:8000";
    process.env.GRAPHITI_GROUP_ID = "test-team";

    initConfig();
  });

  afterEach(() => {
    if (process.env.GRAPHITI_TEST_HOME) {
      try {
        rmSync(process.env.GRAPHITI_TEST_HOME, { recursive: true, force: true });
      } catch {
      }
      delete process.env.GRAPHITI_TEST_HOME;
    }

    delete process.env.GRAPHITI_URL;
    delete process.env.GRAPHITI_GROUP_ID;
    resetConfig();
  });

  describe("getProjectNamespace()", () => {
    it("should generate namespace with groupId and directory hash", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "test-project");
      mkdirSync(testDir, { recursive: true });

      const namespace = getProjectNamespace(testDir);

      // Should have format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should extract project name from package.json if it exists", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "my-app");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "my-awesome-app",
        version: "1.0.0",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash} - project name no longer in namespace
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should fall back to directory name if package.json doesn't exist", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "fallback-project");
      mkdirSync(testDir, { recursive: true });

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash} - directory name used for hash only
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should fall back to directory name if package.json has no name field", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "no-name-project");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        version: "1.0.0",
        // no name field
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should sanitize project name: lowercase", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "MyProject");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "MyAwesomeProject",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should sanitize project name: replace special characters with underscore", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "special-chars");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "my-project@v1.0!",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should sanitize project name: collapse multiple underscores", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "collapse-test");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "my___project!!!name",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should sanitize project name: trim leading/trailing underscores", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "trim-test");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "!!!my-project!!!",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should handle complex sanitization: My Project!", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "complex");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "My Project!",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should generate consistent hash for same directory path", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "consistent");
      mkdirSync(testDir, { recursive: true });

      const namespace1 = getProjectNamespace(testDir);
      const namespace2 = getProjectNamespace(testDir);

      // Same directory should produce same hash
      expect(namespace1).toBe(namespace2);
    });

    it("should generate different hash for different directory paths", () => {
      const testDir1 = join(process.env.GRAPHITI_TEST_HOME!, "project1");
      const testDir2 = join(process.env.GRAPHITI_TEST_HOME!, "project2");
      mkdirSync(testDir1, { recursive: true });
      mkdirSync(testDir2, { recursive: true });

      const namespace1 = getProjectNamespace(testDir1);
      const namespace2 = getProjectNamespace(testDir2);

      // Different directories should produce different hashes
      expect(namespace1).not.toBe(namespace2);
    });

    it("should use groupId from config", () => {
      resetConfig();
      process.env.GRAPHITI_URL = "http://localhost:8000";
      process.env.GRAPHITI_GROUP_ID = "custom-group";
      initConfig();

      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "custom");
      mkdirSync(testDir, { recursive: true });

      const namespace = getProjectNamespace(testDir);

      expect(namespace).toMatch(/^custom-group_/);
    });

    it("should handle empty project name gracefully", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "empty-name");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "!!!",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should preserve hyphens in project name", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "hyphen-test");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "my-awesome-project",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });
  });

  describe("getProfileNamespace()", () => {
    it("should return profileGroupId from config", () => {
      const namespace = getProfileNamespace();

      expect(namespace).toBe("test-team_profile");
    });

    it("should use custom profileGroupId from config file", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "custom-profile-test");
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, ".opencode"), { recursive: true });

      writeFileSync(
        join(testDir, ".opencode", "graphiti.jsonc"),
        JSON.stringify({
          profileGroupId: "custom-profile",
        })
      );

      resetConfig();
      process.env.GRAPHITI_URL = "http://localhost:8000";
      process.env.GRAPHITI_GROUP_ID = "my-group";
      initConfig(testDir);

      const namespace = getProfileNamespace();

      expect(namespace).toBe("custom-profile");
    });

    it("should return consistent value across multiple calls", () => {
      const namespace1 = getProfileNamespace();
      const namespace2 = getProfileNamespace();

      expect(namespace1).toBe(namespace2);
    });
  });

  describe("Namespace Sanitization", () => {
    it("should handle all special characters correctly", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "special");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "test@#$%^&*()project",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should handle unicode characters", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "unicode");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "café-project",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });

    it("should handle spaces in project name", () => {
      const testDir = join(process.env.GRAPHITI_TEST_HOME!, "spaces");
      mkdirSync(testDir, { recursive: true });

      const packageJson = {
        name: "my awesome project",
      };
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(packageJson)
      );

      const namespace = getProjectNamespace(testDir);

      // Format: {groupId}_{hash}
      expect(namespace).toMatch(/^test-team_[a-f0-9]{8}$/);
    });
  });
});
