import type { ManifestDirectory, MapManifest } from "./manifests.js";
import * as D from "./download-definitions.js";
import { createGraphqlUsageState, fetchRepoReleaseIndexes, isSupportedReleaseTag, graphqlUsageSnapshot } from "./release-resolution.js";
import type {
  IntegrityCache,
  IntegrityCacheEntry,
  IntegrityOutput,
  IntegritySource,
  IntegrityVersionEntry,
  ListingIntegrityEntry,
  ManifestGameDependency,
} from "./integrity.js";
import { GAME_VERSION_REQUIRED_SINCE_EPOCH, parseManifestGameDependency } from "./integrity.js";
import type { LoadedSecurityRules } from "./mod-security.js";
import {
  type CustomVersionCandidate,
  type ListingContext,
  buildIncompleteVersionEntry,
  createListingIntegrityEntry,
  enforceGameVersionRequirement,
  fetchCustomVersions,
  getDirectoryForType,
  getIndexIds,
  getManifest,
  loadIntegrityCache,
  loadDownloadsSnapshot,
  loadIntegritySnapshot,
  shouldUseCachedIntegrity,
  sortObjectByKeys,
  warnListing,
  withCheckResult,
} from "./downloads-support.js";
import { applyDownloadCountForVersion } from "./downloads-full/download-counts.js";
import {
  createInspectZipWithMemo,
  isLegacyMapCacheMissingFileSizes,
  releaseSizeFromBytes,
  resolveExpectedCustomReleaseManifestAssetName,
  versionedFingerprint,
  withReleaseSizeIfMissing,
  withReleasedAtIfMissing,
  withBuildingsIndexPresenceIfMissing,
} from "./downloads-full/integrity-completeness.js";
import {
  getSecurityFingerprintPart,
  getSecurityFingerprintValue,
  getStrictFingerprintCacheForListingType,
  isLegacyModCacheMissingSecurityCheck,
  resolveModSecurityRules,
} from "./downloads-full/integrity-security.js";
import {
  adjustDownloadCount,
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
  getAttributedCountForAssetKey,
  recordDownloadAttributionFetchByAssetKey,
  toDownloadAttributionAssetKey,
  type DownloadAttributionDelta,
  type DownloadAttributionLedger,
} from "./download-attribution.js";
import { toDownloadAssetBucketKey } from "./download-version-buckets.js";
import { getActiveCaretaker } from "./caretakers.js";
import {
  applyDeprecationOverlay,
  filterDeprecatedIntegrityAlerts,
  isManifestDeprecated,
} from "./downloads-full/deprecation.js";

// Per-listing display/routing metadata carried from the manifest into
// integrity-alert assembly.
interface ListingMetaEntry {
  listingName: string;
  authorId: string;
  caretakerGithubId?: number;
  deprecated?: boolean;
}

interface AdjustedVersionCount {
  adjustedCount: number;
  subtractedTotal: number;
  clamped: boolean;
  bucketInputs: D.DownloadVersionBucketInput[];
}

function countIntegrityVersions(entry: ListingIntegrityEntry | undefined): {
  complete: number;
  incomplete: number;
} {
  if (!entry) {
    return { complete: 0, incomplete: 0 };
  }
  let complete = 0;
  let incomplete = 0;
  for (const version of Object.values(entry.versions)) {
    if (version.is_complete) {
      complete += 1;
    } else {
      incomplete += 1;
    }
  }
  return { complete, incomplete };
}

// Checks added after the v6 baseline that must not retroactively fail versions
// that were already passing before these checks existed. If a fresh inspection
// (triggered by an empty cache) fails ONLY due to these keys, we preserve the
// previous passing result instead of marking the version incomplete.
const GRANDFATHERED_CHECK_KEYS: ReadonlySet<string> = new Set([
  "demand_phantom_points",
  "demand_residents_match",
]);

function isGrandfatheredDowngrade(
  previousEntry: IntegrityVersionEntry | undefined,
  newResult: IntegrityVersionEntry,
): boolean {
  if (!previousEntry?.is_complete) return false;
  if (newResult.is_complete) return false;
  const failingKeys = Object.entries(newResult.required_checks)
    .filter(([, pass]) => pass === false)
    .map(([key]) => key);
  return failingKeys.length > 0 && failingKeys.every((key) => GRANDFATHERED_CHECK_KEYS.has(key));
}

function getAdjustedGithubZipTotal(params: {
  listingId: string;
  version: string;
  repo: string;
  assets: Map<string, {
    assetNodeId: string | null;
    downloadCount: number;
    downloadUrl: string | null;
    sizeBytes: number | null;
  }>;
  attributionLedger: DownloadAttributionLedger;
  attributionDelta: DownloadAttributionDelta;
  warnings: string[];
}): AdjustedVersionCount {
  const {
    listingId,
    version,
    repo,
    assets,
    attributionLedger,
    attributionDelta,
    warnings,
  } = params;
  let adjustedCount = 0;
  let subtractedTotal = 0;
  let clamped = false;
  const bucketInputs: D.DownloadVersionBucketInput[] = [];

  for (const [assetName, asset] of assets.entries()) {
    if (!assetName.toLowerCase().endsWith(".zip")) continue;
    const key = toDownloadAttributionAssetKey(repo, version, assetName, asset.assetNodeId);
    const attributed = getAttributedCountForAssetKey(attributionLedger, attributionDelta, key);
    const adjusted = adjustDownloadCount(asset.downloadCount, attributed);
    adjustedCount += adjusted.adjusted;
    subtractedTotal += adjusted.subtracted;
    bucketInputs.push({
      bucketKey: toDownloadAssetBucketKey(repo, version, assetName, asset.assetNodeId),
      adjustedCount: adjusted.adjusted,
    });
    if (adjusted.clamped) {
      clamped = true;
      warnListing(
        warnings,
        listingId,
        `download attribution clamped '${assetName}' (raw=${adjusted.raw}, attributed=${adjusted.attributed}, adjusted=${adjusted.adjusted})`,
        version,
      );
    }
  }

  return {
    adjustedCount,
    subtractedTotal,
    clamped,
    bucketInputs,
  };
}

function getAdjustedSingleAssetCount(params: {
  listingId: string;
  version: string;
  repo: string;
  tag: string;
  assetName: string;
  rawCount: number;
  assetNodeId?: string | null;
  attributionLedger: DownloadAttributionLedger;
  attributionDelta: DownloadAttributionDelta;
  warnings: string[];
}): AdjustedVersionCount {
  const {
    listingId,
    version,
    repo,
    tag,
    assetName,
    rawCount,
    assetNodeId,
    attributionLedger,
    attributionDelta,
    warnings,
  } = params;
  const key = toDownloadAttributionAssetKey(repo, tag, assetName, assetNodeId);
  const attributed = getAttributedCountForAssetKey(attributionLedger, attributionDelta, key);
  const adjusted = adjustDownloadCount(rawCount, attributed);
  if (adjusted.clamped) {
    warnListing(
      warnings,
      listingId,
      `download attribution clamped '${assetName}' (raw=${adjusted.raw}, attributed=${adjusted.attributed}, adjusted=${adjusted.adjusted})`,
      version,
    );
  }
  return {
    adjustedCount: adjusted.adjusted,
    subtractedTotal: adjusted.subtracted,
    clamped: adjusted.clamped,
    bucketInputs: [{
      bucketKey: toDownloadAssetBucketKey(repo, tag, assetName, assetNodeId),
      adjustedCount: adjusted.adjusted,
    }],
  };
}

// resolveReleaseGameMeta fetches a release's manifest.json asset and parses the
// game version constraint + mod dependencies. Returns {} on any failure (missing
// asset, network error, unparseable body) so callers can attach it
// unconditionally without affecting completeness.
async function resolveReleaseGameMeta(
  manifestAssetUrl: string | null,
  fetchImpl: typeof fetch,
): Promise<ManifestGameDependency> {
  if (!manifestAssetUrl) return {};
  try {
    const resp = await fetchImpl(manifestAssetUrl, {
      headers: { Accept: "application/octet-stream" },
    });
    if (!resp.ok) return {};
    return parseManifestGameDependency(await resp.text());
  } catch {
    return {};
  }
}

// maxReleaseEpoch returns the newest of the given release date strings as epoch
// seconds, or undefined if none parse. Accepts RFC 3339 (github publishedAt) and
// date-only "YYYY-MM-DD" (custom update JSON) — both are valid Date inputs.
function maxReleaseEpoch(values: Array<string | null | undefined>): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    const seconds = Math.floor(ms / 1000);
    if (best === undefined || seconds > best) best = seconds;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pipeline plumbing for generateDownloadsDataFull. The run is decomposed into
// named stages; shared accumulators (warnings, stats, output maps) are carried
// in FullRunContext and mutated by the stages exactly as the original inline
// code did.
// ---------------------------------------------------------------------------

interface FullRunStats {
  versionsChecked: number;
  completeVersions: number;
  incompleteVersions: number;
  filteredVersions: number;
  cacheHits: number;
  adjustedDeltaTotal: number;
  clampedVersions: number;
}

// Run-scope state shared by every pipeline stage.
interface FullRunContext {
  listingType: D.GenerateDownloadsOptions["listingType"];
  fetchImpl: typeof fetch;
  now: Date;
  nowIso: string;
  warnings: string[];
  stats: FullRunStats;
  strictFingerprintCacheForMods: boolean;
  forceIntegrityRecheck: boolean;
  modSecurityRules: LoadedSecurityRules | null;
  attributionLedger: DownloadAttributionLedger;
  attributionDelta: DownloadAttributionDelta;
  previousIntegrity: IntegrityOutput | null;
  previousDownloads: D.DownloadsByListing;
  cache: IntegrityCache;
  nextCache: IntegrityCache;
  downloadsByListing: D.DownloadsByListing;
  versionBucketInputs: D.VersionBucketInputsByListing;
  integrityListings: Record<string, ListingIntegrityEntry>;
  integrityAlerts: D.IntegrityAlert[];
  listingMeta: Map<string, ListingMetaEntry>;
  transientErrorListings: Set<string>;
  repoIndexes: Map<string, D.RepoReleaseIndex>;
  unavailableRepos: Set<string>;
}

type GithubReleaseAsset = D.RepoReleaseTagData["assets"] extends Map<string, infer V> ? V : never;

// Per-listing working state built up while evaluating one listing's versions.
interface ListingEvaluationState {
  versionEntries: Record<string, IntegrityVersionEntry>;
  // Per-version publish epoch (seconds); date-gates the game_version requirement.
  publishEpochByVersion: Map<string, number | undefined>;
  listingCacheEntries: Record<string, IntegrityCacheEntry>;
  nextListingCacheEntries: Record<string, IntegrityCacheEntry>;
  inspectZipWithMemo: ReturnType<typeof createInspectZipWithMemo>;
}

// Stage 1: read every listing manifest, resolve its update source (github repo
// or custom update JSON), and collect the set of repos to index. Custom listings
// whose update JSON fails transiently are recorded in transientErrorListings
// with their previous download counts preserved.
async function resolveListingContexts(params: {
  ids: string[];
  repoRoot: string;
  dir: ManifestDirectory;
  listingType: D.GenerateDownloadsOptions["listingType"];
  fetchImpl: typeof fetch;
  warnings: string[];
  previousDownloads: D.DownloadsByListing;
  downloadsByListing: D.DownloadsByListing;
  listingContexts: Map<string, ListingContext>;
  listingMeta: Map<string, ListingMetaEntry>;
  repoSet: Set<string>;
  transientErrorListings: Set<string>;
}): Promise<void> {
  const {
    ids,
    repoRoot,
    dir,
    listingType,
    fetchImpl,
    warnings,
    previousDownloads,
    downloadsByListing,
    listingContexts,
    listingMeta,
    repoSet,
    transientErrorListings,
  } = params;

  // Pace unauthenticated raw.githubusercontent.com custom-update fetches to
  // avoid GitHub secondary rate limits (429s). 200ms between each fetch.
  const CUSTOM_UPDATE_INTER_FETCH_DELAY_MS = 200;
  let customFetchCount = 0;

  for (const id of ids) {
    downloadsByListing[id] = {};
    let manifest;
    try {
      manifest = getManifest(repoRoot, dir, id);
    } catch (error) {
      warnListing(warnings, id, `failed to read manifest (${(error as Error).message})`);
      continue;
    }

    listingMeta.set(id, {
      listingName: manifest.name,
      authorId: manifest.author,
      caretakerGithubId: getActiveCaretaker(manifest)?.github_id,
      deprecated: isManifestDeprecated(manifest),
    });

    if (manifest.update.type === "github") {
      const repo = manifest.update.repo.toLowerCase();
      repoSet.add(repo);
      listingContexts.set(id, {
        id,
        listingType,
        cityCode: listingType === "map" ? (manifest as MapManifest).city_code : undefined,
        update: { type: "github", repo },
      });
      continue;
    }

    if (customFetchCount > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, CUSTOM_UPDATE_INTER_FETCH_DELAY_MS));
    }
    customFetchCount += 1;
    const customFetch = await fetchCustomVersions(id, manifest.update.url, fetchImpl, warnings);
    if (customFetch.transientError) {
      downloadsByListing[id] = sortObjectByKeys(previousDownloads[id] ?? {});
      transientErrorListings.add(id);
      warnListing(warnings, id, "preserved previous custom-update downloads (transient fetch error)");
      continue;
    }
    for (const version of customFetch.versions) {
      if (version.parsed) {
        repoSet.add(version.parsed.repo);
      }
    }
    listingContexts.set(id, {
      id,
      listingType,
      cityCode: listingType === "map" ? (manifest as MapManifest).city_code : undefined,
      update: {
        type: "custom",
        url: manifest.update.url,
        versions: customFetch.versions,
      },
    });
  }
}

// Stage 2: preserve state for listings that never got a context — either a
// transient custom-update fetch error (previous integrity + cache preserved) or
// an unreadable manifest (empty listing entry).
function preserveMissingContextListing(ctx: FullRunContext, id: string): void {
  if (ctx.transientErrorListings.has(id)) {
    const listingCacheEntries = ctx.cache.entries[id] ?? {};
    const preservedListing = ctx.previousIntegrity?.listings[id];
    ctx.integrityListings[id] = preservedListing ?? createListingIntegrityEntry({});
    ctx.nextCache.entries[id] = sortObjectByKeys(listingCacheEntries);
    const preservedCounts = countIntegrityVersions(preservedListing);
    ctx.stats.completeVersions += preservedCounts.complete;
    ctx.stats.incompleteVersions += preservedCounts.incomplete;
    warnListing(ctx.warnings, id, "preserved previous integrity state (transient custom-update fetch error)");
  } else {
    ctx.integrityListings[id] = createListingIntegrityEntry({});
  }
}

// Decides whether a github release version may reuse its cached integrity
// result. Includes asset clobber detection: a matching cache entry is discarded
// when the release asset's recorded updatedAt (preferred) or byte size (legacy
// fallback) no longer matches the release index.
function shouldReuseGithubCacheEntry(
  ctx: FullRunContext,
  listingId: string,
  tag: string,
  cached: IntegrityCacheEntry,
  fingerprint: string,
  currentZipSizes: Record<string, number>,
  currentZipUpdatedAt: Record<string, string>,
): boolean {
  let shouldReuseCached = (
    !ctx.forceIntegrityRecheck
    && shouldUseCachedIntegrity(
      cached,
      fingerprint,
      ctx.now,
      ctx.strictFingerprintCacheForMods,
    )
    && !isLegacyMapCacheMissingFileSizes(ctx.listingType, cached)
    && !isLegacyModCacheMissingSecurityCheck(ctx.listingType, cached)
  );
  if (shouldReuseCached && cached != null) {
    // Prefer updatedAt timestamps (catches same-size replacements, e.g. config.json version bump).
    // Fall back to byte-size check for entries written before updatedAt was recorded.
    const storedUpdatedAt = cached.asset_updated_at;
    const storedSizes = cached.asset_sizes;
    const updatedAtMismatch = storedUpdatedAt != null && (
      Object.keys(currentZipUpdatedAt).some((name) => currentZipUpdatedAt[name] !== storedUpdatedAt[name])
      || Object.keys(storedUpdatedAt).some((name) => !(name in currentZipUpdatedAt))
    );
    const sizeMismatch = storedSizes != null && storedUpdatedAt == null && (
      Object.keys(currentZipSizes).some((name) => currentZipSizes[name] !== storedSizes[name])
      || Object.keys(storedSizes).some((name) => !(name in currentZipSizes))
    );
    if (updatedAtMismatch || sizeMismatch) {
      warnListing(ctx.warnings, listingId, "zip asset replaced since last inspection; forcing re-check", tag);
      shouldReuseCached = false;
    }
  }
  return shouldReuseCached;
}

// Fresh inspection of a github release's ZIP assets: fetches/inspects each .zip
// (memoized per listing), records attribution for real fetches, and synthesizes
// the version's integrity entry (first complete asset wins; otherwise the last
// failed result carries the accumulated errors).
async function inspectGithubReleaseZips(
  ctx: FullRunContext,
  state: ListingEvaluationState,
  listingId: string,
  repo: string,
  tag: string,
  releaseData: D.RepoReleaseTagData,
  zipAssets: Array<[string, GithubReleaseAsset]>,
  sourceBase: IntegritySource,
  fingerprint: string,
): Promise<IntegrityVersionEntry> {
  const hasReleaseManifestAsset = releaseData.assets.has("manifest.json");
  // Parse game_version/deps from the release's manifest.json asset once
  // per fresh check (github only). Cached entries gain it on recheck.
  const gameMeta = await resolveReleaseGameMeta(
    hasReleaseManifestAsset ? releaseData.assets.get("manifest.json")?.downloadUrl ?? null : null,
    ctx.fetchImpl,
  );
  let selectedResult: IntegrityVersionEntry | null = null;
  let lastFailedResult: IntegrityVersionEntry | null = null;
  const attemptedErrors: string[] = [];
  let attemptedReleaseSizeMiB: number | undefined;

  for (const [assetName, asset] of zipAssets.sort(([a], [b]) => a.localeCompare(b))) {
    if (!asset.downloadUrl) {
      attemptedErrors.push(`zip asset '${assetName}' is missing download URL`);
      continue;
    }
    const inspected = await state.inspectZipWithMemo({
      version: tag,
      assetName,
      downloadUrl: asset.downloadUrl,
      releaseHasManifestAsset: hasReleaseManifestAsset,
    });
    if (!inspected.ok) {
      attemptedErrors.push(`asset '${assetName}': ${inspected.error}`);
      continue;
    }
    if (!inspected.value.fromMemo) {
      const key = toDownloadAttributionAssetKey(repo, tag, assetName, asset.assetNodeId);
      recordDownloadAttributionFetchByAssetKey(ctx.attributionDelta, key);
    }
    const { check, releaseSizeMiB } = inspected.value;
    attemptedReleaseSizeMiB = releaseSizeMiB;
    for (const warning of check.warnings) {
      warnListing(ctx.warnings, listingId, `integrity warning (${warning})`, tag);
    }
    selectedResult = withCheckResult(
      check,
      { ...sourceBase, asset_name: assetName, download_url: asset.downloadUrl },
      fingerprint,
      ctx.nowIso,
      releaseSizeMiB,
      gameMeta,
    );
    if (check.isComplete) {
      break;
    }
    attemptedErrors.push(...check.errors.map((error) => `asset '${assetName}': ${error}`));
    lastFailedResult = selectedResult;
    selectedResult = null;
  }

  return selectedResult
    ?? (
      lastFailedResult
        ? {
          ...lastFailedResult,
          is_complete: false,
          errors: attemptedErrors.length > 0
            ? attemptedErrors
            : lastFailedResult.errors,
        }
        : buildIncompleteVersionEntry(
          sourceBase,
          fingerprint,
          ctx.nowIso,
          attemptedErrors.length > 0 ? attemptedErrors : ["all zip assets failed integrity checks"],
          {},
          {},
          attemptedReleaseSizeMiB,
        )
    );
}

// Stores a fresh github inspection result, unless doing so would downgrade a
// previously-complete version purely on grandfathered checks — in that case the
// previous passing entry is preserved (never-downgrade guard).
function storeGithubInspectionResult(
  ctx: FullRunContext,
  state: ListingEvaluationState,
  listingId: string,
  tag: string,
  result: IntegrityVersionEntry,
  fingerprint: string,
  currentZipSizes: Record<string, number>,
  currentZipUpdatedAt: Record<string, string>,
): void {
  const previousVersionEntry = ctx.previousIntegrity?.listings[listingId]?.versions?.[tag];
  const zipSizesEntry = Object.keys(currentZipSizes).length > 0 ? currentZipSizes : undefined;
  const zipUpdatedAtEntry = Object.keys(currentZipUpdatedAt).length > 0 ? currentZipUpdatedAt : undefined;
  if (isGrandfatheredDowngrade(previousVersionEntry, result)) {
    state.versionEntries[tag] = previousVersionEntry!;
    state.nextListingCacheEntries[tag] = {
      fingerprint,
      last_checked_at: ctx.nowIso,
      result: previousVersionEntry!,
      asset_sizes: zipSizesEntry,
      asset_updated_at: zipUpdatedAtEntry,
    };
    const failingKeys = Object.entries(result.required_checks)
      .filter(([, v]) => !v).map(([k]) => k).join(", ");
    warnListing(ctx.warnings, listingId, `preserved previous is_complete=true (grandfathered checks: ${failingKeys})`, tag);
  } else {
    state.versionEntries[tag] = result;
    state.nextListingCacheEntries[tag] = {
      fingerprint,
      last_checked_at: ctx.nowIso,
      result,
      asset_sizes: zipSizesEntry,
      asset_updated_at: zipUpdatedAtEntry,
    };
  }
}

// Applies the (attribution-adjusted) download count for a supported github
// release version, filtering versions that fail integrity.
function applyGithubDownloadCount(
  ctx: FullRunContext,
  state: ListingEvaluationState,
  listingId: string,
  repo: string,
  tag: string,
  releaseData: D.RepoReleaseTagData,
): void {
  const result = state.versionEntries[tag];
  const adjusted = getAdjustedGithubZipTotal({
    listingId,
    version: tag,
    repo,
    assets: releaseData.assets,
    attributionLedger: ctx.attributionLedger,
    attributionDelta: ctx.attributionDelta,
    warnings: ctx.warnings,
  });
  ctx.stats.adjustedDeltaTotal += adjusted.subtractedTotal;
  if (adjusted.clamped) {
    ctx.stats.clampedVersions += 1;
  }
  const included = applyDownloadCountForVersion({
    warnings: ctx.warnings,
    listingId,
    version: tag,
    result,
    downloadCount: adjusted.adjustedCount,
    downloadsByListing: ctx.downloadsByListing,
  });
  if (!included) {
    ctx.stats.filteredVersions += 1;
  } else {
    ctx.versionBucketInputs[listingId][tag] = adjusted.bucketInputs;
  }
}

// Stage 3a: evaluate a github-sourced listing — per-release-tag integrity
// (cache reuse with clobber detection, fresh inspection with grandfathering)
// and download-count application. Returns handled=true when the listing was
// fully resolved here (repo unavailable / not found) and per-listing
// finalization must be skipped; otherwise the listing's lastUpdated epoch.
async function evaluateGithubListing(
  ctx: FullRunContext,
  id: string,
  repo: string,
  state: ListingEvaluationState,
): Promise<{ handled: true } | { handled: false; lastUpdated: number | undefined }> {
  if (ctx.unavailableRepos.has(repo)) {
    const preservedListing = ctx.previousIntegrity?.listings[id];
    ctx.downloadsByListing[id] = sortObjectByKeys(ctx.previousDownloads[id] ?? {});
    ctx.integrityListings[id] = preservedListing ?? createListingIntegrityEntry({});
    ctx.nextCache.entries[id] = sortObjectByKeys(state.listingCacheEntries);
    const preservedCounts = countIntegrityVersions(preservedListing);
    ctx.stats.completeVersions += preservedCounts.complete;
    ctx.stats.incompleteVersions += preservedCounts.incomplete;
    warnListing(ctx.warnings, id, "preserved previous integrity and download state (repo unavailable)");
    return { handled: true };
  }
  const repoIndex = ctx.repoIndexes.get(repo);
  if (!repoIndex) {
    warnListing(ctx.warnings, id, "skipped all github-release versions (repository not found or inaccessible)");
    ctx.integrityListings[id] = createListingIntegrityEntry(state.versionEntries);
    ctx.nextCache.entries[id] = state.nextListingCacheEntries;
    return { handled: true };
  }
  const lastUpdated = maxReleaseEpoch(
    [...repoIndex.byTag.values()].map((release) => release.publishedAt),
  );
  for (const [releaseTag, release] of repoIndex.byTag) {
    const ms = Date.parse(release.publishedAt ?? "");
    state.publishEpochByVersion.set(releaseTag, Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined);
  }

  for (const tag of [...repoIndex.byTag.keys()].sort()) {
    const releaseData = repoIndex.byTag.get(tag);
    if (!releaseData) continue;
    ctx.stats.versionsChecked += 1;

    const zipAssets = Array.from(releaseData.assets.entries())
      .filter(([assetName]) => assetName.toLowerCase().endsWith(".zip"))
      .sort(([a], [b]) => a.localeCompare(b));
    const zipAssetNames = zipAssets.map(([name]) => name);
    const securityFingerprintPart = getSecurityFingerprintPart(
      ctx.listingType,
      ctx.modSecurityRules,
    );
    const fingerprintBase = zipAssets.length > 0
      ? `github:${repo}:${tag}:${zipAssetNames.join("|")}${securityFingerprintPart}`
      : `github:${repo}:${tag}:no-zip${securityFingerprintPart}`;
    const fingerprint = versionedFingerprint(fingerprintBase);
    const cached = state.listingCacheEntries[tag];
    const sourceBase: IntegritySource = {
      update_type: "github",
      repo,
      tag,
    };
    const currentZipSizes: Record<string, number> = Object.fromEntries(
      zipAssets.flatMap(([name, a]) => a.sizeBytes != null ? [[name, a.sizeBytes]] : []),
    );
    const currentZipUpdatedAt: Record<string, string> = Object.fromEntries(
      zipAssets.flatMap(([name, a]) => a.assetUpdatedAt != null ? [[name, a.assetUpdatedAt]] : []),
    );
    const shouldReuseCached = shouldReuseGithubCacheEntry(
      ctx,
      id,
      tag,
      cached,
      fingerprint,
      currentZipSizes,
      currentZipUpdatedAt,
    );

    if (shouldReuseCached) {
      ctx.stats.cacheHits += 1;
      const cachedAssetName = cached.result.source.asset_name;
      const matchedAsset = (
        typeof cachedAssetName === "string"
          ? releaseData.assets.get(cachedAssetName)
          : undefined
      );
      const representativeAsset = matchedAsset ?? (zipAssets.length === 1 ? zipAssets[0][1] : undefined);
      const result = withBuildingsIndexPresenceIfMissing(
        withReleaseSizeIfMissing(
          cached.result,
          releaseSizeFromBytes(representativeAsset?.sizeBytes),
        ),
      );
      state.versionEntries[tag] = result;
      state.nextListingCacheEntries[tag] = {
        ...cached,
        result,
      };
    } else if (!isSupportedReleaseTag(tag)) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        [`non-semver release tag '${tag}'`],
      );
      state.versionEntries[tag] = result;
      state.nextListingCacheEntries[tag] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else if (zipAssets.length === 0) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        ["release has no .zip asset"],
      );
      state.versionEntries[tag] = result;
      state.nextListingCacheEntries[tag] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else {
      const result = await inspectGithubReleaseZips(
        ctx,
        state,
        id,
        repo,
        tag,
        releaseData,
        zipAssets,
        sourceBase,
        fingerprint,
      );
      storeGithubInspectionResult(
        ctx,
        state,
        id,
        tag,
        result,
        fingerprint,
        currentZipSizes,
        currentZipUpdatedAt,
      );
    }

    if (isSupportedReleaseTag(tag)) {
      applyGithubDownloadCount(ctx, state, id, repo, tag, releaseData);
    }
  }
  return { handled: false, lastUpdated };
}

// Evaluates a custom version whose download URL parses to a github release .zip
// asset: resolves the release/asset (preserving previous state when the repo is
// transiently unavailable), performs the memoized inspection, and stores the
// result with the never-downgrade grandfathering guard.
async function evaluateCustomParsedZipVersion(
  ctx: FullRunContext,
  state: ListingEvaluationState,
  listingId: string,
  candidate: CustomVersionCandidate,
  parsed: D.ParsedReleaseAssetUrl,
  versionKey: string,
  cached: IntegrityCacheEntry,
  fingerprint: string,
  sourceBase: IntegritySource,
  expectedReleaseManifestAssetName: string,
): Promise<void> {
  const previousVersionEntry = ctx.previousIntegrity?.listings[listingId]?.versions?.[versionKey];
  const repoIndex = ctx.repoIndexes.get(parsed.repo);
  if (ctx.unavailableRepos.has(parsed.repo)) {
    if (previousVersionEntry) {
      state.versionEntries[versionKey] = previousVersionEntry;
      if (cached) {
        state.nextListingCacheEntries[versionKey] = cached;
      }
      warnListing(
        ctx.warnings,
        listingId,
        "preserved previous integrity state (repo unavailable)",
        versionKey,
      );
    } else {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        ["repository is unavailable via GitHub GraphQL and no previous integrity result exists"],
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    }
  } else if (!repoIndex) {
    const result = buildIncompleteVersionEntry(
      sourceBase,
      fingerprint,
      ctx.nowIso,
      ["repository is unavailable via GitHub GraphQL"],
    );
    state.versionEntries[versionKey] = result;
    state.nextListingCacheEntries[versionKey] = {
      fingerprint,
      last_checked_at: ctx.nowIso,
      result,
    };
  } else {
    const release = repoIndex.byTag.get(parsed.tag);
    if (!release) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        [`release tag '${parsed.tag}' not found`],
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else {
      const asset = release.assets.get(parsed.assetName);
      if (!asset) {
        const result = buildIncompleteVersionEntry(
          sourceBase,
          fingerprint,
          ctx.nowIso,
          [`release asset '${parsed.assetName}' not found`],
        );
        state.versionEntries[versionKey] = result;
        state.nextListingCacheEntries[versionKey] = {
          fingerprint,
          last_checked_at: ctx.nowIso,
          result,
        };
      } else if (!asset.downloadUrl) {
        const result = buildIncompleteVersionEntry(
          sourceBase,
          fingerprint,
          ctx.nowIso,
          [`release asset '${parsed.assetName}' has no download URL`],
        );
        state.versionEntries[versionKey] = result;
        state.nextListingCacheEntries[versionKey] = {
          fingerprint,
          last_checked_at: ctx.nowIso,
          result,
        };
      } else {
        const inspected = await state.inspectZipWithMemo({
          version: versionKey,
          assetName: parsed.assetName,
          downloadUrl: asset.downloadUrl,
          releaseHasManifestAsset: release.assets.has(expectedReleaseManifestAssetName),
          expectedReleaseManifestAssetName,
        });
        if (!inspected.ok) {
          const result = buildIncompleteVersionEntry(
            sourceBase,
            fingerprint,
            ctx.nowIso,
            [inspected.error],
          );
          state.versionEntries[versionKey] = result;
          state.nextListingCacheEntries[versionKey] = {
            fingerprint,
            last_checked_at: ctx.nowIso,
            result,
          };
        } else {
          if (!inspected.value.fromMemo) {
            const key = toDownloadAttributionAssetKey(
              parsed.repo,
              parsed.tag,
              parsed.assetName,
              asset.assetNodeId,
            );
            recordDownloadAttributionFetchByAssetKey(ctx.attributionDelta, key);
          }
          const { check, releaseSizeMiB } = inspected.value;
          for (const warning of check.warnings) {
            warnListing(ctx.warnings, listingId, `integrity warning (${warning})`, versionKey);
          }
          const result = withCheckResult(
            check,
            {
              ...sourceBase,
              asset_name: parsed.assetName,
              download_url: asset.downloadUrl,
            },
            fingerprint,
            ctx.nowIso,
            releaseSizeMiB,
            candidate.gameMeta,
          );
          if (isGrandfatheredDowngrade(previousVersionEntry, result)) {
            state.versionEntries[versionKey] = previousVersionEntry!;
            state.nextListingCacheEntries[versionKey] = {
              fingerprint,
              last_checked_at: ctx.nowIso,
              result: previousVersionEntry!,
            };
            const failingKeys = Object.entries(result.required_checks)
              .filter(([, v]) => !v).map(([k]) => k).join(", ");
            warnListing(ctx.warnings, listingId, `preserved previous is_complete=true (grandfathered checks: ${failingKeys})`, versionKey);
          } else {
            state.versionEntries[versionKey] = result;
            state.nextListingCacheEntries[versionKey] = {
              fingerprint,
              last_checked_at: ctx.nowIso,
              result,
            };
          }
        }
      }
    }
  }
}

// Applies the download count for a semver custom version: preserves previous
// counts when the backing repo is unavailable, otherwise adjusts the raw GitHub
// asset count by registry-attributed fetches.
function applyCustomDownloadCount(
  ctx: FullRunContext,
  state: ListingEvaluationState,
  listingId: string,
  candidate: CustomVersionCandidate,
  versionKey: string,
): void {
  const result = state.versionEntries[versionKey];
  let downloadCount: number | undefined;
  let versionBucketsForVersion: D.DownloadVersionBucketInput[] = [];
  if (candidate.parsed && ctx.unavailableRepos.has(candidate.parsed.repo)) {
    const previousCount = ctx.previousDownloads[listingId]?.[versionKey];
    if (typeof previousCount === "number") {
      downloadCount = previousCount;
      warnListing(
        ctx.warnings,
        listingId,
        "preserved previous GitHub release download count (repo unavailable)",
        versionKey,
      );
    }
  } else if (candidate.parsed) {
    const asset = ctx.repoIndexes
      .get(candidate.parsed.repo)
      ?.byTag
      .get(candidate.parsed.tag)
      ?.assets
      .get(candidate.parsed.assetName);
    const rawCount = asset?.downloadCount;
    if (typeof rawCount === "number") {
      const adjusted = getAdjustedSingleAssetCount({
        listingId,
        version: versionKey,
        repo: candidate.parsed.repo,
        tag: candidate.parsed.tag,
        assetName: candidate.parsed.assetName,
        rawCount,
        assetNodeId: asset?.assetNodeId ?? null,
        attributionLedger: ctx.attributionLedger,
        attributionDelta: ctx.attributionDelta,
        warnings: ctx.warnings,
      });
      ctx.stats.adjustedDeltaTotal += adjusted.subtractedTotal;
      if (adjusted.clamped) {
        ctx.stats.clampedVersions += 1;
      }
      downloadCount = adjusted.adjustedCount;
      versionBucketsForVersion = adjusted.bucketInputs;
    }
  }
  const included = applyDownloadCountForVersion({
    warnings: ctx.warnings,
    listingId,
    version: versionKey,
    result,
    downloadCount,
    downloadsByListing: ctx.downloadsByListing,
  });
  if (!included) {
    ctx.stats.filteredVersions += 1;
  } else {
    ctx.versionBucketInputs[listingId][versionKey] = versionBucketsForVersion;
  }
}

// Stage 3b: evaluate a custom-update-sourced listing — per-declared-version
// integrity (cache reuse, candidate validation, fresh inspection with
// grandfathering) and download-count application. Returns the listing's
// lastUpdated epoch.
async function evaluateCustomListing(
  ctx: FullRunContext,
  id: string,
  versions: CustomVersionCandidate[],
  state: ListingEvaluationState,
): Promise<number | undefined> {
  const lastUpdated = maxReleaseEpoch(versions.map((candidate) => candidate.date));
  for (const candidate of versions) {
    const versionKey = candidate.version;
    const candidateMs = Date.parse(candidate.date ?? "");
    state.publishEpochByVersion.set(versionKey, Number.isFinite(candidateMs) ? Math.floor(candidateMs / 1000) : undefined);
    ctx.stats.versionsChecked += 1;
    const expectedReleaseManifestAssetName = resolveExpectedCustomReleaseManifestAssetName(
      candidate,
      ctx.warnings,
      id,
    );

    const fallbackFingerprintBase = candidate.sha256
      ? `sha256:${candidate.sha256}`
      : `custom:${versionKey}:${candidate.downloadUrl ?? "missing-download"}:${expectedReleaseManifestAssetName}`;
    const securityFingerprintPart = getSecurityFingerprintPart(
      ctx.listingType,
      ctx.modSecurityRules,
    );
    const fingerprintBase = candidate.sha256
      ? `sha256:${candidate.sha256}${securityFingerprintPart}`
      : (
        candidate.parsed
          ? `custom:${candidate.parsed.repo}:${candidate.parsed.tag}:${candidate.parsed.assetName}:${expectedReleaseManifestAssetName}:${candidate.downloadUrl ?? "missing-download"}${securityFingerprintPart}`
          : `${fallbackFingerprintBase}${securityFingerprintPart}`
      );
    const fingerprint = versionedFingerprint(fingerprintBase);
    const sourceBase: IntegritySource = {
      update_type: "custom",
      repo: candidate.parsed?.repo,
      tag: candidate.parsed?.tag,
      asset_name: candidate.parsed?.assetName,
      download_url: candidate.downloadUrl ?? undefined,
    };
    const cached = state.listingCacheEntries[versionKey];
    const shouldReuseCached = (
      !ctx.forceIntegrityRecheck
      && shouldUseCachedIntegrity(
        cached,
        fingerprint,
        ctx.now,
        ctx.strictFingerprintCacheForMods,
      )
      && !isLegacyMapCacheMissingFileSizes(ctx.listingType, cached)
      && !isLegacyModCacheMissingSecurityCheck(ctx.listingType, cached)
    );

    if (shouldReuseCached) {
      ctx.stats.cacheHits += 1;
      const sizeFromMetadata = (
        candidate.parsed
          ? releaseSizeFromBytes(
            ctx.repoIndexes
              .get(candidate.parsed.repo)
              ?.byTag
              .get(candidate.parsed.tag)
              ?.assets
              .get(candidate.parsed.assetName)
              ?.sizeBytes,
          )
          : undefined
      );
      const result = withBuildingsIndexPresenceIfMissing(
        withReleaseSizeIfMissing(cached.result, sizeFromMetadata),
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        ...cached,
        result,
      };
    } else if (candidate.errors.length > 0) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        candidate.errors,
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else if (!candidate.parsed) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        ["download URL could not be parsed as a GitHub release asset URL"],
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else if (!candidate.parsed.assetName.toLowerCase().endsWith(".zip")) {
      const result = buildIncompleteVersionEntry(
        sourceBase,
        fingerprint,
        ctx.nowIso,
        [`download asset '${candidate.parsed.assetName}' is not a .zip`],
      );
      state.versionEntries[versionKey] = result;
      state.nextListingCacheEntries[versionKey] = {
        fingerprint,
        last_checked_at: ctx.nowIso,
        result,
      };
    } else {
      await evaluateCustomParsedZipVersion(
        ctx,
        state,
        id,
        candidate,
        candidate.parsed,
        versionKey,
        cached,
        fingerprint,
        sourceBase,
        expectedReleaseManifestAssetName,
      );
    }

    if (candidate.semver) {
      applyCustomDownloadCount(ctx, state, id, candidate, versionKey);
    }
  }
  return lastUpdated;
}

// Stage 4: per-listing finalization — game_version enforcement, released_at
// stamping, integrity-alert assembly, complete/incomplete tallies, and the
// listing's integrity + cache outputs.
function finalizeListingEntries(
  ctx: FullRunContext,
  id: string,
  state: ListingEvaluationState,
  lastUpdated: number | undefined,
): void {
  const { versionEntries, publishEpochByVersion, nextListingCacheEntries } = state;

  for (const violation of enforceGameVersionRequirement(
    versionEntries,
    publishEpochByVersion,
    GAME_VERSION_REQUIRED_SINCE_EPOCH,
  )) {
    warnListing(ctx.warnings, id, `game_version required [${ctx.listingType}]: ${violation.reason}`, violation.version);
  }

  // Stamp released_at (immutable publish date) onto every version — fresh, reused,
  // and legacy cache entries alike. The output entry and its cache entry share a
  // reference, so re-point both to the stamped copy.
  for (const version of Object.keys(versionEntries)) {
    const stamped = withReleasedAtIfMissing(versionEntries[version], publishEpochByVersion.get(version));
    if (stamped === versionEntries[version]) continue;
    versionEntries[version] = stamped;
    const cacheEntry = nextListingCacheEntries[version];
    if (cacheEntry) nextListingCacheEntries[version] = { ...cacheEntry, result: stamped };
  }

  for (const [version, entry] of Object.entries(versionEntries)) {
    if (!entry.is_complete && Object.values(entry.required_checks).some((v) => v === false)) {
      const prevEntry = ctx.previousIntegrity?.listings[id]?.versions?.[version];
      if (prevEntry === undefined || prevEntry.is_complete === true) {
        const meta = ctx.listingMeta.get(id);
        ctx.integrityAlerts.push({
          listingId: id,
          listingName: meta?.listingName ?? id,
          listingType: ctx.listingType,
          authorId: meta?.authorId ?? "",
          ...(meta?.caretakerGithubId !== undefined
            ? { caretakerGithubId: meta.caretakerGithubId }
            : {}),
          version,
          isRegression: prevEntry?.is_complete === true,
          failingChecks: Object.entries(entry.required_checks)
            .filter(([, v]) => v === false)
            .map(([k]) => k),
          errors: entry.errors,
          sourceRepo: entry.source.repo,
          sourceTag: entry.source.tag,
        });
      }
    }
  }

  for (const result of Object.values(versionEntries)) {
    if (result.is_complete) {
      ctx.stats.completeVersions += 1;
    } else {
      ctx.stats.incompleteVersions += 1;
    }
  }

  ctx.integrityListings[id] = createListingIntegrityEntry(versionEntries, lastUpdated);
  ctx.nextCache.entries[id] = sortObjectByKeys(nextListingCacheEntries);
}

// Stage 3: evaluate one listing with a resolved context — build its per-listing
// working state, dispatch to the github/custom evaluator, then finalize.
async function evaluateListing(
  ctx: FullRunContext,
  id: string,
  context: ListingContext,
): Promise<void> {
  const state: ListingEvaluationState = {
    versionEntries: {},
    publishEpochByVersion: new Map<string, number | undefined>(),
    listingCacheEntries: ctx.cache.entries[id] ?? {},
    nextListingCacheEntries: {},
    inspectZipWithMemo: createInspectZipWithMemo({
      listingId: id,
      listingType: ctx.listingType,
      cityCode: context.cityCode,
      nowIso: ctx.nowIso,
      warnings: ctx.warnings,
      fetchImpl: ctx.fetchImpl,
      modSecurityRules: ctx.modSecurityRules,
      securityFingerprint: getSecurityFingerprintValue(ctx.modSecurityRules),
    }),
  };

  // Newest release date for this listing (epoch seconds), synced to last_updated.
  let lastUpdated: number | undefined;
  if (context.update.type === "github") {
    const outcome = await evaluateGithubListing(ctx, id, context.update.repo, state);
    if (outcome.handled) return;
    lastUpdated = outcome.lastUpdated;
  } else {
    lastUpdated = await evaluateCustomListing(ctx, id, context.update.versions, state);
  }

  finalizeListingEntries(ctx, id, state, lastUpdated);
}

export async function generateDownloadsDataFull(
  options: D.GenerateDownloadsOptions,
): Promise<D.GenerateDownloadsResult> {
  const repoRoot = options.repoRoot;
  const listingType = options.listingType;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token;
  const strictFingerprintCache = options.strictFingerprintCache === true;
  const forceIntegrityRecheck = options.forceIntegrityRecheck === true;
  const strictFingerprintCacheForMods = getStrictFingerprintCacheForListingType(
    listingType,
    strictFingerprintCache,
  );
  const warnings: string[] = [];
  const dir = getDirectoryForType(listingType);
  const ids = getIndexIds(repoRoot, dir);
  const now = new Date();
  const nowIso = now.toISOString();
  const attributionLedger = options.attribution?.ledger ?? createEmptyDownloadAttributionLedger(nowIso);
  const attributionDelta = options.attribution?.delta
    ?? createDownloadAttributionDelta(`runtime:${listingType}:full`, undefined, nowIso);
  const modSecurityRules = resolveModSecurityRules(listingType, repoRoot);
  const previousIntegrity = loadIntegritySnapshot(repoRoot, dir);
  const previousDownloads = loadDownloadsSnapshot(repoRoot, dir);

  const cache = loadIntegrityCache(repoRoot, dir);
  const nextCache: IntegrityCache = {
    schema_version: 1,
    entries: {},
  };

  const downloadsByListing: D.DownloadsByListing = {};
  const listingContexts = new Map<string, ListingContext>();
  const listingMeta = new Map<string, ListingMetaEntry>();
  const repoSet = new Set<string>();
  const transientErrorListings = new Set<string>();

  await resolveListingContexts({
    ids,
    repoRoot,
    dir,
    listingType,
    fetchImpl,
    warnings,
    previousDownloads,
    downloadsByListing,
    listingContexts,
    listingMeta,
    repoSet,
    transientErrorListings,
  });

  const usageState = createGraphqlUsageState();
  const { repoIndexes, unavailableRepos } = await fetchRepoReleaseIndexes(repoSet, {
    fetchImpl,
    token,
    warnings,
    usageState,
  });

  const ctx: FullRunContext = {
    listingType,
    fetchImpl,
    now,
    nowIso,
    warnings,
    stats: {
      versionsChecked: 0,
      completeVersions: 0,
      incompleteVersions: 0,
      filteredVersions: 0,
      cacheHits: 0,
      adjustedDeltaTotal: 0,
      clampedVersions: 0,
    },
    strictFingerprintCacheForMods,
    forceIntegrityRecheck,
    modSecurityRules,
    attributionLedger,
    attributionDelta,
    previousIntegrity,
    previousDownloads,
    cache,
    nextCache,
    downloadsByListing,
    versionBucketInputs: {},
    integrityListings: {},
    integrityAlerts: [],
    listingMeta,
    transientErrorListings,
    repoIndexes,
    unavailableRepos,
  };

  for (const id of [...ids].sort()) {
    console.log(`[downloads] heartbeat:listing mode=full listing=${id}`);
    ctx.versionBucketInputs[id] = {};
    const context = listingContexts.get(id);
    if (!context) {
      preserveMissingContextListing(ctx, id);
      continue;
    }
    await evaluateListing(ctx, id, context);
  }

  const sortedDownloads: D.DownloadsByListing = {};
  for (const id of [...ids].sort()) {
    sortedDownloads[id] = sortObjectByKeys(downloadsByListing[id] ?? {});
  }

  // Deprecation output overlay (see downloads-full/deprecation.ts): the
  // published integrity view reports deprecated listings with zero installable
  // versions while downloads, buckets, and the integrity cache above keep the
  // true evaluated state. Applied centrally so preserved/unavailable listing
  // paths are covered too; alerts for deprecated listings are dropped.
  const isDeprecatedId = (id: string): boolean => listingMeta.get(id)?.deprecated === true;
  const overlaidIds = applyDeprecationOverlay(ctx.integrityListings, isDeprecatedId);
  if (overlaidIds.length > 0) {
    console.log(`[downloads] Deprecation overlay applied to: ${overlaidIds.join(", ")}`);
  }

  return {
    downloads: sortedDownloads,
    versionBucketInputs: ctx.versionBucketInputs,
    integrity: {
      schema_version: 1,
      generated_at: nowIso,
      listings: sortObjectByKeys(ctx.integrityListings),
    },
    integrityCache: {
      schema_version: 1,
      entries: sortObjectByKeys(nextCache.entries),
    },
    integrityAlerts: filterDeprecatedIntegrityAlerts(ctx.integrityAlerts, isDeprecatedId),
    stats: {
      listings: ids.length,
      versions_checked: ctx.stats.versionsChecked,
      complete_versions: ctx.stats.completeVersions,
      incomplete_versions: ctx.stats.incompleteVersions,
      filtered_versions: ctx.stats.filteredVersions,
      cache_hits: ctx.stats.cacheHits,
      registry_fetches_added: Object.values(attributionDelta.assets).reduce((sum, count) => sum + count, 0),
      adjusted_delta_total: ctx.stats.adjustedDeltaTotal,
      clamped_versions: ctx.stats.clampedVersions,
    },
    warnings,
    rateLimit: graphqlUsageSnapshot(usageState),
  };
}
