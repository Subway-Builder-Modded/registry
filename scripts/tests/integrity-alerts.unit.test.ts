import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIntegrityAlertIssueBody,
  buildIntegrityAlertIssueTitle,
  resolveAlertNotifyTarget,
} from "../lib/downloads-full/integrity-alerts.js";
import type { AuthorAliasIndex } from "../lib/author-aliases.js";
import type { IntegrityAlert } from "../lib/download-definitions.js";

function makeAlert(overrides: Partial<IntegrityAlert> = {}): IntegrityAlert {
  return {
    listingId: "test-map",
    listingName: "Test Map",
    listingType: "map",
    authorId: "some-author",
    version: "v1.2.0",
    isRegression: true,
    failingChecks: ["config_version_matches_tag"],
    errors: ["config.json version '1.1.0' does not match tag 'v1.2.0'"],
    sourceRepo: "owner/test-map",
    sourceTag: "v1.2.0",
    ...overrides,
  };
}

test("issue title is deterministic and keyed by listing + version", () => {
  assert.equal(
    buildIntegrityAlertIssueTitle(makeAlert()),
    "[Integrity] test-map v1.2.0: failing checks",
  );
  // Stable across unrelated field changes — the title is the dedup key.
  assert.equal(
    buildIntegrityAlertIssueTitle(makeAlert({ errors: [], isRegression: false, listingName: "Renamed" })),
    "[Integrity] test-map v1.2.0: failing checks",
  );
});

test("issue body mentions the author and includes fix hints, errors, and source", () => {
  const body = buildIntegrityAlertIssueBody(makeAlert());
  assert.ok(body.startsWith("@some-author "));
  assert.ok(body.includes("**Test Map** `v1.2.0`"));
  assert.ok(body.includes("a previously-passing version stopped passing"));
  assert.ok(body.includes("`config_version_matches_tag`: Update `version` in `config.json` to match the new release tag"));
  assert.ok(body.includes("config.json version '1.1.0' does not match tag 'v1.2.0'"));
  assert.ok(body.includes("Source: `owner/test-map@v1.2.0`"));
  assert.ok(body.includes("Update Author Profile"));
});

test("issue body labels first-time failures and falls back for unknown check keys", () => {
  const body = buildIntegrityAlertIssueBody(makeAlert({
    listingType: "mod",
    isRegression: false,
    failingChecks: ["some_future_check"],
    errors: [],
    sourceRepo: undefined,
    sourceTag: undefined,
  }));
  assert.ok(body.includes("your mod"));
  assert.ok(body.includes("a new version failed its first check"));
  assert.ok(body.includes("`some_future_check`: Fix the issue and publish a new release."));
  assert.ok(!body.includes("**Errors:**"));
  assert.ok(!body.includes("Source:"));
});

test("issue body caps errors at 8 with an overflow line", () => {
  const errors = Array.from({ length: 11 }, (_, i) => `error ${i + 1}`);
  const body = buildIntegrityAlertIssueBody(makeAlert({ errors }));
  assert.ok(body.includes("- error 8"));
  assert.ok(!body.includes("- error 9"));
  assert.ok(body.includes("...and 3 more"));
});

test("issue body mention login override renders the caretaker's @mention", () => {
  const body = buildIntegrityAlertIssueBody(makeAlert(), "caretaker-login");
  assert.ok(body.startsWith("@caretaker-login "));
  assert.ok(!body.includes("@some-author"));
  // Everything but the mention is unchanged.
  assert.ok(body.includes("**Test Map** `v1.2.0`"));
});

// --- resolveAlertNotifyTarget ---

function makeAuthorIndex(): AuthorAliasIndex {
  return {
    schema_version: 1,
    authors: [
      {
        github_id: 1,
        author_id: "some-author",
        author_alias: "Some Author",
        discord_id: "111",
      },
      {
        github_id: 2,
        author_id: "caretaker-login",
        author_alias: "Care Taker",
        discord_id: "222",
      },
      {
        github_id: 3,
        author_id: "gh-only-caretaker",
      },
    ],
  };
}

test("notify target resolves the active caretaker's entry when set and resolvable", () => {
  const target = resolveAlertNotifyTarget(makeAlert({ caretakerGithubId: 2 }), makeAuthorIndex());
  assert.deepEqual(target, {
    authorId: "caretaker-login",
    alias: "Care Taker",
    discordId: "222",
    githubId: 2,
  });
});

test("notify target falls back to alias/discord-less caretaker entries gracefully", () => {
  const target = resolveAlertNotifyTarget(makeAlert({ caretakerGithubId: 3 }), makeAuthorIndex());
  assert.deepEqual(target, { authorId: "gh-only-caretaker", alias: "gh-only-caretaker", githubId: 3 });
});

test("notify target falls back to the author when the caretaker id is unresolvable", () => {
  const target = resolveAlertNotifyTarget(makeAlert({ caretakerGithubId: 999 }), makeAuthorIndex());
  assert.deepEqual(target, {
    authorId: "some-author",
    alias: "Some Author",
    discordId: "111",
    githubId: 1,
  });
});

test("notify target is the author when no caretaker is set", () => {
  const target = resolveAlertNotifyTarget(makeAlert(), makeAuthorIndex());
  assert.equal(target.authorId, "some-author");
  assert.equal(target.discordId, "111");
});

test("notify target degrades to a bare fallback when neither resolves", () => {
  const target = resolveAlertNotifyTarget(
    makeAlert({ authorId: "unknown-author", caretakerGithubId: 999 }),
    makeAuthorIndex(),
  );
  assert.deepEqual(target, { authorId: "unknown-author", alias: "unknown-author" });
});
