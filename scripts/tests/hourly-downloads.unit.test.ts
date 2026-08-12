import test from "node:test";
import assert from "node:assert/strict";
import {
  computeListingDeltas,
  mergeHourlyRows,
  parseHourlyDownloadsCsv,
  pruneHourlyRows,
  serializeHourlyDownloadsCsv,
  truncateToHourBucketUtc,
  type HourlyDownloadRow,
} from "../lib/hourly-downloads.js";

test("truncateToHourBucketUtc normalizes offsets to UTC hour keys", () => {
  assert.equal(truncateToHourBucketUtc("2026-08-13T04:23:45.678Z"), "2026-08-13T04:00Z");
  // JST offset: 05:10+09:00 = 20:10 UTC the previous day.
  assert.equal(truncateToHourBucketUtc("2026-08-13T05:10:00+09:00"), "2026-08-12T20:00Z");
  assert.throws(() => truncateToHourBucketUtc("not-a-date"), /Unparseable/);
});

test("computeListingDeltas sums versions, clamps drops, nets intra-listing movement", () => {
  const previous = {
    lyon: { "v1.0.0": 100, "v1.0.2": 40 },
    steady: { "1.0.0": 5 },
    corrected: { "1.0.0": 900 },
  };
  const next = {
    lyon: { "v1.0.0": 100, "v1.0.2": 47 },
    steady: { "1.0.0": 5 },
    corrected: { "1.0.0": 300 }, // attribution landed: adjusted dropped — clamp, no negative row
    "brand-new": { "1.0.0": 3 },
  };
  const deltas = computeListingDeltas("map", previous, next);
  assert.deepEqual(deltas, [
    { listing_type: "map", id: "lyon", downloads: 7 },
    { listing_type: "map", id: "brand-new", downloads: 3 },
  ]);
});

test("csv serialize/parse round-trips and sorts chronologically", () => {
  const rows: HourlyDownloadRow[] = [
    { bucket_utc: "2026-08-13T05:00Z", listing_type: "mod", id: "b-mod", downloads: 1 },
    { bucket_utc: "2026-08-13T04:00Z", listing_type: "map", id: "a-map", downloads: 12 },
  ];
  const csv = serializeHourlyDownloadsCsv(rows);
  assert.equal(
    csv,
    "bucket_utc,listing_type,id,downloads\n"
    + "2026-08-13T04:00Z,map,a-map,12\n"
    + "2026-08-13T05:00Z,mod,b-mod,1\n",
  );
  assert.deepEqual(parseHourlyDownloadsCsv(csv), [
    { bucket_utc: "2026-08-13T04:00Z", listing_type: "map", id: "a-map", downloads: 12 },
    { bucket_utc: "2026-08-13T05:00Z", listing_type: "mod", id: "b-mod", downloads: 1 },
  ]);
});

test("parseHourlyDownloadsCsv skips malformed lines", () => {
  const parsed = parseHourlyDownloadsCsv([
    "bucket_utc,listing_type,id,downloads",
    "2026-08-13T04:00Z,map,good,2",
    "not-a-bucket,map,bad,2",
    "2026-08-13T04:00Z,plugin,bad-type,2",
    "2026-08-13T04:00Z,map,zero,0",
    "garbage",
    "",
  ].join("\n"));
  assert.deepEqual(parsed.map((row) => row.id), ["good"]);
});

test("mergeHourlyRows sums same bucket+listing entries", () => {
  const merged = mergeHourlyRows(
    [{ bucket_utc: "2026-08-13T04:00Z", listing_type: "map", id: "lyon", downloads: 2 }],
    [
      { bucket_utc: "2026-08-13T04:00Z", listing_type: "map", id: "lyon", downloads: 3 },
      { bucket_utc: "2026-08-13T04:00Z", listing_type: "mod", id: "lyon", downloads: 1 },
    ],
  );
  const key = (row: HourlyDownloadRow): string => `${row.listing_type}:${row.id}`;
  const byKey = new Map(merged.map((row) => [key(row), row.downloads]));
  assert.equal(byKey.get("map:lyon"), 5);
  assert.equal(byKey.get("mod:lyon"), 1);
  assert.equal(merged.length, 2);
});

test("pruneHourlyRows drops buckets outside the retention window", () => {
  const nowMs = Date.parse("2026-08-15T12:30:00Z");
  const rows: HourlyDownloadRow[] = [
    { bucket_utc: "2026-08-01T11:00Z", listing_type: "map", id: "old", downloads: 1 },
    { bucket_utc: "2026-08-01T13:00Z", listing_type: "map", id: "kept", downloads: 1 },
  ];
  // 14-day cutoff from 2026-08-15T12:30Z is 2026-08-01T12:00Z.
  assert.deepEqual(pruneHourlyRows(rows, nowMs).map((row) => row.id), ["kept"]);
});
