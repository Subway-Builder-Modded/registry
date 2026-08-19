import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import JSZip from "jszip";

const scriptsRoot = resolve(import.meta.dirname, "..", "..");
const repoRoot = resolve(scriptsRoot, "..");
const validationErrorPath = resolve(repoRoot, "scripts", "validation-error.md");

function cleanupValidationErrorFile(): void {
  if (existsSync(validationErrorPath)) {
    unlinkSync(validationErrorPath);
  }
}

function runScript(
  scriptName: "validate-publish" | "validate-update",
  env: Record<string, string>,
): SpawnSyncReturns<string> {
  cleanupValidationErrorFile();
  const compiledScriptPath = resolve(scriptsRoot, ".test-dist", "intake", `${scriptName}.js`);
  return spawnSync(
    process.execPath,
    [compiledScriptPath],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RAILYARD_REPO_ROOT: repoRoot,
        ...env,
      },
      encoding: "utf-8",
    },
  );
}

function readValidationError(): string {
  return existsSync(validationErrorPath)
    ? readFileSync(validationErrorPath, "utf-8")
    : "";
}

function basePublishMapIssue(overrides: Record<string, string>): Record<string, string> {
  return {
    "map-id": `zz-test-map-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: "Validation Test Map",
    "city-code": "RDU",
    country: "US",
    description: "Validation test payload.",
    data_source: "OSM",
    source_quality: "low-quality",
    level_of_detail: "low-detail",
    methodology: "Generated for validation tests.",
    location: "north-america",
    source: "https://example.com/test-map",
    "update-type": "GitHub Releases",
    "github-repo": "invalid-repo-format",
    gallery: "https://example.com/screenshot.png",
    ...overrides,
  };
}

async function makeZipDataUrl(payload: unknown): Promise<string> {
  const zip = new JSZip();
  zip.file("demand_data.json", JSON.stringify(payload));
  zip.file("config.json", JSON.stringify({
    code: "TST",
    initialViewState: {
      latitude: 38.312462,
      longitude: 140.325418,
      zoom: 12,
      bearing: 0,
    },
  }));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return `data:application/zip;base64,${zipBuffer.toString("base64")}`;
}

test("publish validation rejects city codes that clash with vanilla maps", () => {
  const issue = basePublishMapIssue({ "city-code": "NYC" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for vanilla city code");
  const output = readValidationError();
  assert.match(output, /\*\*city-code\*\*: `NYC` clashes with a vanilla city code\./);
});

test("publish validation rejects migration-reserved city codes with a reserved message", () => {
  const issue = basePublishMapIssue({ "city-code": "LYS" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for a migration-reserved city code");
  const output = readValidationError();
  assert.match(output, /\*\*city-code\*\*: `LYS` is reserved during a city-code migration/);
  assert.doesNotMatch(output, /`LYS` clashes with a vanilla city code/);
});

test("publish validation no longer blocks MRS (released back to marseille, 2026-08-20)", () => {
  const issue = basePublishMapIssue({ "city-code": "MRS" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  // MRS may fail other rules in this fixture, but never the city-code rules.
  const output = result.status === 0 ? "" : readValidationError();
  assert.doesNotMatch(output, /`MRS` clashes with a vanilla city code/);
  assert.doesNotMatch(output, /`MRS` is reserved/);
});

test("publish validation enforces ISO country code format (2 uppercase letters)", () => {
  const issue = basePublishMapIssue({ country: "uS" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for invalid country format");
  const output = readValidationError();
  assert.match(output, /\*\*country\*\*: Country must be a 2-letter ISO 3166-1 alpha-2 code/);
});

test("update validation rejects map updates when map ID does not exist", () => {
  const issue = {
    "map-id": `zz-missing-map-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  };
  const result = runScript("validate-update", {
    LISTING_TYPE: "map",
    ISSUE_AUTHOR_ID: "1",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for missing map ID");
  const output = readValidationError();
  assert.match(output, /\*\*map-id\*\*: No map with ID `.*` exists in the registry\./);
});

test("publish validation rejects map demand data with negative population size", async () => {
  const zipUrl = await makeZipDataUrl({
    points: [{ id: "p1", residents: 10 }],
    pops: [{ id: "pop-1329", size: -5 }],
  });
  const customUpdateJson = {
    schema_version: 1,
    versions: [
      {
        version: "1.0.0",
        game_version: "1.0.0",
        date: "2026-03-12",
        download: zipUrl,
        sha256: "deadbeef",
      },
    ],
  };
  const customUpdateUrl = `data:application/json,${encodeURIComponent(JSON.stringify(customUpdateJson))}`;
  const issue = basePublishMapIssue({
    "update-type": "Custom URL",
    "custom-update-url": customUpdateUrl,
  });
  delete issue["github-repo"];

  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for negative population size in demand_data");
  const output = readValidationError();
  assert.match(output, /\*\*demand_data\*\*: population entry 'pop-1329' has negative size value/);
});

test("publish validation rejects map demand data when point/pop resident totals mismatch", async () => {
  const zipUrl = await makeZipDataUrl({
    points: [{ id: "p1", residents: 10 }, { id: "p2", residents: 15 }],
    pops: [{ id: "pop-1", size: 8 }, { id: "pop-2", size: 9 }],
  });
  const customUpdateJson = {
    schema_version: 1,
    versions: [
      {
        version: "1.0.0",
        game_version: "1.0.0",
        date: "2026-03-12",
        download: zipUrl,
        sha256: "deadbeef",
      },
    ],
  };
  const customUpdateUrl = `data:application/json,${encodeURIComponent(JSON.stringify(customUpdateJson))}`;
  const issue = basePublishMapIssue({
    "update-type": "Custom URL",
    "custom-update-url": customUpdateUrl,
  });
  delete issue["github-repo"];

  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail when residents totals mismatch");
  const output = readValidationError();
  assert.match(output, /\*\*demand_data\*\*: listing=.*resident totals mismatch/);
});

test("publish validation rejects city codes that clash with existing maps", () => {
  const issue = basePublishMapIssue({ "city-code": "ALB" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for duplicate city code");
  const output = readValidationError();
  assert.match(output, /\*\*city-code\*\*: `ALB` is already used by map `albany`\. City codes must be unique\./);
});

test("publish validation rejects map ID that matches an existing mod", () => {
  const issue = basePublishMapIssue({ "map-id": "transit-overlay" });
  const result = runScript("validate-publish", {
    LISTING_TYPE: "map",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for cross-type duplicate ID");
  const output = readValidationError();
  assert.match(output, /\*\*map-id\*\*: A mod with ID `transit-overlay` already exists\. Listing IDs must be unique across maps and mods\./);
});

test("publish validation rejects mod ID that matches an existing map", () => {
  const result = runScript("validate-publish", {
    LISTING_TYPE: "mod",
    ISSUE_JSON: JSON.stringify({
      "mod-id": "albany",
      name: "Test Mod",
      description: "Test description.",
      source: "https://example.com/test-mod",
      "update-type": "GitHub Releases",
      "github-repo": "invalid-repo-format",
    }),
  });

  assert.notEqual(result.status, 0, "Validation should fail for cross-type duplicate ID");
  const output = readValidationError();
  assert.match(output, /\*\*mod-id\*\*: A map with ID `albany` already exists\. Listing IDs must be unique across maps and mods\./);
});

test("publish validation rejects malformed collaborators", () => {
  const result = runScript("validate-publish", {
    LISTING_TYPE: "mod",
    ISSUE_JSON: JSON.stringify({
      "mod-id": `zz-test-mod-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: "Test Mod",
      description: "Test description.",
      source: "https://example.com/test-mod",
      collaborators: "19807509,,12345678",
      "update-type": "GitHub Releases",
      "github-repo": "invalid-repo-format",
    }),
  });

  assert.notEqual(result.status, 0, "Validation should fail for malformed collaborators");
  const output = readValidationError();
  assert.match(output, /\*\*collaborators\*\*: Collaborators must be a comma-separated list of GitHub user IDs with no empty entries\./);
});

test("update validation rejects malformed collaborators", () => {
  const issue = {
    "map-id": `zz-missing-map-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    collaborators: "19807509,",
  };
  const result = runScript("validate-update", {
    LISTING_TYPE: "map",
    ISSUE_AUTHOR_ID: "1",
    ISSUE_JSON: JSON.stringify(issue),
  });

  assert.notEqual(result.status, 0, "Validation should fail for malformed collaborators");
  const output = readValidationError();
  assert.match(output, /\*\*collaborators\*\*: Collaborators must be a comma-separated list of GitHub user IDs with no empty entries\./);
});

// --- privileged update fields (ownership parity with retirement) ---

const UPDATE_OWNER_ID = 4100;
const UPDATE_COLLABORATOR_ID = 4200;
const UPDATE_CARETAKER_ID = 4300;

function makeUpdateFixtureRepo(deprecation?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "railyard-update-auth-"));
  mkdirSync(join(root, "mods", "fixture-mod"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "mods", "fixture-mod", "manifest.json"),
    JSON.stringify({
      schema_version: 1,
      id: "fixture-mod",
      name: "Fixture Mod",
      author: "fixture-author",
      github_id: UPDATE_OWNER_ID,
      collaborators: [UPDATE_COLLABORATOR_ID, UPDATE_CARETAKER_ID],
      caretakers: [{ github_id: UPDATE_CARETAKER_ID, since: "2026-03-01T00:00:00Z" }],
      description: "A fixture mod.",
      tags: ["qol"],
      gallery: [],
      is_test: false,
      source: "https://example.com/fixture",
      update: { type: "github", repo: "fixture/fixture" },
      ...(deprecation ? { deprecation } : {}),
    }, null, 2) + "\n",
    "utf-8",
  );
  return root;
}

function runUpdateInFixture(root: string, authorId: number, issue: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [resolve(scriptsRoot, ".test-dist", "intake", "validate-update.js")],
    {
      cwd: root,
      env: {
        ...process.env,
        RAILYARD_REPO_ROOT: root,
        LISTING_TYPE: "mod",
        ISSUE_AUTHOR_ID: String(authorId),
        ISSUE_JSON: JSON.stringify({ "mod-id": "fixture-mod", ...issue }),
      },
      encoding: "utf-8" as const,
    },
  );
}

function fixtureValidationError(root: string): string {
  const path = join(root, "scripts", "validation-error.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

test("update validation blocks a collaborator from repointing the update source", (t) => {
  const root = makeUpdateFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runUpdateInFixture(root, UPDATE_COLLABORATOR_ID, { "update-type": "GitHub Releases" });
  assert.notEqual(result.status, 0, "collaborators must not be able to repoint downloads");
  assert.match(fixtureValidationError(root), /Authorization check failed.*update-type/s);
});

test("update validation blocks a collaborator from rewriting collaborators or caretaker", (t) => {
  const root = makeUpdateFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runUpdateInFixture(root, UPDATE_COLLABORATOR_ID, { caretaker: "not-an-id" });
  assert.notEqual(result.status, 0);
  assert.match(fixtureValidationError(root), /Authorization check failed.*caretaker/s);
});

test("update validation still lets a collaborator edit presentation metadata", (t) => {
  const root = makeUpdateFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runUpdateInFixture(root, UPDATE_COLLABORATOR_ID, {
    name: "Renamed Fixture Mod",
    description: "An updated description.",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("update validation lets the active caretaker change the update source", (t) => {
  const root = makeUpdateFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runUpdateInFixture(root, UPDATE_CARETAKER_ID, { "update-type": "GitHub Releases" });
  assert.equal(result.status, 0, result.stderr);
});

test("update validation lets a code owner change the update source", (t) => {
  const root = makeUpdateFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // subway-builder-modded-admin — see lib/maintainers.ts.
  const result = runUpdateInFixture(root, 268817724, { "update-type": "GitHub Releases" });
  assert.equal(result.status, 0, result.stderr);
});

const DELETED_RECORD = {
  since: "2026-08-01T00:00:00Z",
  by_github_id: UPDATE_OWNER_ID,
  deleted: true,
};

test("update validation refuses metadata edits on a deleted listing", (t) => {
  const root = makeUpdateFixtureRepo(DELETED_RECORD);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runUpdateInFixture(root, UPDATE_OWNER_ID, { description: "A new description." });
  assert.notEqual(result.status, 0, "deletion is permanent for the publisher too");
  assert.match(fixtureValidationError(root), /was permanently deleted and its metadata can no longer be changed/);
});

test("update validation lets a code owner correct a deleted listing's record", (t) => {
  const root = makeUpdateFixtureRepo(DELETED_RECORD);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // subway-builder-modded-admin — see lib/maintainers.ts.
  const result = runUpdateInFixture(root, 268817724, { description: "A corrected description." });
  assert.equal(result.status, 0, result.stderr);
});

test("update validation still accepts edits on a listing that is merely deprecated", (t) => {
  const root = makeUpdateFixtureRepo({
    since: "2026-08-01T00:00:00Z",
    by_github_id: UPDATE_OWNER_ID,
    reason: "Superseded",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Tidying a listing before restoring it is legitimate; deprecation reverses.
  const result = runUpdateInFixture(root, UPDATE_OWNER_ID, { description: "A new description." });
  assert.equal(result.status, 0, result.stderr);
});
