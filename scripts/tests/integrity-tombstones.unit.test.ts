import test from "node:test";
import assert from "node:assert/strict";
import type { IntegrityVersionEntry } from "../lib/integrity.js";
import {
  VERSION_REMOVED_ERROR,
  buildRemovedVersionTombstone,
  carryForwardRemovedVersions,
} from "../lib/integrity-tombstones.js";
import { createListingIntegrityEntry } from "../lib/downloads-support.js";

function completeEntry(overrides: Partial<IntegrityVersionEntry> = {}): IntegrityVersionEntry {
  return {
    is_complete: true,
    errors: [],
    required_checks: { config: true, tiles: true },
    matched_files: { config: "config.json" },
    release_size: 42,
    file_sizes: { "config.json": 1 },
    game_version: ">=1.0.0",
    dependencies: { "some-mod": ">=2.0.0" },
    source: {
      update_type: "custom",
      repo: "owner/repo",
      tag: "0.1.0",
      asset_name: "Map.zip",
      download_url: "https://github.com/owner/repo/releases/download/0.1.0/Map.zip",
    },
    fingerprint: "sha256:abc",
    checked_at: "2026-08-01T00:00:00.000Z",
    released_at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

test("buildRemovedVersionTombstone keeps identity fields and drops check artifacts", () => {
  const previous = completeEntry();
  const tombstone = buildRemovedVersionTombstone(previous);

  assert.equal(tombstone.is_complete, false);
  assert.equal(tombstone.availability, "removed");
  assert.deepEqual(tombstone.errors, [VERSION_REMOVED_ERROR]);
  assert.deepEqual(tombstone.required_checks, {});
  assert.deepEqual(tombstone.matched_files, {});
  assert.equal(tombstone.release_size, undefined);
  assert.equal(tombstone.file_sizes, undefined);

  assert.equal(tombstone.game_version, previous.game_version);
  assert.deepEqual(tombstone.dependencies, previous.dependencies);
  assert.deepEqual(tombstone.source, previous.source);
  assert.equal(tombstone.fingerprint, previous.fingerprint);
  assert.equal(tombstone.checked_at, previous.checked_at);
  assert.equal(tombstone.released_at, previous.released_at);
});

test("carryForwardRemovedVersions tombstones previously complete versions missing from the fresh run", () => {
  const next: Record<string, IntegrityVersionEntry> = {
    "0.2.0": completeEntry({ source: { update_type: "custom", tag: "0.2.0" } }),
  };
  const carried = carryForwardRemovedVersions(
    { versions: { "0.1.0": completeEntry(), "0.2.0": completeEntry() } },
    next,
  );

  assert.deepEqual(carried, ["0.1.0"]);
  assert.equal(next["0.1.0"]?.availability, "removed");
  // The version present in the fresh run is untouched.
  assert.equal(next["0.2.0"]?.is_complete, true);
  assert.equal(next["0.2.0"]?.availability, undefined);
});

test("carryForwardRemovedVersions carries existing tombstones verbatim (frozen)", () => {
  const tombstone = buildRemovedVersionTombstone(completeEntry());
  const next: Record<string, IntegrityVersionEntry> = {};
  const carried = carryForwardRemovedVersions({ versions: { "0.1.0": tombstone } }, next);

  assert.deepEqual(carried, ["0.1.0"]);
  assert.equal(next["0.1.0"], tombstone);
});

test("carryForwardRemovedVersions tombstones retired versions pruned from update.json", () => {
  const retired = completeEntry({
    is_complete: false,
    errors: ["missing download URL"],
    availability: "retired",
  });
  const next: Record<string, IntegrityVersionEntry> = {};
  const carried = carryForwardRemovedVersions({ versions: { "0.1.0": retired } }, next);

  assert.deepEqual(carried, ["0.1.0"]);
  assert.equal(next["0.1.0"]?.availability, "removed");
});

test("carryForwardRemovedVersions drops previously-broken versions and handles missing previous listing", () => {
  const broken = completeEntry({ is_complete: false, errors: ["zip missing config.json"] });
  const next: Record<string, IntegrityVersionEntry> = {};

  assert.deepEqual(carryForwardRemovedVersions({ versions: { "0.1.0": broken } }, next), []);
  assert.deepEqual(next, {});
  assert.deepEqual(carryForwardRemovedVersions(undefined, next), []);
});

test("createListingIntegrityEntry excludes removed tombstones from listing aggregates", () => {
  const tombstone = buildRemovedVersionTombstone(completeEntry());
  const entries: Record<string, IntegrityVersionEntry> = {
    "0.1.0": completeEntry(),
    // Deleted latest release: must not stay pinned as latest_semver_version.
    "0.2.0": tombstone,
  };
  const listing = createListingIntegrityEntry(entries);

  assert.equal(listing.latest_semver_version, "0.1.0");
  assert.equal(listing.latest_semver_complete, true);
  assert.deepEqual(listing.complete_versions, ["0.1.0"]);
  assert.deepEqual(listing.incomplete_versions, []);
  assert.equal(listing.versions["0.2.0"], tombstone);
});
