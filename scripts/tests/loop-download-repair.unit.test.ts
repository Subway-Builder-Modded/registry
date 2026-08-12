import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBaselineDailyRate,
  computeDaySpuriousEstimates,
  computePeerSupersededRate,
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
  const days = computeDaySpuriousEstimates(series, SPEC, TARGET, {
    baselineDailyRate: 20.4,
    peerSupersededRate: null,
  });
  assert.deepEqual(days, [
    { dateKey: "2026-08-07", rawDelta: 100, organicAllowance: 21, spurious: 79 },
    { dateKey: "2026-08-08", rawDelta: 100, organicAllowance: 21, spurious: 79 },
  ]);
});

test("computeDaySpuriousEstimates respects incident_end", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(
    series,
    { ...SPEC, incident_end: "2026-08-07" },
    TARGET,
    { baselineDailyRate: 20, peerSupersededRate: null },
  );
  assert.deepEqual(days.map((day) => day.dateKey), ["2026-08-07"]);
});

test("computeDaySpuriousEstimates switches to the peer allowance at superseded_start", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const target: LoopRepairTarget = { ...TARGET, superseded_start: "2026-08-08" };
  const days = computeDaySpuriousEstimates(series, SPEC, target, {
    baselineDailyRate: 20,
    peerSupersededRate: 0.8,
  });
  // Aug 7 (pre-supersession): baseline allowance 20; Aug 8 on: peer allowance ceil(0.8)=1.
  assert.deepEqual(days, [
    { dateKey: "2026-08-07", rawDelta: 100, organicAllowance: 20, spurious: 80 },
    { dateKey: "2026-08-08", rawDelta: 100, organicAllowance: 1, spurious: 99 },
  ]);
});

test("computePeerSupersededRate pools post-supersession deltas across peers", () => {
  const day = (dateKey: string, aRaw: number, bRaw: number): { dateKey: string; data: SnapshotFileLike } => ({
    dateKey,
    data: {
      maps: {
        downloads: { "peer-a": { "1.0.0": aRaw }, "peer-b": { "1.0.0": bRaw } },
        raw_downloads: { "peer-a": { "1.0.0": aRaw }, "peer-b": { "1.0.0": bRaw } },
      },
    },
  });
  const snapshots = [
    day("2026-08-04", 100, 200),
    day("2026-08-05", 110, 202),
    day("2026-08-06", 112, 203),
    day("2026-08-07", 112, 203),
  ];
  const spec: LoopRepairSpec = {
    ...SPEC,
    peers: [
      { listing_type: "map", listing_id: "peer-a", version: "1.0.0", superseded_start: "2026-08-05" },
      { listing_type: "map", listing_id: "peer-b", version: "1.0.0", superseded_start: "2026-08-05" },
    ],
  };
  // peer-a deltas from Aug 5: 10, 2, 0; peer-b: 2, 1, 0 → mean 15/6 = 2.5.
  assert.equal(computePeerSupersededRate(snapshots, spec), 2.5);
  assert.equal(computePeerSupersededRate(snapshots, { ...spec, peers: [] }), null);
});

test("loopRepairDeltaId is stable per incident, target, and day", () => {
  assert.equal(
    loopRepairDeltaId("loop-test", TARGET, "2026-08-07"),
    "manual-loop-repair:loop-test:paris-ile-de-france@v1.0.0:2026-08-07",
  );
});

const BASELINE_ONLY = { baselineDailyRate: 20, peerSupersededRate: null };

test("computeSnapshotClampPlan grows from the pre-incident anchor by the organic allowance", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, SPEC, TARGET, BASELINE_ONLY);
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
  const days = computeDaySpuriousEstimates(series, SPEC, TARGET, BASELINE_ONLY);
  const plan = computeSnapshotClampPlan(series, SPEC, days);
  assert.equal(plan[0]!.correctedValue, 1130);
});

test("computeSnapshotClampPlan carries the reduction past a closed incident window", () => {
  const spec: LoopRepairSpec = { ...SPEC, incident_end: "2026-08-07" };
  const snapshots = [...buildSnapshots(), snapshotDay("2026-08-09", 1350)];
  const series = extractTargetSeries(snapshots, TARGET);
  const days = computeDaySpuriousEstimates(series, spec, TARGET, BASELINE_ONLY);
  const plan = computeSnapshotClampPlan(series, spec, days);
  // Aug 7 capped at 1140; Aug 8 (+100 raw) and Aug 9 (+30 raw) grow at full raw rate
  // post-window but keep the accumulated reduction.
  assert.deepEqual(plan, [
    { dateKey: "2026-08-07", correctedValue: 1140 },
    { dateKey: "2026-08-08", correctedValue: 1240 },
    { dateKey: "2026-08-09", correctedValue: 1270 },
  ]);
});
