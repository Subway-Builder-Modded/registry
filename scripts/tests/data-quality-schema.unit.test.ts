import test from "node:test";
import assert from "node:assert/strict";
import {
  DataQualityAnswersFileSchema,
  ManifestDataQualitySchema,
  MapManifestSchema,
} from "@subway-builder-modded/registry-schemas";
import { computeScores, roundScore } from "../lib/data-quality.js";

function makeMapManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    id: "data-quality-schema-map",
    name: "Data Quality Schema Test Map",
    author: "tester",
    github_id: 1,
    description: "desc",
    tags: ["east-asia"],
    gallery: ["gallery/1.webp"],
    is_test: false,
    source: "https://example.com",
    update: { type: "github", repo: "owner/repo" },
    city_code: "AAA",
    country: "TW",
    population: 10,
    residents_total: 10,
    points_count: 1,
    population_count: 1,
    initial_view_state: { latitude: 0, longitude: 0, zoom: 10, bearing: 0 },
    data_source: "TEST",
    source_quality: "high-quality",
    level_of_detail: "high-detail",
    location: "east-asia",
    special_demand: [],
    file_sizes: { "map.zip": 1 },
    ...overrides,
  };
}

const SCORED_BLOCK = {
  tier: "high",
  raw_score: 0.57,
  weighted_score: 0.65,
  rubric_version: 1,
  provenance: "reviewed",
};

const UNKNOWN_MARKER = { tier: "unknown", rubric_version: 1 };

const VALID_ANSWERS_FILE = {
  schema_version: 1,
  id: "yukina-tw-tainan",
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
  notes: "MSA sub-里 measured pop; bounded-Tikhonov NACE fit on NLSC cadastre.",
  sources: ["https://example.com/dataset"],
  provenance: {
    method: "self-reported",
    submitted_by: "ahkimn",
    reviewed_by: null,
    date: "2026-07-23",
  },
};

test("map manifest without data_quality stays valid (pre-migration compat)", () => {
  assert.equal(MapManifestSchema.safeParse(makeMapManifest()).success, true);
});

test("map manifest accepts the unknown marker", () => {
  const result = MapManifestSchema.safeParse(
    makeMapManifest({ data_quality: UNKNOWN_MARKER }),
  );
  assert.equal(result.success, true);
});

test("map manifest accepts a scored data_quality block", () => {
  const result = MapManifestSchema.safeParse(
    makeMapManifest({ data_quality: SCORED_BLOCK }),
  );
  assert.equal(result.success, true);
});

test("scored block requires provenance", () => {
  const { provenance: _omitted, ...withoutProvenance } = SCORED_BLOCK;
  assert.equal(ManifestDataQualitySchema.safeParse(withoutProvenance).success, false);
});

test("manifest provenance rejects self-reported (reviewer-gated)", () => {
  const block = { ...SCORED_BLOCK, provenance: "self-reported" };
  assert.equal(ManifestDataQualitySchema.safeParse(block).success, false);
});

test("unknown marker rejects scores and provenance (strict)", () => {
  assert.equal(
    ManifestDataQualitySchema.safeParse({ ...UNKNOWN_MARKER, weighted_score: 0.5 })
      .success,
    false,
  );
  assert.equal(
    ManifestDataQualitySchema.safeParse({ ...UNKNOWN_MARKER, provenance: "backfill" })
      .success,
    false,
  );
});

test("tier values outside the seven-tier vocabulary are rejected", () => {
  const block = { ...SCORED_BLOCK, tier: "very_high" };
  assert.equal(ManifestDataQualitySchema.safeParse(block).success, false);
});

test("answers file: valid self-reported file parses", () => {
  assert.equal(DataQualityAnswersFileSchema.safeParse(VALID_ANSWERS_FILE).success, true);
});

test("answers file: reviewed/backfill require reviewed_by", () => {
  for (const method of ["reviewed", "backfill"]) {
    const file = {
      ...VALID_ANSWERS_FILE,
      provenance: { ...VALID_ANSWERS_FILE.provenance, method },
    };
    const missing = DataQualityAnswersFileSchema.safeParse(file);
    assert.equal(missing.success, false, `${method} with null reviewed_by must fail`);

    const withReviewer = DataQualityAnswersFileSchema.safeParse({
      ...file,
      provenance: { ...file.provenance, reviewed_by: "maintainer" },
    });
    assert.equal(withReviewer.success, true, `${method} with reviewed_by must pass`);
  }
});

test("answers file: unknown ladder values are rejected", () => {
  const file = {
    ...VALID_ANSWERS_FILE,
    answers: { ...VALID_ANSWERS_FILE.answers, workplace_count: "vibes" },
  };
  assert.equal(DataQualityAnswersFileSchema.safeParse(file).success, false);
});

test("answers file: null od_granularity is accepted", () => {
  const file = {
    ...VALID_ANSWERS_FILE,
    answers: {
      ...VALID_ANSWERS_FILE.answers,
      od_metric: "synthetic_measured_marginals",
      od_granularity: null,
    },
  };
  assert.equal(DataQualityAnswersFileSchema.safeParse(file).success, true);
});

test("answers file: extra keys are rejected (strict)", () => {
  const file = { ...VALID_ANSWERS_FILE, extra: true };
  assert.equal(DataQualityAnswersFileSchema.safeParse(file).success, false);
  const withExtraAnswer = {
    ...VALID_ANSWERS_FILE,
    answers: { ...VALID_ANSWERS_FILE.answers, extra: "x" },
  };
  assert.equal(DataQualityAnswersFileSchema.safeParse(withExtraAnswer).success, false);
});

test("round trip: a scored block computed from a valid answers file parses", () => {
  const parsed = DataQualityAnswersFileSchema.parse(VALID_ANSWERS_FILE);
  const scores = computeScores(parsed.answers);
  const block = {
    tier: scores.tier,
    raw_score: roundScore(scores.raw_score),
    weighted_score: roundScore(scores.weighted_score),
    rubric_version: 1,
    provenance: "reviewed",
  };
  assert.equal(ManifestDataQualitySchema.safeParse(block).success, true);
  // The TW pipeline answers resolve to the doc's §8 result.
  assert.equal(scores.tier, "high");
  assert.equal(roundScore(scores.weighted_score), 0.65);
});
