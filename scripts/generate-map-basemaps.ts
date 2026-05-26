import { existsSync } from "node:fs";
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
}

function parseCliArgs(argv: string[]): CliOptions {
  let mapId: string | undefined;
  let continueOnError = false;
  let force = false;
  let check = false;

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
      `Unknown argument '${arg}'. Supported flags: --id <map-id>, -id <map-id>, --continue-on-error, --force, --check.`,
    );
  }

  if (force && check) {
    throw new Error("--force and --check cannot be used together");
  }

  return { mapId, continueOnError, force, check };
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

  if (!cli.force && !cli.check) {
    console.log("[map-basemap] Mode: backfill (existing basemaps are skipped; use --force to regenerate)");
  }

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
      skippedExisting += 1;
      console.log(`[map-basemap] listing=${listingId}: ok (${basemapPath})`);
    }

    const checkFailures = missingGrid + missingBasemap;
    console.log(
      `[map-basemap] Summary: checked=${selectedMapIds.length}, ok=${skippedExisting}, missing_grid=${missingGrid}, missing_basemap=${missingBasemap}`,
    );
    if (checkFailures > 0) {
      throw new Error(`[map-basemap] Check failed: missing entries=${checkFailures}`);
    }
    return;
  }

  for (const listingId of selectedMapIds) {
    const basemapPath = getBasemapPath(repoRoot, listingId);
    if (!cli.force && existsSync(basemapPath)) {
      skipped += 1;
      skippedExisting += 1;
      console.log(`[map-basemap] listing=${listingId}: skipped (existing basemap at ${basemapPath})`);
      continue;
    }

    try {
      const result = await writeBasemapFromGridFile(repoRoot, listingId);
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
    `[map-basemap] Summary: written=${written}, failed=${failed}, skipped=${skipped}, skipped_existing=${skippedExisting}, missing_grid=${missingGrid}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
