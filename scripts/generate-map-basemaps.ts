import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getMapIds } from "./lib/map-demand-stats/repo.js";
import { getBasemapPath, MissingGridGeoJsonError, writeBasemapFromGridFile } from "./lib/map-basemap.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliOptions {
  mapId?: string;
  continueOnError: boolean;
  force: boolean;
  check: boolean;
  retries: number;
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

function parseCliArgs(argv: string[]): CliOptions {
  let mapId: string | undefined;
  let continueOnError = false;
  let force = false;
  let check = false;
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
      `Unknown argument '${arg}'. Supported flags: --id <map-id>, -id <map-id>, --continue-on-error, --force, --check, --retries <count>.`,
    );
  }

  if (force && check) {
    throw new Error("--force and --check cannot be used together");
  }

  return { mapId, continueOnError, force, check, retries };
}

async function run(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const mapIds = getMapIds(repoRoot);

  if (cli.mapId && !mapIds.includes(cli.mapId)) {
    throw new Error(`Map id '${cli.mapId}' was not found in maps/index.json`);
  }

  const selectedMapIds = cli.mapId ? [cli.mapId] : mapIds;
  let written = 0;
  let failed = 0;
  let skipped = 0;
  let skippedExisting = 0;
  let missingGrid = 0;
  let missingBasemap = 0;
  let staleBasemap = 0;
  let regeneratedStale = 0;

  if (!cli.force && !cli.check) {
    console.log("[map-basemap] Mode: backfill (up-to-date basemaps are skipped; stale/missing basemaps are generated; use --force to regenerate all)");
  }
  console.log(`[map-basemap] Retry policy: retries=${cli.retries}, maxAttempts=${cli.retries + 1}`);

  if (cli.check) {
    console.log("[map-basemap] Mode: check (no files will be written)");
    for (const listingId of selectedMapIds) {
      const basemapPath = getBasemapPath(repoRoot, listingId);
      const gridPath = resolve(repoRoot, "maps", listingId, "grid.geojson");
      const hasGrid = existsSync(gridPath);
      const hasBasemap = existsSync(basemapPath);

      if (!hasGrid) {
        missingGrid += 1;
        console.warn(`[map-basemap] listing=${listingId}: missing grid (${gridPath})`);
        continue;
      }
      if (!hasBasemap) {
        missingBasemap += 1;
        console.warn(`[map-basemap] listing=${listingId}: missing basemap (${basemapPath})`);
        continue;
      }

      if (isBasemapStale(gridPath, basemapPath)) {
        staleBasemap += 1;
        console.warn(`[map-basemap] listing=${listingId}: stale basemap (older than grid: ${basemapPath})`);
        continue;
      }

      skippedExisting += 1;
      console.log(`[map-basemap] listing=${listingId}: ok (${basemapPath})`);
    }

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cli.continueOnError) {
        if (error instanceof MissingGridGeoJsonError) {
          skipped += 1;
          missingGrid += 1;
          console.warn(`[map-basemap] listing=${listingId}: skipped (${message})`);
        } else {
          failed += 1;
          console.warn(`[map-basemap] listing=${listingId}: failed (${message})`);
        }
        continue;
      }
      throw new Error(`[map-basemap] listing=${listingId}: ${message}`);
    }
  }

  console.log(
    `[map-basemap] Summary: written=${written}, failed=${failed}, skipped=${skipped}, skipped_existing=${skippedExisting}, stale_detected=${staleBasemap}, stale_regenerated=${regeneratedStale}, missing_grid=${missingGrid}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
