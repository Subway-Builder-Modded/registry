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
          attribution_method: "github",
          attribution_link: "https://github.com/existing",
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
