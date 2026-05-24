import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildZeroValidSemverWarnings,
  listZeroValidSemverListings,
} from "../generate-downloads.js";
import {
  buildPendingAnnouncements,
  getAnnouncementListingIds,
} from "../lib/pending-announcements.js";
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

test("buildPendingAnnouncements writes only non-test listings that became complete", () => {
  const previousIntegrity: IntegrityOutput = {
    schema_version: 1,
    generated_at: "2026-03-31T16:28:29.630Z",
    listings: {
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
      "test-listing": {
        has_complete_version: true,
        latest_semver_version: "v0.2.0",
        latest_semver_complete: true,
        complete_versions: ["v0.2.0"],
        incomplete_versions: [],
        versions: {
          "v0.2.0": makeVersionEntry(true, []),
        },
      },
    },
  };

  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-pending-announcements-"));
  try {
    mkdirSync(join(repoRoot, "maps", "test-listing"), { recursive: true });
    writeFileSync(
      join(repoRoot, "maps", "test-listing", "manifest.json"),
      `${JSON.stringify({ is_test: true }, null, 2)}\n`,
      "utf8",
    );
    const previousIntegrityPath = join(repoRoot, "maps", "integrity.json");
    mkdirSync(join(repoRoot, "maps"), { recursive: true });
    writeFileSync(previousIntegrityPath, `${JSON.stringify(previousIntegrity, null, 2)}\n`, "utf8");

    const pending = buildPendingAnnouncements({
      newIntegrity,
      previousIntegrity,
      listingType: "map",
      repoRoot,
      announcementLedger: {
        schema_version: 1,
        updated_at: "2026-03-31T16:57:42.842Z",
        entries: {},
      },
    });

    assert.deepEqual(pending, {
      schema_version: 1,
      generated_at: "2026-03-31T16:57:42.842Z",
      listing_type: "map",
      listings: [
        {
          listing_id: "brand-new-complete",
          manifest_path: join("maps", "brand-new-complete", "manifest.json"),
        },
      ],
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("buildPendingAnnouncements excludes listings already present in the announcement ledger", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-pending-announcements-ledger-"));
  try {
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    mkdirSync(join(repoRoot, "maps"), { recursive: true });
    const previousIntegrity: IntegrityOutput = {
      schema_version: 1,
      generated_at: "2026-03-31T16:28:29.630Z",
      listings: {},
    };
    writeFileSync(
      join(repoRoot, "maps", "integrity.json"),
      `${JSON.stringify(previousIntegrity, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(repoRoot, "history", "content-announcements.json"),
      `${JSON.stringify({
        schema_version: 1,
        updated_at: "2026-03-31T16:57:42.842Z",
        entries: {
          "map:brand-new-complete": {
            listing_id: "brand-new-complete",
            listing_type: "map",
            latest_semver_version: "v0.1.0",
            recorded_at: "2026-03-31T16:57:42.842Z",
            source: "bootstrap:test",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const newIntegrity: IntegrityOutput = {
      schema_version: 1,
      generated_at: "2026-03-31T16:57:42.842Z",
      listings: {
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
      },
    };

    const pending = buildPendingAnnouncements({
      newIntegrity,
      previousIntegrity,
      listingType: "map",
      repoRoot,
      announcementLedger: {
        schema_version: 1,
        updated_at: "2026-03-31T16:57:42.842Z",
        entries: {
          "map:brand-new-complete": {
            listing_id: "brand-new-complete",
            listing_type: "map",
            latest_semver_version: "v0.1.0",
            recorded_at: "2026-03-31T16:57:42.842Z",
            source: "bootstrap:test",
          },
        },
      },
    });

    assert.deepEqual(pending.listings, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
