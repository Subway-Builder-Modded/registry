import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ensureAuthorAliasPrefill, loadAuthorAliasIndex, updateAuthorEntry } from "../lib/author-aliases.js";
import type { AuthorAliasIndex } from "../lib/author-aliases.js";

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

// updateAuthorEntry tests (pure function — no temp dir needed)

const BASE_INDEX: AuthorAliasIndex = {
  schema_version: 1,
  authors: [
    {
      github_id: 10,
      author_id: "alice",
      author_alias: "Alice",
      attribution_method: "github",
      attribution_link: "https://github.com/alice",
      contributor_tier: "developer",
    },
    {
      github_id: 50,
      author_id: "slurry",
      author_alias: "Slurry",
      attribution_method: "github",
      contributor_tier: "collaborator",
    },
  ],
};

test("updateAuthorEntry applies partial update without touching other fields", () => {
  const result = updateAuthorEntry(BASE_INDEX, 10, "alice", { author_alias: "Alice Smith" });
  const alice = result.authors.find((e) => e.github_id === 10);
  assert.ok(alice);
  assert.equal(alice.author_alias, "Alice Smith");
  assert.equal(alice.attribution_method, "github");
  assert.equal(alice.contributor_tier, "developer");
  // Other author unchanged
  const slurry = result.authors.find((e) => e.github_id === 50);
  assert.ok(slurry);
  assert.equal(slurry.contributor_tier, "collaborator");
});

test("updateAuthorEntry does not mutate contributor_tier", () => {
  const result = updateAuthorEntry(BASE_INDEX, 50, "slurry", { ko_fi_username: "slurrykofi" });
  const slurry = result.authors.find((e) => e.github_id === 50);
  assert.ok(slurry);
  assert.equal(slurry.ko_fi_username, "slurrykofi");
  assert.equal(slurry.contributor_tier, "collaborator");
});

test("updateAuthorEntry creates baseline entry when github_id not in index", () => {
  const result = updateAuthorEntry(BASE_INDEX, 99, "newuser", { author_alias: "New User" });
  assert.equal(result.authors.length, 3);
  const newUser = result.authors.find((e) => e.github_id === 99);
  assert.ok(newUser);
  assert.equal(newUser.author_id, "newuser");
  assert.equal(newUser.author_alias, "New User");
  assert.equal(newUser.attribution_method, "github");
});

test("updateAuthorEntry sorts authors by github_id after update", () => {
  const result = updateAuthorEntry(BASE_INDEX, 99, "newuser", { author_alias: "New User" });
  const ids = result.authors.map((e) => e.github_id);
  assert.deepEqual(ids, [10, 50, 99]);
});

test("updateAuthorEntry switching to github clears stored attribution_link", () => {
  const indexWithCustom: AuthorAliasIndex = {
    schema_version: 1,
    authors: [
      {
        github_id: 10,
        author_id: "alice",
        author_alias: "Alice",
        attribution_method: "custom",
        attribution_link: "https://alice.example.com",
      },
    ],
  };
  const result = updateAuthorEntry(indexWithCustom, 10, "alice", { attribution_method: "github" });
  const alice = result.authors.find((e) => e.github_id === 10);
  assert.ok(alice);
  assert.equal(alice.attribution_method, "github");
  assert.equal(alice.attribution_link, undefined);
});

test("updateAuthorEntry custom attribution_link overrides github method clear", () => {
  // If user provides both method=github AND a link, the link wins (link applied after method)
  const result = updateAuthorEntry(BASE_INDEX, 10, "alice", {
    attribution_method: "github",
    attribution_link: "https://custom.example.com",
  });
  const alice = result.authors.find((e) => e.github_id === 10);
  assert.ok(alice);
  assert.equal(alice.attribution_method, "github");
  assert.equal(alice.attribution_link, "https://custom.example.com");
});

test("updateAuthorEntry stores discord fields without affecting attribution", () => {
  const result = updateAuthorEntry(BASE_INDEX, 10, "alice", {
    discord_username: "alice#1234",
    discord_id: "123456789012345678",
  });
  const alice = result.authors.find((e) => e.github_id === 10);
  assert.ok(alice);
  assert.equal(alice.discord_username, "alice#1234");
  assert.equal(alice.discord_id, "123456789012345678");
  assert.equal(alice.attribution_method, "github");
});
