import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncLastUpdatedFromIntegrity } from "../sync-last-updated.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function integrity(listings: Record<string, { last_updated?: number }>): unknown {
  const full: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(listings)) {
    full[id] = {
      has_complete_version: true,
      latest_semver_version: "v1.0.0",
      latest_semver_complete: true,
      complete_versions: ["v1.0.0"],
      incomplete_versions: [],
      ...entry,
      versions: {},
    };
  }
  return { schema_version: 1, generated_at: "2026-03-22T00:00:00Z", listings: full };
}

async function withTempRegistry(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-sync-last-updated-"));
  for (const dir of ["maps", "mods"]) mkdirSync(join(repoRoot, dir), { recursive: true });
  try {
    await run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("syncs last_updated from integrity into maps and mods manifests", async () => {
  await withTempRegistry(async (repoRoot) => {
    writeJson(join(repoRoot, "maps", "index.json"), { schema_version: 1, maps: ["alpha-map"] });
    writeJson(join(repoRoot, "mods", "index.json"), { schema_version: 1, mods: ["beta-mod"] });
    mkdirSync(join(repoRoot, "maps", "alpha-map"), { recursive: true });
    mkdirSync(join(repoRoot, "mods", "beta-mod"), { recursive: true });
    writeJson(join(repoRoot, "maps", "alpha-map", "manifest.json"), { id: "alpha-map" });
    writeJson(join(repoRoot, "mods", "beta-mod", "manifest.json"), { id: "beta-mod" });
    writeJson(join(repoRoot, "maps", "integrity.json"), integrity({ "alpha-map": { last_updated: 1_700_000_000 } }));
    writeJson(join(repoRoot, "mods", "integrity.json"), integrity({ "beta-mod": { last_updated: 1_700_000_500 } }));

    const result = syncLastUpdatedFromIntegrity(repoRoot);

    assert.equal(result.processed, 2);
    assert.equal(result.updated, 2);
    assert.equal(result.withoutLastUpdated, 0);
    assert.equal(readJson<{ last_updated?: number }>(join(repoRoot, "maps", "alpha-map", "manifest.json")).last_updated, 1_700_000_000);
    assert.equal(readJson<{ last_updated?: number }>(join(repoRoot, "mods", "beta-mod", "manifest.json")).last_updated, 1_700_000_500);
  });
});

test("skips listings without a last_updated in integrity and counts them", async () => {
  await withTempRegistry(async (repoRoot) => {
    writeJson(join(repoRoot, "maps", "index.json"), { schema_version: 1, maps: ["alpha-map"] });
    writeJson(join(repoRoot, "mods", "index.json"), { schema_version: 1, mods: [] });
    mkdirSync(join(repoRoot, "maps", "alpha-map"), { recursive: true });
    writeJson(join(repoRoot, "maps", "alpha-map", "manifest.json"), { id: "alpha-map" });
    writeJson(join(repoRoot, "maps", "integrity.json"), integrity({ "alpha-map": {} }));
    writeJson(join(repoRoot, "mods", "integrity.json"), integrity({}));

    const result = syncLastUpdatedFromIntegrity(repoRoot);

    assert.equal(result.processed, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.withoutLastUpdated, 1);
    assert.equal(readJson<{ last_updated?: number }>(join(repoRoot, "maps", "alpha-map", "manifest.json")).last_updated, undefined);
  });
});
