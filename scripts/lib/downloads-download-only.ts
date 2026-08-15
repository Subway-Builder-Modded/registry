import type { MapManifest } from "./manifests.js";
import * as D from "./download-definitions.js";
import { createGraphqlUsageState, fetchRepoReleaseIndexes, isSupportedReleaseTag, graphqlUsageSnapshot } from "./release-resolution.js";
import {
  adjustDownloadCount,
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
  getAttributedCountForAssetKey,
  toDownloadAttributionAssetKey,
} from "./download-attribution.js";
import { toDownloadAssetBucketKey } from "./download-version-buckets.js";
import { isManifestDeprecated } from "./downloads-full/deprecation.js";
import {
  collectListingsWithoutInstallableVersion,
  livenessSourceKey,
  updateSourceLiveness,
} from "./repo-liveness.js";
import {
  type ListingContext,
  emptyIntegrity,
  fetchCustomVersions,
  getDirectoryForType,
  getIndexIds,
  getManifest,
  loadIntegrityCache,
  loadDownloadsSnapshot,
  loadIntegritySnapshot,
  sortObjectByKeys,
  warnListing,
} from "./downloads-support.js";

export async function generateDownloadsDataDownloadOnly(
  options: D.GenerateDownloadsOptions,
): Promise<D.GenerateDownloadsResult> {
  const repoRoot = options.repoRoot;
  const listingType = options.listingType;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token;
  const warnings: string[] = [];
  const dir = getDirectoryForType(listingType);
  const ids = getIndexIds(repoRoot, dir);
  const nowIso = new Date().toISOString();
  const attributionLedger = options.attribution?.ledger ?? createEmptyDownloadAttributionLedger(nowIso);
  const attributionDelta = options.attribution?.delta
    ?? createDownloadAttributionDelta(`runtime:${listingType}:download-only`, undefined, nowIso);
  const loadedIntegrity = loadIntegritySnapshot(repoRoot, dir);
  const previousDownloads = loadDownloadsSnapshot(repoRoot, dir);
  const integrity = loadedIntegrity ?? emptyIntegrity(nowIso);
  const hasIntegritySnapshot = loadedIntegrity !== null && Object.keys(loadedIntegrity.listings).length > 0;

  const downloadsByListing: D.DownloadsByListing = {};
  const versionBucketInputs: D.VersionBucketInputsByListing = {};
  const listingContexts = new Map<string, ListingContext>();
  const repoSet = new Set<string>();
  // Source key -> non-deprecated, non-test listings referencing it.
  const sourceEligibleListings = new Map<string, Set<string>>();
  const trackSourceListing = (
    key: string,
    id: string,
    manifest: { is_test?: boolean; deprecation?: unknown },
  ) => {
    if (manifest.is_test || isManifestDeprecated(manifest)) return;
    let listings = sourceEligibleListings.get(key);
    if (!listings) {
      listings = new Set();
      sourceEligibleListings.set(key, listings);
    }
    listings.add(id);
  };
  // Custom update endpoints, tracked alongside repos: when the host serving
  // the JSON dies, the fetch fails before any repo can be parsed out of it, so
  // repo-only tracking would never see the listing at all.
  const reachableUrls = new Set<string>();
  const transientUrls = new Set<string>();
  const unreachableUrls = new Set<string>();

  for (const id of ids) {
    downloadsByListing[id] = {};
    versionBucketInputs[id] = {};
    let manifest;
    try {
      manifest = getManifest(repoRoot, dir, id);
    } catch (error) {
      warnListing(warnings, id, `failed to read manifest (${(error as Error).message})`);
      continue;
    }

    if (manifest.update.type === "github") {
      const repo = manifest.update.repo.toLowerCase();
      repoSet.add(repo);
      trackSourceListing(livenessSourceKey("repo", repo), id, manifest);
      listingContexts.set(id, {
        id,
        listingType,
        cityCode: listingType === "map" ? (manifest as MapManifest).city_code : undefined,
        update: { type: "github", repo },
      });
      continue;
    }

    const updateUrl = manifest.update.url;
    trackSourceListing(livenessSourceKey("url", updateUrl), id, manifest);
    const customFetch = await fetchCustomVersions(id, updateUrl, fetchImpl, warnings);
    if (customFetch.transientError) {
      transientUrls.add(updateUrl);
      downloadsByListing[id] = sortObjectByKeys(previousDownloads[id] ?? {});
      warnListing(warnings, id, "preserved previous custom-update downloads (transient fetch error)");
      continue;
    }
    if (customFetch.sourceUnreachable) {
      unreachableUrls.add(updateUrl);
    } else {
      reachableUrls.add(updateUrl);
    }
    for (const version of customFetch.versions) {
      if (version.parsed) {
        repoSet.add(version.parsed.repo);
        trackSourceListing(livenessSourceKey("repo", version.parsed.repo), id, manifest);
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

  const usageState = createGraphqlUsageState();
  // A repo referenced only by deprecated/test listings is expected to stop
  // resolving, so its fetch failure is not news. Full mode has always
  // suppressed these; hourly runs did not, and re-reported them every hour.
  const suppressWarningRepos = new Set(
    [...repoSet].filter((repo) => !sourceEligibleListings.has(livenessSourceKey("repo", repo))),
  );
  const { repoIndexes, unavailableRepos } = await fetchRepoReleaseIndexes(repoSet, {
    fetchImpl,
    token,
    warnings,
    usageState,
    suppressWarningRepos,
  });

  {
    const notFound: Record<string, string[]> = {};
    const unreachableSourceKeys = new Set<string>();
    for (const repo of repoSet) {
      if (repoIndexes.has(repo) || unavailableRepos.has(repo)) continue;
      unreachableSourceKeys.add(livenessSourceKey("repo", repo));
    }
    for (const url of unreachableUrls) {
      unreachableSourceKeys.add(livenessSourceKey("url", url));
    }
    for (const key of unreachableSourceKeys) {
      notFound[key] = [...(sourceEligibleListings.get(key) ?? [])];
    }

    // Listing-level cause, evaluated against the published integrity snapshot
    // this mode already loads. Both modes must apply it: the hourly
    // download-only run would otherwise drop entries the full run recorded,
    // resetting the clock every hour.
    const eligibleForListingCheck = (id: string): boolean => {
      try {
        const manifest = getManifest(repoRoot, dir, id);
        return !isManifestDeprecated(manifest) && manifest.is_test !== true;
      } catch {
        return false;
      }
    };
    Object.assign(notFound, collectListingsWithoutInstallableVersion({
      ids,
      isEligible: (id) => hasIntegritySnapshot && eligibleForListingCheck(id),
      hasCompleteVersion: (id) => integrity.listings[id]?.has_complete_version === true,
      hasUnreachableSource: (id) =>
        [...unreachableSourceKeys].some((key) => sourceEligibleListings.get(key)?.has(id) === true),
    }));

    updateSourceLiveness(repoRoot, dir, {
      reachable: [
        ...[...repoIndexes.keys()].map((repo) => livenessSourceKey("repo", repo)),
        ...[...reachableUrls].map((url) => livenessSourceKey("url", url)),
        ...(hasIntegritySnapshot
          ? ids
              .filter((id) => integrity.listings[id]?.has_complete_version === true)
              .map((id) => livenessSourceKey("listing", id))
          : []),
      ],
      transient: [
        ...[...unavailableRepos].map((repo) => livenessSourceKey("repo", repo)),
        ...[...transientUrls].map((url) => livenessSourceKey("url", url)),
        // No integrity snapshot means no verdict on any listing this run.
        ...(hasIntegritySnapshot ? [] : ids.map((id) => livenessSourceKey("listing", id))),
      ],
      notFound,
    }, nowIso);
  }

  let versionsChecked = 0;
  let adjustedDeltaTotal = 0;
  let clampedVersions = 0;

  for (const id of [...ids].sort()) {
    console.log(`[downloads] heartbeat:listing mode=download-only listing=${id}`);
    const context = listingContexts.get(id);
    if (!context) continue;

    if (context.update.type === "github") {
      if (unavailableRepos.has(context.update.repo)) {
        downloadsByListing[id] = sortObjectByKeys(previousDownloads[id] ?? {});
        warnListing(warnings, id, "preserved previous github-release downloads (repo unavailable)");
        continue;
      }
      const repoIndex = repoIndexes.get(context.update.repo);
      if (!repoIndex) {
        downloadsByListing[id] = sortObjectByKeys(previousDownloads[id] ?? {});
        warnListing(warnings, id, "preserved previous github-release downloads (repository not found or inaccessible)");
        continue;
      }

      for (const tag of [...repoIndex.byTag.keys()].sort()) {
        const releaseData = repoIndex.byTag.get(tag);
        if (!releaseData) continue;
        if (!isSupportedReleaseTag(tag)) continue;
        const hasZipAsset = Array.from(releaseData.assets.keys())
          .some((assetName) => assetName.toLowerCase().endsWith(".zip"));
        if (!hasZipAsset) continue;

        versionsChecked += 1;
        let adjustedTotal = 0;
        let sawClamped = false;
        const bucketInputs: D.DownloadVersionBucketInput[] = [];
        for (const [assetName, asset] of releaseData.assets.entries()) {
          if (!assetName.toLowerCase().endsWith(".zip")) continue;
          const key = toDownloadAttributionAssetKey(
            context.update.repo,
            tag,
            assetName,
            asset.assetNodeId,
          );
          const attributed = getAttributedCountForAssetKey(attributionLedger, attributionDelta, key);
          const adjusted = adjustDownloadCount(asset.downloadCount, attributed);
          adjustedTotal += adjusted.adjusted;
          adjustedDeltaTotal += adjusted.subtracted;
          bucketInputs.push({
            bucketKey: toDownloadAssetBucketKey(
              context.update.repo,
              tag,
              assetName,
              asset.assetNodeId,
            ),
            adjustedCount: adjusted.adjusted,
          });
          if (adjusted.clamped) {
            sawClamped = true;
            warnListing(
              warnings,
              id,
              `download attribution clamped '${assetName}' (raw=${adjusted.raw}, attributed=${adjusted.attributed}, adjusted=${adjusted.adjusted})`,
              tag,
            );
          }
        }
        if (sawClamped) {
          clampedVersions += 1;
        }
        downloadsByListing[id][tag] = adjustedTotal;
        versionBucketInputs[id][tag] = bucketInputs;
      }
      continue;
    }

    for (const candidate of context.update.versions) {
      if (!candidate.semver) continue;
      versionsChecked += 1;

      if (!candidate.parsed) {
        // A retired entry has no download by design, so reporting it every run
        // just echoes the author's own decision back at them.
        if (!candidate.retired) {
          warnListing(
            warnings,
            id,
            candidate.downloadUrl
              ? "skipped non-GitHub release download URL"
              : "skipped version with no download URL",
            candidate.version,
          );
        }
        continue;
      }

      const repoIndex = repoIndexes.get(candidate.parsed.repo);
      if (unavailableRepos.has(candidate.parsed.repo)) {
        const previousCount = previousDownloads[id]?.[candidate.version];
        if (typeof previousCount === "number") {
          downloadsByListing[id][candidate.version] = previousCount;
          warnListing(
            warnings,
            id,
            "preserved previous GitHub release download count (repo unavailable)",
            candidate.version,
          );
        } else {
          warnListing(warnings, id, "skipped (repo unavailable, no previous count to preserve)", candidate.version);
        }
        continue;
      }
      if (!repoIndex) {
        const previousCount = previousDownloads[id]?.[candidate.version];
        if (typeof previousCount === "number") {
          downloadsByListing[id][candidate.version] = previousCount;
          warnListing(
            warnings,
            id,
            "preserved previous GitHub release download count (repository not found or inaccessible)",
            candidate.version,
          );
        } else {
          warnListing(warnings, id, "skipped (repository not found or inaccessible, no previous count to preserve)", candidate.version);
        }
        continue;
      }
      const release = repoIndex.byTag.get(candidate.parsed.tag);
      if (!release) {
        warnListing(
          warnings,
          id,
          `skipped (tag '${candidate.parsed.tag}' not found)`,
          candidate.version,
        );
        continue;
      }
      const asset = release.assets.get(candidate.parsed.assetName);
      if (!asset) {
        warnListing(
          warnings,
          id,
          `skipped (asset '${candidate.parsed.assetName}' not found)`,
          candidate.version,
        );
        continue;
      }

      const key = toDownloadAttributionAssetKey(
        candidate.parsed.repo,
        candidate.parsed.tag,
        candidate.parsed.assetName,
        asset.assetNodeId,
      );
      const attributed = getAttributedCountForAssetKey(attributionLedger, attributionDelta, key);
      const adjusted = adjustDownloadCount(asset.downloadCount, attributed);
      adjustedDeltaTotal += adjusted.subtracted;
      if (adjusted.clamped) {
        clampedVersions += 1;
        warnListing(
          warnings,
          id,
          `download attribution clamped '${candidate.parsed.assetName}' (raw=${adjusted.raw}, attributed=${adjusted.attributed}, adjusted=${adjusted.adjusted})`,
          candidate.version,
        );
      }
      downloadsByListing[id][candidate.version] = adjusted.adjusted;
      versionBucketInputs[id][candidate.version] = [{
        bucketKey: toDownloadAssetBucketKey(
          candidate.parsed.repo,
          candidate.parsed.tag,
          candidate.parsed.assetName,
          asset.assetNodeId,
        ),
        adjustedCount: adjusted.adjusted,
      }];
    }
  }

  let filteredVersions = 0;
  if (hasIntegritySnapshot) {
    for (const id of [...ids].sort()) {
      const byVersion = downloadsByListing[id] ?? {};
      for (const version of Object.keys(byVersion)) {
        const versionIntegrity = integrity.listings[id]?.versions?.[version];
        if (versionIntegrity?.is_complete === true) {
          continue;
        }
        delete byVersion[version];
        delete versionBucketInputs[id]?.[version];
        filteredVersions += 1;
        const reason = versionIntegrity?.errors?.join("; ") || "missing integrity result in snapshot";
        warnListing(warnings, id, `excluded by integrity snapshot (${reason})`, version);
      }
    }
  } else {
    warnings.push("download-only mode: integrity snapshot missing; skipping integrity scrub");
  }

  const sortedDownloads: D.DownloadsByListing = {};
  for (const id of [...ids].sort()) {
    sortedDownloads[id] = sortObjectByKeys(downloadsByListing[id] ?? {});
  }

  let completeVersions = 0;
  let incompleteVersions = 0;
  for (const listing of Object.values(integrity.listings)) {
    for (const version of Object.values(listing.versions)) {
      if (version.is_complete) {
        completeVersions += 1;
      } else {
        incompleteVersions += 1;
      }
    }
  }

  return {
    downloads: sortedDownloads,
    versionBucketInputs,
    integrity,
    integrityCache: loadIntegrityCache(repoRoot, dir),
    integrityAlerts: [],
    stats: {
      listings: ids.length,
      versions_checked: versionsChecked,
      complete_versions: completeVersions,
      incomplete_versions: incompleteVersions,
      filtered_versions: filteredVersions,
      cache_hits: 0,
      registry_fetches_added: 0,
      adjusted_delta_total: adjustedDeltaTotal,
      clamped_versions: clampedVersions,
    },
    warnings,
    rateLimit: graphqlUsageSnapshot(usageState),
  };
}
