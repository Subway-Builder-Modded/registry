import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MapManifest } from "../manifests.js";
import {
  createGraphqlUsageState,
  fetchRepoReleaseIndexes,
  graphqlUsageSnapshot,
} from "../release-resolution.js";
import {
  recordDownloadAttributionFetchByAssetKey,
  recordDownloadAttributionFetchByUrl,
} from "../download-attribution.js";
import {
  buildGridCacheEntry,
  loadDemandStatsCache,
  shouldSkipUnchanged,
  writeDemandStatsCache,
  writeGridFile,
} from "./cache.js";
import { extractDemandStatsFromZipBuffer } from "./extraction.js";
import { applyDerivedFieldDefaults, getMapIds, getMapManifest } from "./repo.js";
import { inferPreferredGithubAssetName, initialViewStateEquals, warnListing } from "./shared.js";
import {
  fetchCustomInstallTargetZipUrl,
  fetchZipBuffer,
  getLatestGithubZipUrl,
  resolveZipUrlForMapSource,
} from "./source-resolution.js";
import type {
  DemandStats,
  GenerateMapDemandStatsOptions,
  GenerateMapDemandStatsResult,
  MapDemandExtractionResult,
  MapUpdateSource,
  ResolvedInstallTarget,
} from "./types.js";

function writeManifest(repoRoot: string, id: string, manifest: MapManifest): void {
  writeFileSync(
    resolve(repoRoot, "maps", id, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

export async function resolveAndExtractDemandStatsForMapSource(
  listingId: string,
  update: MapUpdateSource,
  options: {
    fetchImpl?: typeof fetch;
    token?: string;
    requireResidentTotalsMatch?: boolean;
    sourceUrl?: string;
    repoRoot?: string;
  } = {},
): Promise<DemandStats> {
  const warnings: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolvedSource = await resolveZipUrlForMapSource(
    listingId,
    options.sourceUrl,
    update,
    fetchImpl,
    options.token,
    warnings,
  );
  if (!resolvedSource) {
    throw new Error(warnings[0] ?? `listing=${listingId}: failed to resolve map ZIP URL`);
  }

  const zipBuffer = await fetchZipBuffer(listingId, resolvedSource.zipUrl, fetchImpl, warnings);
  if (!zipBuffer) {
    throw new Error(warnings[0] ?? `listing=${listingId}: failed to fetch map ZIP`);
  }

  const extraction = await extractDemandStatsFromZipBuffer(listingId, zipBuffer, {
    warnings,
    requireResidentTotalsMatch: options.requireResidentTotalsMatch,
  });
  for (const warning of warnings) {
    console.warn(`[map-demand-stats] ${warning}`);
  }
  return extraction.stats;
}

export async function generateMapDemandStats(
  options: GenerateMapDemandStatsOptions,
): Promise<GenerateMapDemandStatsResult> {
  const repoRoot = options.repoRoot;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token;
  const force = options.force === true;
  const strictFingerprintCache = options.strictFingerprintCache === true;
  const attributionDelta = options.attributionDelta;
  const mapId = typeof options.mapId === "string" && options.mapId.trim() !== ""
    ? options.mapId.trim()
    : undefined;
  const warnings: string[] = [];
  const allIds = getMapIds(repoRoot);
  if (mapId && !allIds.includes(mapId)) {
    throw new Error(`Map id '${mapId}' was not found in maps/index.json`);
  }
  const ids = mapId ? [mapId] : allIds;
  const cache = loadDemandStatsCache(repoRoot);
  const now = new Date();

  const manifests = new Map<string, MapManifest>();
  const githubRepos = new Set<string>();

  for (const id of ids) {
    try {
      const manifest = getMapManifest(repoRoot, id);
      manifests.set(id, manifest);
      if (manifest.update.type === "github") {
        githubRepos.add(manifest.update.repo.toLowerCase());
      }
    } catch (error) {
      warnListing(warnings, id, `failed to read map manifest (${(error as Error).message})`);
    }
  }

  const usageState = createGraphqlUsageState();
  const { repoIndexes } = await fetchRepoReleaseIndexes(githubRepos, {
    fetchImpl,
    token,
    warnings,
    usageState,
  });

  let processedMaps = 0;
  let updatedMaps = 0;
  let gridFilesWritten = 0;
  let skippedMaps = 0;
  let skippedUnchanged = 0;
  let extractionFailures = 0;
  let residentsDeltaTotal = 0;
  let attributionFetchesAdded = 0;

  for (const id of ids) {
    processedMaps += 1;
    const manifest = manifests.get(id);
    if (!manifest) {
      skippedMaps += 1;
      extractionFailures += 1;
      continue;
    }

    let resolvedSource: ResolvedInstallTarget | null = null;
    if (manifest.update.type === "github") {
      resolvedSource = getLatestGithubZipUrl(
        id,
        manifest.update.repo,
        repoIndexes,
        warnings,
        inferPreferredGithubAssetName(manifest.source, manifest.update.repo),
      );
    } else {
      resolvedSource = await fetchCustomInstallTargetZipUrl(id, manifest.update.url, fetchImpl, warnings);
    }

    if (!resolvedSource) {
      skippedMaps += 1;
      extractionFailures += 1;
      if (applyDerivedFieldDefaults(manifest)) {
        writeManifest(repoRoot, id, manifest);
        updatedMaps += 1;
      }
      continue;
    }

    if (!force && shouldSkipUnchanged(
      repoRoot,
      id,
      cache[id],
      resolvedSource.sourceFingerprint,
      now,
      strictFingerprintCache,
    )) {
      skippedMaps += 1;
      skippedUnchanged += 1;
      const cachedStats = cache[id]?.stats;
      if (cachedStats) {
        const oldResidents = Number.isFinite(manifest.residents_total)
          ? manifest.residents_total
          : (Number.isFinite(manifest.population) ? manifest.population : 0);
        const changed = (
          manifest.population !== cachedStats.residents_total
          || manifest.residents_total !== cachedStats.residents_total
          || manifest.points_count !== cachedStats.points_count
          || manifest.population_count !== cachedStats.population_count
          || !initialViewStateEquals(manifest.initial_view_state, cachedStats.initial_view_state)
        );
        if (changed) {
          manifest.population = cachedStats.residents_total;
          manifest.residents_total = cachedStats.residents_total;
          manifest.points_count = cachedStats.points_count;
          manifest.population_count = cachedStats.population_count;
          manifest.initial_view_state = cachedStats.initial_view_state;
          writeManifest(repoRoot, id, manifest);
          updatedMaps += 1;
          residentsDeltaTotal += cachedStats.residents_total - oldResidents;
        }
      }
      continue;
    }

    const zipBuffer = await fetchZipBuffer(
      id,
      resolvedSource.zipUrl,
      fetchImpl,
      warnings,
      (downloadUrl) => {
        if (!attributionDelta) return;
        if (resolvedSource.attributionAssetKey) {
          recordDownloadAttributionFetchByAssetKey(
            attributionDelta,
            resolvedSource.attributionAssetKey,
          );
          attributionFetchesAdded += 1;
          return;
        }
        const recorded = recordDownloadAttributionFetchByUrl(attributionDelta, downloadUrl);
        if (!recorded.ok) {
          warnListing(
            warnings,
            id,
            `download attribution key is unparseable for fetched ZIP (${recorded.reason ?? "unknown reason"})`,
          );
          return;
        }
        attributionFetchesAdded += 1;
      },
    );
    if (!zipBuffer) {
      skippedMaps += 1;
      extractionFailures += 1;
      if (applyDerivedFieldDefaults(manifest)) {
        writeManifest(repoRoot, id, manifest);
        updatedMaps += 1;
      }
      continue;
    }

    let extraction: MapDemandExtractionResult;
    try {
      extraction = await extractDemandStatsFromZipBuffer(id, zipBuffer, { warnings });
      writeGridFile(repoRoot, id, extraction.grid);
      gridFilesWritten += 1;
    } catch (error) {
      warnListing(warnings, id, String((error as Error).message));
      skippedMaps += 1;
      extractionFailures += 1;
      if (applyDerivedFieldDefaults(manifest)) {
        writeManifest(repoRoot, id, manifest);
        updatedMaps += 1;
      }
      continue;
    }

    const oldResidents = Number.isFinite(manifest.residents_total)
      ? manifest.residents_total
      : (Number.isFinite(manifest.population) ? manifest.population : 0);
    const stats = extraction.stats;
    const changed = (
      manifest.population !== stats.residents_total
      || manifest.residents_total !== stats.residents_total
      || manifest.points_count !== stats.points_count
      || manifest.population_count !== stats.population_count
      || !initialViewStateEquals(manifest.initial_view_state, stats.initial_view_state)
    );

    manifest.population = stats.residents_total;
    manifest.residents_total = stats.residents_total;
    manifest.points_count = stats.points_count;
    manifest.population_count = stats.population_count;
    manifest.initial_view_state = stats.initial_view_state;
    cache[id] = {
      source_fingerprint: resolvedSource.sourceFingerprint,
      last_checked_at: now.toISOString(),
      stats,
      grid: buildGridCacheEntry(),
    };

    if (changed) {
      writeManifest(repoRoot, id, manifest);
      updatedMaps += 1;
      residentsDeltaTotal += stats.residents_total - oldResidents;
    }
  }

  writeDemandStatsCache(repoRoot, cache);

  return {
    processedMaps,
    updatedMaps,
    gridFilesWritten,
    skippedMaps,
    skippedUnchanged,
    extractionFailures,
    residentsDeltaTotal,
    attributionFetchesAdded,
    warnings,
    rateLimit: graphqlUsageSnapshot(usageState),
  };
}
