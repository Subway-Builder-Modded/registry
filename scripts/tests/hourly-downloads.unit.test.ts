import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyHourlySuppressions,
  computeListingDeltas,
  mergeHourlyRows,
  parseHourlyDownloadsCsv,
  parseHourlySuppressions,
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

test("parseHourlySuppressions keeps valid entries and drops malformed ones", () => {
  const parsed = parseHourlySuppressions({
    schema_version: 1,
    suppressions: [
      { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "gone-mod", reason: "restore burst" },
      { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "partial", downloads: 40, reason: "partial raise" },
      { bucket_utc: "not-an-hour", listing_type: "mod", id: "bad-bucket", reason: "x" },
      { bucket_utc: "2026-08-06T01:00Z", listing_type: "widget", id: "bad-type", reason: "x" },
      { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "no-reason" },
    ],
  });
  assert.deepEqual(parsed.map((entry) => entry.id), ["gone-mod", "partial"]);
  assert.equal(parsed[0]!.downloads, undefined);
  assert.equal(parsed[1]!.downloads, 40);
});

test("applyHourlySuppressions drops whole rows and subtracts partial amounts", () => {
  const rows: HourlyDownloadRow[] = [
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "gone-mod", downloads: 2376 },
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "partial", downloads: 50 },
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "swallowed", downloads: 30 },
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "map", id: "gone-mod", downloads: 7 },
    { bucket_utc: "2026-08-06T02:00Z", listing_type: "mod", id: "gone-mod", downloads: 5 },
  ];
  const { rows: result, suppressed } = applyHourlySuppressions(rows, [
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "gone-mod", reason: "full drop" },
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "partial", downloads: 40, reason: "subtract" },
    { bucket_utc: "2026-08-06T01:00Z", listing_type: "mod", id: "swallowed", downloads: 30, reason: "exact subtract drops" },
  ]);
  assert.equal(suppressed, 3);
  const key = (row: HourlyDownloadRow): string => `${row.bucket_utc} ${row.listing_type} ${row.id}`;
  const byKey = new Map(result.map((row) => [key(row), row.downloads]));
  assert.equal(byKey.has("2026-08-06T01:00Z mod gone-mod"), false);
  assert.equal(byKey.get("2026-08-06T01:00Z mod partial"), 10);
  assert.equal(byKey.has("2026-08-06T01:00Z mod swallowed"), false);
  // Same id under a different type or hour is untouched.
  assert.equal(byKey.get("2026-08-06T01:00Z map gone-mod"), 7);
  assert.equal(byKey.get("2026-08-06T02:00Z mod gone-mod"), 5);
});

test("the committed suppression spec matches the pruned restoration rows", () => {
  const spec = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "..", "..", "..", "history", "hourly-suppressions.json"), "utf-8"),
  ) as unknown;
  const parsed = parseHourlySuppressions(spec);
  assert.deepEqual(
    parsed.map((entry) => `${entry.bucket_utc} ${entry.listing_type} ${entry.id}`).sort(),
    [
      "2026-08-06T01:00Z mod danield1909-dantrains",
      "2026-08-06T01:00Z mod imb11-moveit",
      "2026-08-06T01:00Z mod imb11-subwaycine",
    ],
  );
  for (const entry of parsed) {
    assert.equal(entry.downloads, undefined, "restoration rows are whole-row drops");
  }
});
