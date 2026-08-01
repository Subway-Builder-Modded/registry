import test from "node:test";
import assert from "node:assert/strict";
import { ModManifestSchema } from "@subway-builder-modded/registry-schemas";
import {
  ADMIN_AUTHOR_GITHUB_ID,
  ADMIN_AUTHOR_ID,
  applyAdminAuthorOverride,
  applyCaretakerUpdate,
  getActiveCaretaker,
  parseCaretakerUpdate,
  parsePublishCaretaker,
  resolveCaretakerUpdate,
  type ManifestWithAuthor,
  type ManifestWithCaretakers,
} from "../lib/caretakers.js";

// --- Schema invariants (via the built registry-schemas package) ---

const BASE_MOD_MANIFEST = {
  schema_version: 1,
  id: "test-mod",
  name: "Test Mod",
  author: "tester",
  github_id: 1,
  description: "A test mod.",
  tags: ["qol"],
  gallery: [],
  is_test: false,
  source: "https://example.com/test-mod",
  update: { type: "github", repo: "tester/test-mod" },
} as const;

function parseWithCaretakers(caretakers: unknown) {
  return ModManifestSchema.safeParse({ ...BASE_MOD_MANIFEST, caretakers });
}

test("caretakers schema accepts a single active caretaker", () => {
  const result = parseWithCaretakers([
    { github_id: 100, since: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(result.success, true);
});

test("caretakers schema accepts closed history with the active entry last", () => {
  const result = parseWithCaretakers([
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
    { github_id: 200, since: "2025-06-01T00:00:00Z", until: "2026-01-01T00:00:00Z" },
    { github_id: 300, since: "2026-01-01T00:00:00Z" },
  ]);
  assert.equal(result.success, true);
});

test("caretakers schema accepts an empty and an all-closed history", () => {
  assert.equal(parseWithCaretakers([]).success, true);
  const closed = parseWithCaretakers([
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
  ]);
  assert.equal(closed.success, true);
});

test("caretakers schema rejects two active entries", () => {
  const result = parseWithCaretakers([
    { github_id: 100, since: "2025-01-01T00:00:00Z" },
    { github_id: 200, since: "2026-01-01T00:00:00Z" },
  ]);
  assert.equal(result.success, false);
  assert.match(
    JSON.stringify(result.success ? [] : result.error.issues),
    /at most one caretaker entry may be active/,
  );
});

test("caretakers schema rejects an active entry that is not last", () => {
  const result = parseWithCaretakers([
    { github_id: 100, since: "2025-01-01T00:00:00Z" },
    { github_id: 200, since: "2026-01-01T00:00:00Z", until: "2026-06-01T00:00:00Z" },
  ]);
  assert.equal(result.success, false);
  assert.match(
    JSON.stringify(result.success ? [] : result.error.issues),
    /must be the last entry/,
  );
});

test("caretakers schema rejects until not after since", () => {
  const equal = parseWithCaretakers([
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-01-01T00:00:00Z" },
  ]);
  assert.equal(equal.success, false);
  const before = parseWithCaretakers([
    { github_id: 100, since: "2025-06-01T00:00:00Z", until: "2025-01-01T00:00:00Z" },
  ]);
  assert.equal(before.success, false);
  assert.match(
    JSON.stringify(before.success ? [] : before.error.issues),
    /until must be after since/,
  );
});

test("caretakers schema rejects descending since order", () => {
  const result = parseWithCaretakers([
    { github_id: 100, since: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z" },
    { github_id: 200, since: "2025-01-01T00:00:00Z" },
  ]);
  assert.equal(result.success, false);
  assert.match(
    JSON.stringify(result.success ? [] : result.error.issues),
    /ascending since order/,
  );
});

// --- Parsing ---

test("publish caretaker parses a single GitHub ID and treats blank values as empty", () => {
  assert.equal(parsePublishCaretaker(" 19807509 "), 19807509);
  assert.equal(parsePublishCaretaker(""), null);
  assert.equal(parsePublishCaretaker("_No response_"), null);
  assert.equal(parsePublishCaretaker("None"), null);
  assert.equal(parsePublishCaretaker(undefined), null);
});

test("caretaker parser rejects lists and non-numeric values", () => {
  assert.throws(
    () => parsePublishCaretaker("19807509, 12345678"),
    /single positive integer GitHub user ID/,
  );
  assert.throws(
    () => parseCaretakerUpdate("alice"),
    /single positive integer GitHub user ID/,
  );
});

test("update caretaker parses keep, clear, and replace values", () => {
  assert.deepEqual(parseCaretakerUpdate(""), { kind: "keep" });
  assert.deepEqual(parseCaretakerUpdate("_No response_"), { kind: "keep" });
  assert.deepEqual(parseCaretakerUpdate("No change"), { kind: "keep" });
  assert.deepEqual(parseCaretakerUpdate("None"), { kind: "clear" });
  assert.deepEqual(parseCaretakerUpdate("19807509"), {
    kind: "replace",
    githubId: 19807509,
  });
});

// --- applyCaretakerUpdate ---

const NOW = "2026-08-01T12:00:00.000Z";

test("apply caretaker update appends the first caretaker and unions collaborators", () => {
  const manifest: ManifestWithCaretakers = {};
  applyCaretakerUpdate(manifest, "100", NOW);
  assert.deepEqual(manifest.caretakers, [{ github_id: 100, since: NOW }]);
  assert.deepEqual(manifest.collaborators, [100]);
});

test("apply caretaker update replaces the active caretaker with a closed window", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [100],
    caretakers: [{ github_id: 100, since: "2025-01-01T00:00:00Z" }],
  };
  applyCaretakerUpdate(manifest, "200", NOW);
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: NOW },
    { github_id: 200, since: NOW },
  ]);
  assert.deepEqual(manifest.collaborators, [100, 200]);
  assert.equal(getActiveCaretaker(manifest)?.github_id, 200);
});

test("apply caretaker update closes the active window on None", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [100],
    caretakers: [{ github_id: 100, since: "2025-01-01T00:00:00Z" }],
  };
  applyCaretakerUpdate(manifest, "None", NOW);
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: NOW },
  ]);
  assert.equal(getActiveCaretaker(manifest), undefined);
  // Ending a caretakership does not remove collaborator status.
  assert.deepEqual(manifest.collaborators, [100]);
});

test("apply caretaker update with None is a no-op when no caretaker is active", () => {
  const manifest: ManifestWithCaretakers = {
    caretakers: [
      { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
    ],
  };
  applyCaretakerUpdate(manifest, "None", NOW);
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
  ]);
});

test("apply caretaker update errors when the id equals the active caretaker", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [100],
    caretakers: [{ github_id: 100, since: "2025-01-01T00:00:00Z" }],
  };
  assert.throws(
    () => applyCaretakerUpdate(manifest, "100", NOW),
    /already the active caretaker/,
  );
  // Manifest is untouched on error.
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z" },
  ]);
});

test("apply caretaker update allows a previously closed caretaker to return", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [100, 200],
    caretakers: [
      { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
      { github_id: 200, since: "2025-06-01T00:00:00Z" },
    ],
  };
  applyCaretakerUpdate(manifest, "100", NOW);
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z", until: "2025-06-01T00:00:00Z" },
    { github_id: 200, since: "2025-06-01T00:00:00Z", until: NOW },
    { github_id: 100, since: NOW },
  ]);
});

test("apply caretaker update with a blank value is a no-op", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [100],
    caretakers: [{ github_id: 100, since: "2025-01-01T00:00:00Z" }],
  };
  applyCaretakerUpdate(manifest, "", NOW);
  applyCaretakerUpdate(manifest, "_No response_", NOW);
  applyCaretakerUpdate(manifest, undefined, NOW);
  assert.deepEqual(manifest.caretakers, [
    { github_id: 100, since: "2025-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(manifest.collaborators, [100]);
});

test("apply caretaker update does not duplicate an existing collaborator id", () => {
  const manifest: ManifestWithCaretakers = {
    collaborators: [200, 300],
  };
  applyCaretakerUpdate(manifest, "200", NOW);
  assert.deepEqual(manifest.collaborators, [200, 300]);
  assert.deepEqual(manifest.caretakers, [{ github_id: 200, since: NOW }]);
});

// --- applyAdminAuthorOverride (/admin-author comment command) ---

test("admin-author override swaps author identity and defaults the submitter as caretaker", () => {
  const manifest: ManifestWithAuthor = { author: "submitter", github_id: 555 };
  applyAdminAuthorOverride(manifest, 555, NOW);
  assert.equal(manifest.author, ADMIN_AUTHOR_ID);
  assert.equal(manifest.author, "subway-builder-modded-admin");
  assert.equal(manifest.github_id, ADMIN_AUTHOR_GITHUB_ID);
  assert.equal(manifest.github_id, 268817724);
  assert.deepEqual(manifest.caretakers, [{ github_id: 555, since: NOW }]);
  assert.deepEqual(manifest.collaborators, [555]);
});

test("admin-author override keeps a form-specified caretaker and still unions the submitter", () => {
  const manifest: ManifestWithAuthor = {
    author: "submitter",
    github_id: 555,
    collaborators: [700],
    caretakers: [{ github_id: 700, since: "2026-07-01T00:00:00Z" }],
  };
  applyAdminAuthorOverride(manifest, 555, NOW);
  assert.equal(manifest.author, ADMIN_AUTHOR_ID);
  assert.equal(manifest.github_id, ADMIN_AUTHOR_GITHUB_ID);
  // Form caretaker wins: no new caretaker window is opened.
  assert.deepEqual(manifest.caretakers, [{ github_id: 700, since: "2026-07-01T00:00:00Z" }]);
  // The submitter keeps edit rights via collaborators.
  assert.deepEqual(manifest.collaborators, [700, 555]);
});

test("admin-author override is idempotent about collaborator membership", () => {
  const manifest: ManifestWithAuthor = {
    author: "submitter",
    github_id: 555,
    collaborators: [555, 700],
  };
  applyAdminAuthorOverride(manifest, 555, NOW);
  assert.deepEqual(manifest.collaborators, [555, 700]);
  assert.deepEqual(manifest.caretakers, [{ github_id: 555, since: NOW }]);
});

test("admin-author override with the submitter as form caretaker leaves a single window", () => {
  const manifest: ManifestWithAuthor = {
    author: "submitter",
    github_id: 555,
    collaborators: [555],
    caretakers: [{ github_id: 555, since: "2026-07-01T00:00:00Z" }],
  };
  applyAdminAuthorOverride(manifest, 555, NOW);
  assert.deepEqual(manifest.caretakers, [{ github_id: 555, since: "2026-07-01T00:00:00Z" }]);
  assert.deepEqual(manifest.collaborators, [555]);
  assert.equal(getActiveCaretaker(manifest)?.github_id, 555);
});

// --- Resolution (GitHub account existence, fetch mocked) ---

test("resolve caretaker update verifies the GitHub ID and rejects the active id", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const id = Number.parseInt(url.split("/").pop() ?? "", 10);
    if (id === 19807509) {
      return new Response(JSON.stringify({ id, login: "ahkimn" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const ok = await resolveCaretakerUpdate("19807509");
    assert.deepEqual(ok.update, { kind: "replace", githubId: 19807509 });
    assert.deepEqual(ok.users, [{ id: 19807509, login: "ahkimn" }]);
    assert.deepEqual(ok.errors, []);

    const missing = await resolveCaretakerUpdate("99999999");
    assert.deepEqual(missing.errors, [
      "GitHub user ID `99999999` does not exist or is not accessible.",
    ]);

    const sameAsActive = await resolveCaretakerUpdate("19807509", 19807509);
    assert.deepEqual(sameAsActive.errors, [
      "GitHub user ID `19807509` is already the active caretaker.",
    ]);

    const keep = await resolveCaretakerUpdate("");
    assert.deepEqual(keep, { update: { kind: "keep" }, users: [], errors: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
