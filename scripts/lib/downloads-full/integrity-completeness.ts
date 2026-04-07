import type * as D from "../download-definitions.js";
import type {
  IntegrityCacheEntry,
  IntegrityVersionEntry,
  IntegritySource,
  ZipCompletenessResult,
} from "../integrity.js";
import { inspectZipCompleteness } from "../integrity.js";
import type { LoadedSecurityRules } from "../mod-security.js";
import { normalizeStableSemverTag } from "../semver.js";
import {
  bytesToMebibytesRounded,
  type CustomVersionCandidate,
  buildIncompleteVersionEntry,
  fetchZipBuffer,
  warnListing,
  withCheckResult,
} from "../downloads-support.js";

const INTEGRITY_RULES_VERSION = "v4";

function applyVersionTagCheck(
  check: ZipCompletenessResult,
  releaseTag: string,
  listingType: D.GenerateDownloadsOptions["listingType"],
): ZipCompletenessResult {
  if (listingType !== "mod") return check;
  const normalizedTag = normalizeStableSemverTag(releaseTag);
  if (!normalizedTag) return check;

  const manifestVersion = check.manifestVersion ?? null;
  const normalizedManifestVersion = manifestVersion ? normalizeStableSemverTag(manifestVersion) : null;
  const versionMatches = normalizedManifestVersion !== null && normalizedManifestVersion === normalizedTag;

  const errors = versionMatches
    ? check.errors
    : [
      ...check.errors,
      `manifest.json version '${manifestVersion ?? "(missing)"}' does not match release tag '${releaseTag}'`
      + ` (expected '${normalizedTag}')`,
    ];

  return {
    ...check,
    isComplete: versionMatches ? check.isComplete : false,
    errors,
    requiredChecks: {
      ...check.requiredChecks,
      manifest_version_matches_tag: versionMatches,
    },
    matchedFiles: {
      ...check.matchedFiles,
      manifest_version_matches_tag: versionMatches ? "manifest.json" : null,
    },
  };
}

export function versionedFingerprint(base: string): string {
  return `rules:${INTEGRITY_RULES_VERSION}:${base}`;
}

export function isLegacyMapCacheMissingFileSizes(
  listingType: D.GenerateDownloadsOptions["listingType"],
  cacheEntry: IntegrityCacheEntry | undefined,
): boolean {
  if (listingType !== "map" || !cacheEntry) return false;
  if (cacheEntry.result.is_complete !== true) return false;
  const fileSizes = cacheEntry.result.file_sizes;
  return !fileSizes || Object.keys(fileSizes).length === 0;
}

export function releaseSizeFromBytes(sizeBytes: number | null | undefined): number | undefined {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return undefined;
  return bytesToMebibytesRounded(sizeBytes);
}

export function withReleaseSizeIfMissing(
  result: IntegrityVersionEntry,
  releaseSize: number | undefined,
): IntegrityVersionEntry {
  if (result.release_size !== undefined || releaseSize === undefined) return result;
  return {
    ...result,
    release_size: releaseSize,
  };
}

export function resolveExpectedCustomReleaseManifestAssetName(
  candidate: CustomVersionCandidate,
  warnings: string[],
  listingId: string,
): string {
  if (!candidate.parsedManifest) {
    return "manifest.json";
  }
  if (!candidate.parsed) {
    return "manifest.json";
  }

  const manifestRepo = candidate.parsedManifest.repo;
  const manifestTag = candidate.parsedManifest.tag;
  if (manifestRepo !== candidate.parsed.repo || manifestTag !== candidate.parsed.tag) {
    warnListing(
      warnings,
      listingId,
      `manifest URL targets ${manifestRepo}@${manifestTag} but download URL targets ${candidate.parsed.repo}@${candidate.parsed.tag}; falling back to manifest.json release-asset check`,
      candidate.version,
    );
    return "manifest.json";
  }

  return candidate.parsedManifest.assetName;
}

export interface InspectZipMemoResult {
  check: ZipCompletenessResult;
  releaseSizeMiB: number;
  fromMemo: boolean;
}

function buildInspectionMemoKey(args: {
  listingId: string;
  listingType: D.GenerateDownloadsOptions["listingType"];
  cityCode: string | undefined;
  downloadUrl: string;
  assetName: string;
  releaseHasManifestAsset: boolean;
  expectedReleaseManifestAssetName: string;
  securityFingerprint: string;
}): string {
  return [
    `listing=${args.listingId}`,
    `type=${args.listingType}`,
    `city=${args.cityCode ?? ""}`,
    `url=${args.downloadUrl}`,
    `asset=${args.assetName}`,
    `releaseManifest=${args.releaseHasManifestAsset ? "1" : "0"}`,
    `expectedManifest=${args.expectedReleaseManifestAssetName}`,
    `security=${args.securityFingerprint}`,
  ].join("|");
}

export function createInspectZipWithMemo(options: {
  listingId: string;
  listingType: D.GenerateDownloadsOptions["listingType"];
  cityCode: string | undefined;
  nowIso: string;
  warnings: string[];
  fetchImpl: typeof fetch;
  modSecurityRules: LoadedSecurityRules | null;
  securityFingerprint: string;
  attributionRecorder?: (params: {
    version: string;
    assetName: string;
    downloadUrl: string;
  }) => void;
}): (params: {
  version: string;
  assetName: string;
  downloadUrl: string;
  releaseHasManifestAsset: boolean;
  expectedReleaseManifestAssetName?: string;
}) => Promise<{ ok: true; value: InspectZipMemoResult } | { ok: false; error: string }> {
  const inspectionMemo = new Map<string, InspectZipMemoResult>();

  return async (params) => {
    const expectedReleaseManifestAssetName = (
      typeof params.expectedReleaseManifestAssetName === "string"
      && params.expectedReleaseManifestAssetName.trim() !== ""
    )
      ? params.expectedReleaseManifestAssetName.trim()
      : "manifest.json";
    const memoKey = buildInspectionMemoKey({
      listingId: options.listingId,
      listingType: options.listingType,
      cityCode: options.cityCode,
      downloadUrl: params.downloadUrl,
      assetName: params.assetName,
      releaseHasManifestAsset: params.releaseHasManifestAsset,
      expectedReleaseManifestAssetName,
      securityFingerprint: options.securityFingerprint,
    });
    const memoEntry = inspectionMemo.get(memoKey);
    if (memoEntry) {
      const check = applyVersionTagCheck(memoEntry.check, params.version, options.listingType);
      return { ok: true, value: { ...memoEntry, check, fromMemo: true } };
    }

    const zipBuffer = await fetchZipBuffer(
      options.listingId,
      params.downloadUrl,
      options.fetchImpl,
      options.warnings,
      params.version,
      params.assetName,
      (downloadUrl) => options.attributionRecorder?.({
        version: params.version,
        assetName: params.assetName,
        downloadUrl,
      }),
    );
    if (!zipBuffer) {
      return { ok: false, error: `zip asset '${params.assetName}' could not be fetched` };
    }
    const releaseSizeMiB = bytesToMebibytesRounded(zipBuffer.byteLength);
    let check: ZipCompletenessResult;
    const inspectHeartbeatLabel = `inspect-zip listing=${options.listingId} version=${params.version} asset=${params.assetName}`;
    const inspectStartMs = Date.now();
    console.log(`[downloads] heartbeat:start ${inspectHeartbeatLabel}`);
    try {
      check = await inspectZipCompleteness(options.listingType, zipBuffer, {
        cityCode: options.cityCode,
        releaseHasManifestAsset: params.releaseHasManifestAsset,
        expectedReleaseManifestAssetName,
        modSecurityRules: options.modSecurityRules?.rules,
      });
      console.log(
        `[downloads] heartbeat:end ${inspectHeartbeatLabel} durationMs=${Date.now() - inspectStartMs}`,
      );
    } catch (error) {
      console.log(
        `[downloads] heartbeat:error ${inspectHeartbeatLabel} durationMs=${Date.now() - inspectStartMs}`,
      );
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `integrity inspection failed (${message})` };
    }

    const value: InspectZipMemoResult = {
      check,
      releaseSizeMiB,
      fromMemo: false,
    };
    inspectionMemo.set(memoKey, value);
    const tagChecked = applyVersionTagCheck(check, params.version, options.listingType);
    return { ok: true, value: { ...value, check: tagChecked } };
  };
}

export function buildIncompleteInspectionResult(
  sourceBase: IntegritySource,
  fingerprint: string,
  nowIso: string,
  errorMessage: string,
  releaseSizeMiB?: number,
): IntegrityVersionEntry {
  return buildIncompleteVersionEntry(
    sourceBase,
    fingerprint,
    nowIso,
    [errorMessage],
    {},
    {},
    releaseSizeMiB,
  );
}

export function buildInspectionResult(
  check: ZipCompletenessResult,
  source: IntegritySource,
  fingerprint: string,
  nowIso: string,
  releaseSizeMiB: number,
): IntegrityVersionEntry {
  return withCheckResult(
    check,
    source,
    fingerprint,
    nowIso,
    releaseSizeMiB,
  );
}
