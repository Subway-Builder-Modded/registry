import type * as D from "../download-definitions.js";
import {
  createGraphqlUsageState,
  fetchRepoReleaseIndexes,
  isSupportedReleaseTag,
  parseGitHubReleaseAssetDownloadUrl,
} from "../release-resolution.js";
import { fetchWithTimeout } from "../http.js";
import { toDownloadAttributionAssetKey } from "../download-attribution.js";
import { MAP_DEMAND_FETCH_TIMEOUT_MS } from "./constants.js";
import { compareSemverDescending, inferPreferredGithubAssetName, isObject, warnListing } from "./shared.js";
import type { JsonObject, MapUpdateSource, ResolvedInstallTarget } from "./types.js";

export async function fetchCustomInstallTargetZipUrl(
  listingId: string,
  updateUrl: string,
  fetchImpl: typeof fetch,
  warnings: string[],
): Promise<ResolvedInstallTarget | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      updateUrl,
      { headers: { Accept: "application/json" } },
      {
        timeoutMs: MAP_DEMAND_FETCH_TIMEOUT_MS,
        heartbeatPrefix: "[map-demand-stats]",
        heartbeatLabel: `fetch-custom-update listing=${listingId}`,
      },
    );
  } catch (error) {
    warnListing(warnings, listingId, `custom update JSON fetch failed (${(error as Error).message})`);
    return null;
  }

  if (!response.ok) {
    warnListing(warnings, listingId, `custom update JSON returned HTTP ${response.status}`);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    warnListing(warnings, listingId, "custom update JSON is not valid JSON");
    return null;
  }

  if (!isObject(body)) {
    warnListing(warnings, listingId, "custom update JSON must be an object");
    return null;
  }

  const versions = body.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    warnListing(warnings, listingId, "custom update JSON missing non-empty versions array");
    return null;
  }

  const candidates = versions
    .filter((entry): entry is JsonObject => isObject(entry))
    .map((entry) => {
      const download = typeof entry.download === "string" ? entry.download.trim() : "";
      const version = typeof entry.version === "string" ? entry.version.trim() : "";
      const sha256 = typeof entry.sha256 === "string" ? entry.sha256.trim() : "";
      return { download, version, sha256 };
    })
    .filter((entry) => entry.download !== "");

  if (candidates.length === 0) {
    warnListing(warnings, listingId, "custom update JSON has no version entry with download URL");
    return null;
  }

  const semverCandidates = candidates
    .filter((candidate) => candidate.version !== "" && isSupportedReleaseTag(candidate.version))
    .sort((a, b) => compareSemverDescending(a.version, b.version));
  const chosen = semverCandidates.length > 0 ? semverCandidates[0] : candidates[0];
  const sha256 = chosen.sha256 !== "" ? chosen.sha256 : null;

  return {
    zipUrl: chosen.download,
    sourceFingerprint: sha256
      ? `sha256:${sha256}`
      : `custom:${chosen.version}|${chosen.download}`,
    attributionAssetKey: (() => {
      const parsed = parseGitHubReleaseAssetDownloadUrl(chosen.download);
      if (!parsed) return undefined;
      return toDownloadAttributionAssetKey(parsed.repo, parsed.tag, parsed.assetName);
    })(),
  };
}

export function getLatestGithubZipUrl(
  listingId: string,
  repo: string,
  repoIndexes: Map<string, D.RepoReleaseIndex>,
  warnings: string[],
  preferredAssetName?: string | null,
): ResolvedInstallTarget | null {
  const index = repoIndexes.get(repo.toLowerCase());
  if (!index) {
    warnListing(warnings, listingId, `skipped map stats extraction (repo unavailable: ${repo})`);
    return null;
  }

  const firstTagEntry = index.byTag.entries().next();
  if (firstTagEntry.done) {
    warnListing(warnings, listingId, `skipped map stats extraction (no releases in repo: ${repo})`);
    return null;
  }

  const [tag, releaseData] = firstTagEntry.value;
  if (preferredAssetName) {
    const normalizedPreferredAssetName = preferredAssetName.toLowerCase();
    for (const [assetName, asset] of releaseData.assets.entries()) {
      if (assetName.toLowerCase() !== normalizedPreferredAssetName) continue;
      if (!assetName.toLowerCase().endsWith(".zip")) {
        warnListing(warnings, listingId, `preferred asset '${assetName}' in latest release '${tag}' is not a .zip`);
        return null;
      }
      if (!asset.downloadUrl || asset.downloadUrl.trim() === "") {
        warnListing(warnings, listingId, `preferred asset '${assetName}' in latest release '${tag}' is missing download URL`);
        return null;
      }
      return {
        zipUrl: asset.downloadUrl,
        sourceFingerprint: `github:${tag}|${assetName}`,
        attributionAssetKey: toDownloadAttributionAssetKey(repo.toLowerCase(), tag, assetName),
      };
    }
    warnListing(
      warnings,
      listingId,
      `preferred asset '${preferredAssetName}' not found in latest release '${tag}'; falling back to first .zip asset`,
    );
  }

  for (const [assetName, asset] of releaseData.assets.entries()) {
    if (!assetName.toLowerCase().endsWith(".zip")) continue;
    if (!asset.downloadUrl || asset.downloadUrl.trim() === "") {
      warnListing(warnings, listingId, `latest release '${tag}' zip asset '${assetName}' missing download URL`);
      return null;
    }
    return {
      zipUrl: asset.downloadUrl,
      sourceFingerprint: `github:${tag}|${assetName}`,
      attributionAssetKey: toDownloadAttributionAssetKey(repo.toLowerCase(), tag, assetName),
    };
  }

  warnListing(warnings, listingId, `latest release '${tag}' has no .zip asset`);
  return null;
}

export async function fetchZipBuffer(
  listingId: string,
  zipUrl: string,
  fetchImpl: typeof fetch,
  warnings: string[],
  attributionRecorder?: (downloadUrl: string) => void,
): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      zipUrl,
      undefined,
      {
        timeoutMs: MAP_DEMAND_FETCH_TIMEOUT_MS,
        heartbeatPrefix: "[map-demand-stats]",
        heartbeatLabel: `fetch-zip listing=${listingId}`,
      },
    );
  } catch (error) {
    warnListing(warnings, listingId, `failed to fetch map ZIP (${(error as Error).message})`);
    return null;
  }

  if (!response.ok) {
    warnListing(warnings, listingId, `failed to fetch map ZIP (HTTP ${response.status})`);
    return null;
  }

  try {
    const bytes = await response.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const signature = buffer.subarray(0, 4).toString("hex");
    const looksLikeZip = (
      signature === "504b0304"
      || signature === "504b0506"
      || signature === "504b0708"
    );
    if (!looksLikeZip) {
      const contentType = response.headers.get("content-type") ?? "unknown";
      warnListing(
        warnings,
        listingId,
        `fetched payload is not a ZIP (content-type '${contentType}', first-bytes '${signature}', url '${response.url || zipUrl}')`,
      );
      return null;
    }
    attributionRecorder?.(zipUrl);
    return buffer;
  } catch {
    warnListing(warnings, listingId, "failed to read map ZIP response body");
    return null;
  }
}

export async function resolveZipUrlForMapSource(
  listingId: string,
  manifestSource: string | undefined,
  update: MapUpdateSource,
  fetchImpl: typeof fetch,
  token: string | undefined,
  warnings: string[],
): Promise<ResolvedInstallTarget | null> {
  if (update.type === "custom") {
    return fetchCustomInstallTargetZipUrl(listingId, update.url, fetchImpl, warnings);
  }

  const usageState = createGraphqlUsageState();
  const { repoIndexes } = await fetchRepoReleaseIndexes([update.repo], {
    fetchImpl,
    token,
    warnings,
    usageState,
  });
  return getLatestGithubZipUrl(
    listingId,
    update.repo,
    repoIndexes,
    warnings,
    inferPreferredGithubAssetName(manifestSource, update.repo),
  );
}
