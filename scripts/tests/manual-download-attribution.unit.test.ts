import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualDownloadAttributionDelta,
  normalizeManualDownloadAttributionSpec,
} from "../lib/manual-download-attribution.js";

test("normalizeManualDownloadAttributionSpec accepts mixed entry kinds", () => {
  const spec = normalizeManualDownloadAttributionSpec({
    source: "manual:incident",
    delta_id: "manual:incident:2026-05-23-hourly-spike",
    generated_at: "2026-05-23T23:45:06.000Z",
    entries: [
      {
        listing_type: "map",
        listing_id: "sample-map",
        version: "1.0.0",
        count: 3,
        note: "map family sweep",
      },
      {
        asset_key: "Owner/Repo@v1.0.0/Asset.zip",
        count: 2,
      },
    ],
  });

  assert.equal(spec.entries.length, 2);
  assert.deepEqual(spec.entries[0], {
    listing_type: "map",
    listing_id: "sample-map",
    version: "1.0.0",
    count: 3,
    note: "map family sweep",
  });
  assert.deepEqual(spec.entries[1], {
    asset_key: "Owner/Repo@v1.0.0/Asset.zip",
    count: 2,
    note: undefined,
  });
});

test("buildManualDownloadAttributionDelta resolves versions and aggregates counts", () => {
  const spec = normalizeManualDownloadAttributionSpec({
    source: "manual:incident",
    delta_id: "manual:incident:2026-05-23-hourly-spike",
    generated_at: "2026-05-23T23:45:06.000Z",
    entries: [
      {
        listing_type: "map",
        listing_id: "sample-map",
        version: "1.0.0",
        count: 3,
      },
      {
        asset_key: "Owner/Repo@v1.0.0/Asset.zip",
        count: 2,
      },
    ],
  });

  const result = buildManualDownloadAttributionDelta(spec, (input) => {
    assert.equal(input.listing_type, "map");
    assert.equal(input.listing_id, "sample-map");
    assert.equal(input.version, "1.0.0");
    return "owner/repo@v1.0.0/asset.zip";
  });

  assert.equal(result.total_fetches, 5);
  assert.equal(result.delta.assets["owner/repo@v1.0.0/asset.zip"], 5);
  assert.equal(result.resolved_entries.length, 2);
});

test("normalizeManualDownloadAttributionSpec rejects empty entries", () => {
  assert.throws(
    () => normalizeManualDownloadAttributionSpec({
      source: "manual:incident",
      delta_id: "manual:incident:2026-05-23-hourly-spike",
      generated_at: "2026-05-23T23:45:06.000Z",
      entries: [],
    }),
    /non-empty array/,
  );
});
