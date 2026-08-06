import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestDirectory } from "./manifests.js";
import { isObject, writeJsonFile } from "./json-utils.js";

// Tracks source repos that are currently unreachable in the permanent sense
// (GitHub "Could not resolve to a Repository": deleted, renamed without
// redirect, or made private). Transient failures (429/5xx) never touch this
// file — an entry's first_unreachable_at only starts, and only clears, on a
// definitive observation. Consumed by the repo-liveness review workflow,
// which nags maintainers once a repo has been unreachable for multiple days.

export const REPO_LIVENESS_SCHEMA_VERSION = 1;

export interface RepoLivenessEntry {
  first_unreachable_at: string;
  last_checked_at: string;
  /** Non-deprecated, non-test listings that reference the repo. */
  listings: string[];
}

export interface RepoLivenessFile {
  schema_version: number;
  updated_at: string;
  repos: Record<string, RepoLivenessEntry>;
}

export interface RepoLivenessObservations {
  /** Repos that resolved successfully this run. */
  reachable: Iterable<string>;
  /** Repos that failed transiently this run (existing entries are kept as-is). */
  transient: Iterable<string>;
  /** Definitively-unreachable repos, with the eligible listings referencing each. */
  notFound: Record<string, string[]>;
}

export function getRepoLivenessPath(repoRoot: string, dir: ManifestDirectory): string {
  return resolve(repoRoot, dir, "repo-liveness.json");
}

export function loadRepoLiveness(repoRoot: string, dir: ManifestDirectory): RepoLivenessFile {
  const path = getRepoLivenessPath(repoRoot, dir);
  const empty: RepoLivenessFile = {
    schema_version: REPO_LIVENESS_SCHEMA_VERSION,
    updated_at: "",
    repos: {},
  };
  if (!existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isObject(raw) || !isObject(raw.repos)) return empty;
    const repos: Record<string, RepoLivenessEntry> = {};
    for (const [repo, value] of Object.entries(raw.repos)) {
      if (!isObject(value)) continue;
      const entry = value as Partial<RepoLivenessEntry>;
      if (typeof entry.first_unreachable_at !== "string" || typeof entry.last_checked_at !== "string") continue;
      repos[repo] = {
        first_unreachable_at: entry.first_unreachable_at,
        last_checked_at: entry.last_checked_at,
        listings: Array.isArray(entry.listings)
          ? entry.listings.filter((id): id is string => typeof id === "string")
          : [],
      };
    }
    return { ...empty, repos };
  } catch {
    return empty;
  }
}

/**
 * Pure state transition:
 * - reachable repo -> entry removed (repo recovered)
 * - not-found repo with eligible listings -> entry upserted; the original
 *   first_unreachable_at is preserved so the unreachable clock keeps running
 * - not-found repo whose listings are all deprecated/test -> never tracked
 * - transient repo -> existing entry carried over untouched (state unknown)
 * - repo absent from every observation (no longer referenced) -> entry removed
 */
export function applyRepoLivenessObservations(
  previous: RepoLivenessFile,
  observations: RepoLivenessObservations,
  nowIso: string,
): RepoLivenessFile {
  const transient = new Set(observations.transient);
  const repos: Record<string, RepoLivenessEntry> = {};

  for (const repo of transient) {
    const existing = previous.repos[repo];
    if (existing) repos[repo] = existing;
  }
  for (const [repo, listings] of Object.entries(observations.notFound)) {
    if (listings.length === 0) continue;
    repos[repo] = {
      first_unreachable_at: previous.repos[repo]?.first_unreachable_at ?? nowIso,
      last_checked_at: nowIso,
      listings: [...listings].sort(),
    };
  }

  const sorted: Record<string, RepoLivenessEntry> = {};
  for (const repo of Object.keys(repos).sort()) {
    sorted[repo] = repos[repo]!;
  }
  return {
    schema_version: REPO_LIVENESS_SCHEMA_VERSION,
    updated_at: nowIso,
    repos: sorted,
  };
}

export function updateRepoLiveness(
  repoRoot: string,
  dir: ManifestDirectory,
  observations: RepoLivenessObservations,
  nowIso: string,
): RepoLivenessFile {
  const next = applyRepoLivenessObservations(loadRepoLiveness(repoRoot, dir), observations, nowIso);
  writeJsonFile(getRepoLivenessPath(repoRoot, dir), next);
  return next;
}
