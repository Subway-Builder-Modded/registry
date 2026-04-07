import { appendFileSync } from "node:fs";
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

export async function runAndExitOnError(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
