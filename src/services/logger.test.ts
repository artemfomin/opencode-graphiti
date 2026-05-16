import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { log, resetLogger } from "./logger.js";

const createdHomes: string[] = [];
let savedEnv: string | undefined;

function uniqueHome(name: string): string {
  const home = join(tmpdir(), `oc-graphiti-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  createdHomes.push(home);
  return home;
}

describe("logger", () => {
  beforeEach(() => {
    savedEnv = process.env.GRAPHITI_TEST_HOME;
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
    if (savedEnv === undefined) {
      delete process.env.GRAPHITI_TEST_HOME;
    } else {
      process.env.GRAPHITI_TEST_HOME = savedEnv;
    }

    for (const home of createdHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("creates or silently skips when the log parent directory is missing", () => {
    const home = uniqueHome("missing-parent");
    process.env.GRAPHITI_TEST_HOME = home;

    expect(() => log("missing parent test")).not.toThrow();
  });

  test("does not throw when the log directory disappears after initialization", () => {
    const home = uniqueHome("disappearing-parent");
    process.env.GRAPHITI_TEST_HOME = home;

    expect(() => log("initial write")).not.toThrow();
    rmSync(home, { recursive: true, force: true });

    expect(() => log("write after removal")).not.toThrow();
  });

  test("resetLogger recovers after a failed write path", () => {
    const brokenHome = uniqueHome("broken-parent");
    process.env.GRAPHITI_TEST_HOME = brokenHome;
    expect(() => log("broken path")).not.toThrow();

    resetLogger();
    const validHome = uniqueHome("valid-parent");
    process.env.GRAPHITI_TEST_HOME = validHome;

    expect(() => log("valid path")).not.toThrow();
    expect(existsSync(join(validHome, ".opencode-graphiti.log"))).toBe(true);
  });
});