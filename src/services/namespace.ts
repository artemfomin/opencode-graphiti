import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";

function sanitizeNamespace(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getDirectoryHash(dirPath: string): string {
  const hash = createHash("sha256").update(dirPath).digest("hex");
  return hash.substring(0, 8);
}

function extractProjectName(projectDir: string): string {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name && typeof pkg.name === "string" && pkg.name.trim()) {
        return pkg.name;
      }
    } catch {
      // Fall through to directory name
    }
  }

  return path.basename(projectDir);
}

export function getProjectNamespace(projectDir: string): string {
  const config = getConfig();
  const dirHash = getDirectoryHash(projectDir);

  return `${config.groupId}_${dirHash}`;
}

export function getProfileNamespace(): string {
  const config = getConfig();
  return config.profileGroupId!;
}
