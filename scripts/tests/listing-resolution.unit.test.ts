import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModManifestSchema } from "@subway-builder-modded/registry-schemas";
import { resolveListingById } from "../lib/manifests.js";
import { findCrossTypeIdCollisions } from "../lib/registry-uniqueness.js";

function makeRepo(listings: { dir: "maps" | "mods"; id: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "railyard-uniq-"));
  for (const { dir, id } of listings) {
    const listingDir = join(root, dir, id);
    mkdirSync(listingDir, { recursive: true });
    writeFileSync(join(listingDir, "manifest.json"), JSON.stringify({ id }), "utf-8");
  }
  return root;
}

test("resolveListingById resolves a map by bare ID", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }, { dir: "mods", id: "advanced-analytics" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const resolved = resolveListingById(root, "porto");
  assert.ok(resolved);
  assert.equal(resolved.type, "map");
  assert.equal(resolved.dir, "maps");
  assert.deepEqual(resolved.manifest, { id: "porto" });
});

test("resolveListingById resolves a mod by bare ID", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }, { dir: "mods", id: "advanced-analytics" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const resolved = resolveListingById(root, "advanced-analytics");
  assert.ok(resolved);
  assert.equal(resolved.type, "mod");
  assert.equal(resolved.dir, "mods");
});

test("resolveListingById returns null for an unknown ID", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(resolveListingById(root, "does-not-exist"), null);
});

test("resolveListingById throws when the ID exists in both collections", (t) => {
  const root = makeRepo([{ dir: "maps", id: "clash" }, { dir: "mods", id: "clash" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => resolveListingById(root, "clash"), /uniqueness is violated/);
});

test("findCrossTypeIdCollisions returns empty for disjoint collections", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }, { dir: "mods", id: "advanced-analytics" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(findCrossTypeIdCollisions(root), []);
});

test("findCrossTypeIdCollisions reports colliding IDs sorted", (t) => {
  const root = makeRepo([
    { dir: "maps", id: "zeta" },
    { dir: "maps", id: "alpha" },
    { dir: "maps", id: "only-map" },
    { dir: "mods", id: "zeta" },
    { dir: "mods", id: "alpha" },
    { dir: "mods", id: "only-mod" },
  ]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(findCrossTypeIdCollisions(root), ["alpha", "zeta"]);
});

test("findCrossTypeIdCollisions ignores directories without a manifest.json", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "mods", "porto"), { recursive: true });

  assert.deepEqual(findCrossTypeIdCollisions(root), []);
});

test("findCrossTypeIdCollisions handles a missing collection directory", (t) => {
  const root = makeRepo([{ dir: "maps", id: "porto" }]);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(findCrossTypeIdCollisions(root), []);
});

// --- Deprecation schema (via the built registry-schemas package) ---

const BASE_MOD_MANIFEST = {
  schema_version: 1,
  id: "test-mod",
  name: "Test Mod",
  author: "tester",
  github_id: 1,
  description: "A test mod.",
  tags: ["qol"],
  gallery: [],
  is_test: false,
  source: "https://example.com/test-mod",
  update: { type: "github", repo: "tester/test-mod" },
} as const;

test("manifest schema accepts a deprecation record", () => {
  const result = ModManifestSchema.safeParse({
    ...BASE_MOD_MANIFEST,
    deprecation: {
      since: "2026-08-03T00:00:00Z",
      by_github_id: 100,
      reason: "Superseded by test-mod-2",
    },
  });
  assert.equal(result.success, true);
});

test("manifest schema accepts a deprecation record without a reason", () => {
  const result = ModManifestSchema.safeParse({
    ...BASE_MOD_MANIFEST,
    deprecation: { since: "2026-08-03T00:00:00Z", by_github_id: 100 },
  });
  assert.equal(result.success, true);
});

test("manifest schema rejects a deprecation record without since", () => {
  const result = ModManifestSchema.safeParse({
    ...BASE_MOD_MANIFEST,
    deprecation: { by_github_id: 100 },
  });
  assert.equal(result.success, false);
});

test("manifest schema rejects a deprecation record with an invalid timestamp", () => {
  const result = ModManifestSchema.safeParse({
    ...BASE_MOD_MANIFEST,
    deprecation: { since: "not-a-date", by_github_id: 100 },
  });
  assert.equal(result.success, false);
});

test("manifest schema rejects an empty deprecation reason", () => {
  const result = ModManifestSchema.safeParse({
    ...BASE_MOD_MANIFEST,
    deprecation: { since: "2026-08-03T00:00:00Z", by_github_id: 100, reason: "" },
  });
  assert.equal(result.success, false);
});
