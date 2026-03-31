import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZeroValidSemverWarnings,
  getAnnouncementListingIds,
  listZeroValidSemverListings,
} from "../generate-downloads.js";
import type { IntegrityOutput, IntegrityVersionEntry } from "../lib/integrity.js";

function makeVersionEntry(
  isComplete: boolean,
  errors: string[],
  source: IntegrityVersionEntry["source"] = { update_type: "github", repo: "owner/repo", tag: "v0.0.0" },
): IntegrityVersionEntry {
  return {
    is_complete: isComplete,
    errors,
    required_checks: {},
    matched_files: {},
    source,
    fingerprint: "test-fingerprint",
    checked_at: "2026-03-31T16:28:29.630Z",
  };
}

test("listZeroValidSemverListings returns listings that have versions but no semver tags", () => {
  const integrity: IntegrityOutput = {
    schema_version: 1,
    generated_at: "2026-03-31T16:28:29.630Z",
    listings: {
      "bucharest-medium": {
        has_complete_version: false,
        latest_semver_version: null,
        latest_semver_complete: null,
        complete_versions: [],
        incomplete_versions: [],
        versions: {
          "BUC-1.0": makeVersionEntry(false, ["non-semver release tag 'BUC-1.0'"]),
          "BUC-1.1": makeVersionEntry(false, ["non-semver release tag 'BUC-1.1'"]),
        },
      },
      "incomplete-semver-map": {
        has_complete_version: false,
        latest_semver_version: "v1.0.0",
        latest_semver_complete: false,
        complete_versions: [],
        incomplete_versions: ["v1.0.0"],
        versions: {
          "v1.0.0": makeVersionEntry(false, ["release has no .zip asset"]),
        },
      },
      "healthy-map": {
        has_complete_version: true,
        latest_semver_version: "v2.0.0",
        latest_semver_complete: true,
        complete_versions: ["v2.0.0"],
        incomplete_versions: [],
        versions: {
          "v2.0.0": makeVersionEntry(true, []),
        },
      },
    },
  };

  assert.deepEqual(listZeroValidSemverListings(integrity), ["bucharest-medium"]);
  assert.deepEqual(
    buildZeroValidSemverWarnings(integrity),
    ["listing=bucharest-medium: no valid semver release tags found"],
  );
});

test("getAnnouncementListingIds includes brand-new complete listings and existing listings that become complete", () => {
  const previousIntegrity: IntegrityOutput = {
    schema_version: 1,
    generated_at: "2026-03-31T16:28:29.630Z",
    listings: {
      "bucharest-medium": {
        has_complete_version: false,
        latest_semver_version: null,
        latest_semver_complete: null,
        complete_versions: [],
        incomplete_versions: [],
        versions: {
          "BUC-1.0": makeVersionEntry(false, ["non-semver release tag 'BUC-1.0'"]),
        },
      },
      "already-complete": {
        has_complete_version: true,
        latest_semver_version: "v1.0.0",
        latest_semver_complete: true,
        complete_versions: ["v1.0.0"],
        incomplete_versions: [],
        versions: {
          "v1.0.0": makeVersionEntry(true, []),
        },
      },
    },
  };
  const newIntegrity: IntegrityOutput = {
    schema_version: 1,
    generated_at: "2026-03-31T16:57:42.842Z",
    listings: {
      "bucharest-medium": {
        has_complete_version: true,
        latest_semver_version: "v1.1.1",
        latest_semver_complete: true,
        complete_versions: ["v1.1.1"],
        incomplete_versions: [],
        versions: {
          "v1.1.1": makeVersionEntry(true, []),
        },
      },
      "already-complete": {
        has_complete_version: true,
        latest_semver_version: "v1.0.0",
        latest_semver_complete: true,
        complete_versions: ["v1.0.0"],
        incomplete_versions: [],
        versions: {
          "v1.0.0": makeVersionEntry(true, []),
        },
      },
      "brand-new-complete": {
        has_complete_version: true,
        latest_semver_version: "v0.1.0",
        latest_semver_complete: true,
        complete_versions: ["v0.1.0"],
        incomplete_versions: [],
        versions: {
          "v0.1.0": makeVersionEntry(true, []),
        },
      },
      "brand-new-incomplete": {
        has_complete_version: false,
        latest_semver_version: "v0.1.0",
        latest_semver_complete: false,
        complete_versions: [],
        incomplete_versions: ["v0.1.0"],
        versions: {
          "v0.1.0": makeVersionEntry(false, ["missing top-level manifest.json in ZIP"]),
        },
      },
    },
  };

  assert.deepEqual(
    getAnnouncementListingIds(newIntegrity, previousIntegrity).sort(),
    ["brand-new-complete", "bucharest-medium"],
  );
});
