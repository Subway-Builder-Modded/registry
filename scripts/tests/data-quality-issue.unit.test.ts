import test from "node:test";
import assert from "node:assert/strict";
import {
  GRANULARITY_LADDER,
  OD_METRIC_LADDER,
  RESIDENT_COUNT_LADDER,
  RESIDENT_PLACEMENT_FORM_OPTIONS,
  WORKPLACE_COUNT_LADDER,
  WORKPLACE_PLACEMENT_FORM_OPTIONS,
  type DataQualityAnswersFile,
} from "@subway-builder-modded/registry-schemas";
import {
  parseDataQualityIssue,
  resolveInheritance,
  type InheritanceCandidate,
} from "../lib/data-quality-issue.js";

function label(ladder: readonly { value: string; formLabel: string | null }[], value: string): string {
  const rung = ladder.find((r) => r.value === value);
  assert.ok(rung?.formLabel, `no form label for ${value}`);
  return rung.formLabel;
}

// The TW pipeline expressed as form labels (as the issue parser would emit).
const FULL_ISSUE: Record<string, unknown> = {
  "map-id": "yukina-tw-tainan",
  "same-methodology": "_No response_",
  "dq-workplace-source": label(WORKPLACE_COUNT_LADDER, "physical_measured"),
  "dq-workplace-detail": label(GRANULARITY_LADDER, "adm3"),
  "dq-workplace-placement": WORKPLACE_PLACEMENT_FORM_OPTIONS[1].formLabel,
  "dq-residence-source": label(RESIDENT_COUNT_LADDER, "working_age"),
  "dq-residence-detail": label(GRANULARITY_LADDER, "adm4"),
  "dq-residence-placement": RESIDENT_PLACEMENT_FORM_OPTIONS[0].formLabel,
  "dq-od": label(OD_METRIC_LADDER, "structured_marginals"),
  "dq-od-detail": label(GRANULARITY_LADDER, "adm3"),
  methodology: "Bounded-Tikhonov NACE fit on NLSC cadastre.",
  sources: "https://example.test/a\nhttps://example.test/b",
};

test("parses a full answers submission from form labels", () => {
  const { input, errors } = parseDataQualityIssue(FULL_ISSUE);
  assert.deepEqual(errors, []);
  assert.ok(input);
  assert.equal(input.sameMethodology, false);
  assert.deepEqual(input.answers, {
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
  });
  assert.deepEqual(input.sources, [
    "https://example.test/a",
    "https://example.test/b",
  ]);
});

test("grainless O/D metrics null the grain even when one was selected", () => {
  const { input } = parseDataQualityIssue({
    ...FULL_ISSUE,
    "dq-od": label(OD_METRIC_LADDER, "none"),
    "dq-od-detail": label(GRANULARITY_LADDER, "adm3"),
  });
  assert.equal(input?.answers?.od_granularity, null);
});

test("same-methodology Yes skips the dropdowns entirely", () => {
  const { input, errors } = parseDataQualityIssue({
    "map-id": "yukina-akita",
    "same-methodology": "Yes — same methodology as my other maps in this country",
    methodology: "Same JP pipeline as my existing maps.",
  });
  assert.deepEqual(errors, []);
  assert.ok(input);
  assert.equal(input.sameMethodology, true);
  assert.equal(input.answers, null);
});

test("missing dropdowns produce per-field errors when not inheriting", () => {
  const { input, errors } = parseDataQualityIssue({
    "map-id": "some-map",
    methodology: "notes",
  });
  assert.equal(input, undefined);
  assert.ok(errors.some((error) => error.includes("dq-workplace-source")));
  assert.ok(errors.some((error) => error.includes("dq-residence-placement")));
  assert.ok(errors.some((error) => error.includes("dq-od")));
});

function candidate(
  id: string,
  lastUpdated: number,
  odGranularity: "adm3" | "adm4" = "adm3",
): InheritanceCandidate {
  const answersFile = {
    schema_version: 1,
    id,
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
      od_granularity: odGranularity,
    },
    notes: "n",
    provenance: {
      method: "backfill",
      submitted_by: "m",
      reviewed_by: "m",
      date: "2026-07-23",
    },
  } as DataQualityAnswersFile;
  return { id, lastUpdated, answersFile };
}

test("inheritance picks the newest candidate and caps the sample at five", () => {
  const candidates = [1, 2, 3, 4, 5, 6, 7].map((n) => candidate(`map-${n}`, n));
  const result = resolveInheritance(candidates);
  assert.equal(result.source?.id, "map-7");
  assert.equal(result.sample.length, 5);
  assert.equal(result.sample[0].id, "map-7");
});

test("inheritance refuses heterogeneous answer sets and empty candidate lists", () => {
  const heterogeneous = resolveInheritance([
    candidate("map-a", 2, "adm3"),
    candidate("map-b", 1, "adm4"),
  ]);
  assert.equal(heterogeneous.source, undefined);
  assert.match(heterogeneous.error ?? "", /2 different answer sets/);

  const empty = resolveInheritance([]);
  assert.equal(empty.source, undefined);
  assert.match(empty.error ?? "", /No scored maps/);
});
