import test from "node:test";
import assert from "node:assert/strict";
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

const TARGET: LoopRepairTarget = {
  listing_type: "map",
  listing_id: "paris-ile-de-france",
  version: "v1.0.0",
};

const SPEC: LoopRepairSpec = {
  incident: "loop-test",
  source: "manual-correction/loop-test",
  targets: [TARGET],
  incident_start: "2026-08-07",
  baseline_start: "2026-08-01",
  baseline_end: "2026-08-06",
  incident_end: null,
};

function snapshotDay(dateKey: string, raw: number, adjusted = raw): { dateKey: string; data: SnapshotFileLike } {
  return {
    dateKey,
    data: {
      maps: {
        downloads: { [TARGET.listing_id]: { [TARGET.version]: adjusted } },
        raw_downloads: { [TARGET.listing_id]: { [TARGET.version]: raw } },
      },
    },
  };
}

// Cumulative raw counter: 20/day through Aug 6, then 100/day (loop inflation).
function buildSnapshots(): Array<{ dateKey: string; data: SnapshotFileLike }> {
  return [
    snapshotDay("2026-07-31", 1000),
    snapshotDay("2026-08-01", 1020),
    snapshotDay("2026-08-02", 1040),
    snapshotDay("2026-08-03", 1060),
    snapshotDay("2026-08-04", 1080),
    snapshotDay("2026-08-05", 1100),
    snapshotDay("2026-08-06", 1120),
    snapshotDay("2026-08-07", 1220),
    snapshotDay("2026-08-08", 1320),
  ];
}

test("normalizeLoopRepairSpec validates window ordering", () => {
  assert.throws(
    () => normalizeLoopRepairSpec({ ...SPEC, baseline_end: "2026-08-07" }),
    /baseline_end must be before/,
  );
  assert.throws(
    () => normalizeLoopRepairSpec({ ...SPEC, incident_end: "2026-08-01" }),
    /incident_end must not be before/,
  );
  const normalized = normalizeLoopRepairSpec({ ...SPEC, incident_end: null });
  assert.equal(normalized.incident, "loop-test");
  assert.equal(normalized.incident_end, null);
});

test("extractTargetSeries falls back to adjusted when raw is absent", () => {
  const withoutRaw = {
    dateKey: "2026-08-01",
    data: { maps: { downloads: { [TARGET.listing_id]: { [TARGET.version]: 55 } } } },
  };
  const series = extractTargetSeries([withoutRaw], TARGET);
  assert.deepEqual(series, [{ dateKey: "2026-08-01", raw: 55, adjusted: 55 }]);
});

test("computeBaselineDailyRate averages raw deltas inside the window", () => {
  const baseline = computeBaselineDailyRate(extractTargetSeries(buildSnapshots(), TARGET), SPEC);
  assert.equal(baseline, 20);
});

test("computeBaselineDailyRate returns null when the window has no data", () => {
  const series = extractTargetSeries(buildSnapshots().slice(7), TARGET);
  assert.equal(computeBaselineDailyRate(series, SPEC), null);
});

test("computeDaySpuriousEstimates rounds the allowance up and clamps at zero", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, SPEC, 20.4);
  assert.deepEqual(days, [
    { dateKey: "2026-08-07", rawDelta: 100, organicAllowance: 21, spurious: 79 },
    { dateKey: "2026-08-08", rawDelta: 100, organicAllowance: 21, spurious: 79 },
  ]);
});

test("computeDaySpuriousEstimates respects incident_end", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, { ...SPEC, incident_end: "2026-08-07" }, 20);
  assert.deepEqual(days.map((day) => day.dateKey), ["2026-08-07"]);
});

test("loopRepairDeltaId is stable per incident, target, and day", () => {
  assert.equal(
    loopRepairDeltaId("loop-test", TARGET, "2026-08-07"),
    "manual-loop-repair:loop-test:paris-ile-de-france@v1.0.0:2026-08-07",
  );
});

test("computeSnapshotClampPlan grows from the pre-incident anchor by the organic allowance", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, SPEC, 20);
  const plan = computeSnapshotClampPlan(series, SPEC, days);
  // Anchor 1120 (Aug 6 adjusted); organic allowance 20/day.
  assert.deepEqual(plan, [
    { dateKey: "2026-08-07", correctedValue: 1140 },
    { dateKey: "2026-08-08", correctedValue: 1160 },
  ]);
});

test("computeSnapshotClampPlan never raises a recorded value", () => {
  const snapshots = buildSnapshots();
  // Recorded adjusted value already below the organic trajectory (e.g. attribution landed).
  snapshots[7] = snapshotDay("2026-08-07", 1220, 1130);
  const series = extractTargetSeries(snapshots, TARGET);
  const days = computeDaySpuriousEstimates(series, SPEC, 20);
  const plan = computeSnapshotClampPlan(series, SPEC, days);
  assert.equal(plan[0]!.correctedValue, 1130);
});

test("computeSnapshotClampPlan carries the reduction past a closed incident window", () => {
  const spec: LoopRepairSpec = { ...SPEC, incident_end: "2026-08-07" };
  const snapshots = [...buildSnapshots(), snapshotDay("2026-08-09", 1350)];
  const series = extractTargetSeries(snapshots, TARGET);
  const days = computeDaySpuriousEstimates(series, spec, 20);
  const plan = computeSnapshotClampPlan(series, spec, days);
  // Aug 7 capped at 1140; Aug 8 (+100 raw) and Aug 9 (+30 raw) grow at full raw rate
  // post-window but keep the accumulated reduction.
  assert.deepEqual(plan, [
    { dateKey: "2026-08-07", correctedValue: 1140 },
    { dateKey: "2026-08-08", correctedValue: 1240 },
    { dateKey: "2026-08-09", correctedValue: 1270 },
  ]);
});
