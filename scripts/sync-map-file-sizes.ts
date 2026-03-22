import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface IntegrityVersionEntry {
  is_complete?: unknown;
  file_sizes?: unknown;
}

interface ListingIntegrityEntry {
  complete_versions?: unknown;
  versions?: unknown;
}

interface IntegrityOutput {
  schema_version?: unknown;
  listings?: unknown;
}

interface SyncMapFileSizesResult {
  processedMaps: number;
  updatedMaps: number;
  mapsWithoutCompleteVersion: number;
  mapsWithMissingFileSizes: number;
}

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function sortNumericRecord(value: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

function normalizeFileSizes(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  const normalized: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      normalized[key] = raw;
    }
  }
  return sortNumericRecord(normalized);
}

function getMapIds(repoRoot: string): string[] {
  const indexPath = resolve(repoRoot, "maps", "index.json");
  const parsed = readJsonFile<{ maps?: unknown }>(indexPath);
  if (!Array.isArray(parsed.maps)) {
    throw new Error(`Invalid maps/index.json at ${indexPath}: missing maps array`);
  }
  return parsed.maps.filter((value): value is string => typeof value === "string");
}

function resolveLatestCompleteFileSizes(
  listing: ListingIntegrityEntry | undefined,
): {
  fileSizes: Record<string, number>;
  hasCompleteVersion: boolean;
  missingFileSizes: boolean;
} {
  if (!listing) {
    return { fileSizes: {}, hasCompleteVersion: false, missingFileSizes: false };
  }
  const completeVersions = Array.isArray(listing.complete_versions)
    ? listing.complete_versions.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
  if (completeVersions.length === 0) {
    return { fileSizes: {}, hasCompleteVersion: false, missingFileSizes: false };
  }

  const latestVersion = completeVersions[0];
  const versionsMap = isObject(listing.versions) ? listing.versions : {};
  const versionEntryRaw = versionsMap[latestVersion];
  if (!isObject(versionEntryRaw)) {
    return { fileSizes: {}, hasCompleteVersion: true, missingFileSizes: true };
  }
  const versionEntry = versionEntryRaw as IntegrityVersionEntry;
  if (versionEntry.is_complete !== true) {
    return { fileSizes: {}, hasCompleteVersion: true, missingFileSizes: true };
  }

  const normalized = normalizeFileSizes(versionEntry.file_sizes);
  if (Object.keys(normalized).length === 0) {
    return { fileSizes: {}, hasCompleteVersion: true, missingFileSizes: true };
  }
  return { fileSizes: normalized, hasCompleteVersion: true, missingFileSizes: false };
}

export function syncMapFileSizesFromIntegrity(
  repoRoot: string,
): SyncMapFileSizesResult {
  const integrityPath = resolve(repoRoot, "maps", "integrity.json");
  const integrity = readJsonFile<IntegrityOutput>(integrityPath);
  if (integrity.schema_version !== 1 || !isObject(integrity.listings)) {
    throw new Error(`Invalid integrity snapshot at ${integrityPath}`);
  }

  const listings = integrity.listings as Record<string, ListingIntegrityEntry>;
  const ids = getMapIds(repoRoot).sort();
  let updatedMaps = 0;
  let mapsWithoutCompleteVersion = 0;
  let mapsWithMissingFileSizes = 0;

  for (const id of ids) {
    const manifestPath = resolve(repoRoot, "maps", id, "manifest.json");
    const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
    const currentFileSizes = normalizeFileSizes(manifest.file_sizes);
    const resolved = resolveLatestCompleteFileSizes(listings[id]);

    if (!resolved.hasCompleteVersion) {
      mapsWithoutCompleteVersion += 1;
    }
    if (resolved.missingFileSizes) {
      mapsWithMissingFileSizes += 1;
      console.warn(`[sync-map-file-sizes] listing=${id}: latest complete version is missing file_sizes in integrity data`);
    }

    const nextFileSizes = resolved.fileSizes;
    if (JSON.stringify(currentFileSizes) !== JSON.stringify(nextFileSizes)) {
      manifest.file_sizes = nextFileSizes;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
      updatedMaps += 1;
    }
  }

  return {
    processedMaps: ids.length,
    updatedMaps,
    mapsWithoutCompleteVersion,
    mapsWithMissingFileSizes,
  };
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const result = syncMapFileSizesFromIntegrity(repoRoot);
  console.log(
    `[sync-map-file-sizes] Summary: processedMaps=${result.processedMaps}, updatedMaps=${result.updatedMaps}, mapsWithoutCompleteVersion=${result.mapsWithoutCompleteVersion}, mapsWithMissingFileSizes=${result.mapsWithMissingFileSizes}`,
  );

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `map_file_sizes_processed=${result.processedMaps}\n`
      + `map_file_sizes_updated=${result.updatedMaps}\n`
      + `map_file_sizes_without_complete=${result.mapsWithoutCompleteVersion}\n`
      + `map_file_sizes_missing_in_integrity=${result.mapsWithMissingFileSizes}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
