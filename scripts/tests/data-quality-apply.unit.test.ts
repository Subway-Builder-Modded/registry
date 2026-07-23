import test from "node:test";
import assert from "node:assert/strict";
import { applyDataQualityAnswers } from "../lib/data-quality-apply.js";
import { checkMapDataQuality } from "../lib/data-quality-check.js";
import type { DataQualityAnswers } from "../lib/data-quality.js";

const ID = "yukina-tw-tainan";

// TW pipeline answers — 0.57 raw / 0.65 weighted / high (doc §8).
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

function selfReported(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    id: ID,
    answers: { ...ANSWERS },
    notes: "Submitted via the data-quality form.",
    provenance: {
      method: "self-reported",
      submitted_by: "author-login",
      reviewed_by: null,
      date: "2026-07-01",
    },
    ...overrides,
  };
}

const OPTIONS = { reviewer: "maintainer", date: "2026-07-23" };

test("confirms self-reported answers and derives the scored block", () => {
  const result = applyDataQualityAnswers(ID, selfReported(), OPTIONS);
  assert.equal(result.provenanceFlipped, true);
  assert.equal(result.answersFile.provenance.method, "reviewed");
  assert.equal(result.answersFile.provenance.reviewed_by, "maintainer");
  assert.equal(result.answersFile.provenance.date, "2026-07-23");
  // submitted_by attribution is preserved.
  assert.equal(result.answersFile.provenance.submitted_by, "author-login");
  assert.deepEqual(result.manifestBlock, {
    tier: "high",
    raw_score: 0.57,
    weighted_score: 0.65,
    rubric_version: 1,
    provenance: "reviewed",
  });
});

test("applied output passes the CI consistency check", () => {
  const result = applyDataQualityAnswers(ID, selfReported(), OPTIONS);
  const errors = checkMapDataQuality({
    id: ID,
    manifestDataQuality: result.manifestBlock,
    answersFile: result.answersFile,
  });
  assert.deepEqual(errors, []);
});

test("already-reviewed and backfill answers pass through unchanged", () => {
  const reviewed = selfReported({
    provenance: {
      method: "reviewed",
      submitted_by: "author-login",
      reviewed_by: "earlier-reviewer",
      date: "2026-07-10",
    },
  });
  const result = applyDataQualityAnswers(ID, reviewed, OPTIONS);
  assert.equal(result.provenanceFlipped, false);
  assert.equal(result.answersFile.provenance.reviewed_by, "earlier-reviewer");
  assert.equal(result.answersFile.provenance.date, "2026-07-10");

  const backfill = selfReported({
    provenance: {
      method: "backfill",
      submitted_by: "maintainer",
      reviewed_by: "maintainer",
      date: "2026-07-23",
    },
  });
  const backfillResult = applyDataQualityAnswers(ID, backfill, OPTIONS);
  assert.equal(backfillResult.manifestBlock.provenance, "backfill");
});

test("rejects a grain-carrying O/D metric with a null grain", () => {
  const file = selfReported({
    answers: { ...ANSWERS, od_granularity: null },
  });
  assert.throws(() => applyDataQualityAnswers(ID, file, OPTIONS), /set the grain/);
});

test("rejects id mismatches and invalid files", () => {
  assert.throws(
    () => applyDataQualityAnswers("some-other-map", selfReported(), OPTIONS),
    /must match the map directory/,
  );
  assert.throws(
    () => applyDataQualityAnswers(ID, { schema_version: 1 }, OPTIONS),
    /is invalid/,
  );
});
