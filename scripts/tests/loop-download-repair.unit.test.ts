import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAdoptionDaySpuriousEstimates,
  computeAdoptionFractionCurve,
  computeBaselineDailyRate,
  computeCumulativeListingRawBefore,
  computeDaySpuriousEstimates,
  computeLedgerBound,
  computePeerSupersededRate,
  computeRiderDaySpuriousEstimates,
  computeSnapshotClampPlan,
  countSlotsBySnapshotDay,
  expandRiderTargets,
  extractTargetSeries,
  gateOnLoopSlots,
  loopRepairDeltaId,
  normalizeLoopRepairSpec,
  type LoopRepairAdoptionEntry,
  type LoopRepairRiderTarget,
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

test("computeCumulativeListingRawBefore can measure the base net of attribution", () => {
  // target-y 1.0.0 at Aug 5: raw 50, adjusted 20 (30 loop fetches attributed).
  const snapshots = [
    {
      dateKey: "2026-08-05",
      data: {
        maps: {
          downloads: { "target-y": { "1.0.0": 20 } },
          raw_downloads: { "target-y": { "1.0.0": 50 } },
        },
      },
    },
  ];
  assert.equal(computeCumulativeListingRawBefore(snapshots, "map", "target-y", "2026-08-06"), 50);
  assert.equal(computeCumulativeListingRawBefore(snapshots, "map", "target-y", "2026-08-06", "adjusted"), 20);
  assert.throws(
    () => normalizeLoopRepairSpec({
      ...SPEC,
      adoption_targets: [{ ...ADOPTION_TARGET, install_base: "net" }],
      adoption_peers: [ADOPTION_PEER],
    }),
    /install_base to be 'raw' or 'adjusted'/,
  );
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

test("normalizeLoopRepairSpec validates daily_spurious_cap", () => {
  assert.equal(normalizeLoopRepairSpec(SPEC).daily_spurious_cap, null);
  assert.equal(normalizeLoopRepairSpec({ ...SPEC, daily_spurious_cap: 7 }).daily_spurious_cap, 7);
  for (const bad of [0, -1, 6.5, "7"]) {
    assert.throws(
      () => normalizeLoopRepairSpec({ ...SPEC, daily_spurious_cap: bad }),
      /daily_spurious_cap to be a positive integer/,
    );
  }
});

test("computeDaySpuriousEstimates bounds each day at daily_spurious_cap", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, { ...SPEC, daily_spurious_cap: 30 }, TARGET, BASELINE_ONLY);
  // Excess 80/day over the 20/day allowance; the cap keeps 50/day credited as organic.
  assert.deepEqual(days.map((day) => day.spurious), [30, 30]);
  assert.deepEqual(days.map((day) => day.organicAllowance), [20, 20]);
});

test("computeAdoptionDaySpuriousEstimates bounds each day at the cap", () => {
  const snapshots = buildAdoptionSnapshots();
  const curve = computeAdoptionFractionCurve(snapshots, [ADOPTION_PEER]);
  const series = extractTargetSeries(snapshots, {
    listing_type: "map",
    listing_id: "target-y",
    version: "2.0.0",
  });
  // Uncapped excess 27, 15, 6 (see the uncapped test above).
  const days = computeAdoptionDaySpuriousEstimates(series, ADOPTION_TARGET, curve, 50, null, 10);
  assert.deepEqual(days.map((day) => day.spurious), [10, 10, 6]);
});

test("computeSnapshotClampPlan credits excess beyond the cap as organic growth", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const days = computeDaySpuriousEstimates(series, { ...SPEC, daily_spurious_cap: 30 }, TARGET, BASELINE_ONLY);
  // Anchor 1120; organic growth = rawDelta − capped spurious = 100 − 30 = 70/day.
  assert.deepEqual(computeSnapshotClampPlan(series, SPEC_WINDOW, days), [
    { dateKey: "2026-08-07", correctedValue: 1190 },
    { dateKey: "2026-08-08", correctedValue: 1260 },
  ]);
});

test("normalizeLoopRepairSpec validates a per-target adoption incident_end", () => {
  const withEnd = (incidentEnd: string) => ({
    ...SPEC,
    adoption_targets: [{ ...ADOPTION_TARGET, incident_end: incidentEnd }],
    adoption_peers: [ADOPTION_PEER],
  });
  assert.equal(normalizeLoopRepairSpec(withEnd("2026-08-07")).adoption_targets![0]!.incident_end, "2026-08-07");
  assert.throws(() => normalizeLoopRepairSpec(withEnd("2026-08-05")), /incident_end must not be before/);
  const withoutEnd = normalizeLoopRepairSpec({ ...SPEC, adoption_targets: [ADOPTION_TARGET], adoption_peers: [ADOPTION_PEER] });
  assert.equal(withoutEnd.adoption_targets![0]!.incident_end, undefined);
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

// --- Rider (loop-clock) model ---

const RIDER: LoopRepairRiderTarget = {
  listing_type: "map",
  listing_id: "paris-ile-de-france",
  version: "v1.0.0",
  start: "2026-08-07",
  end: null,
  per_cycle: 0.95,
};

test("normalizeLoopRepairSpec validates rider targets and requires a rider loop", () => {
  const withRiders = { ...SPEC, targets: [], rider_loop: { core: [{ listing_type: "map", listing_id: "core-a" }] }, rider_targets: [RIDER] };
  const normalized = normalizeLoopRepairSpec(withRiders);
  assert.equal(normalized.rider_targets![0]!.per_cycle, 0.95);
  assert.equal(normalized.rider_loop!.core[0]!.listing_id, "core-a");
  assert.throws(() => normalizeLoopRepairSpec({ ...withRiders, rider_loop: undefined }), /rider_targets requires spec.rider_loop/);
  assert.throws(() => normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, per_cycle: 0 }] }), /per_cycle/);
  assert.throws(() => normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, end: "2026-08-01" }] }), /end must not be before/);
  const retired = normalizeLoopRepairSpec({
    ...withRiders,
    rider_targets: [{ ...RIDER, asset_source: { repo: "ahkimn/subwaybuilder-jp-maps", tag: "0.4.10", asset_name: "AKJ.zip" } }],
  });
  assert.equal(retired.rider_targets![0]!.asset_source!.tag, "0.4.10");
  assert.throws(
    () => normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, asset_source: { repo: "x", tag: "" } }] }),
    /asset_source.tag/,
  );
  const wildcard = normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, version: "*", versions_from: "2026-10-18" }] });
  assert.equal(wildcard.rider_targets![0]!.versions_from, "2026-10-18");
  assert.throws(() => normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, version: "*" }] }), /versions_from is required/);
  assert.throws(
    () => normalizeLoopRepairSpec({ ...withRiders, rider_targets: [{ ...RIDER, versions_from: "2026-10-18" }] }),
    /versions_from is required with version "\*" and only allowed with it/,
  );
  assert.throws(
    () => normalizeLoopRepairSpec({
      ...withRiders,
      rider_targets: [{ ...RIDER, version: "*", versions_from: "2026-10-18", asset_source: { repo: "x", tag: "y", asset_name: "z" } }],
    }),
    /cannot be combined/,
  );
});

test("expandRiderTargets expands version \"*\" to each version first seen since versions_from", () => {
  const snap = (dateKey: string, versions: Record<string, number>, field: "raw_downloads" | "downloads" = "raw_downloads") =>
    ({ dateKey, data: { mods: { [field]: { "trains": versions } } } });
  const snapshots = [
    snap("2026-10-17", { "v4.2.1": 100 }),
    snap("2026-10-18", { "v4.2.1": 103, "v4.3.0": 3 }),
    snap("2026-10-19", { "v4.2.1": 105, "v4.3.0": 14, "v5.0.0": 19 }),
    // A schema without raw_downloads still counts as seen.
    snap("2026-10-21", { "v4.2.1": 105, "v4.3.0": 20, "v5.0.0": 40, "v5.0.1": 15 }, "downloads"),
  ];
  const explicit: LoopRepairRiderTarget = { listing_type: "mod", listing_id: "trains", version: "v4.2.1", start: "2026-09-25", end: "2026-10-04", per_cycle: 0.9 };
  const wildcard: LoopRepairRiderTarget = { ...explicit, version: "*", versions_from: "2026-10-18", start: "2026-10-19", end: null };
  const expanded = expandRiderTargets([explicit, wildcard], snapshots);
  assert.deepEqual(expanded.map((rider) => [rider.version, rider.start, rider.end]), [
    ["v4.2.1", "2026-09-25", "2026-10-04"],
    // v4.3.0 was first seen before the rider's start: it starts at `start`.
    ["v4.3.0", "2026-10-19", null],
    ["v5.0.0", "2026-10-19", null],
    ["v5.0.1", "2026-10-21", null],
  ]);
  assert.ok(expanded.every((rider) => !("versions_from" in rider)));
  // Delta ids match an explicit entry for the same version.
  assert.equal(
    loopRepairDeltaId("inc", { listing_type: "mod", listing_id: "trains", version: expanded[3]!.version }, "2026-10-21"),
    "manual-loop-repair:inc:trains@v5.0.1:2026-10-21",
  );
  // A closed wildcard drops versions first seen after its end.
  const closed = expandRiderTargets([{ ...wildcard, end: "2026-10-20" }], snapshots);
  assert.deepEqual(closed.map((rider) => rider.version), ["v4.3.0", "v5.0.0"]);
});

test("countSlotsBySnapshotDay assigns hours at/after the 04:00Z cutoff to the next snapshot", () => {
  const slots = countSlotsBySnapshotDay(["2026-08-07T03:00Z", "2026-08-07T04:00Z", "2026-08-07T23:00Z", "2026-08-08T02:00Z"]);
  assert.deepEqual([...slots.entries()].sort(), [["2026-08-07", 1], ["2026-08-08", 3]]);
});

test("computeRiderDaySpuriousEstimates floors per_cycle × slots and caps at raw growth", () => {
  const series = extractTargetSeries(buildSnapshots(), TARGET);
  const slots = new Map([["2026-08-07", 6], ["2026-08-08", 200]]);
  const days = computeRiderDaySpuriousEstimates(series, RIDER, slots, null);
  // Aug 7: floor(0.95 × 6) = 5; Aug 8: floor(0.95 × 200) = 190, capped at the raw delta 100.
  assert.deepEqual(days.map((day) => [day.dateKey, day.spurious]), [["2026-08-07", 5], ["2026-08-08", 100]]);
  // A closed window stops attributing.
  const closed = computeRiderDaySpuriousEstimates(series, { ...RIDER, end: "2026-08-07" }, slots, null);
  assert.deepEqual(closed.map((day) => day.dateKey), ["2026-08-07"]);
  // No slots that day, nothing attributed.
  assert.equal(computeRiderDaySpuriousEstimates(series, RIDER, new Map(), null)[0]!.spurious, 0);
});


test("computeLedgerBound subtracts the target's own deltas a snapshot had not counted yet", () => {
  const target = { listing_type: "map" as const, listing_id: "shenzhen", version: "1.2.0" };
  const snap = (dateKey: string, generatedAt: string, raw: number, attributed: number) => ({
    dateKey,
    data: {
      generated_at: generatedAt,
      maps: {
        downloads: { shenzhen: { "1.2.0": raw - attributed } },
        raw_downloads: { shenzhen: { "1.2.0": raw } },
        attributed_downloads: { shenzhen: { "1.2.0": attributed } },
      },
    },
  });
  // 385 of an earlier incident's attribution already recorded; this target's own
  // deltas (2 + 3) were applied on 10-25 at 23:12.
  const snapshots = [
    snap("2026-08-01", "2026-08-01T04:05:00Z", 900, 385),
    snap("2026-08-02", "2026-08-02T04:05:00Z", 910, 385),
    snap("2026-10-26", "2026-10-26T04:05:00Z", 954, 390),
  ];
  const own = [
    { dateKey: "2026-08-01", amount: 2, appliedAt: "2026-10-25T23:12:00Z" },
    { dateKey: "2026-08-02", amount: 3, appliedAt: "2026-10-25T23:12:00Z" },
  ];
  const bound = computeLedgerBound(snapshots, target, own);
  // Generated before the deltas existed: all own deltas up to that day are missing.
  assert.equal(bound.get("2026-08-01"), 900 - 385 - 2);
  assert.equal(bound.get("2026-08-02"), 910 - 385 - 5);
  // Generated after: its attribution already counts them.
  assert.equal(bound.get("2026-10-26"), 954 - 390);
  // A delta this run is adding (appliedAt null) is missing everywhere.
  assert.equal(computeLedgerBound(snapshots, target, [{ dateKey: "2026-08-02", amount: 3, appliedAt: null }]).get("2026-10-26"), 954 - 390 - 3);
  // Same-day deltas are stamped after the snapshot's cutoff, so never counted there.
  assert.equal(computeLedgerBound([snap("2026-08-02", "2026-10-26T04:05:00Z", 910, 388)], target, own).get("2026-08-02"), 910 - 388 - 3);
  // Without raw/attribution/generated_at the day stays unbounded.
  assert.equal(computeLedgerBound([{ dateKey: "2026-08-01", data: { maps: { downloads: { shenzhen: { "1.2.0": 5 } } } } }], target, own).size, 0);
});

test("computeSnapshotClampPlan applies the ledger bound under the trajectory", () => {
  const series = [
    { dateKey: "2026-07-25", raw: 500, adjusted: 115 },
    { dateKey: "2026-07-26", raw: 510, adjusted: 125 },
    { dateKey: "2026-07-27", raw: 520, adjusted: 135 },
  ];
  const days = [
    { dateKey: "2026-07-26", rawDelta: 10, organicAllowance: 7, spurious: 3 },
    { dateKey: "2026-07-27", rawDelta: 10, organicAllowance: 7, spurious: 3 },
  ];
  // The trajectory (115 + 7 + 7) misses nothing here, but the recorded values sit
  // above it only by the target's own deltas once the bound is applied.
  const plain = computeSnapshotClampPlan(series, { start: "2026-07-26", end: null }, days);
  assert.deepEqual(plain.map((entry) => entry.correctedValue), [122, 129]);
  const bounded = computeSnapshotClampPlan(series, { start: "2026-07-26", end: null }, days, new Map([["2026-07-26", 120], ["2026-07-27", 140]]));
  assert.deepEqual(bounded.map((entry) => entry.correctedValue), [120, 129]);
});

test("gateOnLoopSlots zeroes estimates on days the loop clock never fired", () => {
  const days = [
    { dateKey: "2026-09-01", rawDelta: 9, organicAllowance: 2, spurious: 7 },
    { dateKey: "2026-10-26", rawDelta: 9, organicAllowance: 2, spurious: 7 },
    { dateKey: "2026-10-27", rawDelta: 3, organicAllowance: 1, spurious: 2 },
    { dateKey: "2026-10-28", rawDelta: 1, organicAllowance: 1, spurious: 0 },
  ];
  const slots = new Map([["2026-10-26", 5]]);
  const { days: gated, silentDays } = gateOnLoopSlots(days, slots, "2026-09-08");
  // Before the clock (no hourly data) and loop days pass through; a silent day books nothing.
  assert.deepEqual(gated.map((day) => day.spurious), [7, 7, 0, 0]);
  assert.equal(gated[2]!.organicAllowance, 3);
  assert.deepEqual(silentDays, ["2026-10-27"]);
});
