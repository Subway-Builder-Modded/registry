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
  // First snapshot day on which a successor version was available (YYYY-MM-DD).
  // From this day on, organic old-version demand collapses to the superseded-peer
  // rate; before it (old version still latest) the baseline-window rate applies.
  // Defaults to incident_start when absent.
  superseded_start?: string;
  note?: string;
}

// A known-good comparable whose old version was superseded around the same time.
// Its post-supersession old-version traffic measures what organic demand for a
// superseded version actually looks like.
export interface LoopRepairPeer {
  listing_type: LoopRepairListingType;
  listing_id: string;
  version: string;
  superseded_start: string;
}

// A NEW version whose download traffic is loop-inflated (adoption_targets), or a
// known-good comparable release used to model organic update adoption
// (adoption_peers). release_start is the first snapshot day the version was counted.
export interface LoopRepairAdoptionEntry {
  listing_type: LoopRepairListingType;
  listing_id: string;
  version: string;
  release_start: string;
  // Last loop day for this target when it precedes spec.incident_end (inclusive),
  // e.g. the client moved on to a successor version. Adoption targets only.
  incident_end?: string | null;
  // "adjusted" measures the install base net of attribution instead of from raw
  // counters. Use when the prior versions were themselves loop-inflated and
  // corrected: raw would count the loop's own fetches as installs and widen the
  // very allowance meant to remove them. Adoption targets only; default "raw".
  install_base?: "raw" | "adjusted";
  note?: string;
}

// A listing the same broken client re-fetches alongside the spec's core loop
// (a "rider", found by detect-metronome): popular enough that an allowance
// model would drown in its organic traffic, so attribution follows the loop's
// own clock instead — per snapshot day, per_cycle × that day's lockstep hours
// of the core loop, rounded down and capped by the version's raw growth. One
// entry per (version, window): the client re-fetches the version it last
// updated to, so a listing whose update restarts the loop gets one entry per
// version.
export interface LoopRepairRiderTarget {
  listing_type: LoopRepairListingType;
  listing_id: string;
  // "*" with versions_from: every version of the listing first seen in a
  // snapshot on or after versions_from, each from the later of `start` and its
  // first snapshot day — for a client that re-fetches every version it has
  // seen since its last restart (japanese-trains), so new releases are covered
  // without a spec edit. Expanded by expandRiderTargets.
  version: string;
  versions_from?: string;
  // First and last snapshot days of the rider's participation (inclusive).
  start: string;
  end?: string | null;
  // Measured fetches per loop cycle: the rider's mean excess per lockstep hour
  // over the same-day neighbouring hours, rounded down.
  per_cycle: number;
  // The version's release asset when integrity no longer records it (a retired
  // version, e.g. jp-maps only-latest retirement): taken from integrity history
  // while the version was live.
  asset_source?: { repo: string; tag: string; asset_name: string };
  note?: string;
}

// The listings whose shared hours define the loop's clock for rider_targets.
export interface LoopRepairRiderLoop {
  core: Array<{ listing_type: LoopRepairListingType; listing_id: string }>;
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
  // Governs the allowance for incident days BEFORE a target's superseded_start.
  baseline_start: string;
  baseline_end: string;
  // Comparables whose pooled post-supersession old-version rate becomes the
  // allowance for incident days ON/AFTER a target's superseded_start. When empty,
  // the baseline-window rate applies to all days (the pre-revision behavior).
  peers?: LoopRepairPeer[];
  // NEW versions whose traffic is loop-inflated. Their organic allowance is the
  // peer-adoption model: for each day since release, the MOST generous per-day
  // adoption fraction observed across adoption_peers, scaled to the target's
  // install base. Requires adoption_peers when non-empty.
  adoption_targets?: LoopRepairAdoptionEntry[];
  adoption_peers?: LoopRepairAdoptionEntry[];
  // Set once the causing bug is fixed to stop attributing new days (inclusive).
  incident_end?: string | null;
  // Upper bound on fetches attributed per target per day: the loop's measured
  // per-listing rate. The allowance models can undershoot a target's real organic
  // demand (e.g. a flagship measured against small-pack adoption peers); excess
  // beyond the loop rate is then organic traffic and must stay credited.
  daily_spurious_cap?: number | null;
  rider_loop?: LoopRepairRiderLoop | null;
  // Riders are bounded by their own measured rate; daily_spurious_cap (a ruling
  // about the core targets' organic demand) does not apply to them.
  rider_targets?: LoopRepairRiderTarget[];
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
  if (!Array.isArray(value.targets)) {
    throw new Error("Expected spec.targets to be an array.");
  }
  const hasAdoptionTargets = Array.isArray(value.adoption_targets) && value.adoption_targets.length > 0;
  const hasRiderTargets = Array.isArray(value.rider_targets) && value.rider_targets.length > 0;
  if (value.targets.length === 0 && !hasAdoptionTargets && !hasRiderTargets) {
    throw new Error("Expected spec.targets to be non-empty when the spec has no adoption_targets or rider_targets.");
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
      superseded_start: entry.superseded_start == null
        ? undefined
        : requireDateKey(entry.superseded_start, `targets[${index}].superseded_start`),
      note: typeof entry.note === "string" && entry.note.trim() !== "" ? entry.note.trim() : undefined,
    };
  });

  const peers: LoopRepairPeer[] = !Array.isArray(value.peers)
    ? []
    : value.peers.map((entry, index) => {
      if (!isObject(entry)) {
        throw new Error(`Expected peers[${index}] to be an object.`);
      }
      const listingType = requireNonEmptyString(entry.listing_type, `peers[${index}].listing_type`);
      if (listingType !== "map" && listingType !== "mod") {
        throw new Error(`Expected peers[${index}].listing_type to be 'map' or 'mod'.`);
      }
      return {
        listing_type: listingType,
        listing_id: requireNonEmptyString(entry.listing_id, `peers[${index}].listing_id`),
        version: requireNonEmptyString(entry.version, `peers[${index}].version`),
        superseded_start: requireDateKey(entry.superseded_start, `peers[${index}].superseded_start`),
      };
    });

  const normalizeAdoptionEntry = (entry: unknown, label: string): LoopRepairAdoptionEntry => {
    if (!isObject(entry)) {
      throw new Error(`Expected ${label} to be an object.`);
    }
    const listingType = requireNonEmptyString(entry.listing_type, `${label}.listing_type`);
    if (listingType !== "map" && listingType !== "mod") {
      throw new Error(`Expected ${label}.listing_type to be 'map' or 'mod'.`);
    }
    const releaseStart = requireDateKey(entry.release_start, `${label}.release_start`);
    const incidentEnd = entry.incident_end == null ? null : requireDateKey(entry.incident_end, `${label}.incident_end`);
    if (incidentEnd && incidentEnd < releaseStart) {
      throw new Error(`${label}.incident_end must not be before ${label}.release_start.`);
    }
    if (entry.install_base != null && entry.install_base !== "raw" && entry.install_base !== "adjusted") {
      throw new Error(`Expected ${label}.install_base to be 'raw' or 'adjusted'.`);
    }
    return {
      listing_type: listingType,
      listing_id: requireNonEmptyString(entry.listing_id, `${label}.listing_id`),
      version: requireNonEmptyString(entry.version, `${label}.version`),
      release_start: releaseStart,
      ...(incidentEnd ? { incident_end: incidentEnd } : {}),
      ...(entry.install_base === "adjusted" ? { install_base: "adjusted" as const } : {}),
      note: typeof entry.note === "string" && entry.note.trim() !== "" ? entry.note.trim() : undefined,
    };
  };
  const adoptionTargets: LoopRepairAdoptionEntry[] = !Array.isArray(value.adoption_targets)
    ? []
    : value.adoption_targets.map((entry, index) => normalizeAdoptionEntry(entry, `adoption_targets[${index}]`));
  const adoptionPeers: LoopRepairAdoptionEntry[] = !Array.isArray(value.adoption_peers)
    ? []
    : value.adoption_peers.map((entry, index) => normalizeAdoptionEntry(entry, `adoption_peers[${index}]`));
  if (adoptionTargets.length > 0 && adoptionPeers.length === 0) {
    throw new Error("spec.adoption_targets requires spec.adoption_peers.");
  }
  if (
    value.daily_spurious_cap != null
    && (typeof value.daily_spurious_cap !== "number"
      || !Number.isInteger(value.daily_spurious_cap)
      || value.daily_spurious_cap <= 0)
  ) {
    throw new Error("Expected spec.daily_spurious_cap to be a positive integer.");
  }

  const requireListingType = (raw: unknown, label: string): LoopRepairListingType => {
    const listingType = requireNonEmptyString(raw, label);
    if (listingType !== "map" && listingType !== "mod") {
      throw new Error(`Expected ${label} to be 'map' or 'mod'.`);
    }
    return listingType;
  };
  const riderTargets: LoopRepairRiderTarget[] = !Array.isArray(value.rider_targets)
    ? []
    : value.rider_targets.map((entry, index) => {
      const label = `rider_targets[${index}]`;
      if (!isObject(entry)) throw new Error(`Expected ${label} to be an object.`);
      const start = requireDateKey(entry.start, `${label}.start`);
      const end = entry.end == null ? null : requireDateKey(entry.end, `${label}.end`);
      if (end && end < start) throw new Error(`${label}.end must not be before ${label}.start.`);
      if (typeof entry.per_cycle !== "number" || !(entry.per_cycle > 0) || entry.per_cycle > 5) {
        throw new Error(`Expected ${label}.per_cycle to be a number in (0, 5].`);
      }
      const version = requireNonEmptyString(entry.version, `${label}.version`);
      if ((version === "*") !== (entry.versions_from != null)) {
        throw new Error(`${label}.versions_from is required with version "*" and only allowed with it.`);
      }
      if (version === "*" && entry.asset_source != null) {
        throw new Error(`${label}.asset_source cannot be combined with version "*".`);
      }
      return {
        listing_type: requireListingType(entry.listing_type, `${label}.listing_type`),
        listing_id: requireNonEmptyString(entry.listing_id, `${label}.listing_id`),
        version,
        ...(version === "*" ? { versions_from: requireDateKey(entry.versions_from, `${label}.versions_from`) } : {}),
        start,
        end,
        per_cycle: entry.per_cycle,
        ...(entry.asset_source == null ? {} : {
          asset_source: (() => {
            const source = entry.asset_source;
            if (!isObject(source)) throw new Error(`Expected ${label}.asset_source to be an object.`);
            return {
              repo: requireNonEmptyString(source.repo, `${label}.asset_source.repo`),
              tag: requireNonEmptyString(source.tag, `${label}.asset_source.tag`),
              asset_name: requireNonEmptyString(source.asset_name, `${label}.asset_source.asset_name`),
            };
          })(),
        }),
        note: typeof entry.note === "string" && entry.note.trim() !== "" ? entry.note.trim() : undefined,
      };
    });
  let riderLoop: LoopRepairRiderLoop | null = null;
  if (value.rider_loop != null) {
    if (!isObject(value.rider_loop) || !Array.isArray(value.rider_loop.core) || value.rider_loop.core.length === 0) {
      throw new Error("Expected spec.rider_loop.core to be a non-empty array.");
    }
    riderLoop = {
      core: value.rider_loop.core.map((entry, index) => {
        if (!isObject(entry)) throw new Error(`Expected rider_loop.core[${index}] to be an object.`);
        return {
          listing_type: requireListingType(entry.listing_type, `rider_loop.core[${index}].listing_type`),
          listing_id: requireNonEmptyString(entry.listing_id, `rider_loop.core[${index}].listing_id`),
        };
      }),
      note: typeof value.rider_loop.note === "string" && value.rider_loop.note.trim() !== "" ? value.rider_loop.note.trim() : undefined,
    };
  }
  if (riderTargets.length > 0 && !riderLoop) {
    throw new Error("spec.rider_targets requires spec.rider_loop.");
  }

  const spec: LoopRepairSpec = {
    incident: requireNonEmptyString(value.incident, "spec.incident"),
    source: requireNonEmptyString(value.source, "spec.source"),
    targets,
    incident_start: requireDateKey(value.incident_start, "spec.incident_start"),
    baseline_start: requireDateKey(value.baseline_start, "spec.baseline_start"),
    baseline_end: requireDateKey(value.baseline_end, "spec.baseline_end"),
    peers,
    adoption_targets: adoptionTargets,
    adoption_peers: adoptionPeers,
    incident_end: value.incident_end == null
      ? null
      : requireDateKey(value.incident_end, "spec.incident_end"),
    daily_spurious_cap: typeof value.daily_spurious_cap === "number" ? value.daily_spurious_cap : null,
    rider_loop: riderLoop,
    rider_targets: riderTargets,
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
  attributed_downloads?: Record<string, Record<string, unknown>>;
}

export interface SnapshotFileLike {
  generated_at?: unknown;
  total_downloads?: unknown;
  maps?: SnapshotSectionLike;
  mods?: SnapshotSectionLike;
}

function readVersionValue(
  section: SnapshotSectionLike | undefined,
  field: "downloads" | "raw_downloads" | "attributed_downloads",
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

// expandRiderTargets resolves version "*" rider targets into one target per
// version first seen (in either counter) on or after versions_from, ordered by
// first snapshot day; explicit targets pass through. Each expanded target is an
// ordinary rider for its version, so its delta ids match an explicit entry.
export function expandRiderTargets(
  riders: LoopRepairRiderTarget[],
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
): LoopRepairRiderTarget[] {
  return riders.flatMap((rider) => {
    if (rider.version !== "*") return [rider];
    const firstSeen = new Map<string, string>();
    for (const snapshot of snapshots) {
      const section = rider.listing_type === "map" ? snapshot.data.maps : snapshot.data.mods;
      for (const field of ["raw_downloads", "downloads"] as const) {
        const byVersion = isObject(section?.[field]) ? section![field]![rider.listing_id] : undefined;
        if (!isObject(byVersion)) continue;
        for (const version of Object.keys(byVersion)) {
          if (!firstSeen.has(version)) firstSeen.set(version, snapshot.dateKey);
        }
      }
    }
    return [...firstSeen]
      .filter(([, seen]) => seen >= rider.versions_from!)
      .sort(([a, seenA], [b, seenB]) => seenA.localeCompare(seenB) || a.localeCompare(b))
      .map(([version, seen]) => {
        const { versions_from: _versionsFrom, ...base } = rider;
        return { ...base, version, start: seen > rider.start ? seen : rider.start };
      })
      .filter((expanded) => !expanded.end || expanded.start <= expanded.end);
  });
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

// computePeerSupersededRate pools the peers' post-supersession old-version raw
// day-deltas into a single mean daily rate — the empirical organic demand for a
// version that has a successor. Returns null when the spec configures no peers or
// no peer has measurable post-supersession days. The first post-supersession day
// (which carries an in-flight release-day residual) is deliberately included: it
// raises the allowance, which errs toward attributing less.
export function computePeerSupersededRate(
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
  spec: LoopRepairSpec,
): number | null {
  const peers = spec.peers ?? [];
  if (peers.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const peer of peers) {
    const series = extractTargetSeries(snapshots, {
      listing_type: peer.listing_type,
      listing_id: peer.listing_id,
      version: peer.version,
    });
    for (const delta of computeRawDayDeltas(series)) {
      if (delta.dateKey < peer.superseded_start) continue;
      total += delta.rawDelta;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}

// Excess over the organic allowance, bounded by the spec's per-day loop-rate cap.
function capSpurious(excess: number, dailySpuriousCap: number | null | undefined): number {
  const spurious = Math.max(0, excess);
  return dailySpuriousCap == null ? spurious : Math.min(spurious, dailySpuriousCap);
}

export interface OrganicAllowanceRates {
  baselineDailyRate: number;
  // Pooled superseded-peer rate; null when no peers are configured (all incident
  // days then use the baseline rate).
  peerSupersededRate: number | null;
}

// computeDaySpuriousEstimates estimates each incident day's excess over the organic
// allowance. Days before the target's superseded_start (old version still the
// latest) allow the baseline-window rate; days from superseded_start on allow only
// the superseded-peer rate — organic demand for an old version collapses once a
// successor exists (observed at ~0-2/day across comparables regardless of install
// base). Every allowance is a mean rounded UP, so estimation always errs toward
// attributing less (the registry's conservative-corrections policy).
export function computeDaySpuriousEstimates(
  series: SnapshotDayValue[],
  spec: LoopRepairSpec,
  target: LoopRepairTarget,
  rates: OrganicAllowanceRates,
): DaySpuriousEstimate[] {
  const baselineAllowance = Math.ceil(Math.max(0, rates.baselineDailyRate));
  const peerAllowance = rates.peerSupersededRate === null
    ? baselineAllowance
    : Math.ceil(Math.max(0, rates.peerSupersededRate));
  const supersededStart = target.superseded_start ?? spec.incident_start;
  const lastDateKey = spec.incident_end ?? series[series.length - 1]?.dateKey ?? spec.incident_start;
  return computeRawDayDeltas(series)
    .filter((delta) => delta.dateKey >= spec.incident_start && delta.dateKey <= lastDateKey)
    .map((delta) => {
      const organicAllowance = delta.dateKey >= supersededStart ? peerAllowance : baselineAllowance;
      return {
        dateKey: delta.dateKey,
        rawDelta: delta.rawDelta,
        organicAllowance,
        spurious: capSpurious(delta.rawDelta - organicAllowance, spec.daily_spurious_cap),
      };
    });
}

// computeAdoptionDayDeltas is computeRawDayDeltas anchored at a release: days
// before release_start (where the version is absent from snapshots) count as a
// zero baseline, so the release day's full delta is the first entry. A missing
// mid-series raw value carries the previous counter forward (delta 0 that day).
function computeAdoptionDayDeltas(series: SnapshotDayValue[], releaseStart: string): DayDelta[] {
  let previousRaw = 0;
  const deltas: DayDelta[] = [];
  for (const day of series) {
    if (day.dateKey < releaseStart) {
      if (day.raw !== null) previousRaw = day.raw;
      continue;
    }
    const raw = day.raw ?? previousRaw;
    deltas.push({ dateKey: day.dateKey, rawDelta: Math.max(0, raw - previousRaw) });
    previousRaw = raw;
  }
  return deltas;
}

// computeCumulativeListingRawBefore measures a listing's install base as the sum of
// every version's raw counter at the last snapshot before dateKey ("adjusted"
// basis: the adjusted counters, net of attribution).
export function computeCumulativeListingRawBefore(
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
  listingType: LoopRepairListingType,
  listingId: string,
  dateKey: string,
  basis: "raw" | "adjusted" = "raw",
): number | null {
  const snapshot = [...snapshots].reverse().find((entry) => entry.dateKey < dateKey);
  if (!snapshot) return null;
  const section = listingType === "map" ? snapshot.data.maps : snapshot.data.mods;
  const counts = basis === "adjusted" ? section?.downloads : section?.raw_downloads ?? section?.downloads;
  const byVersion = counts?.[listingId];
  if (!isObject(byVersion)) return null;
  let total = 0;
  for (const value of Object.values(byVersion)) {
    const count = toFiniteNonNegativeNumber(value);
    if (count !== null) total += count;
  }
  return total;
}

// computeAdoptionFractionCurve pools the adoption peers into a per-day-since-release
// curve of organic update-adoption fractions. Day k takes the MOST generous (max)
// fraction across peers that have a day k — small maps adopt a larger share of their
// base per day, so the max errs toward attributing less for every target size.
export function computeAdoptionFractionCurve(
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
  peers: LoopRepairAdoptionEntry[],
): number[] {
  const curve: number[] = [];
  for (const peer of peers) {
    const base = computeCumulativeListingRawBefore(snapshots, peer.listing_type, peer.listing_id, peer.release_start);
    if (base === null || base <= 0) continue;
    const series = extractTargetSeries(snapshots, {
      listing_type: peer.listing_type,
      listing_id: peer.listing_id,
      version: peer.version,
    });
    const deltas = computeAdoptionDayDeltas(series, peer.release_start);
    deltas.forEach((delta, index) => {
      const fraction = delta.rawDelta / base;
      curve[index] = Math.max(curve[index] ?? 0, fraction);
    });
  }
  return curve;
}

// computeAdoptionDaySpuriousEstimates estimates a new version's daily excess over
// the peer-adoption allowance: curve[day-since-release] × the target's install base,
// rounded UP. Days beyond the curve reuse its last fraction (peer releases predate
// the targets', so this only matters if peer data runs out). dailySpuriousCap is
// the spec's daily_spurious_cap.
export function computeAdoptionDaySpuriousEstimates(
  series: SnapshotDayValue[],
  target: LoopRepairAdoptionEntry,
  curve: number[],
  targetBase: number,
  incidentEnd: string | null | undefined,
  dailySpuriousCap: number | null = null,
): DaySpuriousEstimate[] {
  if (curve.length === 0) {
    throw new Error("Adoption fraction curve is empty; check spec.adoption_peers.");
  }
  return computeAdoptionDayDeltas(series, target.release_start)
    .filter((delta) => !incidentEnd || delta.dateKey <= incidentEnd)
    .map((delta, index) => {
      const fraction = curve[Math.min(index, curve.length - 1)]!;
      const organicAllowance = Math.ceil(fraction * targetBase);
      return {
        dateKey: delta.dateKey,
        rawDelta: delta.rawDelta,
        organicAllowance,
        spurious: capSpurious(delta.rawDelta - organicAllowance, dailySpuriousCap),
      };
    });
}

// Lockstep hours ("YYYY-MM-DDTHH:00Z") per snapshot day: snapshot D covers the
// day ending at its ~04:00Z cutoff, so an hour at or after the cutoff hour
// belongs to the next day's snapshot.
export function countSlotsBySnapshotDay(lockstepHours: string[], cutoffHourUtc = 4): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hour of lockstepHours) {
    const ms = Date.parse(`${hour.slice(0, 13)}:00:00Z`);
    const day = new Date(Number(hour.slice(11, 13)) >= cutoffHourUtc ? ms + 86_400_000 : ms).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

// computeRiderDaySpuriousEstimates attributes, for each snapshot day in the
// rider's window, floor(per_cycle × the core loop's lockstep hours that day),
// never more than the version's raw growth that day. Days before the version
// existed count from zero, like an adoption target.
export function computeRiderDaySpuriousEstimates(
  series: SnapshotDayValue[],
  rider: LoopRepairRiderTarget,
  slotsByDay: Map<string, number>,
  incidentEnd: string | null | undefined,
): DaySpuriousEstimate[] {
  const end = [rider.end, incidentEnd].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  return computeAdoptionDayDeltas(series, rider.start)
    .filter((delta) => !end || delta.dateKey <= end)
    .map((delta) => {
      const loopFetches = Math.floor(rider.per_cycle * (slotsByDay.get(delta.dateKey) ?? 0) + 1e-9);
      const spurious = Math.min(delta.rawDelta, loopFetches);
      return { dateKey: delta.dateKey, rawDelta: delta.rawDelta, organicAllowance: delta.rawDelta - spurious, spurious };
    });
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

export interface SnapshotClampWindow {
  // First snapshot day being corrected (incident_start for superseded targets,
  // release_start for adoption targets).
  start: string;
  // incident_end when set; growth after it resumes at the full raw rate.
  end: string | null;
  // Anchor when no pre-start adjusted value exists. Adoption targets pass 0 (the
  // version did not exist before release); superseded targets omit it so a target
  // with no pre-incident history is skipped rather than clamped to nothing.
  missingAnchorValue?: number;
}

export interface OwnLoopDelta {
  dateKey: string;
  amount: number;
  // applied_delta_ids timestamp, or null for a delta this run is adding.
  appliedAt: string | null;
}

// computeLedgerBound: per snapshot day, the value that snapshot would hold if
// regenerated now — its recorded raw minus its recorded attribution, minus the
// target's own loop-repair deltas it had not counted yet. A delta stamped
// D T12:00Z counts from snapshot D+1 (04:00Z cutoff), and only in a snapshot
// generated after the delta was applied. The clamp trajectory grows by raw
// growth less the target's own estimate, so it misses any OTHER attribution in
// the window — release-day pipeline fetches (±2), or an earlier incident's
// deltas on the same version (the v1 riders on list-B versions, ~90) — and
// leaves history above what a fresh snapshot shows. Days without raw,
// attribution or generated_at are left unbounded.
export function computeLedgerBound(
  snapshots: Array<{ dateKey: string; data: SnapshotFileLike }>,
  target: LoopRepairTarget,
  ownDeltas: OwnLoopDelta[],
): Map<string, number> {
  const bound = new Map<string, number>();
  for (const snapshot of snapshots) {
    const section = target.listing_type === "map" ? snapshot.data.maps : snapshot.data.mods;
    const raw = readVersionValue(section, "raw_downloads", target);
    const attributed = readVersionValue(section, "attributed_downloads", target);
    const generatedAt = typeof snapshot.data.generated_at === "string" ? snapshot.data.generated_at : null;
    if (raw === null || attributed === null || generatedAt === null) continue;
    let missing = 0;
    for (const delta of ownDeltas) {
      if (delta.dateKey > snapshot.dateKey) continue;
      const counted = delta.dateKey < snapshot.dateKey && delta.appliedAt !== null && delta.appliedAt <= generatedAt;
      if (!counted) missing += delta.amount;
    }
    bound.set(snapshot.dateKey, Math.max(0, raw - attributed - missing));
  }
  return bound;
}

// computeSnapshotClampPlan rewrites the window's snapshot trajectory to the
// organic estimate: anchored at the last pre-window adjusted value, growing by the
// raw delta minus that day's spurious estimate (= min(rawDelta, organicAllowance)
// when uncapped). Values are corrected with min(recorded, corrected), so the plan
// is idempotent and never raises history. Mirrors
// ops/backfill-charleston-snapshot-clamp.ts; without it a bucket rebuild from
// history would resurrect the inflated count as a `history-max:` floor.
export function computeSnapshotClampPlan(
  series: SnapshotDayValue[],
  window: SnapshotClampWindow,
  days: DaySpuriousEstimate[],
  // computeLedgerBound's per-day ceiling: the trajectory alone misses any other
  // attribution inside the window.
  ledgerBound?: Map<string, number>,
): SnapshotClampEntry[] {
  const anchorDay = [...series]
    .reverse()
    .find((day) => day.dateKey < window.start && day.adjusted !== null);
  const anchorValue = anchorDay?.adjusted ?? window.missingAnchorValue;
  if (anchorValue === undefined) return [];

  const organicByDate = new Map<string, number>();
  for (const day of days) {
    organicByDate.set(day.dateKey, day.rawDelta - day.spurious);
  }
  const rawDeltaByDate = new Map<string, number>();
  for (const delta of computeRawDayDeltas(series)) {
    rawDeltaByDate.set(delta.dateKey, delta.rawDelta);
  }

  const plan: SnapshotClampEntry[] = [];
  let corrected = anchorValue;
  for (const day of series) {
    if (day.dateKey < window.start) continue;
    // Inside the window growth is capped at the organic allowance; after a closed
    // window (incident_end set) full raw growth resumes, but the accumulated
    // reduction still carries forward so post-incident history stays corrected.
    if (window.end && day.dateKey > window.end) {
      corrected += rawDeltaByDate.get(day.dateKey) ?? 0;
    } else {
      corrected += organicByDate.get(day.dateKey) ?? 0;
    }
    if (day.adjusted === null) continue;
    plan.push({
      dateKey: day.dateKey,
      correctedValue: Math.min(day.adjusted, corrected, ledgerBound?.get(day.dateKey) ?? Number.POSITIVE_INFINITY),
    });
  }
  return plan;
}
