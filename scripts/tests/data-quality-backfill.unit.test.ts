import test from "node:test";
import assert from "node:assert/strict";
import {
  OSM_PATCHER_ANSWERS,
  OSM_PATCHER_MAPS,
  PIPELINE_ENCODINGS,
  findPipelineEncoding,
  recomputeEncoding,
} from "../lib/data-quality-backfill.js";
import { computeScores } from "../lib/data-quality.js";
import { applyMapManifestUpdates } from "../lib/map-update-logic.js";
import type { MapManifest } from "../lib/manifests.js";

test("all pipeline encodings are confirmed and reproduce the doc §8 table exactly", () => {
  for (const encoding of PIPELINE_ENCODINGS) {
    const recomputed = recomputeEncoding(encoding);
    const label = `${encoding.country}/${encoding.docAuthor}`;
    assert.equal(encoding.confirmed, true, `${label} confirmed`);
    assert.equal(recomputed.raw, encoding.expectedDoc.raw, `${label} raw`);
    assert.equal(recomputed.weighted, encoding.expectedDoc.weighted, `${label} weighted`);
    assert.equal(recomputed.tier, encoding.expectedDoc.tier, `${label} tier`);
  }
});

test("OSM patcher cohort scores zero and lands on absent by construction", () => {
  const scores = computeScores(OSM_PATCHER_ANSWERS);
  assert.equal(scores.raw_score, 0);
  assert.equal(scores.weighted_score, 0);
  assert.equal(scores.tier, "absent");
  // Maintainer-validated cohort (2026-07-26 review of publish-issue methodologies).
  assert.deepEqual(
    OSM_PATCHER_MAPS.map((p) => p.id).sort(),
    [
      "berlin-val",
      "cairo",
      "greater-kuala-lumpur",
      "ipoh",
      "johor-bahru",
      "pulau-pinang",
      "pyongyang-nk",
      "singapore-val",
      "trondheim-val",
      "warsaw-val",
    ],
  );
});

test("pipeline matching is exact on (country, registry author) plus shared data sources", () => {
  assert.equal(findPipelineEncoding("US", "rslurry")?.docAuthor, "slurry");
  // The US LODES generator is shared: any US map with data_source LODES matches.
  assert.equal(findPipelineEncoding("US", "kaicardenas0618", "LODES")?.docAuthor, "slurry");
  assert.equal(findPipelineEncoding("US", "crumpetime", "LODES")?.docAuthor, "slurry");
  // Without the shared data source, other authors stay unmatched.
  assert.equal(findPipelineEncoding("US", "kaicardenas0618", "OSM"), undefined);
  assert.equal(findPipelineEncoding("US", "kaicardenas0618"), undefined);
  // Shared sources never leak across countries or into author-only pipelines.
  assert.equal(findPipelineEncoding("NO", "Valdotorium", "LODES"), undefined);
  assert.equal(findPipelineEncoding("JP", "jelegend", "LODES"), undefined);
  // Doc pipelines with no registry maps are not encoded.
  assert.equal(findPipelineEncoding("SK", "ahkimn"), undefined);
});

function makeManifest(overrides: Partial<MapManifest> = {}): MapManifest {
  return {
    schema_version: 1,
    id: "stamp-test",
    name: "Stamp Test",
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
    population: 1,
    residents_total: 1,
    points_count: 1,
    population_count: 1,
    initial_view_state: { latitude: 0, longitude: 0, zoom: 10, bearing: 0 },
    data_source: "TEST",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "east-asia",
    special_demand: [],
    file_sizes: {},
    ...overrides,
  };
}

test("metadata updates stamp the unknown marker on unstamped maps", () => {
  const manifest = makeManifest();
  applyMapManifestUpdates(manifest, {});
  assert.deepEqual(manifest.data_quality, { tier: "unknown", rubric_version: 1 });
});

test("metadata updates never touch an existing data_quality block", () => {
  const scored = {
    tier: "high" as const,
    raw_score: 0.57,
    weighted_score: 0.65,
    rubric_version: 1,
    provenance: "backfill" as const,
  };
  const manifest = makeManifest({ data_quality: scored });
  applyMapManifestUpdates(manifest, { name: "Renamed" });
  assert.deepEqual(manifest.data_quality, scored);
});
