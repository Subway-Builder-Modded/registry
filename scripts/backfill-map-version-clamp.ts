/**
 * One-shot script: retroactively applies the config-version-mismatch
 * download clamp to historical map snapshots using proportional scaling.
 *
 * Maps affected had inflated download counts from Apr 7–10, 2026 due to
 * a bug where the app repeatedly re-downloaded maps with mismatched config
 * version strings (config.json reports an older version than the release tag).
 *
 * Strategy:
 *   - Apr 6 is the clean baseline (last snapshot before the spike started)
 *   - Apr 7–10 snapshots are scaled using a per-version delta scale:
 *       deltaScale = (clamped − apr6Baseline) / (preClamp − apr6Baseline)
 *       snapshot_clamped = apr6Baseline + floor((snapshot_downloads − apr6Baseline) × deltaScale)
 *     This scales the growth above baseline rather than the total, so days with modest
 *     early-spike counts are not collapsed to zero by the max(baseline, …) floor.
 *     The formula exactly reaches clamped when snapshot_downloads = preClamp (Apr 10).
 *   - Apr 11+ snapshots already carry the grandfathered cap values from the live pipeline;
 *     their per-version counts are left untouched, but net_downloads is recalculated.
 *   - Apr 6 and earlier snapshots are left unchanged
 *
 * The mods haircut ratio used to compute clamped values:
 *   DELTA_HAIRCUT_RATIO = 0.2864  (= 1173/4095, weighted average across mods clamp)
 *   clamped = apr6Baseline + floor((preClamp - apr6Baseline) × DELTA_HAIRCUT_RATIO)
 *
 * Recalculates maps.total_downloads, maps.net_downloads, and top-level
 * total_downloads, net_downloads per snapshot.
 *
 * Also caps version bucket ceilings in maps/download-version-buckets.json.
 *
 * Precondition: run against pre-grandfathering (b8760b3) snapshot data.
 *
 * Usage:
 *   cd scripts && npx tsx backfill-map-version-clamp.ts
 */

import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { isObject, writeJsonFile } from "./lib/json-utils.js";

const repoRoot = resolve(import.meta.dirname, "..");

// The ratio by which the spike delta is credited (mods haircut ratio = 1173/4095)
const DELTA_HAIRCUT_RATIO = 0.2864;

// Per-version clamp data:
//   apr6Baseline: raw download count in the Apr 6 snapshot (last clean date)
//   preClamp: download count at Apr 10 (peak spike, before any clamping)
//   clamped: target cap = apr6Baseline + floor((preClamp - apr6Baseline) × DELTA_HAIRCUT_RATIO)
const clampEntries: {
  mapId: string;
  version: string;
  apr6Baseline: number;
  preClamp: number;
  clamped: number;
}[] = [
  { mapId: "anchorage-ak", version: "1.0.0", apr6Baseline: 29, preClamp: 119, clamped: 54 },
  { mapId: "barcelona", version: "1.0.1", apr6Baseline: 185, preClamp: 579, clamped: 297 },
  { mapId: "bilbao", version: "1.0.1", apr6Baseline: 58, preClamp: 185, clamped: 94 },
  { mapId: "bucharest-medium", version: "v1.1.1", apr6Baseline: 96, preClamp: 222, clamped: 132 },
  { mapId: "charleston-huntington-wv", version: "1.0.0", apr6Baseline: 0, preClamp: 20, clamped: 5 },
  { mapId: "dayton-oh", version: "1.0.0", apr6Baseline: 18, preClamp: 19, clamped: 18 },
  { mapId: "jerusalem", version: "v0.3.1", apr6Baseline: 101, preClamp: 154, clamped: 116 },
  { mapId: "madrid", version: "1.0.1", apr6Baseline: 159, preClamp: 517, clamped: 261 },
  { mapId: "piedmont-triad", version: "v1.0.0", apr6Baseline: 37, preClamp: 81, clamped: 49 },
  { mapId: "pyongyang-nk", version: "1.0.0", apr6Baseline: 13, preClamp: 77, clamped: 31 },
  { mapId: "spokane", version: "2.0.0", apr6Baseline: 1, preClamp: 1, clamped: 1 },
  { mapId: "valencia", version: "1.0.1", apr6Baseline: 53, preClamp: 201, clamped: 95 },
  { mapId: "waterloo", version: "1.0.1", apr6Baseline: 77, preClamp: 81, clamped: 78 },
  { mapId: "wilmington-nc", version: "v1.0.0", apr6Baseline: 27, preClamp: 60, clamped: 36 },
];

// Only scale snapshots within this window (spike ran Apr 7–10; Apr 11+ already grandfathered)
const FIRST_SPIKE_DATE = "2026-04-07";
const LAST_SPIKE_DATE = "2026-04-10";

// Timestamp to apply to modified version bucket entries
const CLAMP_TIMESTAMP = "2026-04-11T00:00:00.000Z";

// Filter to only versions that actually change
const activeEntries = clampEntries.filter((e) => e.preClamp !== e.clamped);
console.log(
  `${activeEntries.length} versions need scaling (${clampEntries.length - activeEntries.length} unchanged)\n`,
);

// deltaScale = (clamped − baseline) / (preClamp − baseline)
// When preClamp === baseline the version had no real delta; deltaScale = 0 keeps it flat.
// When current >= preClamp the result is clamped directly (avoids floor rounding off-by-one).
const deltaScales = new Map<string, number>();
const apr6Baselines = new Map<string, number>();
const clampedValues = new Map<string, number>();
const preClampValues = new Map<string, number>();
for (const e of activeEntries) {
  const key = `${e.mapId}:${e.version}`;
  const denom = e.preClamp - e.apr6Baseline;
  deltaScales.set(key, denom > 0 ? (e.clamped - e.apr6Baseline) / denom : 0);
  apr6Baselines.set(key, e.apr6Baseline);
  clampedValues.set(key, e.clamped);
  preClampValues.set(key, e.preClamp);
}

// ── Process history snapshots ──

const historyDir = resolve(repoRoot, "history");
const snapshotFiles = readdirSync(historyDir)
  .filter((f) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(f))
  .sort();

console.log(`Processing ${snapshotFiles.length} snapshot files...\n`);

interface SnapshotTotals {
  file: string;
  mapsTotalDownloads: number;
  modsTotalDownloads: number;
}

const snapshotTotals: SnapshotTotals[] = [];
let totalVersionsAdjusted = 0;

for (const file of snapshotFiles) {
  const dateMatch = file.match(/^snapshot_(\d{4}_\d{2}_\d{2})\.json$/);
  if (!dateMatch) continue;
  const snapshotDate = dateMatch[1]!.replace(/_/g, "-"); // YYYY-MM-DD

  const filePath = resolve(historyDir, file);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;

  if (!isObject(snapshot) || !isObject((snapshot as Record<string, unknown>).maps)) {
    console.error(`[warn] skipping ${file}: unexpected structure`);
    continue;
  }

  const snap = snapshot as Record<string, unknown>;
  const maps = snap.maps as Record<string, unknown>;
  const mods = snap.mods as Record<string, unknown> | undefined;
  const downloads = maps.downloads as Record<string, Record<string, number>> | undefined;

  // Compute current mods total for top-level recalculation
  let modsTotalDownloads = 0;
  if (isObject(mods) && isObject(mods.downloads)) {
    for (const versions of Object.values(mods.downloads as Record<string, Record<string, number>>)) {
      if (!isObject(versions)) continue;
      for (const count of Object.values(versions as Record<string, number>)) {
        if (typeof count === "number" && Number.isFinite(count)) modsTotalDownloads += count;
      }
    }
  }

  if (!isObject(downloads)) {
    snapshotTotals.push({ file, mapsTotalDownloads: 0, modsTotalDownloads });
    continue;
  }

  // Apply delta scaling only for Apr 7–10; Apr 11+ already carry grandfathered values
  const shouldScale = snapshotDate >= FIRST_SPIKE_DATE && snapshotDate <= LAST_SPIKE_DATE;
  let modified = false;

  if (shouldScale) {
    for (const { mapId, version } of activeEntries) {
      const key = `${mapId}:${version}`;
      const deltaScale = deltaScales.get(key)!;
      const apr6 = apr6Baselines.get(key)!;
      const preClamp = preClampValues.get(key)!;
      const clamped = clampedValues.get(key)!;
      const current = downloads[mapId]?.[version];
      if (current === undefined || current === null) continue;

      // If current >= preClamp use the exact cap to avoid floor rounding off-by-one
      const scaled = current >= preClamp ? clamped : apr6 + Math.floor((current - apr6) * deltaScale);
      if (scaled !== current) {
        downloads[mapId]![version] = scaled;
        totalVersionsAdjusted++;
        modified = true;
        console.log(`  ${file}: ${mapId}/${version} ${current} → ${scaled}`);
      }
    }
  }

  // Recalculate maps.total_downloads from all version counts
  let newMapsTotal = 0;
  for (const versions of Object.values(downloads)) {
    if (!isObject(versions)) continue;
    for (const count of Object.values(versions as Record<string, number>)) {
      if (typeof count === "number" && Number.isFinite(count)) newMapsTotal += count;
    }
  }

  maps.total_downloads = newMapsTotal;
  snapshotTotals.push({ file, mapsTotalDownloads: newMapsTotal, modsTotalDownloads });

  if (modified) {
    writeJsonFile(filePath, snapshot);
  }
}

// ── Recalculate net_downloads and top-level totals across all snapshots ──

console.log(`\nRecalculating net_downloads and top-level totals...`);
let netRecalculated = 0;

for (let i = 0; i < snapshotFiles.length; i++) {
  const filePath = resolve(historyDir, snapshotFiles[i]!);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const maps = snapshot.maps as Record<string, unknown>;
  const totals = snapshotTotals[i]!;
  const newMapsTotal = totals.mapsTotalDownloads;
  const newTopTotal = newMapsTotal + totals.modsTotalDownloads;

  const prevMapsTotal = i === 0 ? 0 : snapshotTotals[i - 1]!.mapsTotalDownloads;
  const prevTopTotal = i === 0
    ? 0
    : snapshotTotals[i - 1]!.mapsTotalDownloads + snapshotTotals[i - 1]!.modsTotalDownloads;

  const newMapsNet = newMapsTotal - prevMapsTotal;
  const newTopNet = newTopTotal - prevTopTotal;

  let changed = false;
  if (maps.total_downloads !== newMapsTotal) { maps.total_downloads = newMapsTotal; changed = true; }
  if (maps.net_downloads !== newMapsNet) { maps.net_downloads = newMapsNet; changed = true; }
  if (snapshot.total_downloads !== newTopTotal) { snapshot.total_downloads = newTopTotal; changed = true; }
  if (snapshot.net_downloads !== newTopNet) { snapshot.net_downloads = newTopNet; changed = true; }

  if (changed) {
    writeJsonFile(filePath, snapshot);
    netRecalculated++;
  }
}

// ── Update download-version-buckets.json ──

console.log(`\nUpdating version bucket ceilings...`);

const bucketsPath = resolve(repoRoot, "maps", "download-version-buckets.json");
const bucketsData = JSON.parse(readFileSync(bucketsPath, "utf-8")) as Record<string, unknown>;
const listings = bucketsData.listings as Record<string, unknown>;

let bucketsUpdated = 0;

for (const { mapId, version, clamped } of activeEntries) {
  if (clamped === clampEntries.find((e) => e.mapId === mapId && e.version === version)?.preClamp) {
    continue; // unchanged
  }

  const listing = listings[mapId] as Record<string, unknown> | undefined;
  if (!isObject(listing)) continue;
  const versions = listing.versions as Record<string, Record<string, unknown>> | undefined;
  if (!isObject(versions)) continue;
  const vData = versions[version] as Record<string, unknown> | undefined;
  if (!isObject(vData)) continue;

  const oldTotal = vData.max_total_downloads as number;
  vData.max_total_downloads = clamped;
  vData.updated_at = CLAMP_TIMESTAMP;

  // Find the primary bucket (highest max_adjusted_downloads) and cap it
  const buckets = vData.buckets as Record<string, Record<string, unknown>> | undefined;
  if (isObject(buckets)) {
    let primaryKey: string | null = null;
    let primaryMax = -1;
    for (const [bKey, bData] of Object.entries(buckets)) {
      const bMax = bData.max_adjusted_downloads as number;
      if (typeof bMax === "number" && bMax > primaryMax) {
        primaryMax = bMax;
        primaryKey = bKey;
      }
    }
    if (primaryKey !== null) {
      const primaryBucket = buckets[primaryKey]!;
      primaryBucket.max_adjusted_downloads = clamped;
      primaryBucket.last_adjusted_downloads = Math.min(
        clamped,
        primaryBucket.last_adjusted_downloads as number ?? clamped,
      );
      primaryBucket.updated_at = CLAMP_TIMESTAMP;
    }
  }

  console.log(`  ${mapId}/${version}: max_total ${oldTotal} → ${clamped}`);
  bucketsUpdated++;
}

writeJsonFile(bucketsPath, bucketsData);

// ── Update grandfathered-downloads.json ──

console.log(`\nUpdating grandfathered-downloads.json...`);

const grandfatheredPath = resolve(repoRoot, "maps", "grandfathered-downloads.json");
const grandfathered = JSON.parse(readFileSync(grandfatheredPath, "utf-8")) as Record<
  string,
  Record<string, number>
>;

for (const { mapId, version, clamped } of clampEntries) {
  if (!grandfathered[mapId]) grandfathered[mapId] = {};
  grandfathered[mapId]![version] = clamped;
}

writeJsonFile(grandfatheredPath, grandfathered);

console.log(`\n── Summary ──`);
console.log(`${totalVersionsAdjusted} version×snapshot entries scaled`);
console.log(`${netRecalculated} snapshots had net_downloads/totals recalculated`);
console.log(`${bucketsUpdated} version bucket ceilings updated`);
console.log(`grandfathered-downloads.json updated with ${clampEntries.length} entries`);
