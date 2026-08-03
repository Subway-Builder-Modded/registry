import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListingIntegrityEntry } from "../lib/integrity.js";
import type { IntegrityAlert } from "../lib/download-definitions.js";
import {
  DEPRECATED_LISTING_ERROR,
  applyDeprecationOverlay,
  filterDeprecatedIntegrityAlerts,
  isDeprecatedListing,
  isManifestDeprecated,
  overlayDeprecatedListingEntry,
} from "../lib/downloads-full/deprecation.js";

function versionEntry(overrides: Record<string, unknown> = {}): ListingIntegrityEntry["versions"][string] {
  return {
    is_complete: true,
    errors: [],
    required_checks: { config_version_matches_tag: true },
    matched_files: {},
    game_version: ">=1.2.0",
    released_at: "2026-05-01T00:00:00Z",
    source: {
      update_type: "github",
      repo: "owner/repo",
      tag: "v1.0.0",
      download_url: "https://example.com/release.zip",
    },
    fingerprint: "abc",
    checked_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as ListingIntegrityEntry["versions"][string];
}

function listingEntry(): ListingIntegrityEntry {
  return {
    has_complete_version: true,
    latest_semver_version: "1.1.0",
    latest_semver_complete: true,
    complete_versions: ["v1.0.0", "v1.1.0"],
    incomplete_versions: ["v0.9.0"],
    last_updated: 1750000000,
    versions: {
      "v1.0.0": versionEntry(),
      "v1.1.0": versionEntry({ source: { update_type: "github", repo: "owner/repo", tag: "v1.1.0" } }),
      "v0.9.0": versionEntry({ is_complete: false, errors: ["manifest-version-mismatch"] }),
    },
  };
}

test("overlay reports every version incomplete with the deprecation marker", () => {
  const overlaid = overlayDeprecatedListingEntry(listingEntry());

  assert.equal(overlaid.has_complete_version, false);
  assert.equal(overlaid.latest_semver_complete, false);
  assert.deepEqual(overlaid.complete_versions, []);
  assert.deepEqual(overlaid.incomplete_versions, ["v0.9.0", "v1.0.0", "v1.1.0"]);
  for (const entry of Object.values(overlaid.versions)) {
    assert.equal(entry.is_complete, false);
    assert.ok(entry.errors.includes(DEPRECATED_LISTING_ERROR));
  }
  // Pre-existing errors are preserved, not replaced.
  assert.deepEqual(overlaid.versions["v0.9.0"]!.errors, [
    "manifest-version-mismatch",
    DEPRECATED_LISTING_ERROR,
  ]);
});

test("overlay preserves version data consumers rely on", () => {
  const overlaid = overlayDeprecatedListingEntry(listingEntry());
  const v1 = overlaid.versions["v1.0.0"]!;

  assert.equal(v1.released_at, "2026-05-01T00:00:00Z");
  assert.equal(v1.game_version, ">=1.2.0");
  assert.equal(v1.source.download_url, "https://example.com/release.zip");
  assert.equal(overlaid.last_updated, 1750000000);
  assert.equal(overlaid.latest_semver_version, "1.1.0");
});

test("overlay is idempotent (marker not duplicated on already-overlaid input)", () => {
  const once = overlayDeprecatedListingEntry(listingEntry());
  const twice = overlayDeprecatedListingEntry(once);
  assert.deepEqual(twice, once);
});

test("overlay keeps latest_semver_complete null when no semver version exists", () => {
  const entry: ListingIntegrityEntry = {
    has_complete_version: false,
    latest_semver_version: null,
    latest_semver_complete: null,
    complete_versions: [],
    incomplete_versions: [],
    versions: {},
  };
  const overlaid = overlayDeprecatedListingEntry(entry);
  assert.equal(overlaid.latest_semver_complete, null);
});

test("overlay does not mutate its input", () => {
  const entry = listingEntry();
  const before = JSON.stringify(entry);
  overlayDeprecatedListingEntry(entry);
  assert.equal(JSON.stringify(entry), before);
});

test("applyDeprecationOverlay only touches deprecated ids and returns them sorted", () => {
  const listings: Record<string, ListingIntegrityEntry> = {
    "zeta-mod": listingEntry(),
    "alpha-mod": listingEntry(),
    "kept-mod": listingEntry(),
  };
  const overlaid = applyDeprecationOverlay(listings, (id) => id !== "kept-mod");

  assert.deepEqual(overlaid, ["alpha-mod", "zeta-mod"]);
  assert.equal(listings["kept-mod"]!.has_complete_version, true);
  assert.equal(listings["alpha-mod"]!.has_complete_version, false);
  assert.equal(listings["zeta-mod"]!.has_complete_version, false);
});

test("filterDeprecatedIntegrityAlerts drops alerts for deprecated listings only", () => {
  const alerts = [
    { listingId: "deprecated-mod", version: "v1.0.0" },
    { listingId: "live-mod", version: "v2.0.0" },
  ] as IntegrityAlert[];
  const filtered = filterDeprecatedIntegrityAlerts(alerts, (id) => id === "deprecated-mod");
  assert.deepEqual(filtered.map((a) => a.listingId), ["live-mod"]);
});

test("isManifestDeprecated keys on field presence", () => {
  assert.equal(isManifestDeprecated({}), false);
  assert.equal(
    isManifestDeprecated({ deprecation: { since: "2026-08-03T00:00:00Z", by_github_id: 1 } }),
    true,
  );
});

test("isDeprecatedListing probes the manifest on disk and defaults to false", (t) => {
  const root = mkdtempSync(join(tmpdir(), "railyard-depr-overlay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, "mods", "gone-mod"), { recursive: true });
  writeFileSync(
    join(root, "mods", "gone-mod", "manifest.json"),
    JSON.stringify({ id: "gone-mod", deprecation: { since: "2026-08-03T00:00:00Z", by_github_id: 1 } }),
    "utf-8",
  );
  mkdirSync(join(root, "mods", "live-mod"), { recursive: true });
  writeFileSync(join(root, "mods", "live-mod", "manifest.json"), JSON.stringify({ id: "live-mod" }), "utf-8");

  assert.equal(isDeprecatedListing(root, "mods", "gone-mod"), true);
  assert.equal(isDeprecatedListing(root, "mods", "live-mod"), false);
  assert.equal(isDeprecatedListing(root, "mods", "missing-mod"), false);
});
