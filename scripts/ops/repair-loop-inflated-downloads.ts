import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  recordDownloadAttributionFetchByAssetKey,
  toDownloadAttributionAssetKey,
  writeDownloadAttributionLedger,
  type DownloadAttributionDelta,
} from "../lib/download-attribution.js";
import {
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
} from "../lib/download-version-buckets.js";
import {
  computeBaselineDailyRate,
  computeDaySpuriousEstimates,
  computeSnapshotClampPlan,
  extractTargetSeries,
  loopRepairDeltaId,
  normalizeLoopRepairSpec,
  type LoopRepairSpec,
  type LoopRepairTarget,
  type SnapshotFileLike,
} from "../lib/loop-download-repair.js";
import { getFlagValue, hasFlag } from "../lib/cli.js";
import { isObject, readJsonFile } from "../lib/json-utils.js";
import { resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// Repairs download counts inflated by a client re-download loop (spec-driven; see
// scripts/lib/loop-download-repair.ts for the estimation model). Re-runnable while
// the incident is ongoing: per-day delta ids make the ledger merge idempotent, and
// the snapshot/bucket corrections are min()-guarded. Runbook:
//
//   pnpm --dir scripts run repair-loop-inflated-downloads -- \
//     --spec history/loop-repair-specs/<spec>.json [--apply]
//
// Preview (no --apply) prints per-day estimates without touching anything. After an
// --apply run: run reconcile-attributed-downloads (needs GH token) so downloads.json
// is re-derived from raw − attributed, and let the daily cache-download-history run
// regenerate the analytics CSVs from the clamped snapshots. Once the causing bug is
// fixed and its release has saturated, set spec.incident_end to close the window.
// After any attribution-ledger rebuild, re-apply this spec like the ones in
// history/manual-attribution-specs/ (ops/README.md).

interface CliArgs {
  repoRoot: string;
  specPath: string;
  apply: boolean;
}

interface MapIntegrityVersionSource {
  repo?: string;
  tag?: string;
  asset_name?: string;
}

interface SnapshotEntry {
  dateKey: string;
  fileName: string;
  data: SnapshotFileLike & { maps?: MutableSection; mods?: MutableSection; total_downloads?: number };
}

interface MutableSection {
  downloads?: Record<string, Record<string, number>>;
  raw_downloads?: Record<string, Record<string, number>>;
  total_downloads?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const specValue = getFlagValue(argv, "spec");
  if (!specValue || specValue.trim() === "") {
    throw new Error("Missing --spec <path>.");
  }
  return {
    repoRoot,
    specPath: resolve(repoRoot, specValue.trim()),
    apply: hasFlag(argv, "apply"),
  };
}

function loadSnapshots(repoRoot: string): SnapshotEntry[] {
  const historyDir = resolve(repoRoot, "history");
  return readdirSync(historyDir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .sort()
    .map((fileName) => ({
      fileName,
      dateKey: fileName.slice(9, 19).replaceAll("_", "-"),
      data: JSON.parse(readFileSync(resolve(historyDir, fileName), "utf-8")) as SnapshotEntry["data"],
    }));
}

// Resolves a target's release asset key the same way the manual-attribution path
// does (scripts/ops/create-manual-download-attribution.ts).
function createAssetKeyResolver(repoRoot: string): (target: LoopRepairTarget) => string {
  const mapsPath = resolve(repoRoot, "maps", "integrity.json");
  const modsPath = resolve(repoRoot, "mods", "integrity-cache.json");

  return (target: LoopRepairTarget): string => {
    let source: MapIntegrityVersionSource | undefined;
    if (target.listing_type === "map") {
      const integrity = readJsonFile<{
        listings?: Record<string, { versions?: Record<string, { source?: MapIntegrityVersionSource }> }>;
      }>(mapsPath);
      source = integrity.listings?.[target.listing_id]?.versions?.[target.version]?.source;
    } else {
      const cache = readJsonFile<{
        entries?: Record<string, Record<string, { result?: { source?: MapIntegrityVersionSource } }>>;
      }>(modsPath);
      source = cache.entries?.[target.listing_id]?.[target.version]?.result?.source;
    }
    if (!source?.repo || !source?.tag || !source?.asset_name) {
      throw new Error(`Could not resolve asset key for ${target.listing_type} ${target.listing_id}@${target.version}.`);
    }
    return toDownloadAttributionAssetKey(source.repo, source.tag, source.asset_name);
  };
}

function clampSnapshotValue(
  snapshot: SnapshotEntry,
  target: LoopRepairTarget,
  correctedValue: number,
): number {
  const section = target.listing_type === "map" ? snapshot.data.maps : snapshot.data.mods;
  const byVersion = section?.downloads?.[target.listing_id];
  if (!isObject(byVersion)) return 0;
  const original = byVersion[target.version];
  if (typeof original !== "number" || original <= correctedValue) return 0;

  const reduction = original - correctedValue;
  byVersion[target.version] = correctedValue;
  if (typeof section?.total_downloads === "number") {
    section.total_downloads -= reduction;
  }
  if (typeof snapshot.data.total_downloads === "number") {
    snapshot.data.total_downloads -= reduction;
  }
  return reduction;
}

function lowerVersionBucketCeiling(
  ledger: ReturnType<typeof loadDownloadVersionBucketLedger>,
  target: LoopRepairTarget,
  correctedValue: number,
  nowIso: string,
): boolean {
  const version = ledger.listings?.[target.listing_id]?.versions?.[target.version];
  if (!version) return false;
  let changed = false;
  if (typeof version.max_total_downloads === "number" && version.max_total_downloads > correctedValue) {
    version.max_total_downloads = correctedValue;
    changed = true;
  }
  for (const bucket of Object.values(version.buckets ?? {})) {
    if (typeof bucket.max_adjusted_downloads === "number" && bucket.max_adjusted_downloads > correctedValue) {
      bucket.max_adjusted_downloads = correctedValue;
      bucket.updated_at = nowIso;
      changed = true;
    }
    if (typeof bucket.last_adjusted_downloads === "number" && bucket.last_adjusted_downloads > correctedValue) {
      bucket.last_adjusted_downloads = correctedValue;
      bucket.updated_at = nowIso;
      changed = true;
    }
  }
  if (changed) {
    version.updated_at = nowIso;
  }
  return changed;
}

function lowerDownloadsJsonValue(
  repoRoot: string,
  target: LoopRepairTarget,
  correctedValue: number,
): boolean {
  const path = resolve(
    repoRoot,
    target.listing_type === "map" ? "maps" : "mods",
    "downloads.json",
  );
  if (!existsSync(path)) return false;
  const downloads = JSON.parse(readFileSync(path, "utf-8")) as Record<string, Record<string, number>>;
  const byVersion = downloads[target.listing_id];
  const current = byVersion?.[target.version];
  if (typeof current !== "number" || current <= correctedValue) return false;
  byVersion![target.version] = correctedValue;
  writeFileSync(path, `${JSON.stringify(downloads, null, 2)}\n`, "utf-8");
  return true;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const spec: LoopRepairSpec = normalizeLoopRepairSpec(readJsonFile<unknown>(args.specPath));
  const snapshots = loadSnapshots(args.repoRoot);
  if (snapshots.length === 0) {
    throw new Error("No history/snapshot_*.json files found.");
  }
  const attributionLedger = loadDownloadAttributionLedger(args.repoRoot);
  const resolveAssetKey = createAssetKeyResolver(args.repoRoot);
  const nowIso = new Date().toISOString();

  const newDeltas: DownloadAttributionDelta[] = [];
  const clampPlans = new Map<LoopRepairTarget, ReturnType<typeof computeSnapshotClampPlan>>();
  let totalNewSpurious = 0;

  for (const target of spec.targets) {
    const label = `${target.listing_type}:${target.listing_id}@${target.version}`;
    const series = extractTargetSeries(snapshots, target);
    const baseline = computeBaselineDailyRate(series, spec);
    if (baseline === null) {
      throw new Error(`No baseline-window data for ${label}; refusing to estimate against an empty baseline.`);
    }
    const days = computeDaySpuriousEstimates(series, spec, baseline);
    clampPlans.set(target, computeSnapshotClampPlan(series, spec, days));

    console.log(`[loop-repair] ${label} baseline=${baseline.toFixed(2)}/day allowance=${days[0]?.organicAllowance ?? Math.ceil(baseline)}/day`);
    const assetKey = resolveAssetKey(target);
    for (const day of days) {
      const deltaId = loopRepairDeltaId(spec.incident, target, day.dateKey);
      const alreadyApplied = Boolean(attributionLedger.applied_delta_ids?.[deltaId]);
      const status = alreadyApplied ? "already-applied" : day.spurious > 0 ? "new" : "no-excess";
      console.log(`  ${day.dateKey} rawDelta=${day.rawDelta} spurious=${day.spurious} (${status})`);
      if (alreadyApplied || day.spurious === 0) continue;

      const delta = createDownloadAttributionDelta(spec.source, deltaId, `${day.dateKey}T12:00:00.000Z`);
      for (let i = 0; i < day.spurious; i += 1) {
        recordDownloadAttributionFetchByAssetKey(delta, assetKey);
      }
      newDeltas.push(delta);
      totalNewSpurious += day.spurious;
    }
  }

  console.log(`[loop-repair] new attribution: ${totalNewSpurious} fetches across ${newDeltas.length} day-deltas`);
  if (!args.apply) {
    console.log("[loop-repair] preview only; pass --apply to update the ledger, snapshots, buckets, and downloads.json");
    return;
  }

  // 1. Attribution ledger: per-day deltas, idempotent via applied_delta_ids.
  const merged = mergeDownloadAttributionDeltas(attributionLedger, newDeltas);
  writeDownloadAttributionLedger(args.repoRoot, merged.ledger);
  console.log(`[loop-repair] ledger: +${merged.addedFetches} fetches, applied=${merged.appliedDeltaIds.length}, skipped=${merged.skippedDeltaIds.length}`);

  // 2. Snapshot clamp + 3. bucket ceilings + 4. downloads.json, all min()-guarded.
  const changedSnapshots = new Set<string>();
  const mapBuckets = loadDownloadVersionBucketLedger(args.repoRoot, "map");
  const modBuckets = loadDownloadVersionBucketLedger(args.repoRoot, "mod");
  let bucketsChanged = { map: false, mod: false };

  for (const target of spec.targets) {
    const plan = clampPlans.get(target) ?? [];
    const planByDate = new Map(plan.map((entry) => [entry.dateKey, entry.correctedValue]));
    for (const snapshot of snapshots) {
      const correctedValue = planByDate.get(snapshot.dateKey);
      if (correctedValue === undefined) continue;
      if (clampSnapshotValue(snapshot, target, correctedValue) > 0) {
        changedSnapshots.add(snapshot.fileName);
      }
    }

    const latestCorrected = plan[plan.length - 1]?.correctedValue;
    if (latestCorrected === undefined) continue;
    const bucketLedger = target.listing_type === "map" ? mapBuckets : modBuckets;
    if (lowerVersionBucketCeiling(bucketLedger, target, latestCorrected, nowIso)) {
      bucketsChanged[target.listing_type] = true;
    }
    // Keeps the visible count consistent without waiting for the next hourly run;
    // that run re-derives raw − attributed and the (lowered) bucket ceiling lets the
    // true value through, self-healing any downloads that arrived since the last
    // snapshot.
    lowerDownloadsJsonValue(args.repoRoot, target, latestCorrected);
  }

  const historyDir = resolve(args.repoRoot, "history");
  for (const snapshot of snapshots) {
    if (!changedSnapshots.has(snapshot.fileName)) continue;
    writeFileSync(
      resolve(historyDir, snapshot.fileName),
      `${JSON.stringify(snapshot.data, null, 2)}\n`,
      "utf-8",
    );
  }
  if (bucketsChanged.map) writeDownloadVersionBucketLedger(args.repoRoot, "map", mapBuckets);
  if (bucketsChanged.mod) writeDownloadVersionBucketLedger(args.repoRoot, "mod", modBuckets);

  console.log(`[loop-repair] snapshots clamped: ${changedSnapshots.size}`);
  console.log("[loop-repair] next step: run reconcile-attributed-downloads; analytics CSVs refresh on the next cache-download-history run");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
