import { isObject, toFiniteNonNegativeNumber } from "./json-utils.js";

// Repair math for client re-download loops: a client bug re-downloads a pinned
// release on a schedule (e.g. the 2026-08 Railyard city-code bootstrap loop), so a
// version's counter inflates while organic demand is unchanged. The repair
// estimates the organic share of each incident day from a pre-incident baseline
// and attributes the excess, per day, to the download-attribution ledger.
//
// All day-over-day deltas are computed from the snapshots' RAW counters
// (`maps.raw_downloads`): raw is never rewritten by attribution or by the
// snapshot clamp this module plans, so re-running the repair as the incident
// continues ("proactive" mode) always sees a stable basis. Raw deltas include
// the pipeline's own fetches (~1-2/version/day at most), which slightly raises
// the measured baseline and therefore lowers the attributed excess — an error
// in the conservative (under-correcting) direction.

export type LoopRepairListingType = "map" | "mod";

export interface LoopRepairTarget {
  listing_type: LoopRepairListingType;
  listing_id: string;
  // Version key exactly as it appears in downloads.json / snapshots (e.g. "v1.0.0").
  version: string;
  note?: string;
}

export interface LoopRepairSpec {
  // Short slug identifying the incident; embedded in every delta id.
  incident: string;
  // Attribution source label, e.g. "manual-correction/french-city-code-loop".
  source: string;
  targets: LoopRepairTarget[];
  // First inflated day (YYYY-MM-DD).
  incident_start: string;
  // Baseline window (inclusive, YYYY-MM-DD); must end before incident_start.
  baseline_start: string;
  baseline_end: string;
  // Set once the causing bug is fixed to stop attributing new days (inclusive).
  incident_end?: string | null;
  note?: string;
}

export interface SnapshotDayValue {
  dateKey: string; // YYYY-MM-DD
  raw: number | null;
  adjusted: number | null;
}

export interface DaySpuriousEstimate {
  dateKey: string;
  rawDelta: number;
  organicAllowance: number;
  spurious: number;
}

export interface SnapshotClampEntry {
  dateKey: string;
  correctedValue: number;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireDateKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Expected ${label} to be a YYYY-MM-DD date, got '${String(value)}'.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value.trim();
}

export function normalizeLoopRepairSpec(value: unknown): LoopRepairSpec {
  if (!isObject(value)) {
    throw new Error("Expected loop repair spec to be an object.");
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new Error("Expected spec.targets to be a non-empty array.");
  }

  const targets: LoopRepairTarget[] = value.targets.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`Expected targets[${index}] to be an object.`);
    }
    const listingType = requireNonEmptyString(entry.listing_type, `targets[${index}].listing_type`);
    if (listingType !== "map" && listingType !== "mod") {
      throw new Error(`Expected targets[${index}].listing_type to be 'map' or 'mod'.`);
    }
    return {
      listing_type: listingType,
      listing_id: requireNonEmptyString(entry.listing_id, `targets[${index}].listing_id`),
      version: requireNonEmptyString(entry.version, `targets[${index}].version`),
      note: typeof entry.note === "string" && entry.note.trim() !== "" ? entry.note.trim() : undefined,
    };
  });

  const spec: LoopRepairSpec = {
    incident: requireNonEmptyString(value.incident, "spec.incident"),
    source: requireNonEmptyString(value.source, "spec.source"),
    targets,
    incident_start: requireDateKey(value.incident_start, "spec.incident_start"),
    baseline_start: requireDateKey(value.baseline_start, "spec.baseline_start"),
    baseline_end: requireDateKey(value.baseline_end, "spec.baseline_end"),
    incident_end: value.incident_end == null
      ? null
      : requireDateKey(value.incident_end, "spec.incident_end"),
    note: typeof value.note === "string" && value.note.trim() !== "" ? value.note.trim() : undefined,
  };

  if (spec.baseline_start > spec.baseline_end) {
    throw new Error("spec.baseline_start must not be after spec.baseline_end.");
  }
  if (spec.baseline_end >= spec.incident_start) {
    throw new Error("spec.baseline_end must be before spec.incident_start.");
  }
  if (spec.incident_end && spec.incident_end < spec.incident_start) {
    throw new Error("spec.incident_end must not be before spec.incident_start.");
  }
  return spec;
}

interface SnapshotSectionLike {
  downloads?: Record<string, Record<string, unknown>>;
  raw_downloads?: Record<string, Record<string, unknown>>;
}

export interface SnapshotFileLike {
  total_downloads?: unknown;
  maps?: SnapshotSectionLike;
  mods?: SnapshotSectionLike;
}

function readVersionValue(
  section: SnapshotSectionLike | undefined,
  field: "downloads" | "raw_downloads",
  target: LoopRepairTarget,
): number | null {
  const byListing = section?.[field];
  if (!isObject(byListing)) return null;
  const byVersion = byListing[target.listing_id];
  if (!isObject(byVersion)) return null;
  return toFiniteNonNegativeNumber(byVersion[target.version]);
}

// extractTargetSeries pulls one target's per-day raw + adjusted counters out of the
// snapshot series. Snapshots must be supplied sorted by dateKey ascending. Raw falls
// back to the adjusted value for schema versions that predate raw_downloads.
export function extractTargetSeries(
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
  target: LoopRepairTarget,
): SnapshotDayValue[] {
  const series: SnapshotDayValue[] = [];
  for (const snapshot of snapshots) {
    const section = target.listing_type === "map" ? snapshot.data.maps : snapshot.data.mods;
    const adjusted = readVersionValue(section, "downloads", target);
    const raw = readVersionValue(section, "raw_downloads", target) ?? adjusted;
    series.push({ dateKey: snapshot.dateKey, raw, adjusted });
  }
  return series;
}

interface DayDelta {
  dateKey: string;
  rawDelta: number;
}

// Day-over-day raw deltas, clamped at zero (a counter regression means an asset
// re-upload, not negative demand). Days without a raw value on either side are skipped.
function computeRawDayDeltas(series: SnapshotDayValue[]): DayDelta[] {
  const deltas: DayDelta[] = [];
  let previousRaw: number | null = null;
  for (const day of series) {
    if (day.raw === null) continue;
    if (previousRaw !== null) {
      deltas.push({ dateKey: day.dateKey, rawDelta: Math.max(0, day.raw - previousRaw) });
    }
    previousRaw = day.raw;
  }
  return deltas;
}

// computeBaselineDailyRate averages the raw day deltas inside the baseline window.
// Returns null when the window contains no measurable days — the caller must then
// refuse to estimate rather than assume a zero baseline (which would attribute
// every incident download as spurious).
export function computeBaselineDailyRate(
  series: SnapshotDayValue[],
  spec: LoopRepairSpec,
): number | null {
  const deltas = computeRawDayDeltas(series).filter(
    (delta) => delta.dateKey >= spec.baseline_start && delta.dateKey <= spec.baseline_end,
  );
  if (deltas.length === 0) return null;
  const total = deltas.reduce((sum, delta) => sum + delta.rawDelta, 0);
  return total / deltas.length;
}

// computeDaySpuriousEstimates estimates each incident day's excess over the organic
// allowance. The allowance is the baseline mean rounded UP, so estimation always
// errs toward attributing less (the registry's conservative-corrections policy).
export function computeDaySpuriousEstimates(
  series: SnapshotDayValue[],
  spec: LoopRepairSpec,
  baselineDailyRate: number,
): DaySpuriousEstimate[] {
  const organicAllowance = Math.ceil(Math.max(0, baselineDailyRate));
  const lastDateKey = spec.incident_end ?? series[series.length - 1]?.dateKey ?? spec.incident_start;
  return computeRawDayDeltas(series)
    .filter((delta) => delta.dateKey >= spec.incident_start && delta.dateKey <= lastDateKey)
    .map((delta) => ({
      dateKey: delta.dateKey,
      rawDelta: delta.rawDelta,
      organicAllowance,
      spurious: Math.max(0, delta.rawDelta - organicAllowance),
    }));
}

// loopRepairDeltaId is stable per (incident, target, day) so the ledger's
// applied_delta_ids makes re-runs idempotent: an already-attributed day is
// skipped, a newly observed day is applied.
export function loopRepairDeltaId(
  incident: string,
  target: LoopRepairTarget,
  dateKey: string,
): string {
  return `manual-loop-repair:${incident}:${target.listing_id}@${target.version}:${dateKey}`;
}

// computeSnapshotClampPlan rewrites the incident-window snapshot trajectory to the
// organic estimate: anchored at the last pre-incident adjusted value, growing by
// min(rawDelta, organicAllowance) per day. Values are corrected with
// min(recorded, corrected), so the plan is idempotent and never raises history.
// Mirrors ops/backfill-charleston-snapshot-clamp.ts; without it a bucket rebuild
// from history would resurrect the inflated count as a `history-max:` floor.
export function computeSnapshotClampPlan(
  series: SnapshotDayValue[],
  spec: LoopRepairSpec,
  days: DaySpuriousEstimate[],
): SnapshotClampEntry[] {
  const anchorDay = [...series]
    .reverse()
    .find((day) => day.dateKey < spec.incident_start && day.adjusted !== null);
  if (!anchorDay || anchorDay.adjusted === null) return [];

  const organicByDate = new Map<string, number>();
  for (const day of days) {
    organicByDate.set(day.dateKey, Math.min(day.rawDelta, day.organicAllowance));
  }
  const rawDeltaByDate = new Map<string, number>();
  for (const delta of computeRawDayDeltas(series)) {
    rawDeltaByDate.set(delta.dateKey, delta.rawDelta);
  }

  const plan: SnapshotClampEntry[] = [];
  let corrected = anchorDay.adjusted;
  for (const day of series) {
    if (day.dateKey < spec.incident_start) continue;
    // Inside the incident window growth is capped at the organic allowance; after a
    // closed window (incident_end set) full raw growth resumes, but the accumulated
    // reduction still carries forward so post-incident history stays corrected.
    if (spec.incident_end && day.dateKey > spec.incident_end) {
      corrected += rawDeltaByDate.get(day.dateKey) ?? 0;
    } else {
      corrected += organicByDate.get(day.dateKey) ?? 0;
    }
    if (day.adjusted === null) continue;
    plan.push({ dateKey: day.dateKey, correctedValue: Math.min(day.adjusted, corrected) });
  }
  return plan;
}
