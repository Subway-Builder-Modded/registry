/**
 * One-shot script: retroactively applies the manifest-version-mismatch
 * download clamp to all historical snapshots using proportional scaling.
 *
 * For each invalid version:
 *   scale = clamped_current / pre_clamp_current
 *   snapshot_clamped = floor(snapshot_downloads × scale)
 *
 * Also recalculates total_downloads and net_downloads per snapshot.
 *
 * Usage:
 *   cd scripts && npx tsx backfill-version-tag-clamp.ts
 */

import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { isObject, writeJsonFile } from "./lib/json-utils.js";

const repoRoot = resolve(import.meta.dirname, "..");

// Pre-clamp current values (from downloads.json before apply-version-tag-clamp.ts ran)
// and their clamped targets.
const clampEntries: { modId: string; version: string; preClamp: number; clamped: number }[] = [
  { modId: "any-money", version: "v0.1.0", preClamp: 40, clamped: 40 },
  { modId: "cinematic-camera", version: "v1.2.0", preClamp: 427, clamped: 226 },
  { modId: "citymapper", version: "0.1.2", preClamp: 1085, clamped: 264 },
  { modId: "danield1909-dantrains", version: "v1.0.1", preClamp: 57, clamped: 57 },
  { modId: "network-status", version: "v0.1.0", preClamp: 2, clamped: 2 },
  { modId: "network-status", version: "v0.1.1", preClamp: 254, clamped: 45 },
  { modId: "simple-trains", version: "v1.0.0", preClamp: 394, clamped: 122 },
  { modId: "valdotoriums-trains", version: "v0.1.3", preClamp: 892, clamped: 280 },
  { modId: "valdotoriums-trains", version: "v0.1.4", preClamp: 785, clamped: 186 },
  { modId: "valdotoriums-trains", version: "v0.1.5", preClamp: 199, clamped: 42 },
  { modId: "valdotoriums-trains", version: "v0.1.6", preClamp: 59, clamped: 8 },
];

// Filter to only versions that actually change
const activeEntries = clampEntries.filter((e) => e.preClamp !== e.clamped);
console.log(`${activeEntries.length} versions need scaling (${clampEntries.length - activeEntries.length} unchanged)\n`);

// Compute scale factors
const scaleFactors = new Map<string, number>();
for (const e of activeEntries) {
  scaleFactors.set(`${e.modId}:${e.version}`, e.clamped / e.preClamp);
}

// ── Process snapshots ──

const historyDir = resolve(repoRoot, "history");
const snapshotFiles = readdirSync(historyDir)
  .filter((f) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(f))
  .sort();

console.log(`Processing ${snapshotFiles.length} snapshot files...\n`);

interface SnapshotTotals {
  file: string;
  totalDownloads: number;
}

const snapshotTotals: SnapshotTotals[] = [];
let totalAdjusted = 0;

for (const file of snapshotFiles) {
  const filePath = resolve(historyDir, file);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;

  if (!isObject(snapshot) || !isObject((snapshot as Record<string, unknown>).mods)) {
    console.error(`[warn] skipping ${file}: unexpected structure`);
    continue;
  }

  const mods = (snapshot as { mods: Record<string, unknown> }).mods;
  const downloads = mods.downloads as Record<string, Record<string, number>> | undefined;

  if (!isObject(downloads)) {
    snapshotTotals.push({ file, totalDownloads: 0 });
    continue;
  }

  let modified = false;

  for (const { modId, version } of activeEntries) {
    const scale = scaleFactors.get(`${modId}:${version}`)!;
    const current = downloads[modId]?.[version];
    if (current === undefined || current === null) continue;

    const scaled = Math.floor(current * scale);
    if (scaled !== current) {
      downloads[modId]![version] = scaled;
      totalAdjusted++;
      modified = true;
    }
  }

  // Recalculate total_downloads
  let newTotal = 0;
  for (const versions of Object.values(downloads)) {
    if (!isObject(versions)) continue;
    for (const count of Object.values(versions as Record<string, number>)) {
      if (typeof count === "number" && Number.isFinite(count)) {
        newTotal += count;
      }
    }
  }

  mods.total_downloads = newTotal;
  snapshotTotals.push({ file, totalDownloads: newTotal });

  if (modified) {
    writeJsonFile(filePath, snapshot);
  }
}

// ── Recalculate net_downloads across consecutive snapshots ──

let netRecalculated = 0;
for (let i = 0; i < snapshotFiles.length; i++) {
  const filePath = resolve(historyDir, snapshotFiles[i]!);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const mods = snapshot.mods as Record<string, unknown>;

  if (i === 0) {
    // First snapshot: net_downloads = total_downloads (no previous)
    if (typeof mods.net_downloads === "number") {
      mods.net_downloads = snapshotTotals[i]!.totalDownloads;
      writeJsonFile(filePath, snapshot);
      netRecalculated++;
    }
  } else {
    const prevTotal = snapshotTotals[i - 1]!.totalDownloads;
    const currTotal = snapshotTotals[i]!.totalDownloads;
    const newNet = currTotal - prevTotal;
    if (typeof mods.net_downloads === "number" && mods.net_downloads !== newNet) {
      mods.net_downloads = newNet;
      writeJsonFile(filePath, snapshot);
      netRecalculated++;
    }
  }
}

console.log(`Done: ${totalAdjusted} version entries scaled across ${snapshotFiles.length} snapshots`);
console.log(`Recalculated net_downloads in ${netRecalculated} snapshots`);
