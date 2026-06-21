import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonFile } from "./lib/json-utils.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

// sync-last-updated copies the per-listing `last_updated` (newest release date,
// epoch seconds) computed by the downloads/integrity pipeline into each
// listing's manifest.last_updated, so clients can show "last updated" without
// resolving upstream releases. Mirrors sync-map-file-sizes, but covers both maps
// and mods.

interface ListingIntegrityEntry {
  last_updated?: unknown;
}

interface IntegrityOutput {
  schema_version?: unknown;
  listings?: unknown;
}

interface SyncLastUpdatedResult {
  processed: number;
  updated: number;
  withoutLastUpdated: number;
}

const ASSET_DIRS = ["maps", "mods"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function getListingIds(repoRoot: string, dir: string): string[] {
  const indexPath = resolve(repoRoot, dir, "index.json");
  const parsed = readJsonFile<Record<string, unknown>>(indexPath);
  const ids = parsed[dir];
  if (!Array.isArray(ids)) {
    throw new Error(`Invalid ${dir}/index.json at ${indexPath}: missing ${dir} array`);
  }
  return ids.filter((value): value is string => typeof value === "string");
}

function resolveLastUpdated(listing: ListingIntegrityEntry | undefined): number | undefined {
  const value = listing?.last_updated;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function syncLastUpdatedFromIntegrity(repoRoot: string): SyncLastUpdatedResult {
  let processed = 0;
  let updated = 0;
  let withoutLastUpdated = 0;

  for (const dir of ASSET_DIRS) {
    const integrityPath = resolve(repoRoot, dir, "integrity.json");
    const integrity = readJsonFile<IntegrityOutput>(integrityPath);
    if (integrity.schema_version !== 1 || !isObject(integrity.listings)) {
      throw new Error(`Invalid integrity snapshot at ${integrityPath}`);
    }
    const listings = integrity.listings as Record<string, ListingIntegrityEntry>;

    for (const id of getListingIds(repoRoot, dir).sort()) {
      processed += 1;
      const lastUpdated = resolveLastUpdated(listings[id]);
      if (lastUpdated === undefined) {
        withoutLastUpdated += 1;
        continue;
      }

      const manifestPath = resolve(repoRoot, dir, id, "manifest.json");
      const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
      if (manifest.last_updated === lastUpdated) continue;

      manifest.last_updated = lastUpdated;
      writeJsonFile(manifestPath, manifest);
      updated += 1;
    }
  }

  return { processed, updated, withoutLastUpdated };
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const result = syncLastUpdatedFromIntegrity(repoRoot);
  console.log(
    `[sync-last-updated] Summary: processed=${result.processed}, updated=${result.updated}, withoutLastUpdated=${result.withoutLastUpdated}`,
  );

  appendGitHubOutput([
    `last_updated_processed=${result.processed}`,
    `last_updated_updated=${result.updated}`,
    `last_updated_without=${result.withoutLastUpdated}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
