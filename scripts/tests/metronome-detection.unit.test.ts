import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDailyLockstep,
  detectLockstepCohorts,
  measureLocalExcess,
  trackKnownLoop,
  windowHours,
  type HourlySeries,
} from "../lib/metronome-detection.js";

const HOURS = windowHours("2026-10-15", 14);
const LOOP_SLOTS = [2, 9, 15, 21]; // UTC hours-of-day the broken client fires

// Deterministic pseudo-random noise so fixtures are stable across runs.
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function addHit(series: HourlySeries, key: string, hour: string, downloads = 1): void {
  if (!series.has(key)) series.set(key, new Map());
  series.get(key)!.set(hour, (series.get(key)!.get(hour) ?? 0) + downloads);
}

function buildSeries(): HourlySeries {
  const series: HourlySeries = new Map();
  const random = lcg(7);
  for (const hour of HOURS) {
    const hourOfDay = Number(hour.slice(11, 13));
    const day = Math.floor(HOURS.indexOf(hour) / 24);
    // A loop: three small maps fetched together at fixed slots every day.
    if (LOOP_SLOTS.includes(hourOfDay)) {
      for (const key of ["map:loop-a", "map:loop-b", "map:loop-c"]) addHit(series, key, hour);
      // A busy mod the same client also re-fetches.
      addHit(series, "mod:busy-rider", hour);
    }
    // The busy mod's own organic traffic (~25% of hours).
    if (random() < 0.25) addHit(series, "mod:busy-rider", hour);
    // A pack-release wave: four maps co-active for the first three days only.
    if (day < 3 && hourOfDay % 2 === 0) {
      for (const key of ["map:wave-1", "map:wave-2", "map:wave-3", "map:wave-4"]) addHit(series, key, hour);
    }
    // Independent organic noise.
    for (const key of ["map:organic-1", "map:organic-2", "map:organic-3"]) {
      if (random() < 0.08) addHit(series, key, hour);
    }
  }
  return series;
}

test("windowHours covers the days before the end date", () => {
  assert.equal(HOURS.length, 14 * 24);
  assert.equal(HOURS[0], "2026-10-01T00:00Z");
  assert.equal(HOURS.at(-1), "2026-10-14T23:00Z");
});

test("classifyDailyLockstep accepts a flat loop and tolerates one offline day", () => {
  assert.equal(classifyDailyLockstep(Array(14).fill(4)).classification, "metronome");
  // The 2026-10-04 UA pause: one silent day must not reset an established loop.
  assert.equal(classifyDailyLockstep([3, 3, 3, 3, 3, 3, 0, 3, 3, 3, 3, 3, 3, 3]).classification, "metronome");
});

test("classifyDailyLockstep rejects waves, fresh onsets and decay", () => {
  // Release wave: big and synchronized, but gone within days.
  assert.equal(classifyDailyLockstep([10, 9, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0]).classification, "transient");
  // A loop six days old cannot yet be told apart from a wave.
  assert.equal(classifyDailyLockstep([0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5]).classification, "transient");
  // Persistent but fading into the end of the window.
  const decaying = classifyDailyLockstep([12, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3, 2, 2]);
  assert.equal(decaying.classification, "transient");
  assert.match(decaying.reason, /decaying/);
  assert.equal(classifyDailyLockstep([4, 4]).classification, "transient");
});

test("detectLockstepCohorts finds the loop with its rider and ignores the wave", () => {
  const cohorts = detectLockstepCohorts(buildSeries(), HOURS);
  const metronomes = cohorts.filter((cohort) => cohort.classification === "metronome");
  assert.equal(metronomes.length, 1);
  const [loop] = metronomes;
  assert.deepEqual(
    loop!.members.filter((member) => member.role === "core").map((member) => member.key),
    ["map:loop-a", "map:loop-b", "map:loop-c"],
  );
  assert.deepEqual(loop!.members.filter((member) => member.role === "rider").map((member) => member.key), ["mod:busy-rider"]);
  assert.equal(loop!.lockstepHours.length, 14 * LOOP_SLOTS.length);
  assert.deepEqual(loop!.dailyLockstepHours, Array(14).fill(LOOP_SLOTS.length));
  const coreA = loop!.members.find((member) => member.key === "map:loop-a")!;
  assert.equal(coreA.lockstepDownloadsPerDay, LOOP_SLOTS.length);
  assert.equal(coreA.lockstepShare, 1);
  // The wave clusters too, but is classified transient.
  const wave = cohorts.find((cohort) => cohort.members.some((member) => member.key === "map:wave-1"));
  assert.equal(wave?.classification, "transient");
  // Organic noise never forms a cohort.
  assert.ok(!cohorts.some((cohort) => cohort.members.some((member) => member.key.startsWith("map:organic"))));
});

test("trackKnownLoop derives lockstep hours from known members and flags riders", () => {
  const series = buildSeries();
  // A spec that knows only two of the loop's maps still catches the third.
  const loop = trackKnownLoop(series, HOURS, ["map:loop-a", "map:loop-b", "map:not-active"]);
  assert.equal(loop.classification, "metronome");
  assert.deepEqual(loop.members.filter((member) => member.role === "core").map((member) => member.key), ["map:loop-a", "map:loop-b"]);
  assert.deepEqual(
    loop.members.filter((member) => member.role === "rider").map((member) => member.key).sort(),
    ["map:loop-c", "mod:busy-rider"],
  );
  // A known loop that stopped: no lockstep hours, no riders.
  const quiet = trackKnownLoop(series, HOURS, ["map:organic-1"]);
  assert.equal(quiet.lockstepHours.length, 0);
  assert.equal(quiet.classification, "transient");
});

test("trackKnownLoop ignores busy targets when deriving lockstep hours", () => {
  const series = buildSeries();
  // A target active most hours (a popular map hit by the loop) would turn peak
  // hours into "lockstep" hours; it must not define the loop.
  for (const hour of HOURS) if (Number(hour.slice(11, 13)) % 4 !== 3) addHit(series, "map:busy-target", hour);
  const loop = trackKnownLoop(series, HOURS, ["map:busy-target", "map:loop-a", "map:loop-b"]);
  assert.deepEqual(loop.members.filter((member) => member.role === "core").map((member) => member.key), ["map:loop-a", "map:loop-b"]);
  assert.equal(loop.lockstepHours.length, 14 * LOOP_SLOTS.length);
  const onlyBusy = trackKnownLoop(series, HOURS, ["map:busy-target"]);
  assert.equal(onlyBusy.lockstepHours.length, 0);
});

test("measureLocalExcess reads a rider's fetches per loop cycle and drops to zero once it leaves", () => {
  const series = buildSeries();
  const loop = trackKnownLoop(series, HOURS, ["map:loop-a", "map:loop-b", "map:loop-c"]);
  // busy-rider gets exactly one loop fetch per cycle on top of ~25% organic hours.
  const riding = measureLocalExcess(series.get("mod:busy-rider"), HOURS, loop.lockstepHours);
  assert.equal(riding.samples, 14 * LOOP_SLOTS.length);
  assert.ok(Math.abs(riding.mean - 1) < 0.25, `mean ${riding.mean}`);
  assert.ok(riding.standardError > 0);
  // Pure organic traffic has no excess in loop hours.
  const organic = measureLocalExcess(series.get("map:organic-1"), HOURS, loop.lockstepHours);
  assert.ok(Math.abs(organic.mean) < 0.15, `mean ${organic.mean}`);
  // A rider that left the loop: its lockstep-hour fetches stop.
  const left = new Map([...series.get("mod:busy-rider")!].map(([hour, downloads]) =>
    [hour, LOOP_SLOTS.includes(Number(hour.slice(11, 13))) ? Math.max(0, downloads - 1) : downloads]));
  assert.ok(Math.abs(measureLocalExcess(left, HOURS, loop.lockstepHours).mean) < 0.25);
  // An unknown listing or no lockstep hours measures nothing.
  assert.deepEqual(measureLocalExcess(undefined, HOURS, loop.lockstepHours).mean, 0);
  assert.deepEqual(measureLocalExcess(series.get("mod:busy-rider"), HOURS, []), { mean: 0, standardError: 0, samples: 0 });
});
