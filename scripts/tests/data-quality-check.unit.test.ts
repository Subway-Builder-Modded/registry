import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_QUALITY_REPORT_MARKER,
  PROVISIONAL_OD_GRANULARITY,
  buildProvisionalReport,
  checkMapDataQuality,
  computeProvisionalScores,
} from "../lib/data-quality-check.js";
import { computeScores, roundScore } from "../lib/data-quality.js";
import type { DataQualityAnswers } from "../lib/data-quality.js";

const ID = "yukina-tw-tainan";

// TW pipeline answers — resolve to 0.57 raw / 0.65 weighted / high (doc §8).
const ANSWERS: DataQualityAnswers = {
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
};

function makeAnswersFile(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    id: ID,
    answers: { ...ANSWERS },
    notes: "Test pipeline notes.",
    provenance: {
      method: "reviewed",
      submitted_by: "ahkimn",
      reviewed_by: "maintainer",
      date: "2026-07-23",
    },
    ...overrides,
  };
}

function selfReported(overrides: Record<string, unknown> = {}) {
  return makeAnswersFile({
    provenance: {
      method: "self-reported",
      submitted_by: "ahkimn",
      reviewed_by: null,
      date: "2026-07-23",
    },
    ...overrides,
  });
}

const SCORED_BLOCK = {
  tier: "high",
  raw_score: 0.57,
  weighted_score: 0.65,
  rubric_version: 1,
  provenance: "reviewed",
};

const UNKNOWN_MARKER = { tier: "unknown", rubric_version: 1 };

test("no data_quality anywhere passes (pre-migration state)", () => {
  assert.deepEqual(checkMapDataQuality({ id: ID }), []);
});

test("requirePresence flags maps without a data_quality block", () => {
  const errors = checkMapDataQuality({ id: ID }, { requirePresence: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /presence is required/);
});

test("unknown marker with self-reported answers passes (pending review)", () => {
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: UNKNOWN_MARKER,
    answersFile: selfReported(),
  });
  assert.deepEqual(errors, []);
});

test("scored block with matching reviewed answers passes", () => {
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: SCORED_BLOCK,
    answersFile: makeAnswersFile(),
  });
  assert.deepEqual(errors, []);
});

test("confirmed answers without a manifest block fail", () => {
  const errors = checkMapDataQuality({ id: ID, answersFile: makeAnswersFile() });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /has no data_quality block/);
});

test("confirmed answers with an unknown-marker manifest fail", () => {
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: UNKNOWN_MARKER,
    answersFile: makeAnswersFile(),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown marker/);
});

test("scored block without an answers file fails", () => {
  const errors = checkMapDataQuality({ id: ID, manifestDataQuality: SCORED_BLOCK });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires maps\/yukina-tw-tainan\/data-quality\.json/);
});

test("scored block with only self-reported answers fails (reviewer gate)", () => {
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: SCORED_BLOCK,
    answersFile: selfReported(),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /reviewed\/backfill/);
});

test("tier and score mismatches are reported", () => {
  const tierMismatch = checkMapDataQuality({
    id: ID,
    manifestDataQuality: { ...SCORED_BLOCK, tier: "very-high" },
    answersFile: makeAnswersFile(),
  });
  assert.equal(tierMismatch.length, 1);
  assert.match(tierMismatch[0], /does not match recomputed tier/);

  const scoreMismatch = checkMapDataQuality({
    id: ID,
    manifestDataQuality: { ...SCORED_BLOCK, weighted_score: 0.66 },
    answersFile: makeAnswersFile(),
  });
  assert.equal(scoreMismatch.length, 1);
  assert.match(scoreMismatch[0], /weighted_score 0.66 does not match recomputed 0.65/);
});

test("rubric_version mismatch is reported before recompute", () => {
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: { ...SCORED_BLOCK, rubric_version: 2 },
    answersFile: makeAnswersFile(),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rubric_version 2 does not match/);
});

test("id mismatch between file and directory is reported", () => {
  const errors = checkMapDataQuality({
    id: "some-other-map",
    answersFile: selfReported(),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match the map directory/);
});

test("confirmed grain-carrying O/D with null grain fails", () => {
  const file = makeAnswersFile({
    answers: { ...ANSWERS, od_granularity: null },
  });
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: SCORED_BLOCK,
    answersFile: file,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /od_granularity is null/);
});

test("invalid shapes are reported with schema details", () => {
  const badManifest = checkMapDataQuality({
    id: ID,
    manifestDataQuality: { tier: "very_high" },
  });
  assert.equal(badManifest.length, 1);
  assert.match(badManifest[0], /manifest data_quality is invalid/);

  const badAnswers = checkMapDataQuality({
    id: ID,
    answersFile: { schema_version: 1 },
  });
  assert.equal(badAnswers.length, 1);
  assert.match(badAnswers[0], /data-quality\.json is invalid/);
});

test("provisional scoring assumes ADM3 for blank grain-carrying O/D", () => {
  const provisional = computeProvisionalScores({ ...ANSWERS, od_granularity: null });
  const explicit = computeScores({ ...ANSWERS, od_granularity: PROVISIONAL_OD_GRANULARITY });
  assert.equal(provisional.assumedOdGranularity, true);
  assert.equal(provisional.weighted_score, explicit.weighted_score);

  const grainless = computeProvisionalScores({
    ...ANSWERS,
    od_metric: "synthetic_measured_marginals",
    od_granularity: null,
  });
  assert.equal(grainless.assumedOdGranularity, false);
});

test("provisional report includes marker, scores, and assumption flag", () => {
  const report = buildProvisionalReport([
    {
      path: `maps/${ID}/data-quality.json`,
      file: selfReported({
        answers: { ...ANSWERS, od_granularity: null },
      }) as never,
    },
    { path: "maps/broken-map/data-quality.json", error: "bad json" },
  ]);
  assert.match(report, new RegExp(DATA_QUALITY_REPORT_MARKER));
  assert.match(report, /pending reviewer confirmation/);
  assert.match(report, /Tier: \*\*high\*\*/);
  assert.match(report, /provisionally assumed \*\*adm3\*\*/);
  assert.match(report, /❌ Invalid: bad json/);
});

test("report round-trips the recomputed composite scores", () => {
  const file = makeAnswersFile() as never;
  const report = buildProvisionalReport([{ path: `maps/${ID}/data-quality.json`, file }]);
  const scores = computeScores(ANSWERS);
  assert.match(report, new RegExp(`\\*\\*${roundScore(scores.raw_score)}\\*\\*`));
  assert.match(report, new RegExp(`\\*\\*${roundScore(scores.weighted_score)}\\*\\*`));
});
