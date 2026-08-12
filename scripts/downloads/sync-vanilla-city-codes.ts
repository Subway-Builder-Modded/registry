import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isObject, readJsonFile, writeJsonFile } from "../lib/json-utils.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// Syncs the base game's live city list into maps/vanilla-city-codes.json so intake
// validation (loadVanillaCityCodeSet) always rejects listings colliding with
// current vanilla cities — the 2026-08 French-city incident (KNOWN_INCIDENTS.md)
// is what a stale hardcoded list costs. Runs in the 4-hourly analytics workflow
// alongside the integrity snapshot.
//
// The synced file is a monotonic union: codes are only ever added (a code from an
// older game version still owns installs on user disks), and a failed or empty
// fetch leaves the file untouched. Existing listings that collide with the live
// list are reported as warnings — they need author-side renames, not automated
// mutation.

const LATEST_CITIES_URL = "https://ctiles.subwaybuilder.com/cities/latest-cities.yml";
const FETCH_TIMEOUT_MS = 30_000;

export interface VanillaCityCodesFile {
  schema_version: number;
  synced_at: string;
  source_url: string;
  codes: string[];
}

// Parses `code: XYZ` lines with a regex rather than a YAML parser on purpose:
// YAML 1.1 would read the code `NO` (New Orleans) as boolean false.
export function parseLatestCitiesCodes(yml: string): string[] {
  const codes = new Set<string>();
  for (const line of yml.split(/\r?\n/)) {
    const match = /^\s*code:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/.exec(line);
    if (match) codes.add(match[1]!);
  }
  return [...codes].sort();
}

export function mergeVanillaCityCodes(
  previous: VanillaCityCodesFile | null,
  fetchedCodes: string[],
  nowIso: string,
): VanillaCityCodesFile {
  const codes = new Set<string>(previous?.codes ?? []);
  for (const code of fetchedCodes) codes.add(code);
  return {
    schema_version: 1,
    synced_at: nowIso,
    source_url: LATEST_CITIES_URL,
    codes: [...codes].sort(),
  };
}

function loadPrevious(path: string): VanillaCityCodesFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readJsonFile<unknown>(path);
    if (!isObject(raw) || !Array.isArray(raw.codes)) return null;
    return {
      schema_version: 1,
      synced_at: typeof raw.synced_at === "string" ? raw.synced_at : "",
      source_url: typeof raw.source_url === "string" ? raw.source_url : LATEST_CITIES_URL,
      codes: raw.codes.filter((code): code is string => typeof code === "string"),
    };
  } catch {
    return null;
  }
}

function findListingCollisions(repoRoot: string, codes: Set<string>): string[] {
  const collisions: string[] = [];
  const indexPath = resolve(repoRoot, "maps", "index.json");
  if (!existsSync(indexPath)) return collisions;
  const index = readJsonFile<{ maps?: string[] }>(indexPath);
  for (const listingId of index.maps ?? []) {
    const manifestPath = resolve(repoRoot, "maps", listingId, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { city_code?: unknown };
      if (typeof manifest.city_code === "string" && codes.has(manifest.city_code)) {
        collisions.push(`${listingId}=${manifest.city_code}`);
      }
    } catch {
      continue;
    }
  }
  return collisions;
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const outputPath = resolve(repoRoot, "maps", "vanilla-city-codes.json");
  const previous = loadPrevious(outputPath);

  let fetchedCodes: string[] = [];
  try {
    const response = await fetch(LATEST_CITIES_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "registry-vanilla-city-codes-sync" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    fetchedCodes = parseLatestCitiesCodes(await response.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[vanilla-city-codes] fetch failed (${message}); keeping previous file untouched`);
    appendGitHubOutput(["vanilla_codes_fetch_ok=false"]);
    return;
  }
  if (fetchedCodes.length === 0) {
    console.warn("[vanilla-city-codes] fetch returned no codes; keeping previous file untouched");
    appendGitHubOutput(["vanilla_codes_fetch_ok=false"]);
    return;
  }

  const merged = mergeVanillaCityCodes(previous, fetchedCodes, new Date().toISOString());
  const previousSet = new Set(previous?.codes ?? []);
  const newCodes = merged.codes.filter((code) => !previousSet.has(code));
  writeJsonFile(outputPath, merged);

  const collisions = findListingCollisions(repoRoot, new Set(fetchedCodes));
  for (const collision of collisions) {
    console.warn(`[vanilla-city-codes] WARNING: listing collides with a live vanilla city code: ${collision} — needs an author-side code change`);
  }
  console.log(
    `[vanilla-city-codes] synced ${fetchedCodes.length} live codes (${newCodes.length} new: ${newCodes.join(", ") || "none"}), total ${merged.codes.length}, listing collisions: ${collisions.length}`,
  );
  appendGitHubOutput([
    "vanilla_codes_fetch_ok=true",
    `vanilla_codes_new=${newCodes.join(",")}`,
    `vanilla_codes_collisions=${collisions.join(",")}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
