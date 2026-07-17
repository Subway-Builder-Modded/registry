/**
 * One-shot script: re-applies the Apr 2026 config-version-mismatch download
 * clamp to historical map snapshots — this time to BOTH `downloads` (adjusted)
 * and `raw_downloads`, so the clamp survives ledger-based snapshot rebuilds.
 *
 * Background: backfill-map-version-clamp.ts (Apr 11, 2026) scaled only the
 * adjusted `downloads` values for Apr 7-10, leaving inflated `raw_downloads`
 * in place. The May 24 attribution backfill (451fb5d6d) rebuilt every snapshot
 * as `adjusted = raw − attribution-at-cutoff`, which resurrected the spike.
 * Stored raw is the ground truth for all rebuilds, so this script writes
 * `new_raw = new_adjusted + (old_raw − old_adjusted)`, preserving each
 * version's per-snapshot attributed count.
 *
 * Scaling formula (identical to backfill-map-version-clamp.ts):
 *   deltaScale = (clamped − apr6Baseline) / (preClamp − apr6Baseline)
 *   scaled = apr6Baseline + floor((current − apr6Baseline) × deltaScale)
 *   (current >= preClamp → exact `clamped` to avoid floor off-by-one)
 *
 * Later attribution backfills shifted some versions' rebuilt adjusted series a
 * few counts above the table's historical apr6Baseline/preClamp (bucharest-medium,
 * piedmont-triad, wilmington-nc). The scale endpoints are therefore derived from
 * the CURRENT snapshots — baseline from Apr 6, peak from Apr 10 — while the
 * table's `clamped` targets are kept (they match the stable Apr 11+ grandfather
 * plateaus exactly). The table baseline/preClamp serve as a sanity cross-check.
 *
 * Safety:
 *   - Dry-run by default; pass --apply to write.
 *   - Per-entry precondition on the Apr 10 (peak) snapshot: adjusted must be
 *     >= the table preClamp (unclamped state). Entries at or below `clamped`
 *     are skipped as done; anything in between aborts the run. This makes
 *     accidental double runs no-ops instead of double-scaling.
 *   - Does NOT touch maps/download-version-buckets.json or
 *     maps/grandfathered-downloads.json (verified as still correct; the
 *     original script's bucket capping would now damage legitimate
 *     post-re-upload buckets, e.g. anchorage-ak/1.0.0). Both are only checked
 *     and reported.
 *
 * Usage:
 *   cd scripts && npx tsx reapply-map-version-clamp-raw.ts          # dry run
 *   cd scripts && npx tsx reapply-map-version-clamp-raw.ts --apply
 */

import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { isObject, writeJsonFile } from "./lib/json-utils.js";
import {
  normalizeDownloadHistorySnapshot,
  type DownloadHistorySnapshot,
} from "./lib/download-history-core.js";

const repoRoot = resolve(import.meta.dirname, "..");
const apply = process.argv.includes("--apply");

// Per-version clamp table, copied verbatim from backfill-map-version-clamp.ts:
//   apr6Baseline: adjusted count in the Apr 6 snapshot (last clean date)
//   preClamp: adjusted count at Apr 10 (peak spike, before any clamping)
//   clamped: target cap = apr6Baseline + floor((preClamp − apr6Baseline) × 0.2864)
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

const FIRST_SPIKE_DATE = "2026-04-07";
const LAST_SPIKE_DATE = "2026-04-10";
const BASELINE_SNAPSHOT_FILE = "snapshot_2026_04_06.json";
const PEAK_SNAPSHOT_FILE = "snapshot_2026_04_10.json";

// Max tolerated drift between the table's historical baseline/peak and the
// current snapshot values (attribution backfills shift the series slightly).
const MAX_ENDPOINT_DRIFT = 12;

type VersionCounts = Record<string, Record<string, number>>;

interface SnapshotSection {
  downloads?: VersionCounts;
  raw_downloads?: VersionCounts;
  total_downloads?: number;
  raw_total_downloads?: number;
  net_downloads?: number;
  [key: string]: unknown;
}

function sumVersionCounts(counts: VersionCounts | undefined): number {
  if (!isObject(counts)) return 0;
  let total = 0;
  for (const versions of Object.values(counts)) {
    if (!isObject(versions)) continue;
    for (const count of Object.values(versions)) {
      if (typeof count === "number" && Number.isFinite(count)) total += count;
    }
  }
  return total;
}

const historyDir = resolve(repoRoot, "history");
const snapshotFiles = readdirSync(historyDir)
  .filter((f) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(f))
  .sort();

// ── Precondition: classify each entry from the current Apr 6/Apr 10 snapshots ──

function readSnapshotDownloads(fileName: string): VersionCounts {
  const parsed = JSON.parse(readFileSync(resolve(historyDir, fileName), "utf-8")) as Record<string, unknown>;
  const downloads = (parsed.maps as SnapshotSection | undefined)?.downloads;
  if (!isObject(downloads)) {
    throw new Error(`${fileName} has no maps.downloads section`);
  }
  return downloads;
}

const baselineDownloads = readSnapshotDownloads(BASELINE_SNAPSHOT_FILE);
const peakDownloads = readSnapshotDownloads(PEAK_SNAPSHOT_FILE);

interface ActiveEntry {
  mapId: string;
  version: string;
  effBaseline: number;
  effPeak: number;
  clamped: number;
  deltaScale: number;
}

const activeEntries: ActiveEntry[] = [];
for (const entry of clampEntries) {
  if (entry.preClamp === entry.clamped) continue; // nothing to scale
  const { mapId, version, clamped } = entry;
  const peakValue = peakDownloads[mapId]?.[version];
  if (typeof peakValue !== "number") {
    throw new Error(`${mapId}/${version}: missing from ${PEAK_SNAPSHOT_FILE}`);
  }
  if (peakValue <= clamped) {
    console.log(`[skip] ${mapId}/${version}: peak snapshot value ${peakValue} already at/below clamped ${clamped}`);
    continue;
  }
  if (peakValue < entry.preClamp) {
    throw new Error(
      `${mapId}/${version}: peak snapshot value ${peakValue} is between clamped (${clamped}) and `
      + `preClamp (${entry.preClamp}); refusing to scale from an ambiguous state`,
    );
  }
  const effBaseline = baselineDownloads[mapId]?.[version] ?? entry.apr6Baseline;
  if (Math.abs(effBaseline - entry.apr6Baseline) > MAX_ENDPOINT_DRIFT
    || Math.abs(peakValue - entry.preClamp) > MAX_ENDPOINT_DRIFT) {
    throw new Error(
      `${mapId}/${version}: current endpoints (baseline ${effBaseline}, peak ${peakValue}) drift more than `
      + `${MAX_ENDPOINT_DRIFT} from table (${entry.apr6Baseline}, ${entry.preClamp}); review before scaling`,
    );
  }
  if (clamped < effBaseline) {
    throw new Error(`${mapId}/${version}: clamped target ${clamped} below current baseline ${effBaseline}`);
  }
  const denom = peakValue - effBaseline;
  activeEntries.push({
    mapId,
    version,
    effBaseline,
    effPeak: peakValue,
    clamped,
    deltaScale: denom > 0 ? (clamped - effBaseline) / denom : 0,
  });
}

console.log(`\n${activeEntries.length} versions to scale (mode: ${apply ? "APPLY" : "dry-run"})\n`);

// ── Pass 1: scale adjusted + raw in the Apr 7-10 snapshots ──

interface SnapshotTotals {
  file: string;
  mapsTotal: number;
  mapsRawTotal: number;
  modsTotal: number;
  modsRawTotal: number;
}

const snapshotTotals: SnapshotTotals[] = [];
let versionEntriesScaled = 0;

for (const file of snapshotFiles) {
  const snapshotDate = file.slice("snapshot_".length, -".json".length).replace(/_/g, "-");
  const filePath = resolve(historyDir, file);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const maps = snapshot.maps as SnapshotSection | undefined;
  const mods = snapshot.mods as SnapshotSection | undefined;
  if (!isObject(maps) || !isObject(maps.downloads)) {
    snapshotTotals.push({ file, mapsTotal: 0, mapsRawTotal: 0, modsTotal: sumVersionCounts(mods?.downloads), modsRawTotal: sumVersionCounts(mods?.raw_downloads) });
    continue;
  }

  const downloads = maps.downloads;
  const rawDownloads = maps.raw_downloads;
  const shouldScale = snapshotDate >= FIRST_SPIKE_DATE && snapshotDate <= LAST_SPIKE_DATE;
  let modified = false;

  if (shouldScale) {
    for (const { mapId, version, effBaseline, effPeak, clamped, deltaScale } of activeEntries) {
      const currentAdj = downloads[mapId]?.[version];
      if (typeof currentAdj !== "number") continue;
      const currentRaw = rawDownloads?.[mapId]?.[version];
      const attributed = typeof currentRaw === "number" ? currentRaw - currentAdj : null;
      if (attributed !== null && attributed < 0) {
        throw new Error(`${file}: ${mapId}/${version} raw (${currentRaw}) < adjusted (${currentAdj})`);
      }

      const scaledAdj = currentAdj >= effPeak
        ? clamped
        : currentAdj <= effBaseline
          ? currentAdj
          : effBaseline + Math.floor((currentAdj - effBaseline) * deltaScale);
      if (scaledAdj === currentAdj) continue;

      const scaledRaw = attributed !== null ? scaledAdj + attributed : null;
      console.log(
        `  ${file}: ${mapId}/${version} adj ${currentAdj} → ${scaledAdj}`
        + (scaledRaw !== null ? `, raw ${currentRaw} → ${scaledRaw}` : ", raw: (absent)"),
      );
      downloads[mapId]![version] = scaledAdj;
      if (scaledRaw !== null) rawDownloads![mapId]![version] = scaledRaw;
      versionEntriesScaled++;
      modified = true;
    }
  }

  const totals: SnapshotTotals = {
    file,
    mapsTotal: sumVersionCounts(downloads),
    mapsRawTotal: sumVersionCounts(rawDownloads),
    modsTotal: sumVersionCounts(mods?.downloads),
    modsRawTotal: sumVersionCounts(mods?.raw_downloads),
  };
  snapshotTotals.push(totals);

  if (modified && apply) {
    writeJsonFile(filePath, snapshot);
  }
}

// ── Pass 2: recalculate totals and net_downloads within the incident window ──
// Totals only change for Apr 7-10, so nets can only change for Apr 7-11. Writes
// are scoped to that window so pre-existing totals drift elsewhere (e.g. the
// mods section of snapshot_2026_06_08.json is off by 35 vs its version sums)
// is not silently rewritten by this incident fix.

const TOTALS_WINDOW_FIRST = "2026-04-07";
const TOTALS_WINDOW_LAST = "2026-04-11";
let totalsRecalculated = 0;

for (let i = 0; i < snapshotFiles.length; i++) {
  const snapshotDate = snapshotFiles[i]!.slice("snapshot_".length, -".json".length).replace(/_/g, "-");
  if (snapshotDate < TOTALS_WINDOW_FIRST || snapshotDate > TOTALS_WINDOW_LAST) continue;
  const filePath = resolve(historyDir, snapshotFiles[i]!);
  const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const maps = snapshot.maps as SnapshotSection | undefined;
  if (!isObject(maps)) continue;
  const totals = snapshotTotals[i]!;
  const prev = i === 0 ? null : snapshotTotals[i - 1]!;

  const newTopTotal = totals.mapsTotal + totals.modsTotal;
  const newTopRawTotal = totals.mapsRawTotal + totals.modsRawTotal;
  const newMapsNet = totals.mapsTotal - (prev ? prev.mapsTotal : 0);
  const newTopNet = newTopTotal - (prev ? prev.mapsTotal + prev.modsTotal : 0);

  const changes: string[] = [];
  const applyField = (obj: Record<string, unknown>, field: string, value: number, label: string) => {
    if (obj[field] !== value) {
      changes.push(`${label} ${obj[field]} → ${value}`);
      obj[field] = value;
    }
  };
  applyField(maps, "total_downloads", totals.mapsTotal, "maps.total");
  applyField(maps, "raw_total_downloads", totals.mapsRawTotal, "maps.raw_total");
  applyField(maps, "net_downloads", newMapsNet, "maps.net");
  applyField(snapshot, "total_downloads", newTopTotal, "total");
  applyField(snapshot, "raw_total_downloads", newTopRawTotal, "raw_total");
  applyField(snapshot, "net_downloads", newTopNet, "net");

  if (changes.length > 0) {
    totalsRecalculated++;
    console.log(`  ${snapshotFiles[i]}: ${changes.join(", ")}`);
    if (apply) writeJsonFile(filePath, snapshot);
  }
}

// ── Pass 3: rebuild-exactness correction ──
// A future ledger-based snapshot rebuild recomputes adjusted = stored raw −
// ledger-attribution-at-cutoff. Where the ledger's view of a version's
// attribution differs from what the snapshot's raw−adjusted gap implies (e.g.
// bucharest-medium is off by 1), the clamp would drift on rebuild. Run the real
// normalization in memory and correct stored raw so the rebuild reproduces the
// clamped adjusted values exactly. Scoped to the clamped versions in the scaled
// window; runs even when pass 1 had nothing to scale, so a re-run converges.

console.log(`\nRebuild-exactness correction (scaled window, clamped versions only)...`);
const clampedVersionSet = new Set(clampEntries.map((e) => `${e.mapId}:${e.version}`));
let rawCorrections = 0;

for (let iteration = 0; iteration < 3; iteration++) {
  let iterationChanges = 0;
  for (const file of snapshotFiles) {
    const snapshotDate = file.slice("snapshot_".length, -".json".length).replace(/_/g, "-");
    if (snapshotDate < FIRST_SPIKE_DATE || snapshotDate > LAST_SPIKE_DATE) continue;
    const filePath = resolve(historyDir, file);
    const snapshot = JSON.parse(readFileSync(filePath, "utf-8")) as DownloadHistorySnapshot;
    const warnings: string[] = [];
    const rebuilt = normalizeDownloadHistorySnapshot({
      repoRoot,
      snapshot,
      previousSnapshot: null,
      warnings,
      fileName: file,
    });

    let rawDelta = 0;
    const snap = snapshot as unknown as { maps: SnapshotSection };
    for (const key of clampedVersionSet) {
      const [mapId, version] = key.split(":") as [string, string];
      const storedAdj = snap.maps.downloads?.[mapId]?.[version];
      const storedRaw = snap.maps.raw_downloads?.[mapId]?.[version];
      const rebuiltAdj = rebuilt.maps.downloads[mapId]?.[version];
      if (typeof storedAdj !== "number" || typeof storedRaw !== "number" || typeof rebuiltAdj !== "number") continue;
      if (rebuiltAdj === storedAdj) continue;
      const correctedRaw = storedRaw - (rebuiltAdj - storedAdj);
      if (correctedRaw < storedAdj) {
        console.warn(`  [warn] ${file} ${mapId}/${version}: corrected raw ${correctedRaw} < adjusted ${storedAdj}; skipping`);
        continue;
      }
      console.log(`  ${file}: ${mapId}/${version} raw ${storedRaw} → ${correctedRaw} (rebuild gave adj ${rebuiltAdj}, want ${storedAdj})`);
      snap.maps.raw_downloads![mapId]![version] = correctedRaw;
      rawDelta += correctedRaw - storedRaw;
      iterationChanges++;
      rawCorrections++;
    }

    if (rawDelta !== 0) {
      const maps = snap.maps as Record<string, unknown>;
      maps.raw_total_downloads = (maps.raw_total_downloads as number) + rawDelta;
      (snapshot as unknown as Record<string, unknown>).raw_total_downloads = ((snapshot as unknown as Record<string, unknown>).raw_total_downloads as number) + rawDelta;
      if (apply) writeJsonFile(filePath, snapshot);
    }
  }
  if (iterationChanges === 0) break;
  if (!apply) break; // dry-run cannot converge on disk; report first-pass findings only
}
console.log(`  ${rawCorrections} raw correction(s)${apply ? "" : " planned"}`);

// ── Verify (read-only): buckets and grandfathered caps still hold ──

console.log(`\nVerifying maps/download-version-buckets.json and maps/grandfathered-downloads.json (read-only)...`);
const bucketsData = JSON.parse(
  readFileSync(resolve(repoRoot, "maps", "download-version-buckets.json"), "utf-8"),
) as { listings?: Record<string, { versions?: Record<string, { max_total_downloads?: number }> }> };
const grandfathered = JSON.parse(
  readFileSync(resolve(repoRoot, "maps", "grandfathered-downloads.json"), "utf-8"),
) as Record<string, Record<string, number>>;

for (const { mapId, version, clamped } of clampEntries) {
  const gf = grandfathered[mapId]?.[version];
  if (gf !== clamped) {
    console.warn(`  [warn] grandfathered ${mapId}/${version} = ${gf}, expected ${clamped}`);
  }
}
console.log(`  grandfathered caps checked (${clampEntries.length} entries)`);
for (const { mapId, version } of clampEntries) {
  const maxTotal = bucketsData.listings?.[mapId]?.versions?.[version]?.max_total_downloads;
  if (maxTotal === undefined) {
    console.warn(`  [warn] bucket entry missing for ${mapId}/${version}`);
  }
}
console.log(`  bucket entries present; ceilings left untouched by design`);

console.log(`\n── Summary (${apply ? "APPLIED" : "dry-run — no files written"}) ──`);
console.log(`${versionEntriesScaled} version×snapshot entries scaled (adjusted + raw)`);
console.log(`${totalsRecalculated} snapshots with totals/net recalculated`);
