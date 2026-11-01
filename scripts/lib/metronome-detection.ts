// Detection of "metronome" re-download loops: one broken client re-fetches a
// fixed library of listings on a timer, so every library member registers
// downloads in the same UTC hours, day after day, regardless of popularity
// (KNOWN_INCIDENTS.md metronome v1/v2 entries). Pack-release waves also
// synchronize listings, but they decay within ~3 days; a loop stays flat.
//
// Model, over a window of hourly download buckets:
//   1. cohort cores: listings whose active-hour sets overlap far beyond chance
//      (Jaccard + lift), joined by single linkage — or, for a known loop, the
//      listings its open loop-repair spec targets (trackKnownLoop);
//   2. lockstep hours: hours in which most core members are active;
//   3. riders: other listings (often popular mods, too busy to cluster) whose
//      activity tracks the lockstep hours far beyond their own base rate;
//   4. classification: "metronome" only when lockstep hours persist on most
//      recent days into the end of the window without decaying.
// Calibrated on 2026-07..10 hourly history (14-day window): discovery flags
// metronome v1 and v2 within ~10 days of onset, but long yukina pack-release
// waves can also qualify, so discovered cohorts are review candidates. Known
// loops are tracked from their spec, which catches the loop spreading (the
// eu-maps 0.8.1 versions, the UA cohort's mod riders) without that ambiguity.

export type HourlySeries = Map<string, Map<string, number>>;

// Off-lockstep samples needed before an hour-of-day baseline is trusted.
const MIN_BASELINE_SAMPLES = 5;

export interface MetronomeDetectionParams {
  // Listings need this many active hours in the window to be considered...
  minActiveHours: number;
  // ...and must be idle at least this share of the time (busier listings
  // co-occur with everything by chance and are only eligible as riders).
  maxActivityRatio: number;
  minPairOverlapHours: number;
  minPairJaccard: number;
  minPairLift: number;
  minCohortSize: number;
  // Share of core members active for an hour to count as a lockstep hour.
  lockstepMemberShare: number;
  minLockstepHoursPerDay: number;
  // Qualifying days (≥ minLockstepHoursPerDay) required among the last
  // persistenceDays days, one of the last two among them. Release waves fade
  // within ~9 days; tolerating a gap day keeps a client's day offline (the
  // 2026-10-04 UA pause) from resetting an established loop.
  persistenceDays: number;
  minQualifyingDays: number;
  // Mean lockstep hours/day over the last 3 days vs the busiest 3-day stretch.
  minTailToPeakRatio: number;
  minRiderCoverage: number;
  // z-score of the rider's lockstep hits against its own hour-of-day base
  // rates: a busy listing must beat its chance overlap, not just reach coverage.
  minRiderZ: number;
  minRiderHits: number;
}

// Tuned for a 14-day window (detect-metronome's default).
export const DEFAULT_METRONOME_PARAMS: MetronomeDetectionParams = {
  minActiveHours: 14,
  maxActivityRatio: 0.5,
  minPairOverlapHours: 14,
  minPairJaccard: 0.6,
  minPairLift: 3,
  minCohortSize: 3,
  lockstepMemberShare: 0.6,
  minLockstepHoursPerDay: 2,
  persistenceDays: 12,
  minQualifyingDays: 10,
  minTailToPeakRatio: 0.4,
  minRiderCoverage: 0.6,
  minRiderZ: 5,
  minRiderHits: 10,
};

export interface CohortMemberStats {
  key: string;
  role: "core" | "rider";
  activeHours: number;
  lockstepHits: number;
  // Downloads registered in lockstep hours, per window day.
  lockstepDownloadsPerDay: number;
  // Share of the member's window downloads that fell in lockstep hours.
  lockstepShare: number;
  // Mean downloads per lockstep hour above the member's mean at the same hour
  // of day outside lockstep hours — roughly the fetches each loop cycle adds.
  excessPerLockstepHour: number;
}

export interface LockstepCohort {
  members: CohortMemberStats[];
  lockstepHours: string[];
  dailyLockstepHours: number[];
  classification: "metronome" | "transient";
  reason: string;
}

// The UTC hour buckets ("YYYY-MM-DDTHH:00Z") of the `days` days ending at the
// start of `endDate` (exclusive).
export function windowHours(endDate: string, days: number): string[] {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(endMs)) throw new Error(`Invalid window end '${endDate}'.`);
  const hours: string[] = [];
  for (let ms = endMs - days * 86_400_000; ms < endMs; ms += 3_600_000) {
    hours.push(`${new Date(ms).toISOString().slice(0, 13)}:00Z`);
  }
  return hours;
}

function activeHourSet(series: Map<string, number>, hourIndex: Map<string, number>): Set<number> {
  const active = new Set<number>();
  for (const [hour, downloads] of series) {
    const index = hourIndex.get(hour);
    if (index !== undefined && downloads > 0) active.add(index);
  }
  return active;
}

function intersectionSize(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const value of small) if (large.has(value)) count += 1;
  return count;
}

export function classifyDailyLockstep(
  daily: number[],
  params: MetronomeDetectionParams = DEFAULT_METRONOME_PARAMS,
): { classification: "metronome" | "transient"; reason: string } {
  if (daily.length < 3) return { classification: "transient", reason: "window shorter than 3 days" };
  const qualifies = (count: number) => count >= params.minLockstepHoursPerDay;
  const recent = daily.slice(-params.persistenceDays);
  const qualifying = recent.filter(qualifies).length;
  if (!daily.slice(-2).some(qualifies)) {
    return { classification: "transient", reason: "no lockstep day in the last two days" };
  }
  if (qualifying < params.minQualifyingDays) {
    return {
      classification: "transient",
      reason: `${qualifying} of the last ${recent.length} days in lockstep, need ${params.minQualifyingDays}`,
    };
  }
  const mean3 = (start: number) => (daily[start]! + daily[start + 1]! + daily[start + 2]!) / 3;
  let peak = 0;
  for (let i = 0; i + 2 < daily.length; i += 1) peak = Math.max(peak, mean3(i));
  const tail = mean3(daily.length - 3);
  if (peak > 0 && tail / peak < params.minTailToPeakRatio) {
    return { classification: "transient", reason: `decaying (last-3-day mean ${tail.toFixed(1)} vs peak ${peak.toFixed(1)})` };
  }
  return {
    classification: "metronome",
    reason: `${qualifying} of the last ${recent.length} days in lockstep, not decaying`,
  };
}

interface WindowIndex {
  hours: string[];
  hourIndex: Map<string, number>;
  days: string[];
  // Listing key → indices of its active hours (listings idle all window omitted).
  active: Map<string, Set<number>>;
}

function indexWindow(series: HourlySeries, hours: string[]): WindowIndex {
  const hourIndex = new Map(hours.map((hour, index) => [hour, index]));
  const active = new Map<string, Set<number>>();
  for (const [key, listingSeries] of series) {
    const set = activeHourSet(listingSeries, hourIndex);
    if (set.size > 0) active.set(key, set);
  }
  return { hours, hourIndex, days: [...new Set(hours.map((hour) => hour.slice(0, 10)))], active };
}

// Lockstep hours, member stats and riders for one cohort core. Listings in
// `excludeFromRiders` (core members of any cohort) never ride.
function buildCohort(
  series: HourlySeries,
  window: WindowIndex,
  core: Set<string>,
  excludeFromRiders: Set<string>,
  params: MetronomeDetectionParams,
): LockstepCohort {
  const { hours, hourIndex, days, active } = window;
  const total = hours.length;
  const need = Math.max(2, Math.ceil(params.lockstepMemberShare * core.size));
  const lockstep: number[] = [];
  for (let h = 0; h < total; h += 1) {
    let count = 0;
    for (const key of core) if (active.get(key)?.has(h)) count += 1;
    if (count >= need) lockstep.push(h);
  }
  const lockstepSet = new Set(lockstep);
  const daily = days.map((day) => lockstep.filter((h) => hours[h]!.startsWith(day)).length);

  const stats = (key: string, role: "core" | "rider"): CohortMemberStats => {
    let lockstepDownloads = 0;
    let windowDownloads = 0;
    for (const [hour, downloads] of series.get(key) ?? []) {
      const index = hourIndex.get(hour);
      if (index === undefined) continue;
      windowDownloads += downloads;
      if (lockstepSet.has(index)) lockstepDownloads += downloads;
    }
    const set = active.get(key) ?? new Set<number>();
    const offSum = new Map<string, number>();
    const offCount = new Map<string, number>();
    for (let h = 0; h < total; h += 1) {
      if (lockstepSet.has(h)) continue;
      const hourOfDay = hours[h]!.slice(11, 13);
      offSum.set(hourOfDay, (offSum.get(hourOfDay) ?? 0) + (series.get(key)?.get(hours[h]!) ?? 0));
      offCount.set(hourOfDay, (offCount.get(hourOfDay) ?? 0) + 1);
    }
    let excess = 0;
    for (const h of lockstep) {
      const hourOfDay = hours[h]!.slice(11, 13);
      const baseline = (offCount.get(hourOfDay) ?? 0) > 0 ? offSum.get(hourOfDay)! / offCount.get(hourOfDay)! : 0;
      excess += (series.get(key)?.get(hours[h]!) ?? 0) - baseline;
    }
    return {
      key,
      role,
      activeHours: set.size,
      lockstepHits: intersectionSize(set, lockstepSet),
      lockstepDownloadsPerDay: lockstepDownloads / days.length,
      lockstepShare: windowDownloads > 0 ? lockstepDownloads / windowDownloads : 0,
      excessPerLockstepHour: lockstep.length > 0 ? excess / lockstep.length : 0,
    };
  };
  const members = [...core].sort().map((key) => stats(key, "core"));
  if (lockstep.length > 0) {
    for (const [key, set] of active) {
      if (core.has(key) || excludeFromRiders.has(key) || set.size < params.minRiderHits) continue;
      const hits = intersectionSize(set, lockstepSet);
      if (hits < params.minRiderHits || hits / lockstep.length < params.minRiderCoverage) continue;
      // Chance overlap from the listing's own activity at each hour of day
      // OUTSIDE lockstep hours, so a busy listing whose audience peaks when the
      // loop happens to fire (amba's evenings vs the UA slots) does not ride on
      // diurnal traffic, while a loop firing at the same clock hours every day
      // cannot hide inside its own baseline. An hour of day with too few
      // off-lockstep samples (a loop firing at fixed clock hours, like v1) pools
      // its neighbouring hours — diurnal traffic is smooth hour to hour — and
      // only then falls back to the listing's overall off-lockstep rate.
      const offTotal = new Map<string, number>();
      const offActive = new Map<string, number>();
      let offHours = 0;
      let offHits = 0;
      for (let h = 0; h < total; h += 1) {
        if (lockstepSet.has(h)) continue;
        const hourOfDay = hours[h]!.slice(11, 13);
        offTotal.set(hourOfDay, (offTotal.get(hourOfDay) ?? 0) + 1);
        offHours += 1;
        if (set.has(h)) {
          offActive.set(hourOfDay, (offActive.get(hourOfDay) ?? 0) + 1);
          offHits += 1;
        }
      }
      const offRate = offHours > 0 ? offHits / offHours : 0;
      const baseRate = (hourOfDay: string): number => {
        const hod = Number(hourOfDay);
        for (const spread of [0, 1, 2]) {
          let samples = 0;
          let activeSamples = 0;
          for (let d = -spread; d <= spread; d += 1) {
            const neighbour = String((hod + d + 24) % 24).padStart(2, "0");
            samples += offTotal.get(neighbour) ?? 0;
            activeSamples += offActive.get(neighbour) ?? 0;
          }
          if (samples >= MIN_BASELINE_SAMPLES) return activeSamples / samples;
        }
        return offRate;
      };
      let expected = 0;
      let variance = 0;
      for (const index of lockstep) {
        const p = baseRate(hours[index]!.slice(11, 13));
        expected += p;
        variance += p * (1 - p);
      }
      // No off-lockstep activity at all: every hit is the loop's.
      const z = variance > 0 ? (hits - expected) / Math.sqrt(variance) : hits > expected ? Number.POSITIVE_INFINITY : 0;
      if (z >= params.minRiderZ) {
        members.push(stats(key, "rider"));
      }
    }
  }
  return {
    members,
    lockstepHours: lockstep.map((h) => hours[h]!),
    dailyLockstepHours: daily,
    ...classifyDailyLockstep(daily, params),
  };
}

export interface LocalExcess {
  mean: number;
  standardError: number;
  samples: number;
}

// Mean downloads per lockstep hour above the same day's neighbouring
// off-lockstep hours (±2–3h, at least two of them) — the local measure
// loop-repair rider rates (`per_cycle`) are set from, so a rider's current
// excess compares directly with its spec rate. `hours` must be consecutive.
export function measureLocalExcess(
  listingSeries: Map<string, number> | undefined,
  hours: string[],
  lockstepHours: Iterable<string>,
): LocalExcess {
  const hourIndex = new Map(hours.map((hour, index) => [hour, index]));
  const lockstep = new Set<number>();
  for (const hour of lockstepHours) {
    const index = hourIndex.get(hour);
    if (index !== undefined) lockstep.add(index);
  }
  const value = (index: number) => listingSeries?.get(hours[index]!) ?? 0;
  const diffs: number[] = [];
  for (const index of [...lockstep].sort((a, b) => a - b)) {
    const neighbours = [-3, -2, 2, 3]
      .map((offset) => index + offset)
      .filter((neighbour) => neighbour >= 0 && neighbour < hours.length && !lockstep.has(neighbour));
    if (neighbours.length < 2) continue;
    const baseline = neighbours.reduce((sum, neighbour) => sum + value(neighbour), 0) / neighbours.length;
    diffs.push(value(index) - baseline);
  }
  if (diffs.length === 0) return { mean: 0, standardError: 0, samples: 0 };
  const mean = diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
  const variance = diffs.length > 1
    ? diffs.reduce((sum, diff) => sum + (diff - mean) ** 2, 0) / (diffs.length - 1)
    : 0;
  return { mean, standardError: Math.sqrt(variance / diffs.length), samples: diffs.length };
}

// Tracks an already-known loop (an open spec's targeted listings): its lockstep
// hours come from the known members, so it needs no rediscovery, and any other
// listing tracking those hours rides — the loop spreading to listings the spec
// does not cover. "metronome" classification means the loop is still alive.
export function trackKnownLoop(
  series: HourlySeries,
  hours: string[],
  memberKeys: Iterable<string>,
  params: MetronomeDetectionParams = DEFAULT_METRONOME_PARAMS,
): LockstepCohort {
  const window = indexWindow(series, hours);
  // Only quiet targets define the loop's hours: a busy target (the French
  // loop's paris) is active in peak hours anyway, which would make every
  // popular listing look like a rider.
  const core = new Set([...memberKeys].filter((key) => {
    const size = window.active.get(key)?.size ?? 0;
    return size > 0 && size / hours.length <= params.maxActivityRatio;
  }));
  return buildCohort(series, window, core, new Set(), params);
}

export function detectLockstepCohorts(
  series: HourlySeries,
  hours: string[],
  params: MetronomeDetectionParams = DEFAULT_METRONOME_PARAMS,
): LockstepCohort[] {
  const window = indexWindow(series, hours);
  const { active } = window;
  const total = hours.length;

  const eligible = [...active.keys()]
    .filter((key) => {
      const size = active.get(key)!.size;
      return size >= params.minActiveHours && size / total <= params.maxActivityRatio;
    })
    .sort();
  const neighbors = new Map<string, Set<string>>();
  for (let i = 0; i < eligible.length; i += 1) {
    const a = active.get(eligible[i]!)!;
    for (let j = i + 1; j < eligible.length; j += 1) {
      const b = active.get(eligible[j]!)!;
      const overlap = intersectionSize(a, b);
      if (overlap < params.minPairOverlapHours) continue;
      const jaccard = overlap / (a.size + b.size - overlap);
      const lift = overlap / ((a.size * b.size) / total);
      if (jaccard < params.minPairJaccard || lift < params.minPairLift) continue;
      for (const [x, y] of [[eligible[i]!, eligible[j]!], [eligible[j]!, eligible[i]!]] as const) {
        if (!neighbors.has(x)) neighbors.set(x, new Set());
        neighbors.get(x)!.add(y);
      }
    }
  }

  const seen = new Set<string>();
  const cores: Set<string>[] = [];
  for (const start of [...neighbors.keys()].sort()) {
    if (seen.has(start)) continue;
    const core = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (core.has(key)) continue;
      core.add(key);
      for (const next of neighbors.get(key) ?? []) if (!core.has(next)) stack.push(next);
    }
    for (const key of core) seen.add(key);
    if (core.size >= params.minCohortSize) cores.push(core);
  }
  // Two loops running at once share hours, so a listing already core to one
  // cohort is never counted as another cohort's rider.
  const coreKeys = new Set(cores.flatMap((core) => [...core]));
  return cores.map((core) => buildCohort(series, window, core, coreKeys, params));
}

// --- Silence: has the broken client stopped? ---

export type LoopSilence = "running" | "paused" | "stopped";

// The client's restarts are short (2026-10-04: ~30 h offline, then it came back
// and re-enrolled every listing), so two days without a loop hour is a pause
// worth a look and a week is a stop.
export const LOOP_PAUSED_HOURS = 48;
export const LOOP_STOPPED_HOURS = 168;

function silenceFor(silentHours: number | null): LoopSilence {
  if (silentHours === null || silentHours >= LOOP_STOPPED_HOURS) return "stopped";
  return silentHours >= LOOP_PAUSED_HOURS ? "paused" : "running";
}

// How long a known loop has gone without a lockstep hour at the window end. No
// lockstep hour in the whole window counts as stopped.
export function classifyLoopSilence(
  lockstepHours: string[],
  windowEndMs: number,
): { lastLockstepHour: string | null; silentHours: number | null; silence: LoopSilence } {
  const last = [...lockstepHours].sort().at(-1) ?? null;
  // An hour bucket covers [HH:00, HH:00 + 1h).
  const silentHours = last === null ? null : Math.max(0, Math.floor((windowEndMs - Date.parse(last.replace("Z", ":00Z")) - 3_600_000) / 3_600_000));
  return { lastLockstepHour: last, silentHours, silence: silenceFor(silentHours) };
}

// Deprecated targets (the holdouts) are frozen out of the hourly series, so a
// loop that keeps fetching them shows only on the live release counters. The
// guard keeps the last counters it saw; any growth means the client is still
// fetching. Counts missing this run (an API error) keep their previous value.
export interface CounterWatchState {
  counts: Record<string, number>;
  lastGrowthAt: string;
  checkedAt: string;
}

export function updateCounterWatch(
  previous: CounterWatchState | undefined,
  counts: Record<string, number | null>,
  nowIso: string,
): { state: CounterWatchState; growth: Record<string, number | null>; silentHours: number; silence: LoopSilence; unchecked: boolean } {
  // Nothing could be read this run: keep the state and do not age the silence.
  if (Object.values(counts).every((count) => count === null)) {
    const state = previous ?? { counts: {}, lastGrowthAt: nowIso, checkedAt: nowIso };
    const growth = Object.fromEntries(Object.keys(counts).map((key) => [key, null]));
    return { state, growth, silentHours: 0, silence: "running", unchecked: true };
  }
  const merged: Record<string, number> = { ...(previous?.counts ?? {}) };
  const growth: Record<string, number | null> = {};
  let grew = previous === undefined;
  for (const [key, count] of Object.entries(counts)) {
    if (count === null) {
      growth[key] = null;
      continue;
    }
    const before = previous?.counts[key];
    growth[key] = before === undefined ? null : count - before;
    if (before === undefined || count > before) grew = true;
    merged[key] = count;
  }
  const lastGrowthAt = grew ? nowIso : previous!.lastGrowthAt;
  const silentHours = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(lastGrowthAt)) / 3_600_000));
  return {
    state: { counts: merged, lastGrowthAt, checkedAt: nowIso },
    growth,
    silentHours,
    silence: silenceFor(silentHours),
    unchecked: false,
  };
}
