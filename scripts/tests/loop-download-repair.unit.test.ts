import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAdoptionDaySpuriousEstimates,
  computeAdoptionFractionCurve,
  computeBaselineDailyRate,
  computeCumulativeListingRawBefore,
  computeDaySpuriousEstimates,
  computePeerSupersededRate,
  computeSnapshotClampPlan,
  extractTargetSeries,
  loopRepairDeltaId,
  normalizeLoopRepairSpec,
  type LoopRepairAdoptionEntry,
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
const SPEC_WINDOW = { start: SPEC.incident_start, end: null };

test("computeSnapshotClampPlan grows from the pre-incident anchor by the organic allowance", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, SPEC, TARGET, BASELINE_ONLY);
  const plan = computeSnapshotClampPlan(series, SPEC_WINDOW, days);
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
  const plan = computeSnapshotClampPlan(series, SPEC_WINDOW, days);
  assert.equal(plan[0]!.correctedValue, 1130);
});

test("computeSnapshotClampPlan carries the reduction past a closed incident window", () => {
  const spec: LoopRepairSpec = { ...SPEC, incident_end: "2026-08-07" };
  const snapshots = [...buildSnapshots(), snapshotDay("2026-08-09", 1350)];
  const series = extractTargetSeries(snapshots, TARGET);
  const days = computeDaySpuriousEstimates(series, spec, TARGET, BASELINE_ONLY);
  const plan = computeSnapshotClampPlan(series, { start: spec.incident_start, end: spec.incident_end ?? null }, days);
  // Aug 7 capped at 1140; Aug 8 (+100 raw) and Aug 9 (+30 raw) grow at full raw rate
  // post-window but keep the accumulated reduction.
  assert.deepEqual(plan, [
    { dateKey: "2026-08-07", correctedValue: 1140 },
    { dateKey: "2026-08-08", correctedValue: 1240 },
    { dateKey: "2026-08-09", correctedValue: 1270 },
  ]);
});

// --- Adoption (new-version) model ---

// peer-x: base 100 before release Aug 5, new version 1.1.0 with deltas 5, 10, 8.
// target-y: base 50 before release Aug 6, new version 2.0.0 with deltas 30, 20, 10.
function buildAdoptionSnapshots(): Array<{ dateKey: string; data: SnapshotFileLike }> {
  const day = (
    dateKey: string,
    peerOld: number,
    peerNew: number | null,
    targetOld: number,
    targetNew: number | null,
  ): { dateKey: string; data: SnapshotFileLike } => {
    const versions = (old: number, next: number | null): Record<string, number> => (
      next === null ? { "1.0.0": old } : { "1.0.0": old, "next": next }
    );
    const listing = (old: number, next: number | null, nextKey: string): Record<string, number> => {
      const byVersion: Record<string, number> = { "1.0.0": old };
      if (next !== null) byVersion[nextKey] = next;
      return byVersion;
    };
    void versions;
    return {
      dateKey,
      data: {
        maps: {
          downloads: {
            "peer-x": listing(peerOld, peerNew, "1.1.0"),
            "target-y": listing(targetOld, targetNew, "2.0.0"),
          },
          raw_downloads: {
            "peer-x": listing(peerOld, peerNew, "1.1.0"),
            "target-y": listing(targetOld, targetNew, "2.0.0"),
          },
        },
      },
    };
  };
  return [
    day("2026-08-04", 100, null, 48, null),
    day("2026-08-05", 100, 5, 50, null),
    day("2026-08-06", 100, 15, 50, 30),
    day("2026-08-07", 100, 23, 50, 50),
    day("2026-08-08", 100, 23, 50, 60),
  ];
}

const ADOPTION_PEER: LoopRepairAdoptionEntry = {
  listing_type: "map",
  listing_id: "peer-x",
  version: "1.1.0",
  release_start: "2026-08-05",
};
const ADOPTION_TARGET: LoopRepairAdoptionEntry = {
  listing_type: "map",
  listing_id: "target-y",
  version: "2.0.0",
  release_start: "2026-08-06",
};

test("computeCumulativeListingRawBefore sums all versions at the last prior snapshot", () => {
  const snapshots = buildAdoptionSnapshots();
  assert.equal(computeCumulativeListingRawBefore(snapshots, "map", "peer-x", "2026-08-05"), 100);
  // Target base before Aug 6: 1.0.0 at 50 (new version absent).
  assert.equal(computeCumulativeListingRawBefore(snapshots, "map", "target-y", "2026-08-06"), 50);
  assert.equal(computeCumulativeListingRawBefore(snapshots, "map", "missing", "2026-08-06"), null);
});

test("computeAdoptionFractionCurve includes the release-day delta and normalizes by base", () => {
  const curve = computeAdoptionFractionCurve(buildAdoptionSnapshots(), [ADOPTION_PEER]);
  // Peer deltas 5, 10, 8, 0 over base 100.
  assert.deepEqual(curve, [0.05, 0.1, 0.08, 0]);
});

test("computeAdoptionDaySpuriousEstimates scales the curve to the target base and rounds up", () => {
  const snapshots = buildAdoptionSnapshots();
  const curve = computeAdoptionFractionCurve(snapshots, [ADOPTION_PEER]);
  const series = extractTargetSeries(snapshots, {
    listing_type: "map",
    listing_id: "target-y",
    version: "2.0.0",
  });
  const days = computeAdoptionDaySpuriousEstimates(series, ADOPTION_TARGET, curve, 50, null);
  // Target deltas 30, 20, 10; allowances ceil(0.05*50)=3, ceil(0.1*50)=5, ceil(0.08*50)=4.
  assert.deepEqual(days, [
    { dateKey: "2026-08-06", rawDelta: 30, organicAllowance: 3, spurious: 27 },
    { dateKey: "2026-08-07", rawDelta: 20, organicAllowance: 5, spurious: 15 },
    { dateKey: "2026-08-08", rawDelta: 10, organicAllowance: 4, spurious: 6 },
  ]);
});

test("computeSnapshotClampPlan anchors adoption targets at zero via missingAnchorValue", () => {
  const snapshots = buildAdoptionSnapshots();
  const curve = computeAdoptionFractionCurve(snapshots, [ADOPTION_PEER]);
  const series = extractTargetSeries(snapshots, {
    listing_type: "map",
    listing_id: "target-y",
    version: "2.0.0",
  });
  const days = computeAdoptionDaySpuriousEstimates(series, ADOPTION_TARGET, curve, 50, null);
  const plan = computeSnapshotClampPlan(
    series,
    { start: "2026-08-06", end: null, missingAnchorValue: 0 },
    days,
  );
  // Organic growth min(delta, allowance): 3, 5, 4 → cumulative 3, 8, 12.
  assert.deepEqual(plan, [
    { dateKey: "2026-08-06", correctedValue: 3 },
    { dateKey: "2026-08-07", correctedValue: 8 },
    { dateKey: "2026-08-08", correctedValue: 12 },
  ]);
  // Without missingAnchorValue the superseded-path semantics hold: no anchor → no plan.
  assert.deepEqual(computeSnapshotClampPlan(series, { start: "2026-08-06", end: null }, days), []);
});

test("normalizeLoopRepairSpec requires adoption_peers when adoption_targets is set", () => {
  assert.throws(
    () => normalizeLoopRepairSpec({ ...SPEC, adoption_targets: [ADOPTION_TARGET] }),
    /adoption_targets requires spec.adoption_peers/,
  );
  const normalized = normalizeLoopRepairSpec({
    ...SPEC,
    adoption_targets: [ADOPTION_TARGET],
    adoption_peers: [ADOPTION_PEER],
  });
  assert.equal(normalized.adoption_targets!.length, 1);
  assert.equal(normalized.adoption_peers![0]!.release_start, "2026-08-05");
});
