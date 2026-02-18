import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";

const _hashCache = new Map<string, string>();

function sanitizeNamespace(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getGitRemoteUrl(dirPath: string): string | null {
  try {
    return execSync("git remote get-url origin", {
      cwd: dirPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function normalizeGitRemoteUrl(url: string): string {
  let normalized = url.trim();

  normalized = normalized.replace(/^(https?|ssh):\/\//i, "");
  normalized = normalized.replace(/^[^@/]+@/, "");

  if (
    /^[^/]+:[^/]/.test(normalized) &&
    !/^[^/]+:\d+(?:\/|$)/.test(normalized)
  ) {
    normalized = normalized.replace(":", "/");
  }

  normalized = normalized.replace(/\.git$/i, "");
  normalized = normalized.replace(/\/+$/, "");

  return normalized.toLowerCase();
}

function getRelativePathFromGitRoot(dirPath: string): string {
  try {
    const prefix = execSync("git rev-parse --show-prefix", {
      cwd: dirPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");

    return prefix;
  } catch {
    return "";
  }
}

function getProjectHash(dirPath: string): string {
  const cachedHash = _hashCache.get(dirPath);
  if (cachedHash) {
    return cachedHash;
  }

  const remoteUrl = getGitRemoteUrl(dirPath);
  const hashInput = remoteUrl
    ? (() => {
        const normalizedUrl = normalizeGitRemoteUrl(remoteUrl);
        const relativePath = getRelativePathFromGitRoot(dirPath);
        return relativePath ? `${normalizedUrl}/${relativePath}` : normalizedUrl;
      })()
    : dirPath;

  const hash = createHash("sha256").update(hashInput).digest("hex").substring(0, 8);
  _hashCache.set(dirPath, hash);
  return hash;
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
  const dirHash = getProjectHash(projectDir);

  return `${config.groupId}_${dirHash}`;
}

export function getProfileNamespace(): string {
  const config = getConfig();
  return config.profileGroupId!;
}
