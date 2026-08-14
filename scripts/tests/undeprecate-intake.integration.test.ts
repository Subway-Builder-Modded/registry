import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const scriptsRoot = resolve(import.meta.dirname, "..", "..");

const AUTHOR_ID = 1000;
const COLLABORATOR_ID = 2000;
const ACTIVE_CARETAKER_ID = 3000;
const STRANGER_ID = 9000;

function deprecatedModManifest(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    name: "Fixture Mod",
    author: "fixture-author",
    github_id: AUTHOR_ID,
    collaborators: [COLLABORATOR_ID, ACTIVE_CARETAKER_ID],
    caretakers: [{ github_id: ACTIVE_CARETAKER_ID, since: "2026-03-01T00:00:00Z" }],
    description: "A fixture mod.",
    tags: ["qol"],
    gallery: [],
    is_test: false,
    source: "https://example.com/fixture",
    update: { type: "github", repo: "fixture/fixture" },
    deprecation: {
      since: "2026-08-01T00:00:00Z",
      by_github_id: AUTHOR_ID,
      reason: "Superseded",
    },
  };
}

function makeFixtureRepo(manifests: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "railyard-undeprecate-"));
  mkdirSync(join(root, "maps"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const [id, manifest] of Object.entries(manifests)) {
    const dir = join(root, "mods", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }
  return root;
}

function runScript(
  scriptName: "validate-undeprecate" | "undeprecate-listing",
  fixtureRoot: string,
  env: Record<string, string>,
): SpawnSyncReturns<string> {
  const compiledScriptPath = resolve(scriptsRoot, ".test-dist", "intake", `${scriptName}.js`);
  return spawnSync(process.execPath, [compiledScriptPath], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      RAILYARD_REPO_ROOT: fixtureRoot,
      ...env,
    },
    encoding: "utf-8",
  });
}

function readValidationError(fixtureRoot: string): string {
  const path = join(fixtureRoot, "scripts", "validation-error.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

const ISSUE_JSON = JSON.stringify({ "asset-id": "fixture-mod" });

// --- validate-undeprecate ---

test("un-deprecate validation passes for the original publisher", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("un-deprecate validation passes for the active caretaker", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(ACTIVE_CARETAKER_ID),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("un-deprecate validation rejects an ordinary collaborator", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(COLLABORATOR_ID),
  });
  assert.notEqual(result.status, 0, "collaborators must not be able to un-deprecate");
  assert.match(readValidationError(root), /Only the original publisher or the active caretaker/);
});

test("un-deprecate validation rejects a stranger", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(STRANGER_ID),
  });
  assert.notEqual(result.status, 0);
});

test("un-deprecate validation rejects an unknown asset ID", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON: JSON.stringify({ "asset-id": "does-not-exist" }),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
  assert.match(readValidationError(root), /No mod or map with ID `does-not-exist` exists/);
});

test("un-deprecate validation rejects a listing that is not deprecated", (t) => {
  const manifest = deprecatedModManifest("fixture-mod");
  delete manifest.deprecation;
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
  assert.match(readValidationError(root), /is not deprecated/);
});

// --- undeprecate-listing ---

test("undeprecate-listing removes the deprecation field and keeps everything else", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("undeprecate-listing", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);

  const written = JSON.parse(
    readFileSync(join(root, "mods", "fixture-mod", "manifest.json"), "utf-8"),
  ) as Record<string, unknown>;
  assert.equal("deprecation" in written, false);
  assert.equal(written.github_id, AUTHOR_ID);
  assert.deepEqual(written.caretakers, [
    { github_id: ACTIVE_CARETAKER_ID, since: "2026-03-01T00:00:00Z" },
  ]);

  const history = written.deprecation_history as Array<Record<string, unknown>>;
  assert.equal(history.length, 1);
  assert.equal(history[0].since, "2026-08-01T00:00:00Z");
  assert.equal(history[0].by_github_id, AUTHOR_ID);
  assert.equal(history[0].reason, "Superseded");
  assert.equal(history[0].removed_by_github_id, AUTHOR_ID);
  assert.match(String(history[0].until), /^\d{4}-\d{2}-\d{2}T/);
});

test("undeprecate-listing appends to an existing history and records who reversed it", (t) => {
  const manifest = deprecatedModManifest("fixture-mod");
  manifest.deprecation_history = [{
    since: "2026-01-01T00:00:00Z",
    until: "2026-02-01T00:00:00Z",
    by_github_id: AUTHOR_ID,
    removed_by_github_id: AUTHOR_ID,
  }];
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // A code owner reversing someone else's deprecation: by_github_id and
  // removed_by_github_id are different people, which is the case the pair exists for.
  const result = runScript("undeprecate-listing", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: "268817724",
  });
  assert.equal(result.status, 0, result.stderr);

  const written = JSON.parse(
    readFileSync(join(root, "mods", "fixture-mod", "manifest.json"), "utf-8"),
  ) as Record<string, unknown>;
  const history = written.deprecation_history as Array<Record<string, unknown>>;
  assert.equal(history.length, 2);
  assert.equal(history[0].since, "2026-01-01T00:00:00Z");
  assert.equal(history[1].since, "2026-08-01T00:00:00Z");
  assert.equal(history[1].by_github_id, AUTHOR_ID);
  assert.equal(history[1].removed_by_github_id, 268817724);
});

test("undeprecate-listing refuses a listing that is not deprecated", (t) => {
  const manifest = deprecatedModManifest("fixture-mod");
  delete manifest.deprecation;
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("undeprecate-listing", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
});

test("a code owner may remove a deprecation they did not create", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": deprecatedModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // subway-builder-modded-admin — see lib/maintainers.ts.
  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: "268817724",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a code owner still cannot restore a deleted listing", (t) => {
  const manifest = deprecatedModManifest("fixture-mod");
  (manifest.deprecation as Record<string, unknown>).deleted = true;
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Deletion is permanent for everyone; the override covers ownership only.
  const result = runScript("validate-undeprecate", root, {
    ISSUE_JSON,
    ISSUE_AUTHOR_ID: "268817724",
  });
  assert.notEqual(result.status, 0);
});
