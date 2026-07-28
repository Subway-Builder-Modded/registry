/**
 * One-time migration: makes `location` canonical (country-derived) on every
 * map manifest and retires the europe/sub_location compatibility bridge.
 *
 * For each maps/<id>/manifest.json:
 *   1. If `sub_location` is present, promote it to `location` and drop it.
 *   2. Normalize `location` to COUNTRY_TO_LOCATION[country], logging changes.
 *   3. Rebuild `tags` as [location, ...special_demand] (fixes stale tags).
 *
 * Nothing else is touched (last_updated, data_quality, etc.). Idempotent.
 *
 * Run with:  pnpm tsx scripts/migrate-location-cleanup.ts [--dry-run]
 *
 * Delete this script once the migration has landed on main.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COUNTRY_TO_LOCATION } from "@subway-builder-modded/registry-schemas";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

interface MapManifest {
  location: string;
  sub_location?: string;
  country: string;
  tags?: string[];
  special_demand?: string[];
  [key: string]: unknown;
}

function run(): void {
  const mapsDir = resolve(REPO_ROOT, "maps");
  const entries = readdirSync(mapsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let changed = 0;
  let failed = 0;

  for (const mapId of entries) {
    const manifestPath = resolve(mapsDir, mapId, "manifest.json");
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as MapManifest;
    const notes: string[] = [];

    const canonical = COUNTRY_TO_LOCATION[manifest.country];
    if (!canonical) {
      console.error(`  [FAIL] ${mapId}: country "${manifest.country}" has no location mapping`);
      failed++;
      continue;
    }

    if (manifest.sub_location !== undefined) {
      notes.push(`drop sub_location "${manifest.sub_location}"`);
      delete manifest.sub_location;
    }
    if (manifest.location !== canonical) {
      notes.push(`location "${manifest.location}" → "${canonical}"`);
      manifest.location = canonical;
    }

    const specialDemand = Array.isArray(manifest.special_demand) ? manifest.special_demand : [];
    const tags = Array.from(new Set([manifest.location, ...specialDemand]));
    if (JSON.stringify(manifest.tags) !== JSON.stringify(tags)) {
      notes.push(`tags ${JSON.stringify(manifest.tags)} → ${JSON.stringify(tags)}`);
      manifest.tags = tags;
    }

    if (notes.length === 0) continue;
    changed++;
    console.log(`  ${DRY_RUN ? "[dry-run] " : ""}${mapId} (${manifest.country}): ${notes.join("; ")}`);
    if (!DRY_RUN) {
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry-run] would change" : "Changed"} ${changed} of ${entries.length} manifest(s).` +
    (failed > 0 ? ` ${failed} FAILED (unmapped country).` : ""),
  );
  if (failed > 0) process.exit(1);
}

run();
