import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEmptyContentAnnouncementLedger,
  loadContentAnnouncementLedger,
  recordContentAnnouncements,
  writeContentAnnouncementLedger,
} from "../lib/content-announcements.js";
import type { IntegrityOutput } from "../lib/integrity.js";

test("recordContentAnnouncements writes deterministic ledger entries", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-content-announcements-"));
  try {
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    const ledger = createEmptyContentAnnouncementLedger("2026-03-31T16:00:00.000Z");
    const integrity: IntegrityOutput = {
      schema_version: 1,
      generated_at: "2026-03-31T16:57:42.842Z",
      listings: {
        "brand-new-complete": {
          has_complete_version: true,
          latest_semver_version: "v0.1.0",
          latest_semver_complete: true,
          complete_versions: ["v0.1.0"],
          incomplete_versions: [],
          versions: {},
        },
      },
    };

    const added = recordContentAnnouncements({
      ledger,
      listingType: "map",
      listingIds: ["brand-new-complete", "brand-new-complete"],
      integrity,
      recordedAt: "2026-03-31T16:57:42.842Z",
      source: "pending:map",
    });
    assert.equal(added, 1);

    writeContentAnnouncementLedger(repoRoot, ledger);
    const reloaded = loadContentAnnouncementLedger(repoRoot);
    assert.deepEqual(reloaded.entries, {
      "map:brand-new-complete": {
        listing_id: "brand-new-complete",
        listing_type: "map",
        latest_semver_version: "v0.1.0",
        recorded_at: "2026-03-31T16:57:42.842Z",
        source: "pending:map",
      },
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
