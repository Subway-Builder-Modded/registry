import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadDownloadAttributionLedger,
  sumLedgerTotalUpToCutoff,
  writeDownloadAttributionLedger,
  type DownloadAttributionLedger,
} from "../lib/download-attribution.js";
import {
  loopRepairDeltaId,
  normalizeLoopRepairSpec,
  type LoopRepairAdoptionEntry,
  type LoopRepairSpec,
} from "../lib/loop-download-repair.js";
import { getFlagValue, hasFlag } from "../lib/cli.js";
import { readJsonFile, writeJsonFile } from "../lib/json-utils.js";
import { resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";
import { createAssetKeyResolver } from "./repair-loop-inflated-downloads.js";

// One-shot consistency repair for the metronome v2 UA cap (#12201, 2026-10-03;
// KNOWN_INCIDENTS.md metronome v2 entry). The cap lowered the attribution ledger's
// `daily` and `assets` views to 7/day/listing via an uncommitted script but left
// `timeline` at the pre-cap amounts. Snapshot generation and history rebuilds
// read `timeline` first (forEachLedgerAssetCountUpToCutoff), so:
//   - the 2026-09-07..10-02 snapshots kept the pre-cap clamp, and the whole
//     434-fetch re-credit surfaced as one 2026-10-03 jump in the by-day series;
//   - every snapshot generated since stored raw = capped adjusted + pre-cap
//     timeline, i.e. raw above the real GitHub counter by the re-credit — which
//     also poisons the loop-repair engine's raw day-deltas and install bases.
//
// Passes (preview by default; --apply writes):
//   1. ledger: lower each capped delta's timeline entry to its daily amount.
//   2. snapshots generated after the incident's deltas were applied: raw =
//      adjusted + attribution applied by generated_at; attributed to match.
//   3. snapshots generated before that, from release_start on: adjusted = raw −
//      attribution effective at that snapshot (pipeline fetches by generated_at
//      plus the incident's applied amounts for days up to the snapshot date — the
//      engine clamp's day semantics), using the ledger's applied per-day amounts
//      rather than re-estimating. Only raises are written (the re-credit landing
//      on its own days); later snapshots are only validated.
// Totals, raw totals, attributed totals, attributed fetches and nets move by the
// per-version deltas only, so unrelated pre-existing drift is left untouched.
// Idempotent: gated on the timeline defect itself (pass 1); once the ledger is
// consistent the script exits without touching anything.
//
//   pnpm --dir scripts run repair-metronome-ua-cap-consistency [-- --apply]
//
// Run BEFORE the next repair-loop-inflated-downloads apply of the UA spec: the
// engine derives day-deltas and install bases from snapshot raw.

const DEFAULT_SPEC = "history/loop-repair-specs/2026_10_03_metronome_fetch_ua_v2.json";
const DAY_STAMP_SUFFIX = "T12:00:00.000Z";

type VersionCounts = Record<string, Record<string, number>>;

interface SnapshotSection {
  downloads?: VersionCounts;
  raw_downloads?: VersionCounts;
  attributed_downloads?: VersionCounts;
  total_downloads?: number;
  raw_total_downloads?: number;
  total_attributed_downloads?: number;
  net_downloads?: number;
}

interface SnapshotData {
  snapshot_date: string;
  generated_at: string;
  total_downloads?: number;
  raw_total_downloads?: number;
  total_attributed_downloads?: number;
  total_attributed_fetches?: number;
  net_downloads?: number;
  maps?: SnapshotSection;
}

interface SnapshotEntry {
  dateKey: string;
  fileName: string;
  generatedAtMs: number;
  data: SnapshotData;
  adjustedDelta: number;
  changes: string[];
}

interface CappedTarget {
  adoption: LoopRepairAdoptionEntry;
  label: string;
  assetKey: string;
  // dateKey → applied-at ms for every applied delta of this target.
  appliedDays: Map<string, number>;
}

function loadSnapshots(repoRoot: string): SnapshotEntry[] {
  const historyDir = resolve(repoRoot, "history");
  return readdirSync(historyDir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .sort()
    .map((fileName) => {
      const data = JSON.parse(readFileSync(resolve(historyDir, fileName), "utf-8")) as SnapshotData;
      return {
        fileName,
        dateKey: fileName.slice(9, 19).replaceAll("_", "-"),
        generatedAtMs: Date.parse(data.generated_at),
        data,
        adjustedDelta: 0,
        changes: [],
      };
    });
}

function collectCappedTargets(
  repoRoot: string,
  spec: LoopRepairSpec,
  ledger: DownloadAttributionLedger,
): CappedTarget[] {
  if (spec.targets.length > 0) {
    throw new Error("This repair handles adoption targets only; the spec has superseded-version targets.");
  }
  const resolveAssetKey = createAssetKeyResolver(repoRoot);
  const capped: CappedTarget[] = [];
  for (const adoption of spec.adoption_targets ?? []) {
    const target = { listing_type: adoption.listing_type, listing_id: adoption.listing_id, version: adoption.version };
    const idPrefix = loopRepairDeltaId(spec.incident, target, "");
    const appliedDays = new Map<string, number>();
    for (const [deltaId, appliedAt] of Object.entries(ledger.applied_delta_ids)) {
      if (!deltaId.startsWith(idPrefix)) continue;
      appliedDays.set(deltaId.slice(idPrefix.length), Date.parse(appliedAt));
    }
    if (appliedDays.size === 0) continue;
    capped.push({
      adoption,
      label: `${adoption.listing_type}:${adoption.listing_id}@${adoption.version}`,
      assetKey: resolveAssetKey(target),
      appliedDays,
    });
  }
  return capped;
}

function sumTimelineForAssetOnDay(ledger: DownloadAttributionLedger, assetKey: string, dateKey: string): number {
  let total = 0;
  for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
    if (timeKey.startsWith(dateKey)) total += entry.assets[assetKey] ?? 0;
  }
  return total;
}

// Pass 1: the cap left each capped day's `${date}T12:00Z` timeline entry at the
// pre-cap amount while daily/assets hold the capped one. Lower the timeline entry
// by exactly the per-day excess, and require the result to be the capped amount.
// Returns the fetches lowered per target; targets absent from the map carry no
// defect, and an empty map means the repair has already run.
function lowerTimelineToDaily(
  ledger: DownloadAttributionLedger,
  spec: LoopRepairSpec,
  targets: CappedTarget[],
): Map<CappedTarget, number> {
  const loweredByTarget = new Map<CappedTarget, number>();
  for (const target of targets) {
    let lowered = 0;
    for (const dateKey of [...target.appliedDays.keys()].sort()) {
      const stamp = `${dateKey}${DAY_STAMP_SUFFIX}`;
      const entry = ledger.timeline[stamp];
      const amount = entry?.assets[target.assetKey] ?? 0;
      const dailyAmount = ledger.daily[dateKey.replaceAll("-", "_")]?.assets[target.assetKey] ?? 0;
      const excess = sumTimelineForAssetOnDay(ledger, target.assetKey, dateKey) - dailyAmount;
      if (excess === 0) continue;
      if (!entry || excess < 0 || excess > amount) {
        throw new Error(`${target.label} ${dateKey}: timeline/daily mismatch ${excess} cannot be explained by the cap.`);
      }
      const cappedAmount = amount - excess;
      if (spec.daily_spurious_cap != null && cappedAmount !== Math.min(amount, spec.daily_spurious_cap)) {
        throw new Error(
          `${target.label} ${dateKey}: timeline ${amount} → ${cappedAmount} is not min(amount, daily_spurious_cap=${spec.daily_spurious_cap}).`,
        );
      }
      entry.assets[target.assetKey] = cappedAmount;
      entry.total -= excess;
      lowered += excess;
    }
    if (lowered > 0) loweredByTarget.set(target, lowered);
  }

  for (const target of targets) {
    let timelineTotal = 0;
    for (const entry of Object.values(ledger.timeline)) timelineTotal += entry.assets[target.assetKey] ?? 0;
    let dailyTotal = 0;
    for (const entry of Object.values(ledger.daily)) dailyTotal += entry.assets[target.assetKey] ?? 0;
    const assetsTotal = ledger.assets[target.assetKey]?.count ?? 0;
    if (timelineTotal !== dailyTotal || dailyTotal !== assetsTotal) {
      throw new Error(
        `${target.assetKey}: ledger views still disagree after pass 1 (timeline ${timelineTotal}, daily ${dailyTotal}, assets ${assetsTotal}).`,
      );
    }
  }
  return loweredByTarget;
}

// The snapshot builder matches attribution by repo/tag/asset name, so node-id
// re-upload keys (`<key>#RA_...`) count toward the same version.
function sumFamilyAttribution(
  ledger: DownloadAttributionLedger,
  target: CappedTarget,
  include: (timeKey: string, assetKey: string) => boolean,
): number {
  let total = 0;
  for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
    for (const [assetKey, count] of Object.entries(entry.assets)) {
      if (assetKey !== target.assetKey && !assetKey.startsWith(`${target.assetKey}#`)) continue;
      if (include(timeKey, assetKey)) total += count;
    }
  }
  return total;
}

function manualAmount(ledger: DownloadAttributionLedger, target: CappedTarget, dateKey: string): number {
  return ledger.timeline[`${dateKey}${DAY_STAMP_SUFFIX}`]?.assets[target.assetKey] ?? 0;
}

// Attribution the pipeline had applied by `atMs`: timeline entries stamped by
// then, plus this incident's deltas applied by then but stamped later in the day
// (the engine stamps day D at D T12:00Z, and downloads.json — hence the snapshot's
// adjusted value — subtracts a delta as soon as it is applied).
function attributionAppliedBy(ledger: DownloadAttributionLedger, target: CappedTarget, atMs: number): number {
  let total = sumFamilyAttribution(ledger, target, (timeKey) => Date.parse(timeKey) <= atMs);
  for (const [dateKey, appliedMs] of target.appliedDays) {
    if (appliedMs <= atMs && Date.parse(`${dateKey}${DAY_STAMP_SUFFIX}`) > atMs) {
      total += manualAmount(ledger, target, dateKey);
    }
  }
  return total;
}

// Attribution effective at a snapshot under the engine clamp's day semantics:
// pipeline fetches stamped by generated_at, plus the incident's applied amount for
// every day up to and including the snapshot date (day D = snapshot D−1 → D).
function attributionEffectiveAt(
  ledger: DownloadAttributionLedger,
  target: CappedTarget,
  snapshot: SnapshotEntry,
): number {
  const manualStamps = new Set([...target.appliedDays.keys()].map((dateKey) => `${dateKey}${DAY_STAMP_SUFFIX}`));
  let total = sumFamilyAttribution(
    ledger,
    target,
    (timeKey, assetKey) => !(manualStamps.has(timeKey) && assetKey === target.assetKey)
      && Date.parse(timeKey) <= snapshot.generatedAtMs,
  );
  for (const dateKey of target.appliedDays.keys()) {
    if (dateKey <= snapshot.dateKey) total += manualAmount(ledger, target, dateKey);
  }
  return total;
}

function readCount(counts: VersionCounts | undefined, listingId: string, version: string): number | null {
  const value = counts?.[listingId]?.[version];
  return typeof value === "number" ? value : null;
}

function addToField<T extends object>(obj: T, field: keyof T, delta: number): void {
  const current = obj[field];
  if (typeof current === "number") (obj as Record<keyof T, number>)[field] = current + delta;
}

// Pass 2: restore raw (and attributed, so raw = adjusted + attributed holds) for
// the capped versions in every snapshot generated after the deltas were applied.
function restoreRawAfterApply(
  snapshots: SnapshotEntry[],
  ledger: DownloadAttributionLedger,
  originalLedger: DownloadAttributionLedger,
  targets: CappedTarget[],
  appliedFromMs: number,
): number {
  let changed = 0;
  for (const snapshot of snapshots) {
    if (!(snapshot.generatedAtMs >= appliedFromMs)) continue;
    const maps = snapshot.data.maps;
    if (!maps) continue;
    for (const target of targets) {
      const { listing_id: listingId, version } = target.adoption;
      const adjusted = readCount(maps.downloads, listingId, version);
      const raw = readCount(maps.raw_downloads, listingId, version);
      const attributed = readCount(maps.attributed_downloads, listingId, version);
      if (adjusted === null || raw === null || attributed === null) continue;
      const nextAttributed = attributionAppliedBy(ledger, target, snapshot.generatedAtMs);
      const nextRaw = adjusted + nextAttributed;
      if (nextRaw === raw && nextAttributed === attributed) continue;
      maps.raw_downloads![listingId]![version] = nextRaw;
      maps.attributed_downloads![listingId]![version] = nextAttributed;
      addToField(maps, "raw_total_downloads", nextRaw - raw);
      addToField(snapshot.data, "raw_total_downloads", nextRaw - raw);
      addToField(maps, "total_attributed_downloads", nextAttributed - attributed);
      addToField(snapshot.data, "total_attributed_downloads", nextAttributed - attributed);
      snapshot.changes.push(`${listingId}@${version} raw ${raw}→${nextRaw} attributed ${attributed}→${nextAttributed}`);
      changed += 1;
    }
    const fetchesDelta = sumLedgerTotalUpToCutoff(ledger, snapshot.data.snapshot_date, snapshot.data.generated_at)
      - sumLedgerTotalUpToCutoff(originalLedger, snapshot.data.snapshot_date, snapshot.data.generated_at);
    if (fetchesDelta !== 0) {
      addToField(snapshot.data, "total_attributed_fetches", fetchesDelta);
      snapshot.changes.push(`total_attributed_fetches ${fetchesDelta > 0 ? "+" : ""}${fetchesDelta}`);
    }
  }
  return changed;
}

// Pass 3: adjusted = raw − attribution effective at each snapshot.
function rederiveAdjusted(
  snapshots: SnapshotEntry[],
  ledger: DownloadAttributionLedger,
  targets: CappedTarget[],
  appliedFromMs: number,
): { rewritten: number; mismatches: string[] } {
  let rewritten = 0;
  const mismatches: string[] = [];

  for (const target of targets) {
    const { listing_id: listingId, version, release_start: releaseStart } = target.adoption;
    for (const snapshot of snapshots) {
      if (snapshot.dateKey < releaseStart) continue;
      const maps = snapshot.data.maps;
      const recorded = readCount(maps?.downloads, listingId, version);
      const raw = readCount(maps?.raw_downloads, listingId, version);
      if (recorded === null || raw === null) continue;
      const correctedValue = raw - attributionEffectiveAt(ledger, target, snapshot);
      if (recorded === correctedValue) continue;
      if (snapshot.generatedAtMs >= appliedFromMs || correctedValue < recorded) {
        mismatches.push(`${target.label} ${snapshot.dateKey}: recorded ${recorded}, raw − effective attribution ${correctedValue}`);
        continue;
      }
      const downloads = maps!.downloads!;
      downloads[listingId]![version] = correctedValue;
      const delta = correctedValue - recorded;
      addToField(snapshot.data.maps!, "total_downloads", delta);
      addToField(snapshot.data, "total_downloads", delta);
      snapshot.adjustedDelta += delta;
      snapshot.changes.push(`${listingId}@${version} adjusted ${recorded}→${correctedValue}`);
      rewritten += 1;
    }
  }

  // A total change moves its own net and the next snapshot's net.
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!;
    const previousDelta = index > 0 ? snapshots[index - 1]!.adjustedDelta : 0;
    const netDelta = snapshot.adjustedDelta - previousDelta;
    if (netDelta === 0) continue;
    addToField(snapshot.data.maps!, "net_downloads", netDelta);
    addToField(snapshot.data, "net_downloads", netDelta);
    snapshot.changes.push(`net ${netDelta > 0 ? "+" : ""}${netDelta}`);
  }
  return { rewritten, mismatches };
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const specPath = resolve(repoRoot, getFlagValue(argv, "spec")?.trim() || DEFAULT_SPEC);
  const apply = hasFlag(argv, "apply");

  const spec = normalizeLoopRepairSpec(readJsonFile<unknown>(specPath));
  const ledger = loadDownloadAttributionLedger(repoRoot);
  const originalLedger = structuredClone(ledger);
  // Passes 2-3 derive raw from recorded adjusted values, which is only valid
  // before any later engine clamp; the timeline defect itself is the gate, so a
  // re-run after the repair (and after any later re-apply) is a no-op.
  const loweredByTarget = lowerTimelineToDaily(ledger, spec, collectCappedTargets(repoRoot, spec, ledger));
  const targets = [...loweredByTarget.keys()];
  if (targets.length === 0) {
    console.log("[cap-consistency] ledger timeline already matches daily/assets; repair already applied, nothing to do");
    return;
  }
  const timelineLowered = [...loweredByTarget.values()].reduce((sum, lowered) => sum + lowered, 0);
  const appliedFromMs = Math.min(...targets.flatMap((target) => [...target.appliedDays.values()]));
  console.log(
    `[cap-consistency] ${targets.length} capped targets; deltas applied from ${new Date(appliedFromMs).toISOString()}`,
  );
  console.log(`[cap-consistency] pass 1 ledger: timeline lowered by ${timelineLowered} fetches`);

  const snapshots = loadSnapshots(repoRoot);
  const rawRestored = restoreRawAfterApply(snapshots, ledger, originalLedger, targets, appliedFromMs);
  console.log(`[cap-consistency] pass 2 raw: ${rawRestored} version entries restored`);

  const { rewritten, mismatches } = rederiveAdjusted(snapshots, ledger, targets, appliedFromMs);
  console.log(`[cap-consistency] pass 3 adjusted: ${rewritten} version entries re-credited`);
  for (const mismatch of mismatches) {
    console.log(`[cap-consistency] WARNING not rewritten (post-apply snapshot or would lower): ${mismatch}`);
  }

  const changedSnapshots = snapshots.filter((snapshot) => snapshot.changes.length > 0);
  for (const snapshot of changedSnapshots) {
    console.log(`  ${snapshot.fileName}: ${snapshot.changes.join("; ")}`);
  }
  if (!apply) {
    console.log("[cap-consistency] preview only; pass --apply to write the ledger and snapshots");
    return;
  }
  // Ledger last: it carries the gate, so an interrupted run is simply redone.
  for (const snapshot of changedSnapshots) {
    writeJsonFile(resolve(repoRoot, "history", snapshot.fileName), snapshot.data);
  }
  writeDownloadAttributionLedger(repoRoot, ledger);
  console.log(`[cap-consistency] wrote snapshots=${changedSnapshots.length} and the ledger`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
