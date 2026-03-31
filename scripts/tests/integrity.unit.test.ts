import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectZipCompleteness } from "../lib/integrity.js";
import type { CompiledSecurityRule } from "../lib/mod-security.js";

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
  assert.ok(result.fileSizes);
  assert.equal(typeof result.fileSizes?.["config.json"], "number");
  assert.equal(typeof result.fileSizes?.["ABC.pmtiles"], "number");
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
