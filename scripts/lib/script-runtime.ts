import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export function resolveRepoRoot(importMetaDir: string): string {
  return basename(importMetaDir) === "dist"
    ? resolve(importMetaDir, "..", "..")
    : resolve(importMetaDir, "..");
}

export function getNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function appendGitHubOutput(lines: string[]): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function stripWrappedQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadLocalDotEnv(repoRoot: string, fileName = ".env"): void {
  const envPath = resolve(repoRoot, fileName);
  if (!existsSync(envPath)) {
    return;
  }

  const source = readFileSync(envPath, "utf-8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key === "" || process.env[key] !== undefined) {
      continue;
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = stripWrappedQuotes(rawValue);
  }
}

export async function runAndExitOnError(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
