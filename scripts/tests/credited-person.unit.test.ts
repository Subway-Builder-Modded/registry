import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuthorAliasIndex } from "../lib/author-aliases.js";
import {
  buildVersionCreditResolver,
  findCoveringCaretakerGithubId,
  resolveCreditedPerson,
  type CaretakerWindowLike,
} from "../lib/analytics/credited-person.js";

const AUTHOR = "listing-author";
const CARETAKER_ID = 200;
const resolveGithubId = (githubId: number): string | null =>
  (githubId === CARETAKER_ID ? "caretaker" : null);

const WINDOW: CaretakerWindowLike = {
  github_id: CARETAKER_ID,
  since: "2026-06-01T00:00:00Z",
  until: "2026-07-01T00:00:00Z",
};

test("resolveCreditedPerson credits the author when there are no caretakers", () => {
  assert.equal(resolveCreditedPerson(undefined, "2026-06-15T00:00:00Z", AUTHOR, resolveGithubId), AUTHOR);
  assert.equal(resolveCreditedPerson([], "2026-06-15T00:00:00Z", AUTHOR, resolveGithubId), AUTHOR);
});

test("resolveCreditedPerson credits the caretaker whose window covers released_at", () => {
  assert.equal(
    resolveCreditedPerson([WINDOW], "2026-06-15T00:00:00Z", AUTHOR, resolveGithubId),
    "caretaker",
  );
});

test("resolveCreditedPerson credits the author when released_at is before since", () => {
  assert.equal(
    resolveCreditedPerson([WINDOW], "2026-05-31T23:59:59Z", AUTHOR, resolveGithubId),
    AUTHOR,
  );
});

test("resolveCreditedPerson credits the author when released_at is after until", () => {
  assert.equal(
    resolveCreditedPerson([WINDOW], "2026-07-02T00:00:00Z", AUTHOR, resolveGithubId),
    AUTHOR,
  );
});

test("resolveCreditedPerson treats since as inclusive", () => {
  assert.equal(
    resolveCreditedPerson([WINDOW], "2026-06-01T00:00:00Z", AUTHOR, resolveGithubId),
    "caretaker",
  );
});

test("resolveCreditedPerson treats until as exclusive", () => {
  assert.equal(
    resolveCreditedPerson([WINDOW], "2026-07-01T00:00:00Z", AUTHOR, resolveGithubId),
    AUTHOR,
  );
});

test("resolveCreditedPerson: caretaker-since-epoch covers every version (devenperez invariant)", () => {
  const sinceEpoch: CaretakerWindowLike = { github_id: CARETAKER_ID, since: "1970-01-01T00:00:00Z" };
  for (const releasedAt of ["1970-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "2026-07-31T23:59:59Z"]) {
    assert.equal(resolveCreditedPerson([sinceEpoch], releasedAt, AUTHOR, resolveGithubId), "caretaker");
  }
});

test("resolveCreditedPerson falls back to the author for an unresolvable github_id", () => {
  const unknownCaretaker: CaretakerWindowLike = { github_id: 999, since: "1970-01-01T00:00:00Z" };
  assert.equal(
    resolveCreditedPerson([unknownCaretaker], "2026-06-15T00:00:00Z", AUTHOR, resolveGithubId),
    AUTHOR,
  );
});

test("resolveCreditedPerson credits the author when released_at is missing or unparseable", () => {
  const active: CaretakerWindowLike = { github_id: CARETAKER_ID, since: "1970-01-01T00:00:00Z" };
  assert.equal(resolveCreditedPerson([active], undefined, AUTHOR, resolveGithubId), AUTHOR);
  assert.equal(resolveCreditedPerson([active], "not-a-date", AUTHOR, resolveGithubId), AUTHOR);
});

test("resolveCreditedPerson picks the window matching each version across a caretaker history", () => {
  const history: CaretakerWindowLike[] = [
    { github_id: 300, since: "2025-01-01T00:00:00Z", until: "2026-01-01T00:00:00Z" },
    { github_id: CARETAKER_ID, since: "2026-01-01T00:00:00Z" },
  ];
  const resolveBoth = (githubId: number): string | null => (
    githubId === CARETAKER_ID ? "caretaker" : githubId === 300 ? "predecessor" : null
  );
  assert.equal(resolveCreditedPerson(history, "2024-06-01T00:00:00Z", AUTHOR, resolveBoth), AUTHOR);
  assert.equal(resolveCreditedPerson(history, "2025-06-01T00:00:00Z", AUTHOR, resolveBoth), "predecessor");
  assert.equal(resolveCreditedPerson(history, "2026-06-01T00:00:00Z", AUTHOR, resolveBoth), "caretaker");
});

test("findCoveringCaretakerGithubId skips windows with unparseable dates", () => {
  assert.equal(
    findCoveringCaretakerGithubId(
      [{ github_id: CARETAKER_ID, since: "garbage" }],
      "2026-06-15T00:00:00Z",
    ),
    null,
  );
});

// --- Loader wrapper (buildVersionCreditResolver) over a temp repo fixture ---

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

test("buildVersionCreditResolver resolves credits from manifests, integrity and authors index", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-credit-resolver-"));
  try {
    mkdirSync(join(repoRoot, "maps", "porto"), { recursive: true });
    mkdirSync(join(repoRoot, "authors"), { recursive: true });
    writeJson(join(repoRoot, "maps", "porto", "manifest.json"), {
      schema_version: 1,
      id: "porto",
      name: "Porto",
      author: "bquelhas",
      github_id: 100,
      collaborators: [200],
      caretakers: [{ github_id: 200, since: "2026-06-01T00:00:00Z" }],
    });
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-07-31T00:00:00Z",
      listings: {
        porto: {
          versions: {
            "v1.0.0": { released_at: "2026-05-01T00:00:00Z" },
            "v2.0.0": { released_at: "2026-07-01T00:00:00Z" },
          },
        },
      },
    });
    writeJson(join(repoRoot, "authors", "index.json"), {
      schema_version: 1,
      authors: [
        { github_id: 100, author_id: "bquelhas", author_alias: "bquelhas", attribution_method: "github" },
        { github_id: 200, author_id: "capitao", author_alias: "Miguel Sousa", attribution_method: "github" },
      ],
    });

    const resolver = buildVersionCreditResolver({
      repoRoot,
      authorAliases: loadAuthorAliasIndex(repoRoot),
    });

    assert.equal(resolver.hasCaretakers("maps", "porto"), true);
    assert.equal(resolver.hasCaretakers("maps", "missing-listing"), false);
    // v1 predates the caretaker window; v2 falls inside it (porto invariant).
    assert.equal(resolver.resolveAuthorId("maps", "porto", "v1.0.0", "bquelhas"), "bquelhas");
    assert.equal(resolver.resolveAuthorId("maps", "porto", "v2.0.0", "bquelhas"), "capitao");
    // Version absent from integrity (no released_at) falls back to the author.
    assert.equal(resolver.resolveAuthorId("maps", "porto", "v9.9.9", "bquelhas"), "bquelhas");
    assert.deepEqual(
      resolver.resolvePresentation("maps", "porto", "v2.0.0", {
        author: "bquelhas",
        author_alias: "bquelhas",
        attribution_link: "https://github.com/bquelhas",
      }),
      {
        author: "capitao",
        author_alias: "Miguel Sousa",
        attribution_link: "https://github.com/capitao",
      },
    );
    assert.deepEqual(resolver.activeCaretaker("maps", "porto"), {
      author: "capitao",
      author_alias: "Miguel Sousa",
      attribution_link: "https://github.com/capitao",
    });
    assert.equal(resolver.activeCaretaker("mods", "porto"), null);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("buildVersionCreditResolver falls back to the author for an unresolvable caretaker and closed windows", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-credit-resolver-fallback-"));
  try {
    mkdirSync(join(repoRoot, "mods", "sample-mod"), { recursive: true });
    writeJson(join(repoRoot, "mods", "sample-mod", "manifest.json"), {
      schema_version: 1,
      id: "sample-mod",
      name: "Sample Mod",
      author: "modder",
      github_id: 2,
      caretakers: [
        { github_id: 999, since: "1970-01-01T00:00:00Z", until: "2026-01-01T00:00:00Z" },
      ],
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-07-31T00:00:00Z",
      listings: {
        "sample-mod": {
          versions: { "v1.0.0": { released_at: "2025-06-01T00:00:00Z" } },
        },
      },
    });

    const resolver = buildVersionCreditResolver({
      repoRoot,
      authorAliases: { schema_version: 1, authors: [] },
    });

    // github_id 999 is not in authors/index.json -> author keeps the credit.
    assert.equal(resolver.resolveAuthorId("mods", "sample-mod", "v1.0.0", "modder"), "modder");
    // The only window is closed -> no active caretaker.
    assert.equal(resolver.activeCaretaker("mods", "sample-mod"), null);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
