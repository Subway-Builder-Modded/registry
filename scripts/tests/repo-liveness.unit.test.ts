import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySourceLivenessObservations,
  livenessSourceKey,
  loadSourceLiveness,
  updateSourceLiveness,
  type SourceLivenessFile,
} from "../lib/repo-liveness.js";

const T0 = "2026-08-01T00:00:00.000Z";
const T1 = "2026-08-02T00:00:00.000Z";

function fileWith(sources: SourceLivenessFile["sources"]): SourceLivenessFile {
  return { schema_version: 2, updated_at: T0, sources };
}

test("a newly not-found repo starts its unreachable clock", () => {
  const next = applySourceLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: { "repo:owner/gone": ["mod-a", "mod-b"] },
  }, T1);
  assert.deepEqual(next.sources["repo:owner/gone"], {
    kind: "repo",
    first_unreachable_at: T1,
    last_checked_at: T1,
    listings: ["mod-a", "mod-b"],
  });
});

test("a repeatedly not-found repo keeps its original first_unreachable_at", () => {
  const previous = fileWith({
    "repo:owner/gone": { kind: "repo", first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applySourceLivenessObservations(previous, {
    reachable: [],
    transient: [],
    notFound: { "repo:owner/gone": ["mod-a"] },
  }, T1);
  assert.equal(next.sources["repo:owner/gone"]?.first_unreachable_at, T0);
  assert.equal(next.sources["repo:owner/gone"]?.last_checked_at, T1);
});

test("a reachable repo clears its entry", () => {
  const previous = fileWith({
    "repo:owner/back": { kind: "repo", first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applySourceLivenessObservations(previous, {
    reachable: ["repo:owner/back"],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(next.sources, {});
});

test("a transient failure neither starts nor advances the clock", () => {
  const previous = fileWith({
    "repo:owner/flaky": { kind: "repo", first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applySourceLivenessObservations(previous, {
    reachable: [],
    transient: ["repo:owner/flaky", "repo:owner/new-flaky"],
    notFound: {},
  }, T1);
  assert.deepEqual(next.sources["repo:owner/flaky"], previous.sources["repo:owner/flaky"]);
  assert.equal("repo:owner/new-flaky" in next.sources, false);
});

test("repos referenced only by deprecated/test listings are never tracked", () => {
  const next = applySourceLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: { "repo:owner/gone": [] },
  }, T1);
  assert.deepEqual(next.sources, {});
});

test("a repo no longer referenced by any listing is dropped", () => {
  const previous = fileWith({
    "repo:owner/delisted": { kind: "repo", first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applySourceLivenessObservations(previous, {
    reachable: [],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(next.sources, {});
});

test("updateSourceLiveness round-trips through the file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "railyard-liveness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "mods"), { recursive: true });

  updateSourceLiveness(root, "mods", {
    reachable: [],
    transient: [],
    notFound: { "repo:owner/gone": ["mod-a"] },
  }, T0);
  const loaded = loadSourceLiveness(root, "mods");
  assert.equal(loaded.sources["repo:owner/gone"]?.first_unreachable_at, T0);

  const written = JSON.parse(readFileSync(join(root, "mods", "repo-liveness.json"), "utf-8")) as SourceLivenessFile;
  assert.equal(written.schema_version, 2);

  updateSourceLiveness(root, "mods", {
    reachable: ["repo:owner/gone"],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(loadSourceLiveness(root, "mods").sources, {});
});

test("a custom update endpoint is tracked like a repo", () => {
  const url = "https://example.com/updates/map-a.json";
  const key = livenessSourceKey("url", url);
  const next = applySourceLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: { [key]: ["map-a"] },
  }, T1);
  assert.deepEqual(next.sources[key], {
    kind: "url",
    first_unreachable_at: T1,
    last_checked_at: T1,
    listings: ["map-a"],
  });

  // Recovery clears it on the same rule as repos.
  const recovered = applySourceLivenessObservations(next, {
    reachable: [key],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(recovered.sources, {});
});

test("a repo and a URL never collide in the key space", () => {
  const shared = "owner/name";
  const next = applySourceLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: {
      [livenessSourceKey("repo", shared)]: ["mod-a"],
      [livenessSourceKey("url", shared)]: ["map-a"],
    },
  }, T1);
  assert.equal(Object.keys(next.sources).length, 2);
  assert.equal(next.sources[livenessSourceKey("repo", shared)]?.kind, "repo");
  assert.equal(next.sources[livenessSourceKey("url", shared)]?.kind, "url");
});

test("a v1 file's bare repo names load as repo-kind sources", (t) => {
  const root = mkdtempSync(join(tmpdir(), "railyard-liveness-v1-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "mods"), { recursive: true });
  writeFileSync(
    join(root, "mods", "repo-liveness.json"),
    JSON.stringify({
      schema_version: 1,
      updated_at: T0,
      repos: { "owner/gone": { first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] } },
    }) + "\n",
    "utf-8",
  );

  const loaded = loadSourceLiveness(root, "mods");
  assert.deepEqual(loaded.sources["repo:owner/gone"], {
    kind: "repo",
    first_unreachable_at: T0,
    last_checked_at: T0,
    listings: ["mod-a"],
  });
});
