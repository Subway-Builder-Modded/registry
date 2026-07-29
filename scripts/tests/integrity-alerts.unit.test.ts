import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIntegrityAlertIssueBody,
  buildIntegrityAlertIssueTitle,
} from "../lib/downloads-full/integrity-alerts.js";
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
