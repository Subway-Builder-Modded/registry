import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRepoLivenessObservations,
  loadRepoLiveness,
  updateRepoLiveness,
  type RepoLivenessFile,
} from "../lib/repo-liveness.js";

const T0 = "2026-08-01T00:00:00.000Z";
const T1 = "2026-08-02T00:00:00.000Z";

function fileWith(repos: RepoLivenessFile["repos"]): RepoLivenessFile {
  return { schema_version: 1, updated_at: T0, repos };
}

test("a newly not-found repo starts its unreachable clock", () => {
  const next = applyRepoLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: { "owner/gone": ["mod-a", "mod-b"] },
  }, T1);
  assert.deepEqual(next.repos["owner/gone"], {
    first_unreachable_at: T1,
    last_checked_at: T1,
    listings: ["mod-a", "mod-b"],
  });
});

test("a repeatedly not-found repo keeps its original first_unreachable_at", () => {
  const previous = fileWith({
    "owner/gone": { first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applyRepoLivenessObservations(previous, {
    reachable: [],
    transient: [],
    notFound: { "owner/gone": ["mod-a"] },
  }, T1);
  assert.equal(next.repos["owner/gone"]?.first_unreachable_at, T0);
  assert.equal(next.repos["owner/gone"]?.last_checked_at, T1);
});

test("a reachable repo clears its entry", () => {
  const previous = fileWith({
    "owner/back": { first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applyRepoLivenessObservations(previous, {
    reachable: ["owner/back"],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(next.repos, {});
});

test("a transient failure neither starts nor advances the clock", () => {
  const previous = fileWith({
    "owner/flaky": { first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applyRepoLivenessObservations(previous, {
    reachable: [],
    transient: ["owner/flaky", "owner/new-flaky"],
    notFound: {},
  }, T1);
  assert.deepEqual(next.repos["owner/flaky"], previous.repos["owner/flaky"]);
  assert.equal("owner/new-flaky" in next.repos, false);
});

test("repos referenced only by deprecated/test listings are never tracked", () => {
  const next = applyRepoLivenessObservations(fileWith({}), {
    reachable: [],
    transient: [],
    notFound: { "owner/gone": [] },
  }, T1);
  assert.deepEqual(next.repos, {});
});

test("a repo no longer referenced by any listing is dropped", () => {
  const previous = fileWith({
    "owner/delisted": { first_unreachable_at: T0, last_checked_at: T0, listings: ["mod-a"] },
  });
  const next = applyRepoLivenessObservations(previous, {
    reachable: [],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(next.repos, {});
});

test("updateRepoLiveness round-trips through the file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "railyard-liveness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "mods"), { recursive: true });

  updateRepoLiveness(root, "mods", {
    reachable: [],
    transient: [],
    notFound: { "owner/gone": ["mod-a"] },
  }, T0);
  const loaded = loadRepoLiveness(root, "mods");
  assert.equal(loaded.repos["owner/gone"]?.first_unreachable_at, T0);

  const written = JSON.parse(readFileSync(join(root, "mods", "repo-liveness.json"), "utf-8")) as RepoLivenessFile;
  assert.equal(written.schema_version, 1);

  updateRepoLiveness(root, "mods", {
    reachable: ["owner/gone"],
    transient: [],
    notFound: {},
  }, T1);
  assert.deepEqual(loadRepoLiveness(root, "mods").repos, {});
});
