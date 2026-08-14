import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestDirectory } from "./manifests.js";
import { isObject, writeJsonFile } from "./json-utils.js";

// Tracks listings that are effectively unavailable, by cause:
//   repo    — GitHub repo returning "Could not resolve to a Repository"
//             (deleted, renamed without redirect, or made private)
//   url     — custom update JSON whose endpoint returns a non-transient error
//   listing — source reachable, but no installable version remains (every
//             version removed upstream), which no per-version integrity alert
//             can catch: tombstones carry no failed checks
// Transient failures (429/5xx, network errors) never touch this file — an
// entry's first_unreachable_at only starts, and only clears, on a definitive
// observation. Consumed by the repo-liveness review workflow, which nags
// maintainers once a cause has persisted for multiple days.
//
// The file name predates both custom sources and listing entries; the key kind
// carries the distinction.

export const REPO_LIVENESS_SCHEMA_VERSION = 2;

export type LivenessSourceKind = "repo" | "url" | "listing";

/** Key space: "repo:owner/name", "url:https://…" and "listing:<id>" cannot collide. */
export function livenessSourceKey(kind: LivenessSourceKind, value: string): string {
  return `${kind}:${value}`;
}

export function parseLivenessSourceKey(
  key: string,
): { kind: LivenessSourceKind; value: string } | null {
  if (key.startsWith("repo:")) return { kind: "repo", value: key.slice(5) };
  if (key.startsWith("url:")) return { kind: "url", value: key.slice(4) };
  if (key.startsWith("listing:")) return { kind: "listing", value: key.slice(8) };
  return null;
}

export interface SourceLivenessEntry {
  kind: LivenessSourceKind;
  first_unreachable_at: string;
  last_checked_at: string;
  /** Non-deprecated, non-test listings affected (the listing itself, for listing-kind). */
  listings: string[];
}

export interface SourceLivenessFile {
  schema_version: number;
  updated_at: string;
  sources: Record<string, SourceLivenessEntry>;
}

export interface SourceLivenessObservations {
  /** Source keys that resolved successfully this run. */
  reachable: Iterable<string>;
  /** Source keys that failed transiently (existing entries are kept as-is). */
  transient: Iterable<string>;
  /** Definitively-unreachable source keys, with the eligible listings referencing each. */
  notFound: Record<string, string[]>;
}

export function getRepoLivenessPath(repoRoot: string, dir: ManifestDirectory): string {
  return resolve(repoRoot, dir, "repo-liveness.json");
}

export function loadSourceLiveness(repoRoot: string, dir: ManifestDirectory): SourceLivenessFile {
  const path = getRepoLivenessPath(repoRoot, dir);
  const empty: SourceLivenessFile = {
    schema_version: REPO_LIVENESS_SCHEMA_VERSION,
    updated_at: "",
    sources: {},
  };
  if (!existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isObject(raw)) return empty;
    // v1 stored bare repo names under `repos`; read them as repo-kind sources.
    const legacy = isObject(raw.repos) ? raw.repos : null;
    const current = isObject(raw.sources) ? raw.sources : null;
    const sources: Record<string, SourceLivenessEntry> = {};
    for (const [rawKey, value] of Object.entries(current ?? legacy ?? {})) {
      if (!isObject(value)) continue;
      const entry = value as Partial<SourceLivenessEntry>;
      if (typeof entry.first_unreachable_at !== "string" || typeof entry.last_checked_at !== "string") {
        continue;
      }
      const key = current ? rawKey : livenessSourceKey("repo", rawKey);
      const parsed = parseLivenessSourceKey(key);
      if (!parsed) continue;
      sources[key] = {
        kind: parsed.kind,
        first_unreachable_at: entry.first_unreachable_at,
        last_checked_at: entry.last_checked_at,
        listings: Array.isArray(entry.listings)
          ? entry.listings.filter((id): id is string => typeof id === "string")
          : [],
      };
    }
    return { ...empty, sources };
  } catch {
    return empty;
  }
}

/**
 * Pure state transition:
 * - reachable source -> entry removed (source recovered)
 * - not-found source with eligible listings -> entry upserted; the original
 *   first_unreachable_at is preserved so the unreachable clock keeps running
 * - not-found source whose listings are all deprecated/test -> never tracked
 * - transient source -> existing entry carried over untouched (state unknown)
 * - source absent from every observation (no longer referenced) -> entry removed
 */
export function applySourceLivenessObservations(
  previous: SourceLivenessFile,
  observations: SourceLivenessObservations,
  nowIso: string,
): SourceLivenessFile {
  const transient = new Set(observations.transient);
  const sources: Record<string, SourceLivenessEntry> = {};

  for (const key of transient) {
    const existing = previous.sources[key];
    if (existing) sources[key] = existing;
  }
  for (const [key, listings] of Object.entries(observations.notFound)) {
    if (listings.length === 0) continue;
    const parsed = parseLivenessSourceKey(key);
    if (!parsed) continue;
    sources[key] = {
      kind: parsed.kind,
      first_unreachable_at: previous.sources[key]?.first_unreachable_at ?? nowIso,
      last_checked_at: nowIso,
      listings: [...listings].sort(),
    };
  }

  const sorted: Record<string, SourceLivenessEntry> = {};
  for (const key of Object.keys(sources).sort()) {
    sorted[key] = sources[key]!;
  }
  return {
    schema_version: REPO_LIVENESS_SCHEMA_VERSION,
    updated_at: nowIso,
    sources: sorted,
  };
}

export function updateSourceLiveness(
  repoRoot: string,
  dir: ManifestDirectory,
  observations: SourceLivenessObservations,
  nowIso: string,
): SourceLivenessFile {
  const next = applySourceLivenessObservations(
    loadSourceLiveness(repoRoot, dir),
    observations,
    nowIso,
  );
  writeJsonFile(getRepoLivenessPath(repoRoot, dir), next);
  return next;
}

/**
 * Listing-level observations: listings with no installable version left, keyed
 * as listing-kind sources. Deprecated and test listings are excluded (their
 * empty version set is intended), as are listings whose own source is already
 * reported unreachable — one dead upstream should raise one issue.
 */
export function collectListingsWithoutInstallableVersion(params: {
  ids: readonly string[];
  isEligible: (id: string) => boolean;
  hasCompleteVersion: (id: string) => boolean;
  hasUnreachableSource: (id: string) => boolean;
}): Record<string, string[]> {
  const notFound: Record<string, string[]> = {};
  for (const id of params.ids) {
    if (!params.isEligible(id)) continue;
    if (params.hasCompleteVersion(id)) continue;
    if (params.hasUnreachableSource(id)) continue;
    notFound[livenessSourceKey("listing", id)] = [id];
  }
  return notFound;
}
