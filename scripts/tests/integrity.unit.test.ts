import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectZipCompleteness, parseManifestGameDependency } from "../lib/integrity.js";
import type { IntegrityVersionEntry } from "../lib/integrity.js";
import type { CompiledSecurityRule } from "../lib/mod-security.js";
import { withBuildingsIndexPresenceIfMissing } from "../lib/downloads-full/integrity-completeness.js";

function makeCachedEntry(matchedFiles: Record<string, string | null>): IntegrityVersionEntry {
  return {
    is_complete: true,
    errors: [],
    required_checks: { buildings_index: true },
    matched_files: matchedFiles,
    source: { update_type: "github", repo: "owner/repo", tag: "v1.0.0" },
    fingerprint: "rules:v6:github:owner/repo:v1.0.0",
    checked_at: "2026-01-01T00:00:00Z",
  };
}

test("parseManifestGameDependency extracts game_version and other deps", () => {
  const result = parseManifestGameDependency(
    JSON.stringify({ dependencies: { "subway-builder": "<=1.3.0", "other-mod": "^2.0.0" } }),
  );
  assert.equal(result.game_version, "<=1.3.0");
  assert.deepEqual(result.dependencies, { "other-mod": "^2.0.0" });
});

test("parseManifestGameDependency omits dependencies when only the game key is present", () => {
  const result = parseManifestGameDependency(
    JSON.stringify({ dependencies: { "subway-builder": "1.0.0" } }),
  );
  assert.equal(result.game_version, "1.0.0");
  assert.equal(result.dependencies, undefined);
});

test("parseManifestGameDependency returns empty object for unparseable or depless input", () => {
  assert.deepEqual(parseManifestGameDependency("not json"), {});
  assert.deepEqual(parseManifestGameDependency(JSON.stringify({ name: "x" })), {});
  assert.deepEqual(parseManifestGameDependency(JSON.stringify({ dependencies: null })), {});
});

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeDemandData(points: Array<{ id: string; location: [number, number] }>): string {
  return JSON.stringify({
    points: points.map((point) => ({
      id: point.id,
      location: point.location,
      jobs: 1,
      residents: 1,
    })),
    pops_map: points.map((point, index) => ({
      id: `pop-${index + 1}`,
      size: 1,
    })),
    pops: points.map((point) => ({
      residenceId: point.id,
      jobId: point.id,
      drivingDistance: 1,
    })),
  });
}

test("map integrity requires exact top-level files including city pmtiles", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"ABC\"}",
    "demand_data.json.gz": "stub",
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson.gz": "stub",
    "ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, true);
  assert.equal(result.requiredChecks.config_json, true);
  assert.equal(result.requiredChecks.demand_data, true);
  assert.equal(result.requiredChecks.buildings_index, true);
  assert.equal(result.requiredChecks.roads_geojson, true);
  assert.equal(result.requiredChecks.runways_taxiways_geojson, true);
  assert.equal(result.requiredChecks.city_pmtiles, true);
  // JSON-only buildings index: json form recorded, binary twin absent.
  assert.equal(result.matchedFiles.buildings_index, "buildings_index.json");
  assert.equal(result.matchedFiles.buildings_index_json, "buildings_index.json");
  assert.equal(result.matchedFiles.buildings_index_bin, null);
  assert.ok(result.fileSizes);
  assert.equal(typeof result.fileSizes?.["config.json"], "number");
  assert.equal(typeof result.fileSizes?.["ABC.pmtiles"], "number");
});

test("map integrity accepts a binary-only buildings index", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"ABC\"}",
    "demand_data.json": "{}",
    "buildings_index.bin.gz": "stub",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, true);
  assert.equal(result.requiredChecks.buildings_index, true);
  assert.equal(result.matchedFiles.buildings_index, "buildings_index.bin.gz");
  assert.equal(result.matchedFiles.buildings_index_json, null);
  assert.equal(result.matchedFiles.buildings_index_bin, "buildings_index.bin.gz");
});

test("map integrity records both buildings index forms when present", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"ABC\"}",
    "demand_data.json": "{}",
    "buildings_index.json": "{}",
    "buildings_index.bin.gz": "stub",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, true);
  assert.equal(result.requiredChecks.buildings_index, true);
  // Combined key prefers the JSON form; both presences recorded separately.
  assert.equal(result.matchedFiles.buildings_index, "buildings_index.json");
  assert.equal(result.matchedFiles.buildings_index_json, "buildings_index.json");
  assert.equal(result.matchedFiles.buildings_index_bin, "buildings_index.bin.gz");
});

test("map integrity fails when neither buildings index form is present", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"ABC\"}",
    "demand_data.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, false);
  assert.equal(result.requiredChecks.buildings_index, false);
  assert.equal(result.matchedFiles.buildings_index, null);
  assert.ok(result.errors.some((error) => error.includes("buildings index")));
});

test("map integrity rejects nested paths and missing top-level city pmtiles", async () => {
  const zipBuffer = await makeZip({
    "nested/config.json": "{\"code\":\"ABC\"}",
    "demand_data.json": "{}",
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "nested/ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, false);
  assert.ok(result.errors.some((error) => error.includes("config.json")));
  assert.ok(result.errors.some((error) => error.includes("missing code in config.json")));
  assert.ok(result.fileSizes);
});

test("map integrity uses config code for pmtiles and warns on registry mismatch", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"CFG\"}",
    "demand_data.json": "{}",
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "CFG.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "REG" });
  assert.equal(result.isComplete, true);
  assert.ok(result.warnings.some((warning) => warning.includes("registry city_code 'REG'")));
  assert.ok(result.warnings.some((warning) => warning.includes("config code 'CFG'")));
  assert.ok(result.warnings.some((warning) => warning.includes("REG.pmtiles")));
  assert.ok(result.warnings.some((warning) => warning.includes("CFG.pmtiles")));
});

test("map integrity enforces pmtiles using config code when present", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"CFG\"}",
    "demand_data.json": "{}",
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "REG.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "REG" });
  assert.equal(result.isComplete, false);
  assert.ok(result.errors.some((error) => error.includes("CFG.pmtiles")));
  assert.ok(result.errors.some((error) => error.includes("config code 'CFG'")));
  assert.ok(result.errors.some((error) => error.includes("registry city_code 'REG'")));
});

test("map integrity does not fall back to registry city_code when config code is missing", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{}",
    "demand_data.json": "{}",
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "REG.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "REG" });
  assert.equal(result.isComplete, false);
  assert.ok(result.errors.some((error) => error.includes("missing code in config.json")));
});

test("map integrity fails when a demand point is more than 100km from its nearest neighbor", async () => {
  const zipBuffer = await makeZip({
    "config.json": "{\"code\":\"ABC\"}",
    "demand_data.json": makeDemandData([
      { id: "city-a", location: [0, 0] },
      { id: "city-b", location: [0.02, 0.02] },
      { id: "remote", location: [2, 2] },
    ]),
    "buildings_index.json": "{}",
    "roads.geojson": "{}",
    "runways_taxiways.geojson": "{}",
    "ABC.pmtiles": "stub",
  });

  const result = await inspectZipCompleteness("map", zipBuffer, { cityCode: "ABC" });
  assert.equal(result.isComplete, false);
  assert.equal(result.requiredChecks.demand_point_spacing, false);
  assert.ok(result.errors.some((error) => error.includes("isolated point(s)")));
  assert.ok(result.errors.some((error) => error.includes(">100km")));
  assert.ok(result.errors.some((error) => error.includes("remote")));
});

test("mod integrity requires both release manifest asset and top-level zip manifest", async () => {
  const zipBuffer = await makeZip({
    "manifest.json": "{}",
    "plugin.dll": "binary",
  });

  const missingReleaseAsset = await inspectZipCompleteness("mod", zipBuffer, {
    releaseHasManifestAsset: false,
  });
  assert.equal(missingReleaseAsset.isComplete, false);
  assert.ok(missingReleaseAsset.errors.some((error) => error.includes("release asset manifest.json")));
  assert.equal(missingReleaseAsset.fileSizes, undefined);

  const valid = await inspectZipCompleteness("mod", zipBuffer, {
    releaseHasManifestAsset: true,
  });
  assert.equal(valid.isComplete, true);
  assert.equal(valid.fileSizes, undefined);
});

test("mod integrity blocks completion when security ERROR rule matches", async () => {
  const zipBuffer = await makeZip({
    "manifest.json": "{}",
    "index.js": "const x = customSavesDirectory;",
  });
  const modSecurityRules: CompiledSecurityRule[] = [
    {
      id: "forbidden-customSavesDirectory",
      severity: "ERROR",
      type: "literal",
      pattern: "customSavesDirectory",
      enabled: true,
    },
  ];

  const result = await inspectZipCompleteness("mod", zipBuffer, {
    releaseHasManifestAsset: true,
    modSecurityRules,
  });
  assert.equal(result.isComplete, false);
  assert.equal(result.requiredChecks.security_scan_passed, false);
  assert.ok(result.errors.some((error) => error.includes("security scan detected")));
  assert.equal(result.securityIssue?.findings[0]?.rule_id, "forbidden-customSavesDirectory");
});

test("mod integrity records security WARNING rule without blocking completion", async () => {
  const zipBuffer = await makeZip({
    "manifest.json": "{}",
    "main.ts": "const x = eval(atob('Zm9v'));",
  });
  const modSecurityRules: CompiledSecurityRule[] = [
    {
      id: "suspicious-eval-atob",
      severity: "WARNING",
      type: "regex",
      pattern: "eval\\s*\\(\\s*atob\\s*\\(",
      enabled: true,
      compiledPattern: new RegExp("eval\\s*\\(\\s*atob\\s*\\("),
    },
  ];

  const result = await inspectZipCompleteness("mod", zipBuffer, {
    releaseHasManifestAsset: true,
    modSecurityRules,
  });
  assert.equal(result.isComplete, true);
  assert.equal(result.requiredChecks.security_scan_passed, true);
  assert.ok(result.warnings.some((warning) => warning.includes("security scan detected")));
  assert.equal(result.securityIssue?.findings[0]?.severity, "WARNING");
});

test("withBuildingsIndexPresenceIfMissing backfills legacy map cache entries", async () => {
  // Pre-split cache entry: only the combined buildings_index match, no per-form keys.
  const legacy = makeCachedEntry({ buildings_index: "buildings_index.json" });
  const patched = withBuildingsIndexPresenceIfMissing(legacy);
  // Binary is known-absent; JSON form derived from the recorded match. No re-inspection.
  assert.equal(patched.matched_files.buildings_index_json, "buildings_index.json");
  assert.equal(patched.matched_files.buildings_index_bin, null);
  assert.equal(patched.matched_files.buildings_index, "buildings_index.json");
});

test("withBuildingsIndexPresenceIfMissing leaves already-split entries untouched", async () => {
  const fresh = makeCachedEntry({
    buildings_index: "buildings_index.bin.gz",
    buildings_index_json: null,
    buildings_index_bin: "buildings_index.bin.gz",
  });
  const patched = withBuildingsIndexPresenceIfMissing(fresh);
  assert.equal(patched, fresh); // no-op: returns the same reference
});

test("withBuildingsIndexPresenceIfMissing ignores non-map (mod) entries", async () => {
  const mod = makeCachedEntry({ release_manifest_asset: "manifest.json", zip_manifest_json: "manifest.json" });
  const patched = withBuildingsIndexPresenceIfMissing(mod);
  assert.equal(patched, mod); // no buildings_index key → untouched
});
