/**
 * One-time migration: adds `sub_location` to all map manifests whose
 * `location` is "europe".  The new app reads `sub_location ?? location` so
 * old clients (≤0.2.3) continue to see `location: "europe"` unchanged.
 *
 * Run with:  pnpm tsx scripts/migrate-europe-sub-locations.ts [--dry-run]
 *
 * After all clients have migrated past 0.2.3, flip `location` to the
 * sub-region, drop `sub_location`, and remove this script.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COUNTRY_TO_EUROPE_SUB_REGION } from "./lib/map-constants.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

interface MapManifest {
  location: string;
  sub_location?: string;
  country?: string;
  [key: string]: unknown;
}

function getMapsDir(): string {
  return resolve(REPO_ROOT, "maps");
}

function run(): void {
  const mapsDir = getMapsDir();
  const entries = readdirSync(mapsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let migrated = 0;
  let skipped = 0;
  let unknown = 0;

  for (const mapId of entries) {
    const manifestPath = resolve(mapsDir, mapId, "manifest.json");
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as MapManifest;

    if (manifest.location !== "europe") {
      continue;
    }

    if (manifest.sub_location) {
      skipped++;
      continue;
    }

    const country = manifest.country;
    if (!country) {
      console.warn(`  [WARN] ${mapId}: no country field, skipping`);
      unknown++;
      continue;
    }

    const subRegion = COUNTRY_TO_EUROPE_SUB_REGION[country];
    if (!subRegion) {
      console.warn(`  [WARN] ${mapId}: unmapped country "${country}", skipping`);
      unknown++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] ${mapId} (${country}) → sub_location: "${subRegion}"`);
    } else {
      manifest.sub_location = subRegion;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
      console.log(`  ${mapId} (${country}) → sub_location: "${subRegion}"`);
    }
    migrated++;
  }

  console.log(
    `\n${DRY_RUN ? "[dry-run] would migrate" : "Migrated"} ${migrated} manifest(s).` +
    (skipped > 0 ? ` ${skipped} already had sub_location.` : "") +
    (unknown > 0 ? ` ${unknown} skipped (unknown country).` : ""),
  );
}

run();
