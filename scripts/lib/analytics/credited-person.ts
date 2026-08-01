import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, isObject } from "../json-utils.js";
import { resolveAuthorPresentation, type AuthorAliasIndex } from "../author-aliases.js";

// Download CREDITING (analytics layer only): a version's downloads are credited
// to the caretaker whose [since, until) window contains the version's
// released_at (ISO 8601, from the current <type>/integrity.json:
// listings[id].versions[version].released_at). `since` is inclusive, `until`
// exclusive. No covering window, no released_at, or an unresolvable caretaker
// github_id -> credited to the listing AUTHOR. Manifests, downloads.json and
// the attribution ledger are untouched; only the authors_* CSVs and the
// listing_version_credits.csv artifact apply this rule.

export interface CaretakerWindowLike {
  github_id: number;
  since: string;
  until?: string;
}

export interface CreditedPersonPresentation {
  author: string;
  author_alias: string;
  attribution_link: string;
}

/**
 * Finds the caretaker window covering `releasedAt` and returns its github_id,
 * or null when no window covers it. `since` is inclusive, `until` exclusive;
 * a missing `until` means the window is still open. Windows with unparseable
 * dates never match. When windows overlap (validation prevents this), the last
 * matching entry wins, mirroring getActiveCaretaker's last-entry-is-active rule.
 */
export function findCoveringCaretakerGithubId(
  caretakers: readonly CaretakerWindowLike[] | undefined,
  releasedAt: string | undefined,
): number | null {
  if (!caretakers || caretakers.length === 0) return null;
  if (typeof releasedAt !== "string") return null;
  const releasedMs = Date.parse(releasedAt);
  if (!Number.isFinite(releasedMs)) return null;

  for (let index = caretakers.length - 1; index >= 0; index -= 1) {
    const window = caretakers[index]!;
    const sinceMs = Date.parse(window.since);
    if (!Number.isFinite(sinceMs) || releasedMs < sinceMs) continue;
    if (window.until !== undefined) {
      const untilMs = Date.parse(window.until);
      if (!Number.isFinite(untilMs) || releasedMs >= untilMs) continue;
    }
    return window.github_id;
  }
  return null;
}

/**
 * Pure crediting rule: resolves the person credited with a version's downloads.
 * Returns the caretaker's author_id when a [since, until) window covers
 * `releasedAt` and `resolveGithubId` can map the caretaker's github_id to an
 * author_id; in every other case (no caretakers, no covering window, missing
 * released_at, unresolvable github_id) returns `authorId` unchanged.
 */
export function resolveCreditedPerson(
  caretakers: readonly CaretakerWindowLike[] | undefined,
  releasedAt: string | undefined,
  authorId: string,
  resolveGithubId: (githubId: number) => string | null,
): string {
  const githubId = findCoveringCaretakerGithubId(caretakers, releasedAt);
  if (githubId === null) return authorId;
  return resolveGithubId(githubId) ?? authorId;
}

export interface VersionCreditResolver {
  /** Caretaker windows declared on the listing's manifest ([] when none). */
  getCaretakers(listingType: "maps" | "mods", listingId: string): readonly CaretakerWindowLike[];
  /** True when the listing's manifest carries at least one caretaker window. */
  hasCaretakers(listingType: "maps" | "mods", listingId: string): boolean;
  /**
   * Credited person's presentation for one version. Falls back to
   * `authorFallback` (the listing author's presentation) per the crediting rule.
   */
  resolvePresentation(
    listingType: "maps" | "mods",
    listingId: string,
    version: string,
    authorFallback: CreditedPersonPresentation,
  ): CreditedPersonPresentation;
  /** Credited author_id for one version (author fallback = `authorId`). */
  resolveAuthorId(
    listingType: "maps" | "mods",
    listingId: string,
    version: string,
    authorId: string,
  ): string;
  /**
   * Presentation of the ACTIVE caretaker (entry without `until`), or null when
   * the listing has none or the github_id does not resolve via authors/index.json.
   */
  activeCaretaker(
    listingType: "maps" | "mods",
    listingId: string,
  ): CreditedPersonPresentation | null;
}

function parseCaretakerWindows(value: unknown): CaretakerWindowLike[] {
  if (!Array.isArray(value)) return [];
  const windows: CaretakerWindowLike[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    if (typeof entry.github_id !== "number" || !Number.isFinite(entry.github_id)) continue;
    if (typeof entry.since !== "string") continue;
    windows.push({
      github_id: entry.github_id,
      since: entry.since,
      ...(typeof entry.until === "string" ? { until: entry.until } : {}),
    });
  }
  return windows;
}

interface IntegrityFileShape {
  listings?: Record<string, { versions?: Record<string, { released_at?: unknown }> }>;
}

function loadReleasedAtByListing(
  repoRoot: string,
  listingType: "maps" | "mods",
): Map<string, Map<string, string>> {
  const byListing = new Map<string, Map<string, string>>();
  const integrityPath = join(repoRoot, listingType, "integrity.json");
  if (!existsSync(integrityPath)) return byListing;
  let integrity: IntegrityFileShape;
  try {
    integrity = readJsonFile<IntegrityFileShape>(integrityPath);
  } catch {
    return byListing;
  }
  if (!isObject(integrity.listings)) return byListing;
  for (const [listingId, listing] of Object.entries(integrity.listings)) {
    if (!isObject(listing) || !isObject(listing.versions)) continue;
    const byVersion = new Map<string, string>();
    for (const [version, entry] of Object.entries(listing.versions)) {
      if (!isObject(entry)) continue;
      if (typeof entry.released_at === "string") {
        byVersion.set(version, entry.released_at);
      }
    }
    byListing.set(listingId, byVersion);
  }
  return byListing;
}

/**
 * Loader wrapper around resolveCreditedPerson: reads caretaker windows from
 * each listing's manifest, released_at timestamps from the current
 * <type>/integrity.json, and resolves caretaker github_ids to people via
 * authors/index.json (entry.github_id -> author_id).
 */
export function buildVersionCreditResolver(options: {
  repoRoot: string;
  authorAliases: AuthorAliasIndex;
}): VersionCreditResolver {
  const { repoRoot, authorAliases } = options;
  const caretakersCache = new Map<string, CaretakerWindowLike[]>();
  const releasedAtCache = new Map<"maps" | "mods", Map<string, Map<string, string>>>();
  const authorIdByGithubId = new Map<number, string | null>();
  const presentationByGithubId = new Map<number, CreditedPersonPresentation | null>();

  const getCaretakers = (
    listingType: "maps" | "mods",
    listingId: string,
  ): CaretakerWindowLike[] => {
    const cacheKey = `${listingType}:${listingId}`;
    const cached = caretakersCache.get(cacheKey);
    if (cached) return cached;
    let windows: CaretakerWindowLike[] = [];
    try {
      const manifest = readJsonFile<Record<string, unknown>>(
        join(repoRoot, listingType, listingId, "manifest.json"),
      );
      windows = parseCaretakerWindows(manifest.caretakers);
    } catch {
      // Missing/unreadable manifest -> no caretakers; credit stays with the author.
    }
    caretakersCache.set(cacheKey, windows);
    return windows;
  };

  const getReleasedAt = (
    listingType: "maps" | "mods",
    listingId: string,
    version: string,
  ): string | undefined => {
    let byListing = releasedAtCache.get(listingType);
    if (!byListing) {
      byListing = loadReleasedAtByListing(repoRoot, listingType);
      releasedAtCache.set(listingType, byListing);
    }
    return byListing.get(listingId)?.get(version);
  };

  const resolveGithubId = (githubId: number): string | null => {
    const cached = authorIdByGithubId.get(githubId);
    if (cached !== undefined) return cached;
    const entry = authorAliases.authors.find((candidate) => candidate.github_id === githubId);
    const authorId = entry?.author_id ?? null;
    authorIdByGithubId.set(githubId, authorId);
    return authorId;
  };

  const presentationForGithubId = (githubId: number): CreditedPersonPresentation | null => {
    const cached = presentationByGithubId.get(githubId);
    if (cached !== undefined) return cached;
    const authorId = resolveGithubId(githubId);
    const presentation = authorId === null
      ? null
      : resolveAuthorPresentation(authorId, githubId, authorAliases);
    presentationByGithubId.set(githubId, presentation);
    return presentation;
  };

  return {
    getCaretakers,
    hasCaretakers: (listingType, listingId) => getCaretakers(listingType, listingId).length > 0,
    resolvePresentation: (listingType, listingId, version, authorFallback) => {
      const caretakers = getCaretakers(listingType, listingId);
      if (caretakers.length === 0) return authorFallback;
      const githubId = findCoveringCaretakerGithubId(
        caretakers,
        getReleasedAt(listingType, listingId, version),
      );
      if (githubId === null) return authorFallback;
      return presentationForGithubId(githubId) ?? authorFallback;
    },
    resolveAuthorId: (listingType, listingId, version, authorId) => resolveCreditedPerson(
      getCaretakers(listingType, listingId),
      getReleasedAt(listingType, listingId, version),
      authorId,
      resolveGithubId,
    ),
    activeCaretaker: (listingType, listingId) => {
      const caretakers = getCaretakers(listingType, listingId);
      if (caretakers.length === 0) return null;
      const last = caretakers[caretakers.length - 1]!;
      if (last.until !== undefined) return null;
      return presentationForGithubId(last.github_id);
    },
  };
}
