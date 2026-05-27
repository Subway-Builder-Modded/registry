import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getMapIds } from "./lib/map-demand-stats/repo.js";
import { getBasemapPath, MissingGridGeoJsonError, writeBasemapFromGridFile } from "./lib/map-basemap.js";
import { isObject, readJsonFile, writeJsonFile } from "./lib/json-utils.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliOptions {
  mapId?: string;
  continueOnError: boolean;
  force: boolean;
  check: boolean;
  populateCompletenessOnly: boolean;
  retries: number;
}

interface IntegrityListingVersionMeta {
  version: string | null;
  fingerprint: string | null;
  eligible: boolean;
}

interface BasemapCompletenessListingEntry {
  listing_id: string;
  version: string | null;
  fingerprint: string | null;
  basemap_complete: boolean;
  checked_at: string;
  reason: string;
}

interface BasemapCompletenessFile {
  schema_version: 1;
  generated_at: string;
  by_fingerprint: Record<string, boolean>;
  listings: Record<string, BasemapCompletenessListingEntry>;
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: '${value}'. Expected a non-negative integer.`);
  }
  return parsed;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function isBasemapStale(gridPath: string, basemapPath: string): boolean {
  const gridMtimeMs = statSync(gridPath).mtimeMs;
  const basemapMtimeMs = statSync(basemapPath).mtimeMs;
  return basemapMtimeMs < gridMtimeMs;
}

function getBasemapCompletenessPath(repoRoot: string): string {
  return resolve(repoRoot, "maps", "basemap-completeness.json");
}

function loadIntegrityListingMeta(repoRoot: string): Record<string, IntegrityListingVersionMeta> {
  const integrityPath = resolve(repoRoot, "maps", "integrity.json");
  if (!existsSync(integrityPath)) {
    return {};
  }

  try {
    const parsed = readJsonFile<unknown>(integrityPath);
    if (!isObject(parsed) || !isObject(parsed.listings)) {
      return {};
    }

    const result: Record<string, IntegrityListingVersionMeta> = {};
    for (const [listingId, listingValue] of Object.entries(parsed.listings)) {
      if (!isObject(listingValue)) continue;
      const latestVersion = typeof listingValue.latest_semver_version === "string"
        ? listingValue.latest_semver_version
        : null;
      const latestSemverComplete = listingValue.latest_semver_complete === true;
      const versions = isObject(listingValue.versions) ? listingValue.versions : null;
      const versionEntry = latestVersion && versions && isObject(versions[latestVersion])
        ? versions[latestVersion]
        : null;
      const fingerprint = versionEntry && typeof versionEntry.fingerprint === "string"
        ? versionEntry.fingerprint
        : null;
      const versionIsComplete = versionEntry?.is_complete === true;

      result[listingId] = {
        version: latestVersion,
        fingerprint,
        eligible: latestSemverComplete && versionIsComplete,
      };
    }

    return result;
  } catch {
    return {};
  }
}

function loadBasemapCompletenessFile(repoRoot: string): BasemapCompletenessFile {
  const path = getBasemapCompletenessPath(repoRoot);
  if (!existsSync(path)) {
    return {
      schema_version: 1,
      generated_at: new Date(0).toISOString(),
      by_fingerprint: {},
      listings: {},
    };
  }

  try {
    const parsed = readJsonFile<unknown>(path);
    if (!isObject(parsed) || parsed.schema_version !== 1) {
      throw new Error("invalid schema");
    }
    const byFingerprint = isObject(parsed.by_fingerprint)
      ? Object.fromEntries(Object.entries(parsed.by_fingerprint).filter(([, value]) => typeof value === "boolean"))
      : {};
    const listings = isObject(parsed.listings)
      ? Object.fromEntries(Object.entries(parsed.listings).filter(([, value]) => isObject(value))) as Record<string, BasemapCompletenessListingEntry>
      : {};

    return {
      schema_version: 1,
      generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : new Date(0).toISOString(),
      by_fingerprint: byFingerprint,
      listings,
    };
  } catch {
    return {
      schema_version: 1,
      generated_at: new Date(0).toISOString(),
      by_fingerprint: {},
      listings: {},
    };
  }
}

function writeBasemapCompletenessFile(
  repoRoot: string,
  integrityMeta: Record<string, IntegrityListingVersionMeta>,
  updates: Record<string, { basemap_complete: boolean; reason: string; checked_at: string }>,
): void {
  if (Object.keys(updates).length === 0) {
    return;
  }

  const existing = loadBasemapCompletenessFile(repoRoot);

  for (const [listingId, update] of Object.entries(updates)) {
    const meta = integrityMeta[listingId] ?? { version: null, fingerprint: null, eligible: false };

    if (update.reason === "integrity_incomplete") {
      const existingFingerprint = existing.listings[listingId]?.fingerprint;
      delete existing.listings[listingId];

      if (meta.fingerprint) {
        delete existing.by_fingerprint[meta.fingerprint];
      }
      if (existingFingerprint && existingFingerprint !== meta.fingerprint) {
        delete existing.by_fingerprint[existingFingerprint];
      }
      continue;
    }

    existing.listings[listingId] = {
      listing_id: listingId,
      version: meta.version,
      fingerprint: meta.fingerprint,
      basemap_complete: update.basemap_complete,
      checked_at: update.checked_at,
      reason: update.reason,
    };

    if (meta.fingerprint) {
      existing.by_fingerprint[meta.fingerprint] = update.basemap_complete;
    }
  }

  existing.generated_at = new Date().toISOString();
  writeJsonFile(getBasemapCompletenessPath(repoRoot), existing);
}

function parseCliArgs(argv: string[]): CliOptions {
  let mapId: string | undefined;
  let continueOnError = false;
  let force = false;
  let check = false;
  let populateCompletenessOnly = false;
  let retries = 3;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--continue-on-error") {
      continueOnError = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--populate-completeness-only") {
      populateCompletenessOnly = true;
      continue;
    }
    if (arg === "--retries") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing retries value after '${arg}'`);
      }
      retries = parsePositiveInteger(value.trim(), "--retries");
      index += 1;
      continue;
    }
    if (arg.startsWith("--retries=")) {
      const value = arg.slice(arg.indexOf("=") + 1).trim();
      if (value === "") {
        throw new Error(`Missing retries value in '${arg}'`);
      }
      retries = parsePositiveInteger(value, "--retries");
      continue;
    }
    if (arg === "--id" || arg === "-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing map id value after '${arg}'`);
      }
      mapId = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--id=") || arg.startsWith("-id=")) {
      const value = arg.slice(arg.indexOf("=") + 1).trim();
      if (value === "") {
        throw new Error(`Missing map id value in '${arg}'`);
      }
      mapId = value;
      continue;
    }
    throw new Error(
      `Unknown argument '${arg}'. Supported flags: --id <map-id>, -id <map-id>, --continue-on-error, --force, --check, --populate-completeness-only, --retries <count>.`,
    );
  }

  if (force && check) {
    throw new Error("--force and --check cannot be used together");
  }
  if (populateCompletenessOnly && (force || check)) {
    throw new Error("--populate-completeness-only cannot be combined with --force or --check");
  }

  return { mapId, continueOnError, force, check, populateCompletenessOnly, retries };
}

function isListingEligibleForBasemap(
  integrityMeta: Record<string, IntegrityListingVersionMeta>,
  listingId: string,
): boolean {
  return integrityMeta[listingId]?.eligible === true;
}

async function run(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const mapIds = getMapIds(repoRoot);

  if (cli.mapId && !mapIds.includes(cli.mapId)) {
    throw new Error(`Map id '${cli.mapId}' was not found in maps/index.json`);
  }

  const selectedMapIds = cli.mapId ? [cli.mapId] : mapIds;
  const integrityMeta = loadIntegrityListingMeta(repoRoot);
  const completenessUpdates: Record<string, { basemap_complete: boolean; reason: string; checked_at: string }> = {};
  let written = 0;
  let failed = 0;
  let skipped = 0;
  let skippedExisting = 0;
  let missingGrid = 0;
  let missingBasemap = 0;
  let staleBasemap = 0;
  let regeneratedStale = 0;

  if (!cli.force && !cli.check && !cli.populateCompletenessOnly) {
    console.log("[map-basemap] Mode: backfill (up-to-date basemaps are skipped; stale/missing basemaps are generated; use --force to regenerate all)");
  }
  if (cli.populateCompletenessOnly) {
    console.log("[map-basemap] Mode: populate-completeness-only (no basemap generation)");
  }
  console.log(`[map-basemap] Retry policy: retries=${cli.retries}, maxAttempts=${cli.retries + 1}`);

  if (cli.populateCompletenessOnly) {
    let complete = 0;
    for (const listingId of selectedMapIds) {
      if (!isListingEligibleForBasemap(integrityMeta, listingId)) {
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "integrity_incomplete",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      const basemapPath = getBasemapPath(repoRoot, listingId);
      const gridPath = resolve(repoRoot, "maps", listingId, "grid.geojson");
      const hasGrid = existsSync(gridPath);
      const hasBasemap = existsSync(basemapPath);

      if (!hasGrid) {
        missingGrid += 1;
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "missing_grid",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      if (!hasBasemap) {
        missingBasemap += 1;
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "missing_basemap",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      if (isBasemapStale(gridPath, basemapPath)) {
        staleBasemap += 1;
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "stale_basemap",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      complete += 1;
      completenessUpdates[listingId] = {
        basemap_complete: true,
        reason: "ok",
        checked_at: new Date().toISOString(),
      };
    }

    writeBasemapCompletenessFile(repoRoot, integrityMeta, completenessUpdates);
    console.log(
      `[map-basemap] Summary: populated=${selectedMapIds.length}, complete=${complete}, missing_grid=${missingGrid}, missing_basemap=${missingBasemap}, stale_basemap=${staleBasemap}`,
    );
    return;
  }

  if (cli.check) {
    console.log("[map-basemap] Mode: check (no files will be written)");
    for (const listingId of selectedMapIds) {
      if (!isListingEligibleForBasemap(integrityMeta, listingId)) {
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "integrity_incomplete",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      const basemapPath = getBasemapPath(repoRoot, listingId);
      const gridPath = resolve(repoRoot, "maps", listingId, "grid.geojson");
      const hasGrid = existsSync(gridPath);
      const hasBasemap = existsSync(basemapPath);

      if (!hasGrid) {
        missingGrid += 1;
        console.warn(`[map-basemap] listing=${listingId}: missing grid (${gridPath})`);
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "missing_grid",
          checked_at: new Date().toISOString(),
        };
        continue;
      }
      if (!hasBasemap) {
        missingBasemap += 1;
        console.warn(`[map-basemap] listing=${listingId}: missing basemap (${basemapPath})`);
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "missing_basemap",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      if (isBasemapStale(gridPath, basemapPath)) {
        staleBasemap += 1;
        console.warn(`[map-basemap] listing=${listingId}: stale basemap (older than grid: ${basemapPath})`);
        completenessUpdates[listingId] = {
          basemap_complete: false,
          reason: "stale_basemap",
          checked_at: new Date().toISOString(),
        };
        continue;
      }

      skippedExisting += 1;
      console.log(`[map-basemap] listing=${listingId}: ok (${basemapPath})`);
      completenessUpdates[listingId] = {
        basemap_complete: true,
        reason: "ok",
        checked_at: new Date().toISOString(),
      };
    }

    writeBasemapCompletenessFile(repoRoot, integrityMeta, completenessUpdates);

    const checkFailures = missingGrid + missingBasemap + staleBasemap;
    console.log(
      `[map-basemap] Summary: checked=${selectedMapIds.length}, ok=${skippedExisting}, missing_grid=${missingGrid}, missing_basemap=${missingBasemap}, stale_basemap=${staleBasemap}`,
    );
    if (checkFailures > 0) {
      throw new Error(`[map-basemap] Check failed: missing entries=${checkFailures}`);
    }
    return;
  }

  for (const listingId of selectedMapIds) {
    if (!isListingEligibleForBasemap(integrityMeta, listingId)) {
      skipped += 1;
      completenessUpdates[listingId] = {
        basemap_complete: false,
        reason: "integrity_incomplete",
        checked_at: new Date().toISOString(),
      };
      console.log(`[map-basemap] listing=${listingId}: skipped (latest semver version is not integrity-complete)`);
      continue;
    }

    const basemapPath = getBasemapPath(repoRoot, listingId);
    const gridPath = resolve(repoRoot, "maps", listingId, "grid.geojson");
    if (!cli.force && existsSync(basemapPath)) {
      if (existsSync(gridPath) && isBasemapStale(gridPath, basemapPath)) {
        staleBasemap += 1;
        regeneratedStale += 1;
        console.log(`[map-basemap] listing=${listingId}: stale basemap detected, regenerating (${basemapPath})`);
      } else {
        skipped += 1;
        skippedExisting += 1;
        console.log(`[map-basemap] listing=${listingId}: skipped (existing basemap at ${basemapPath})`);
        completenessUpdates[listingId] = {
          basemap_complete: true,
          reason: "skipped_existing",
          checked_at: new Date().toISOString(),
        };
        continue;
      }
    }

    try {
      let result: Awaited<ReturnType<typeof writeBasemapFromGridFile>> | null = null;
      let lastError: unknown;
      const maxAttempts = cli.retries + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          result = await writeBasemapFromGridFile(repoRoot, listingId);
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof MissingGridGeoJsonError) {
            throw error;
          }
          if (attempt >= maxAttempts) {
            throw error;
          }
          const nextAttempt = attempt + 1;
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[map-basemap] listing=${listingId}: attempt ${attempt}/${maxAttempts} failed (${message}); retrying attempt ${nextAttempt}/${maxAttempts}`,
          );
          await waitMs(1000 * attempt);
        }
      }

      if (!result) {
        throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
      }

      written += 1;
      console.log(`[map-basemap] listing=${listingId}: wrote ${result.outputPath} roads=${result.roadCount}`);
      completenessUpdates[listingId] = {
        basemap_complete: true,
        reason: "generated",
        checked_at: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cli.continueOnError) {
        if (error instanceof MissingGridGeoJsonError) {
          skipped += 1;
          missingGrid += 1;
          console.warn(`[map-basemap] listing=${listingId}: skipped (${message})`);
          completenessUpdates[listingId] = {
            basemap_complete: false,
            reason: "missing_grid",
            checked_at: new Date().toISOString(),
          };
        } else {
          failed += 1;
          console.warn(`[map-basemap] listing=${listingId}: failed (${message})`);
          completenessUpdates[listingId] = {
            basemap_complete: false,
            reason: "generation_failed",
            checked_at: new Date().toISOString(),
          };
        }
        continue;
      }
      throw new Error(`[map-basemap] listing=${listingId}: ${message}`);
    }
  }

  writeBasemapCompletenessFile(repoRoot, integrityMeta, completenessUpdates);

  console.log(
    `[map-basemap] Summary: written=${written}, failed=${failed}, skipped=${skipped}, skipped_existing=${skippedExisting}, stale_detected=${staleBasemap}, stale_regenerated=${regeneratedStale}, missing_grid=${missingGrid}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
