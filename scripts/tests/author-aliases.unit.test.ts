import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ensureAuthorAliasPrefill, loadAuthorAliasIndex } from "../lib/author-aliases.js";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

test("ensureAuthorAliasPrefill appends new github author with github defaults", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-author-prefill-test-"));
  try {
    writeJson(join(repoRoot, "authors", "index.json"), {
      schema_version: 1,
      authors: [
        {
          github_id: 10,
          author_id: "existing",
          author_alias: "Existing",
          attribution_method: "custom",
          attribution_link: "https://example.com/existing",
          ko_fi_username: "existing-kofi",
          contributor_tier: "developer",
        },
      ],
    });

    const result = ensureAuthorAliasPrefill(repoRoot, 20, "newauthor");
    assert.equal(result.created, true);

    const aliases = loadAuthorAliasIndex(repoRoot);
    assert.equal(aliases.authors.length, 2);
    const added = aliases.authors.find((entry) => entry.github_id === 20);
    assert.ok(added);
    assert.equal(added.author_id, "newauthor");
    assert.equal(added.author_alias, "newauthor");
    assert.equal(added.attribution_method, "github");
    assert.equal(added.attribution_link, "https://github.com/newauthor");

    const existing = aliases.authors.find((entry) => entry.github_id === 10);
    assert.ok(existing);
    assert.equal(existing.attribution_method, "custom");
    assert.equal(existing.attribution_link, "https://example.com/existing");
    assert.equal(existing.ko_fi_username, "existing-kofi");
    assert.equal(existing.contributor_tier, "developer");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("ensureAuthorAliasPrefill preserves contributor_tier: collaborator on existing authors", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-author-prefill-collaborator-test-"));
  try {
    writeJson(join(repoRoot, "authors", "index.json"), {
      schema_version: 1,
      authors: [
        {
          github_id: 50,
          author_id: "collaboratoruser",
          author_alias: "CollaboratorUser",
          attribution_method: "github",
          attribution_link: "https://github.com/collaboratoruser",
          contributor_tier: "collaborator",
        },
      ],
    });

    // Adding a new unrelated author should not strip the collaborator tier
    const result = ensureAuthorAliasPrefill(repoRoot, 99, "newauthor");
    assert.equal(result.created, true);

    const aliases = loadAuthorAliasIndex(repoRoot);
    const collaborator = aliases.authors.find((entry) => entry.github_id === 50);
    assert.ok(collaborator, "collaborator author should still exist");
    assert.equal(collaborator.contributor_tier, "collaborator", "contributor_tier must survive round-trip");

    const written = readFileSync(join(repoRoot, "authors", "index.json"), "utf-8");
    assert.ok(written.includes('"contributor_tier": "collaborator"'), "collaborator tier must be present in written JSON");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("ensureAuthorAliasPrefill is a no-op for existing github_id", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-author-prefill-noop-test-"));
  try {
    writeJson(join(repoRoot, "authors", "index.json"), {
      schema_version: 1,
      authors: [
        {
          github_id: 99,
          author_id: "existing",
          author_alias: "Custom Alias",
          attribution_method: "github",
          attribution_link: "https://github.com/existing",
        },
      ],
    });
    const before = readFileSync(join(repoRoot, "authors", "index.json"), "utf-8");

    const result = ensureAuthorAliasPrefill(repoRoot, 99, "changed-login");
    assert.equal(result.created, false);

    const after = readFileSync(join(repoRoot, "authors", "index.json"), "utf-8");
    assert.equal(after, before);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
