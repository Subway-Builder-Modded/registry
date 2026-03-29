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
import {
  type ListingContext,
  emptyIntegrity,
  fetchCustomVersions,
  getDirectoryForType,
  getIndexIds,
  getManifest,
  loadIntegrityCache,
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
  const integrity = loadedIntegrity ?? emptyIntegrity(nowIso);
  const hasIntegritySnapshot = loadedIntegrity !== null && Object.keys(loadedIntegrity.listings).length > 0;

  const downloadsByListing: D.DownloadsByListing = {};
  const listingContexts = new Map<string, ListingContext>();
  const repoSet = new Set<string>();

  for (const id of ids) {
    downloadsByListing[id] = {};
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
      listingContexts.set(id, {
        id,
        listingType,
        cityCode: listingType === "map" ? (manifest as MapManifest).city_code : undefined,
        update: { type: "github", repo },
      });
      continue;
    }

    const customVersions = await fetchCustomVersions(id, manifest.update.url, fetchImpl, warnings);
    for (const version of customVersions) {
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
        versions: customVersions,
      },
    });
  }

  const usageState = createGraphqlUsageState();
  const { repoIndexes } = await fetchRepoReleaseIndexes(repoSet, {
    fetchImpl,
    token,
    warnings,
    usageState,
  });

  let versionsChecked = 0;
  let adjustedDeltaTotal = 0;
  let clampedVersions = 0;

  for (const id of [...ids].sort()) {
    console.log(`[downloads] heartbeat:listing mode=download-only listing=${id}`);
    const context = listingContexts.get(id);
    if (!context) continue;

    if (context.update.type === "github") {
      const repoIndex = repoIndexes.get(context.update.repo);
      if (!repoIndex) {
        warnListing(warnings, id, "skipped all github-release versions (repo unavailable)");
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
        for (const [assetName, asset] of releaseData.assets.entries()) {
          if (!assetName.toLowerCase().endsWith(".zip")) continue;
          const key = toDownloadAttributionAssetKey(context.update.repo, tag, assetName);
          const attributed = getAttributedCountForAssetKey(attributionLedger, attributionDelta, key);
          const adjusted = adjustDownloadCount(asset.downloadCount, attributed);
          adjustedTotal += adjusted.adjusted;
          adjustedDeltaTotal += adjusted.subtracted;
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
      }
      continue;
    }

    for (const candidate of context.update.versions) {
      if (!candidate.semver) continue;
      versionsChecked += 1;

      if (!candidate.parsed) {
        warnListing(
          warnings,
          id,
          "skipped non-GitHub release download URL",
          candidate.version,
        );
        continue;
      }

      const repoIndex = repoIndexes.get(candidate.parsed.repo);
      if (!repoIndex) {
        warnListing(warnings, id, "skipped (repo unavailable)", candidate.version);
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
    integrity,
    integrityCache: loadIntegrityCache(repoRoot, dir),
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
