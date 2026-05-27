import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyCollaboratorUpdate,
  ensureCollaboratorAuthorAliasPrefills,
  parseCollaboratorUpdate,
  parsePublishCollaborators,
  resolvePublishCollaborators,
} from "../lib/collaborators.js";
import { loadAuthorAliasIndex } from "../lib/author-aliases.js";

test("publish collaborators trims comma-separated GitHub IDs", () => {
  assert.deepEqual(
    parsePublishCollaborators(" 19807509, 12345678 "),
    [19807509, 12345678],
  );
});

test("publish collaborators accepts a single GitHub ID", () => {
  assert.deepEqual(parsePublishCollaborators("19807509"), [19807509]);
});

test("publish collaborators treats blank, no-response, and None as empty", () => {
  assert.deepEqual(parsePublishCollaborators(""), []);
  assert.deepEqual(parsePublishCollaborators("   "), []);
  assert.deepEqual(parsePublishCollaborators("_No response_"), []);
  assert.deepEqual(parsePublishCollaborators("None"), []);
});

test("collaborator parser rejects empty comma entries", () => {
  assert.throws(
    () => parsePublishCollaborators("19807509,,12345678"),
    /no empty entries/,
  );
  assert.throws(
    () => parsePublishCollaborators("19807509, "),
    /no empty entries/,
  );
});

test("collaborator parser rejects non-integer and duplicate IDs", () => {
  assert.throws(
    () => parsePublishCollaborators("19807509, alice"),
    /positive integer GitHub user IDs/,
  );
  assert.throws(
    () => parsePublishCollaborators("19807509, 19807509"),
    /duplicate GitHub user IDs/,
  );
});

test("update collaborators keeps, clears, or replaces collaborators", () => {
  assert.deepEqual(parseCollaboratorUpdate(""), { kind: "keep" });
  assert.deepEqual(parseCollaboratorUpdate("_No response_"), { kind: "keep" });
  assert.deepEqual(parseCollaboratorUpdate("No change"), { kind: "keep" });
  assert.deepEqual(parseCollaboratorUpdate("None"), { kind: "clear" });
  assert.deepEqual(parseCollaboratorUpdate("19807509, 12345678"), {
    kind: "replace",
    collaborators: [19807509, 12345678],
  });
});

test("apply collaborator update preserves, clears, and replaces manifest field", () => {
  const manifest: { collaborators?: number[] } = {
    collaborators: [1],
  };

  applyCollaboratorUpdate(manifest, "");
  assert.deepEqual(manifest.collaborators, [1]);

  applyCollaboratorUpdate(manifest, "19807509, 12345678");
  assert.deepEqual(manifest.collaborators, [19807509, 12345678]);

  applyCollaboratorUpdate(manifest, "None");
  assert.equal(Object.hasOwn(manifest, "collaborators"), false);
});

test("resolve publish collaborators verifies GitHub IDs", async () => {
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
    const result = await resolvePublishCollaborators("19807509, 99999999");
    assert.deepEqual(result.collaborators, [19807509, 99999999]);
    assert.deepEqual(result.users, [{ id: 19807509, login: "ahkimn" }]);
    assert.deepEqual(result.errors, [
      "GitHub user ID `99999999` does not exist or is not accessible.",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collaborator author prefill adds missing GitHub users to authors index", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-collaborator-prefill-test-"));
  try {
    const created = ensureCollaboratorAuthorAliasPrefills(repoRoot, [
      { id: 19807509, login: "ahkimn" },
    ]);
    assert.deepEqual(created, ["ahkimn"]);

    const aliases = loadAuthorAliasIndex(repoRoot);
    assert.equal(aliases.authors.length, 1);
    assert.equal(aliases.authors[0]?.github_id, 19807509);
    assert.equal(aliases.authors[0]?.author_id, "ahkimn");
    assert.equal(aliases.authors[0]?.attribution_link, "https://github.com/ahkimn");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
