import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findListingCollisions,
  mergeVanillaCityCodes,
  parseLatestCitiesCodes,
} from "../downloads/sync-vanilla-city-codes.js";
import { loadVanillaCityCodeSet, VANILLA_CITY_CODE_SET } from "../lib/map-constants.js";

test("parseLatestCitiesCodes extracts codes without YAML boolean pitfalls", () => {
  const yml = [
    "cities:",
    "  - id: new-york",
    "    code: NYC",
    "    fileName: NYC-v1.tar.gz",
    "  - id: new-orleans",
    "    code: NO", // YAML 1.1 would read this as boolean false; the regex must not.
    "  - id: quoted",
    "    code: \"KC\"",
    "    barcode: XXX", // must not match: key is not `code`
    "",
  ].join("\n");
  assert.deepEqual(parseLatestCitiesCodes(yml), ["KC", "NO", "NYC"]);
});

test("mergeVanillaCityCodes is a monotonic union", () => {
  const previous = {
    schema_version: 1,
    synced_at: "2026-08-01T00:00:00.000Z",
    source_url: "https://example.com",
    codes: ["OLD", "NYC"],
  };
  const merged = mergeVanillaCityCodes(previous, ["NYC", "DUB"], "2026-08-13T00:00:00.000Z");
  // OLD is retained even though the live list no longer carries it.
  assert.deepEqual(merged.codes, ["DUB", "NYC", "OLD"]);
  assert.equal(merged.synced_at, "2026-08-13T00:00:00.000Z");
});

test("loadVanillaCityCodeSet unions the hardcoded floor with the synced file", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "vanilla-codes-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  writeFileSync(
    join(repoRoot, "maps", "vanilla-city-codes.json"),
    JSON.stringify({ schema_version: 1, codes: ["ZZZ"] }),
    "utf-8",
  );
  const codes = loadVanillaCityCodeSet(repoRoot);
  assert.ok(codes.has("ZZZ"), "synced code present");
  assert.ok(codes.has("NYC"), "hardcoded floor present");
  for (const code of VANILLA_CITY_CODE_SET) {
    assert.ok(codes.has(code), `floor code ${code} present`);
  }
});

test("findListingCollisions reports listing, code, and author for colliding manifests", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "vanilla-collisions-"));
  const write = (id: string, manifest: unknown): void => {
    mkdirSync(join(repoRoot, "maps", id), { recursive: true });
    writeFileSync(join(repoRoot, "maps", id, "manifest.json"), JSON.stringify(manifest), "utf-8");
  };
  write("clashing", { id: "clashing", city_code: "DUB", author: "someone" });
  write("authorless", { id: "authorless", city_code: "MAR" });
  write("clean", { id: "clean", city_code: "ZZZ", author: "other" });
  writeFileSync(
    join(repoRoot, "maps", "index.json"),
    JSON.stringify({ maps: ["clashing", "authorless", "clean", "missing-dir"] }),
    "utf-8",
  );

  const collisions = findListingCollisions(repoRoot, new Set(["DUB", "MAR"]));
  assert.deepEqual(collisions, [
    { listing_id: "clashing", city_code: "DUB", author: "someone" },
    { listing_id: "authorless", city_code: "MAR", author: null },
  ]);
});

test("findListingCollisions skips deprecated listings", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "vanilla-collisions-dep-"));
  const write = (id: string, manifest: unknown): void => {
    mkdirSync(join(repoRoot, "maps", id), { recursive: true });
    writeFileSync(join(repoRoot, "maps", id, "manifest.json"), JSON.stringify(manifest), "utf-8");
  };
  // A deprecated listing is uninstallable regardless; its collision is not actionable.
  write("deprecated-clash", {
    id: "deprecated-clash",
    city_code: "DUB",
    author: "someone",
    deprecation: { since: "2026-08-17T00:00:00.000Z", by_github_id: 1, reason: "test" },
  });
  write("live-clash", { id: "live-clash", city_code: "MAR", author: "other" });
  writeFileSync(
    join(repoRoot, "maps", "index.json"),
    JSON.stringify({ maps: ["deprecated-clash", "live-clash"] }),
    "utf-8",
  );

  const collisions = findListingCollisions(repoRoot, new Set(["DUB", "MAR"]));
  assert.deepEqual(collisions, [
    { listing_id: "live-clash", city_code: "MAR", author: "other" },
  ]);
});

test("loadVanillaCityCodeSet degrades to the floor when the synced file is absent or malformed", () => {
  const missingRoot = mkdtempSync(join(tmpdir(), "vanilla-codes-missing-"));
  assert.deepEqual([...loadVanillaCityCodeSet(missingRoot)].sort(), [...VANILLA_CITY_CODE_SET].sort());

  const badRoot = mkdtempSync(join(tmpdir(), "vanilla-codes-bad-"));
  mkdirSync(join(badRoot, "maps"), { recursive: true });
  writeFileSync(join(badRoot, "maps", "vanilla-city-codes.json"), "not json", "utf-8");
  assert.deepEqual([...loadVanillaCityCodeSet(badRoot)].sort(), [...VANILLA_CITY_CODE_SET].sort());
});
