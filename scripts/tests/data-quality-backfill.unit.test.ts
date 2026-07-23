import test from "node:test";
import assert from "node:assert/strict";
import {
  PIPELINE_ENCODINGS,
  findPipelineEncoding,
  recomputeEncoding,
} from "../lib/data-quality-backfill.js";
import { applyMapManifestUpdates } from "../lib/map-update-logic.js";
import type { MapManifest } from "../lib/manifests.js";

test("confirmed pipeline encodings reproduce the doc §8 table exactly", () => {
  for (const encoding of PIPELINE_ENCODINGS.filter((p) => p.confirmed)) {
    const recomputed = recomputeEncoding(encoding);
    const label = `${encoding.country}/${encoding.docAuthor}`;
    assert.equal(recomputed.raw, encoding.expectedDoc.raw, `${label} raw`);
    assert.equal(recomputed.weighted, encoding.expectedDoc.weighted, `${label} weighted`);
    assert.equal(recomputed.tier, encoding.expectedDoc.tier, `${label} tier`);
  }
});

test("unconfirmed encodings land on the doc tier within a rounding wobble", () => {
  const unconfirmed = PIPELINE_ENCODINGS.filter((p) => !p.confirmed);
  assert.deepEqual(
    unconfirmed.map((p) => p.country).sort(),
    ["MX", "PE", "PR"],
  );
  for (const encoding of unconfirmed) {
    const recomputed = recomputeEncoding(encoding);
    const label = `${encoding.country}/${encoding.docAuthor}`;
    assert.equal(recomputed.tier, encoding.expectedDoc.tier, `${label} tier`);
    assert.ok(Math.abs(recomputed.rawDelta) <= 0.015, `${label} raw delta ${recomputed.rawDelta}`);
    assert.ok(
      Math.abs(recomputed.weightedDelta) <= 0.015,
      `${label} weighted delta ${recomputed.weightedDelta}`,
    );
  }
});

test("pipeline matching is exact on (country, registry author)", () => {
  assert.equal(findPipelineEncoding("US", "rslurry")?.docAuthor, "slurry");
  // Same country, different author (shared-pipeline candidates stay unmatched).
  assert.equal(findPipelineEncoding("US", "kaicardenas0618"), undefined);
  assert.equal(findPipelineEncoding("NO", "Valdotorium"), undefined);
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
