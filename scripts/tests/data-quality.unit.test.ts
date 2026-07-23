import test from "node:test";
import assert from "node:assert/strict";
import {
  GRANULARITY_LADDER,
  SPATIAL_RESOLUTION_LADDER,
  WORKPLACE_COUNT_LADDER,
  collapseTier,
  ladderWeight,
  tierForWeightedScore,
} from "@subway-builder-modded/registry-schemas";
import {
  computeScores,
  roundScore,
  type DataQualityAnswers,
} from "../lib/data-quality.js";

// Worked examples from docs/data-quality.md §8 ("one per tier"). These pin the
// ladder-weight transcription in data-quality-ladders.ts against the rubric
// doc: if a weight is mistranscribed, at least one of these fails.
interface WorkedExample {
  name: string;
  answers: DataQualityAnswers;
  raw: number;
  weighted: number;
  tier: string;
}

const WORKED_EXAMPLES: WorkedExample[] = [
  {
    // Physical 経済センサス worker mesh (500 m) · employed residents (250 m mesh,
    // ADM4) · full municipal O/D matrix (ADM3).
    name: "JP — very-high (0.76 raw / 0.81 weighted)",
    answers: {
      workplace_count: "physical_measured",
      workplace_granularity: "mesh_500",
      workplace_resolution: "mesh_250",
      workplace_intensity: "measured_per_unit",
      resident_count: "employed_residents",
      resident_granularity: "adm4",
      resident_resolution: "mesh_250",
      resident_intensity: "measured_per_unit",
      od_metric: "full_matrix",
      od_granularity: "adm3",
    },
    raw: 0.76,
    weighted: 0.81,
    tier: "very-high",
  },
  {
    // Physical count on NLSC cadastre + calibrated fit (municipal) · working-age
    // on MSA sub-里 measured-pop blocks (ADM4) · structured marginals (ADM3).
    name: "TW — high (0.57 raw / 0.65 weighted)",
    answers: {
      workplace_count: "physical_measured",
      workplace_granularity: "adm3",
      workplace_resolution: "exact_footprints",
      workplace_intensity: "fine_types_calibrated",
      resident_count: "working_age",
      resident_granularity: "adm4",
      resident_resolution: "mesh_125_or_adm5",
      resident_intensity: "measured_per_unit",
      od_metric: "structured_marginals",
      od_granularity: "adm3",
    },
    raw: 0.57,
    weighted: 0.65,
    tier: "high",
  },
  {
    // Physical on GRPK cadastre · employed residents (250 m mesh) · synthetic O/D
    // from two measured marginals (no grain multiplier).
    name: "LT — medium (0.54 raw / 0.59 weighted)",
    answers: {
      workplace_count: "physical_measured",
      workplace_granularity: "adm3",
      workplace_resolution: "exact_footprints",
      workplace_intensity: "fine_types_calibrated",
      resident_count: "employed_residents",
      resident_granularity: "adm3",
      resident_resolution: "mesh_250",
      resident_intensity: "measured_per_unit",
      od_metric: "synthetic_measured_marginals",
      od_granularity: null,
    },
    raw: 0.54,
    weighted: 0.59,
    tier: "medium",
  },
  {
    // Physical 5th Economic Census count on ML footprints (binary
    // commercial/residential split, 街道 / ADM4) · total population (same
    // footprints & grain) · no O/D (unbounded gravity).
    name: "CN — low (0.16 raw / 0.40 weighted)",
    answers: {
      workplace_count: "physical_measured",
      workplace_granularity: "adm4",
      workplace_resolution: "ml_hybrid_footprints",
      workplace_intensity: "binary_split",
      resident_count: "total_population",
      resident_granularity: "adm4",
      resident_resolution: "ml_hybrid_footprints",
      resident_intensity: "binary_split",
      od_metric: "none",
      od_granularity: null,
    },
    raw: 0.16,
    weighted: 0.4,
    tier: "low",
  },
  {
    // Estimated proxy on ML footprints (oblast grain) · total population
    // (hromada grain) · prior-informed synthetic O/D (GIPF).
    name: "UA — very-low (0.08 raw / 0.17 weighted)",
    answers: {
      workplace_count: "estimated_proxy",
      workplace_granularity: "adm1",
      workplace_resolution: "ml_hybrid_footprints",
      workplace_intensity: "fine_types_generic",
      resident_count: "total_population",
      resident_granularity: "adm3",
      resident_resolution: "ml_hybrid_footprints",
      resident_intensity: "fine_types_generic",
      od_metric: "prior_informed_synthetic",
      od_granularity: null,
    },
    raw: 0.08,
    weighted: 0.17,
    tier: "very-low",
  },
  {
    // OSM patcher: no census anchor anywhere, so G = 0 zeroes every pillar
    // regardless of footprint placement.
    name: "OSM patcher — absent (0.00 raw / 0.00 weighted)",
    answers: {
      workplace_count: "none",
      workplace_granularity: "none",
      workplace_resolution: "osm_footprints",
      workplace_intensity: "size_only",
      resident_count: "none",
      resident_granularity: "none",
      resident_resolution: "osm_footprints",
      resident_intensity: "size_only",
      od_metric: "none",
      od_granularity: null,
    },
    raw: 0,
    weighted: 0,
    tier: "absent",
  },
];

for (const example of WORKED_EXAMPLES) {
  test(`computeScores reproduces ${example.name}`, () => {
    const result = computeScores(example.answers);
    assert.equal(roundScore(result.raw_score), example.raw);
    assert.equal(roundScore(result.weighted_score), example.weighted);
    assert.equal(result.tier, example.tier);
  });
}

test("pillar breakdown matches the doc's JP factors", () => {
  const result = computeScores(WORKED_EXAMPLES[0].answers);
  // workplace_raw = 1.0 × (0.85 × 1.0) × 0.90 = 0.765; weighted = 0.925 × 0.90.
  assert.equal(roundScore(result.pillars.workplace.raw), 0.77);
  assert.equal(roundScore(result.pillars.workplace.weighted), 0.83);
  assert.equal(roundScore(result.pillars.od.raw), 0.7);
});

test("od_granularity null omits the grain multiplier (G ≡ 1)", () => {
  const withNull = computeScores(WORKED_EXAMPLES[2].answers);
  assert.equal(roundScore(withNull.pillars.od.raw), 0.25);
});

test("tier thresholds land on documented boundaries", () => {
  assert.equal(tierForWeightedScore(0.75), "very-high");
  assert.equal(tierForWeightedScore(0.749), "high");
  assert.equal(tierForWeightedScore(0.6), "high");
  assert.equal(tierForWeightedScore(0.599), "medium");
  assert.equal(tierForWeightedScore(0.45), "medium");
  assert.equal(tierForWeightedScore(0.449), "low");
  assert.equal(tierForWeightedScore(0.3), "low");
  assert.equal(tierForWeightedScore(0.299), "very-low");
  assert.equal(tierForWeightedScore(0.15), "very-low");
  assert.equal(tierForWeightedScore(0.149), "absent");
  assert.equal(tierForWeightedScore(0), "absent");
});

test("collapseTier maps tiers onto the frozen legacy vocabulary", () => {
  assert.equal(collapseTier("very-high"), "high-quality");
  assert.equal(collapseTier("high"), "high-quality");
  assert.equal(collapseTier("medium"), "medium-quality");
  assert.equal(collapseTier("low"), "low-quality");
  assert.equal(collapseTier("very-low"), "low-quality");
  assert.equal(collapseTier("absent"), "low-quality");
  assert.equal(collapseTier("unknown"), null);
});

test("R ladder carries the mesh_500 rung between mesh_250 and ML footprints", () => {
  const weights = SPATIAL_RESOLUTION_LADDER.map((r) => r.weight);
  assert.equal(ladderWeight(SPATIAL_RESOLUTION_LADDER, "mesh_500"), 0.75);
  // The ladder stays strictly descending so rungs keep a total order.
  for (let i = 1; i < weights.length; i += 1) {
    assert.ok(weights[i] < weights[i - 1], `R ladder not descending at index ${i}`);
  }
});

test("ladderWeight throws on unknown values", () => {
  assert.throws(
    () => ladderWeight(WORKPLACE_COUNT_LADDER, "not-a-rung" as never),
    /Unknown data-quality ladder value/,
  );
  assert.throws(() => ladderWeight(GRANULARITY_LADDER, "adm9" as never));
});
