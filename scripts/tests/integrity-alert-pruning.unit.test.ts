import test from "node:test";
import assert from "node:assert/strict";
import type { IntegrityOutput } from "@subway-builder-modded/registry-schemas";
import {
  NEEDS_MAINTAINER_LABEL,
  decideAlertIssueAction,
  parseAlertIssueTitle,
  resolveAlertAgainstIntegrity,
} from "../lib/integrity-alert-pruning.js";

const NOW = new Date("2026-08-20T00:00:00Z");
const SIXTEEN_DAYS_AGO = "2026-08-04T00:00:00Z";
const TWO_DAYS_AGO = "2026-08-18T00:00:00Z";

function versionEntry(overrides: Record<string, unknown> = {}) {
  return {
    is_complete: false,
    errors: ["config_version_matches_tag failed"],
    required_checks: { config_version_matches_tag: false },
    matched_files: {},
    source: { update_type: "github" as const },
    fingerprint: "f",
    checked_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function integrityWith(listingId: string, versions: Record<string, ReturnType<typeof versionEntry>>): IntegrityOutput {
  return {
    schema_version: 1,
    generated_at: "2026-08-20T00:00:00Z",
    listings: {
      [listingId]: {
        has_complete_version: Object.values(versions).some((v) => v.is_complete),
        latest_semver_version: null,
        latest_semver_complete: null,
        complete_versions: [],
        incomplete_versions: Object.keys(versions),
        versions,
      },
    },
  };
}

// --- title parsing ---

test("parses the alert issue title format", () => {
  assert.deepEqual(parseAlertIssueTitle("[Integrity] my-map v1.2.0: failing checks"), {
    listingId: "my-map",
    version: "v1.2.0",
  });
  assert.equal(parseAlertIssueTitle("[Deprecate]: Prospector"), null);
  assert.equal(parseAlertIssueTitle("random title"), null);
});

// --- resolution against integrity ---

test("resolution: version now complete", () => {
  const integrity = integrityWith("my-map", { "v1.0.0": versionEntry({ is_complete: true, errors: [] }) });
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "my-map", version: "v1.0.0" }, { maps: integrity, mods: null }),
    { resolved: true, reason: "version_complete" },
  );
});

test("resolution: version still failing", () => {
  const integrity = integrityWith("my-map", { "v1.0.0": versionEntry() });
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "my-map", version: "v1.0.0" }, { maps: integrity, mods: null }),
    { resolved: false },
  );
});

test("resolution: version removed / listing removed / deprecated", () => {
  const integrity = integrityWith("my-map", { "v2.0.0": versionEntry() });
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "my-map", version: "v1.0.0" }, { maps: integrity, mods: null }),
    { resolved: true, reason: "version_removed" },
  );
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "gone-map", version: "v1.0.0" }, { maps: integrity, mods: null }),
    { resolved: true, reason: "listing_removed" },
  );
  const deprecated = integrityWith("old-mod", {
    "v1.0.0": versionEntry({ errors: ["config_version_matches_tag failed", "listing_deprecated"] }),
  });
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "old-mod", version: "v1.0.0" }, { maps: null, mods: deprecated }),
    { resolved: true, reason: "listing_deprecated" },
  );
});

test("resolution: mods integrity is consulted when maps misses", () => {
  const mods = integrityWith("some-mod", { "v1.0.0": versionEntry({ is_complete: true }) });
  const maps = integrityWith("other-map", { "v9.0.0": versionEntry() });
  assert.deepEqual(
    resolveAlertAgainstIntegrity({ listingId: "some-mod", version: "v1.0.0" }, { maps, mods }),
    { resolved: true, reason: "version_complete" },
  );
});

// --- decision logic ---

const BASE_ISSUE = {
  title: "[Integrity] my-map v1.0.0: failing checks",
  createdAt: SIXTEEN_DAYS_AGO,
  labels: [] as string[],
  lastComment: null,
};

test("resolved alerts close regardless of activity", () => {
  const decision = decideAlertIssueAction(
    { ...BASE_ISSUE, lastComment: { createdAt: TWO_DAYS_AGO, isMaintainer: false } },
    { resolved: true, reason: "version_complete" },
    NOW,
  );
  assert.deepEqual(decision, { action: "close_resolved", reason: "version_complete" });
});

test("recent activity is left alone", () => {
  const decision = decideAlertIssueAction(
    { ...BASE_ISSUE, lastComment: { createdAt: TWO_DAYS_AGO, isMaintainer: true } },
    { resolved: false },
    NOW,
  );
  assert.deepEqual(decision, { action: "none", reason: "recent activity" });
});

test("stale with no comments at all is pruned", () => {
  const decision = decideAlertIssueAction(BASE_ISSUE, { resolved: false }, NOW);
  assert.deepEqual(decision, { action: "close_stale" });
});

test("stale with a maintainer's last word is pruned", () => {
  const decision = decideAlertIssueAction(
    { ...BASE_ISSUE, lastComment: { createdAt: SIXTEEN_DAYS_AGO, isMaintainer: true } },
    { resolved: false },
    NOW,
  );
  assert.deepEqual(decision, { action: "close_stale" });
});

test("stale with the creator's last word escalates instead of pruning", () => {
  const decision = decideAlertIssueAction(
    { ...BASE_ISSUE, lastComment: { createdAt: SIXTEEN_DAYS_AGO, isMaintainer: false } },
    { resolved: false },
    NOW,
  );
  assert.deepEqual(decision, { action: "escalate" });
});

test("escalated issues are exempt from both re-escalation and pruning", () => {
  const escalatedByCreator = decideAlertIssueAction(
    {
      ...BASE_ISSUE,
      labels: [NEEDS_MAINTAINER_LABEL],
      lastComment: { createdAt: SIXTEEN_DAYS_AGO, isMaintainer: false },
    },
    { resolved: false },
    NOW,
  );
  assert.deepEqual(escalatedByCreator, { action: "none", reason: "already escalated" });

  // After the escalation the bot's ping is the last comment (maintainer-side):
  // the label still shields the issue from stale pruning.
  const escalatedThenQuiet = decideAlertIssueAction(
    {
      ...BASE_ISSUE,
      labels: [NEEDS_MAINTAINER_LABEL],
      lastComment: { createdAt: SIXTEEN_DAYS_AGO, isMaintainer: true },
    },
    { resolved: false },
    NOW,
  );
  assert.deepEqual(escalatedThenQuiet, { action: "none", reason: "escalated; awaiting maintainer" });
});
