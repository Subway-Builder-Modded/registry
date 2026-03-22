import test from "node:test";
import assert from "node:assert/strict";
import { assertValidRegistryManifest } from "../lib/registry-manifest.js";

function makeMapManifest(fileSizes: unknown): Record<string, unknown> {
  return {
    schema_version: 1,
    id: "manifest-schema-map",
    name: "Schema Test Map",
    author: "tester",
    github_id: 1,
    description: "desc",
    tags: ["north-america"],
    gallery: ["gallery/1.webp"],
    source: "https://example.com",
    update: { type: "github", repo: "owner/repo" },
    city_code: "AAA",
    country: "US",
    population: 10,
    residents_total: 10,
    points_count: 1,
    population_count: 1,
    initial_view_state: {
      latitude: 1,
      longitude: 2,
      zoom: 3,
      bearing: 4,
    },
    data_source: "OSM",
    source_quality: "low-quality",
    level_of_detail: "low-detail",
    location: "north-america",
    special_demand: [],
    file_sizes: fileSizes,
  };
}

test("registry schema accepts map manifests with valid file_sizes", () => {
  assert.doesNotThrow(() => {
    assertValidRegistryManifest(
      makeMapManifest({
        "AAA.pmtiles": 3.12,
        "config.json": 0.01,
      }),
      "valid manifest",
    );
  });
});

test("registry schema rejects map manifests with negative or non-numeric file_sizes", () => {
  assert.throws(() => {
    assertValidRegistryManifest(
      makeMapManifest({
        "AAA.pmtiles": -1,
      }),
      "invalid manifest negative",
    );
  });

  assert.throws(() => {
    assertValidRegistryManifest(
      makeMapManifest({
        "config.json": "1.2",
      }),
      "invalid manifest non-numeric",
    );
  });
});
