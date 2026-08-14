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
const PAST_CARETAKER_ID = 4000;
const STRANGER_ID = 9000;

function baseModManifest(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    name: "Fixture Mod",
    author: "fixture-author",
    github_id: AUTHOR_ID,
    collaborators: [COLLABORATOR_ID, PAST_CARETAKER_ID, ACTIVE_CARETAKER_ID],
    caretakers: [
      { github_id: PAST_CARETAKER_ID, since: "2026-01-01T00:00:00Z", until: "2026-03-01T00:00:00Z" },
      { github_id: ACTIVE_CARETAKER_ID, since: "2026-03-01T00:00:00Z" },
    ],
    description: "A fixture mod.",
    tags: ["qol"],
    gallery: [],
    is_test: false,
    source: "https://example.com/fixture",
    update: { type: "github", repo: "fixture/fixture" },
  };
}

function makeFixtureRepo(manifests: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "railyard-deprecate-"));
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
  scriptName: "validate-deprecate" | "deprecate-listing",
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

function issueJson(assetId: string, reason?: string): string {
  return JSON.stringify({ "asset-id": assetId, reason: reason ?? "_No response_" });
}

// --- validate-deprecate ---

test("deprecate validation passes for the original publisher", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("deprecate validation passes for the active caretaker", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(ACTIVE_CARETAKER_ID),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("deprecate validation rejects an ordinary collaborator", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(COLLABORATOR_ID),
  });
  assert.notEqual(result.status, 0, "collaborators must not be able to deprecate");
  assert.match(readValidationError(root), /Only the original publisher or the active caretaker/);
});

test("deprecate validation rejects a past (closed-window) caretaker", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(PAST_CARETAKER_ID),
  });
  assert.notEqual(result.status, 0, "past caretakers must not be able to deprecate");
});

test("deprecate validation rejects a stranger", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(STRANGER_ID),
  });
  assert.notEqual(result.status, 0);
});

test("deprecate validation rejects an unknown asset ID", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("does-not-exist"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
  assert.match(readValidationError(root), /No mod or map with ID `does-not-exist` exists/);
});

test("deprecate validation rejects an already-deprecated listing", (t) => {
  const manifest = baseModManifest("fixture-mod");
  manifest.deprecation = { since: "2026-08-01T00:00:00Z", by_github_id: AUTHOR_ID };
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
  assert.match(readValidationError(root), /already deprecated/);
});

test("deprecate validation allows a test listing", (t) => {
  const manifest = baseModManifest("fixture-mod");
  manifest.is_test = true;
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);
});

// --- deprecate-listing ---

test("deprecate-listing stamps a schema-valid deprecation record with reason", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("deprecate-listing", root, {
    ISSUE_JSON: issueJson("fixture-mod", "Superseded by fixture-mod-2"),
    ISSUE_AUTHOR_ID: String(ACTIVE_CARETAKER_ID),
  });
  assert.equal(result.status, 0, result.stderr);

  const written = JSON.parse(
    readFileSync(join(root, "mods", "fixture-mod", "manifest.json"), "utf-8"),
  ) as Record<string, unknown>;
  const deprecation = written.deprecation as Record<string, unknown>;
  assert.equal(deprecation.by_github_id, ACTIVE_CARETAKER_ID);
  assert.equal(deprecation.reason, "Superseded by fixture-mod-2");
  assert.ok(!Number.isNaN(Date.parse(deprecation.since as string)), "since must be a timestamp");
});

test("deprecate-listing omits the reason when the form field is blank", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("deprecate-listing", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);

  const written = JSON.parse(
    readFileSync(join(root, "mods", "fixture-mod", "manifest.json"), "utf-8"),
  ) as Record<string, unknown>;
  const deprecation = written.deprecation as Record<string, unknown>;
  assert.equal(deprecation.by_github_id, AUTHOR_ID);
  assert.equal("reason" in deprecation, false);
});

test("deprecate-listing refuses to double-deprecate", (t) => {
  const manifest = baseModManifest("fixture-mod");
  manifest.deprecation = { since: "2026-08-01T00:00:00Z", by_github_id: AUTHOR_ID };
  const root = makeFixtureRepo({ "fixture-mod": manifest });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("deprecate-listing", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.notEqual(result.status, 0);
});

test("deprecate-listing freezes ledger and current counts into grandfathered-downloads.json", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(join(root, "mods", "download-version-buckets.json"), JSON.stringify({
    schema_version: 1,
    updated_at: "2026-08-01T00:00:00.000Z",
    listings: {
      "fixture-mod": {
        versions: {
          "v1.0.0": { max_total_downloads: 120, buckets: {}, updated_at: "2026-08-01T00:00:00.000Z" },
          "v1.1.0": { max_total_downloads: 40, buckets: {}, updated_at: "2026-08-01T00:00:00.000Z" },
        },
      },
    },
  }) + "\n", "utf-8");
  // v1.1.0 grew past its ledger max; v1.2.0 exists only in downloads.json.
  writeFileSync(join(root, "mods", "downloads.json"), JSON.stringify({
    "fixture-mod": { "v1.1.0": 45, "v1.2.0": 7 },
  }) + "\n", "utf-8");
  // A pre-existing grandfathered entry above all other sources must win.
  writeFileSync(join(root, "mods", "grandfathered-downloads.json"), JSON.stringify({
    "fixture-mod": { "v1.0.0": 150 },
    "other-mod": { "v2.0.0": 9 },
  }) + "\n", "utf-8");

  const result = runScript("deprecate-listing", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);

  const grandfathered = JSON.parse(
    readFileSync(join(root, "mods", "grandfathered-downloads.json"), "utf-8"),
  ) as Record<string, Record<string, number>>;
  assert.deepEqual(grandfathered["fixture-mod"], {
    "v1.0.0": 150,
    "v1.1.0": 45,
    "v1.2.0": 7,
  });
  assert.deepEqual(grandfathered["other-mod"], { "v2.0.0": 9 });
});

test("deprecate-listing succeeds without freezing when the listing has no counts", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("deprecate-listing", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(AUTHOR_ID),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("No download counts to freeze"));
  assert.equal(existsSync(join(root, "mods", "grandfathered-downloads.json")), false);
});

test("a code owner may deprecate a listing they do not own", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // subway-builder-modded-admin — see lib/maintainers.ts.
  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: "268817724",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a non-owner who is not a code owner is still rejected", (t) => {
  const root = makeFixtureRepo({ "fixture-mod": baseModManifest("fixture-mod") });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runScript("validate-deprecate", root, {
    ISSUE_JSON: issueJson("fixture-mod"),
    ISSUE_AUTHOR_ID: String(STRANGER_ID),
  });
  assert.notEqual(result.status, 0);
});
