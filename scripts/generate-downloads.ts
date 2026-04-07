import { readFileSync } from "node:fs";
import { writeJsonFile } from "./lib/json-utils.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeAnnouncement } from "./make-announcement.js";
import { generateDownloadsData } from "./lib/downloads.js";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
  writeDownloadAttributionDeltaFile,
} from "./lib/download-attribution.js";
import {
  applyVersionBucketMonotonicCounts,
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
} from "./lib/download-version-buckets.js";
import {
  loadGrandfatheredDownloads,
  mergeGrandfatheredDownloads,
} from "./lib/grandfathered-downloads.js";
import type { IntegrityOutput } from "./lib/integrity.js";
import type { ManifestType } from "./lib/manifests.js";
import type { SecurityFinding } from "./lib/mod-security.js";
import {
  appendGitHubOutput,
  getNonEmptyEnv,
  isTruthyEnv,
  resolveRepoRoot,
  runAndExitOnError,
} from "./lib/script-runtime.js";
import { compareStableSemverAsc, isStableSemverTag } from "./lib/semver.js";
import { filterListingMessages, isTestListing } from "./lib/test-listings.js";

export function getAnnouncementListingIds(
  newIntegrity: IntegrityOutput,
  previousIntegrity: IntegrityOutput,
): string[] {
  return Object.entries(newIntegrity.listings)
    .filter(([, listing]) => listing.has_complete_version)
    .filter(([id]) => !previousIntegrity.listings[id]?.has_complete_version)
    .map(([id]) => id);
}

export function listZeroValidSemverListings(integrity: IntegrityOutput): string[] {
  return Object.entries(integrity.listings)
    .filter(([, listing]) => listing.latest_semver_version === null && Object.keys(listing.versions).length > 0)
    .map(([id]) => id)
    .sort();
}

export function buildZeroValidSemverWarnings(integrity: IntegrityOutput): string[] {
  return listZeroValidSemverListings(integrity)
    .map((listingId) => `listing=${listingId}: no valid semver release tags found`);
}

async function announceNewAssets(
  newIntegrity: IntegrityOutput,
  integrityPath: string,
  listingType: ManifestType,
  repoRoot: string,
): Promise<void> {
  let previousIntegrity: IntegrityOutput = {
    schema_version: 1,
    generated_at: "",
    listings: {},
  };
  try {
    const previousIntegrityContent = readFileSync(integrityPath, "utf8");
    previousIntegrity = JSON.parse(previousIntegrityContent) as IntegrityOutput;
  } catch {
    // No prior integrity file is acceptable on first run.
  }

  const newListings = getAnnouncementListingIds(newIntegrity, previousIntegrity);
  for (const listingId of newListings) {
    if (isTestListing(repoRoot, listingType === "map" ? "maps" : "mods", listingId)) {
      continue;
    }
    const manifestPath = resolve(
      repoRoot,
      listingType === "map" ? "maps" : "mods",
      listingId,
      "manifest.json",
    );
    try {
      await makeAnnouncement(manifestPath);
    } catch (error) {
      console.warn(
        `[downloads] announcement skipped for ${listingId} (${(error as Error).message})`,
      );
    }
  }
}

function getArgValue(name: string): string | undefined {
  const exact = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(exact)) {
      return arg.slice(exact.length);
    }
  }

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--${name}`) {
      return args[index + 1];
    }
  }
  return undefined;
}

function hasArgFlag(name: string): boolean {
  const target = `--${name}`;
  return process.argv.slice(2).includes(target);
}

function resolveListingType(rawValue: string | undefined): ManifestType {
  if (rawValue === "map" || rawValue === "mod") {
    return rawValue;
  }
  throw new Error("Missing or invalid --type. Expected one of: map, mod");
}

function resolveMode(rawValue: string | undefined): "full" | "download-only" {
  if (!rawValue || rawValue.trim() === "") return "full";
  if (rawValue === "full" || rawValue === "download-only") {
    return rawValue;
  }
  throw new Error("Missing or invalid --mode. Expected one of: full, download-only");
}

function toWarningsOutputJson(listingType: ManifestType, warnings: string[]): string {
  const MAX_WARNINGS = 30;
  const normalized = warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning !== "")
    .map((warning) => `${listingType}: ${warning}`);
  const displayed = normalized.slice(0, MAX_WARNINGS);
  if (normalized.length > displayed.length) {
    displayed.push(`...and ${normalized.length - displayed.length} more warnings`);
  }
  return JSON.stringify(displayed);
}

function toLimitedOutputJson(items: string[]): string {
  const MAX_ITEMS = 30;
  const normalized = items
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const displayed = normalized.slice(0, MAX_ITEMS);
  if (normalized.length > displayed.length) {
    displayed.push(`...and ${normalized.length - displayed.length} more`);
  }
  return JSON.stringify(displayed);
}

interface ParsedListingWarning {
  listingId: string;
  version: string | null;
}

function parseListingWarning(warning: string): ParsedListingWarning | null {
  const withVersion = warning.match(/^listing=([^ ]+)\s+version=([^:]+):/);
  if (withVersion) {
    return {
      listingId: withVersion[1],
      version: withVersion[2],
    };
  }
  const listingOnly = warning.match(/^listing=([^:]+):/);
  if (listingOnly) {
    return {
      listingId: listingOnly[1],
      version: null,
    };
  }
  return null;
}

function filterWarningsForGitHub(
  warnings: string[],
  integrity: IntegrityOutput,
): string[] {
  if (Object.keys(integrity.listings).length === 0) return warnings;

  return warnings.filter((warning) => {
    const parsed = parseListingWarning(warning);
    if (!parsed || !parsed.version) return true;
    if (!isStableSemverTag(parsed.version)) return true;

    const listingIntegrity = integrity.listings[parsed.listingId];
    if (!listingIntegrity) return true;

    const latestSemverVersion = listingIntegrity.latest_semver_version;
    if (latestSemverVersion && parsed.version === latestSemverVersion) {
      return true;
    }

    const latestValidVersion = listingIntegrity.complete_versions.find((version) => isStableSemverTag(version)) ?? null;
    if (!latestValidVersion) {
      return false;
    }

    return compareStableSemverAsc(parsed.version, latestValidVersion) > 0;
  });
}

interface SecurityAlerts {
  errors: string[];
  warnings: string[];
}

function formatSecurityAlert(listingId: string, version: string, findings: SecurityFinding[]): string {
  const uniqueRuleIds = [...new Set(findings.map((finding) => finding.rule_id))];
  const uniqueFiles = [...new Set(findings.map((finding) => finding.file))];
  return `listing=${listingId} version=${version}: rules=${uniqueRuleIds.join(", ")} files=${uniqueFiles.join(", ")}`;
}

function collectSecurityAlerts(integrity: IntegrityOutput, listingType: ManifestType): SecurityAlerts {
  if (listingType !== "mod") {
    return { errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const listingId of Object.keys(integrity.listings).sort()) {
    const listing = integrity.listings[listingId];
    const latestVersion = listing.latest_semver_version;
    if (!latestVersion) continue;

    const versionEntry = listing.versions[latestVersion];
    const findings = versionEntry?.security_issue?.findings ?? [];
    if (findings.length === 0) continue;

    const errorFindings = findings.filter((finding) => finding.severity === "ERROR");
    if (errorFindings.length > 0) {
      errors.push(formatSecurityAlert(listingId, latestVersion, errorFindings));
    }

    const warningFindings = findings.filter((finding) => finding.severity === "WARNING");
    if (warningFindings.length > 0) {
      warnings.push(formatSecurityAlert(listingId, latestVersion, warningFindings));
    }
  }

  return { errors, warnings };
}

async function run(): Promise<void> {
  const listingType = resolveListingType(
    getArgValue("type") ?? process.env.LISTING_TYPE,
  );
  const mode = resolveMode(getArgValue("mode") ?? process.env.DOWNLOADS_MODE);
  const strictFingerprintCache = (
    hasArgFlag("strict-fingerprint-cache")
    || isTruthyEnv(process.env.STRICT_FINGERPRINT_CACHE)
    || isTruthyEnv(process.env.REGISTRY_STRICT_FINGERPRINT_CACHE)
  );
  const forceIntegrityRecheck = (
    hasArgFlag("force")
    || hasArgFlag("force-integrity")
    || isTruthyEnv(process.env.FORCE_INTEGRITY_RECHECK)
  );
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const runId = getNonEmptyEnv("GITHUB_RUN_ID") ?? "local";
  const jobId = getNonEmptyEnv("GITHUB_JOB") ?? "manual";
  const workflowName = getNonEmptyEnv("GITHUB_WORKFLOW") ?? "local";
  const attributionLedger = loadDownloadAttributionLedger(repoRoot);
  const versionBucketLedger = loadDownloadVersionBucketLedger(repoRoot, listingType);
  const outputDir = listingType === "map" ? "maps" : "mods";
  const outputPath = resolve(repoRoot, outputDir, "downloads.json");
  const defaultAttributionDeltaPath = resolve(repoRoot, outputDir, "download-attribution-delta.json");
  const attributionDeltaPath = (
    getArgValue("attribution-delta-path")
    ?? getNonEmptyEnv("DOWNLOAD_ATTRIBUTION_DELTA_PATH")
    ?? defaultAttributionDeltaPath
  );
  const attributionDelta = createDownloadAttributionDelta(
    `workflow:${workflowName}:${listingType}:${mode}`,
    `${runId}:${jobId}:${listingType}:${mode}`,
  );
  const ghDownloadsToken = getNonEmptyEnv("GH_DOWNLOADS_TOKEN");
  const githubToken = getNonEmptyEnv("GITHUB_TOKEN");
  const token = ghDownloadsToken ?? githubToken;
  const tokenSource = ghDownloadsToken
    ? "GH_DOWNLOADS_TOKEN"
    : (githubToken ? "GITHUB_TOKEN" : "none");
  console.log(`[downloads] Auth token source: ${tokenSource}`);
  if (!token) {
    console.warn(
      "[downloads] No non-empty GitHub token configured (GH_DOWNLOADS_TOKEN/GITHUB_TOKEN). GraphQL requests are likely to fail with 401.",
    );
  }

  const {
    downloads: rawDownloads,
    versionBucketInputs,
    integrity,
    integrityCache,
    stats,
    warnings,
    rateLimit,
  } = await generateDownloadsData({
    repoRoot,
    listingType,
    mode,
    strictFingerprintCache,
    forceIntegrityRecheck,
    token,
    attribution: {
      ledger: attributionLedger,
      delta: attributionDelta,
    },
    versionBuckets: {
      ledger: versionBucketLedger,
    },
  });
  const securityAlerts = collectSecurityAlerts(integrity, listingType);

  const bucketDownloads = applyVersionBucketMonotonicCounts(
    versionBucketLedger,
    rawDownloads,
    versionBucketInputs,
  );

  const grandfathered = loadGrandfatheredDownloads(repoRoot, listingType);
  const downloads = mergeGrandfatheredDownloads(bucketDownloads, grandfathered);

  const integrityPath = resolve(repoRoot, outputDir, "integrity.json");
  const integrityCachePath = resolve(repoRoot, outputDir, "integrity-cache.json");
  writeJsonFile(outputPath, downloads);
  writeDownloadVersionBucketLedger(repoRoot, listingType, versionBucketLedger);
  if (mode === "full") {
    await announceNewAssets(integrity, integrityPath, listingType, repoRoot);
    writeJsonFile(integrityPath, integrity);
    writeJsonFile(integrityCachePath, integrityCache);
    writeDownloadAttributionDeltaFile(attributionDeltaPath, attributionDelta);
  }

  for (const warning of warnings) {
    console.warn(`[downloads] ${warning}`);
  }
  for (const securityError of securityAlerts.errors) {
    console.warn(`[downloads][security][ERROR] ${securityError}`);
  }
  for (const securityWarning of securityAlerts.warnings) {
    console.warn(`[downloads][security][WARNING] ${securityWarning}`);
  }

  console.log(
    `[downloads] Mode: ${mode}`,
  );
  console.log(
    `[downloads] Strict fingerprint cache: ${strictFingerprintCache ? "enabled" : "disabled"}`,
  );
  if (forceIntegrityRecheck) {
    console.log("[downloads] Force integrity recheck: enabled");
  }
  console.log(
    `[downloads] GraphQL usage: queries=${rateLimit.queries}, totalCost=${rateLimit.totalCost}, firstRemaining=${rateLimit.firstRemaining ?? "n/a"}, lastRemaining=${rateLimit.lastRemaining ?? "n/a"}, estimatedConsumed=${rateLimit.estimatedConsumed ?? "n/a"}, resetAt=${rateLimit.resetAt ?? "n/a"}`,
  );
  console.log(
    `[downloads] Integrity stats: listings=${stats.listings}, versionsChecked=${stats.versions_checked}, completeVersions=${stats.complete_versions}, incompleteVersions=${stats.incomplete_versions}, filteredVersions=${stats.filtered_versions}, cacheHits=${stats.cache_hits}`,
  );
  console.log(
    `[downloads] Attribution stats: registryFetchesAdded=${stats.registry_fetches_added}, adjustedDeltaTotal=${stats.adjusted_delta_total}, clampedVersions=${stats.clamped_versions}`,
  );

  const zeroValidSemverListings = listZeroValidSemverListings(integrity);
  if (zeroValidSemverListings.length > 0) {
    console.warn(
      `[downloads] Listings with zero valid semver tags (${zeroValidSemverListings.length}): ${zeroValidSemverListings.join(", ")}`,
    );
  } else {
    console.log("[downloads] Listings with zero valid semver tags: none");
  }

  console.log(
    mode === "full"
      ? `Generated ${outputDir}/downloads.json and ${outputDir}/integrity.json for ${Object.keys(downloads).length} listings`
      : `Generated ${outputDir}/downloads.json for ${Object.keys(downloads).length} listings (download-only mode)`,
  );

  const warningsForOutput = [
    ...warnings,
    ...buildZeroValidSemverWarnings(integrity),
  ];
  const warningsForGitHub = filterListingMessages(
    filterWarningsForGitHub(warningsForOutput, integrity),
    (listingId) => isTestListing(repoRoot, listingType === "map" ? "maps" : "mods", listingId),
  );
  const securityErrorsForOutput = filterListingMessages(
    securityAlerts.errors,
    (listingId) => isTestListing(repoRoot, "mods", listingId),
  );
  const securityWarningsForOutput = filterListingMessages(
    securityAlerts.warnings,
    (listingId) => isTestListing(repoRoot, "mods", listingId),
  );
  const suppressedWarnings = warningsForOutput.length - warningsForGitHub.length;
  if (suppressedWarnings > 0) {
    console.log(
      `[downloads] Suppressed ${suppressedWarnings} older-version warnings from GitHub/Discord output`,
    );
  }
  appendGitHubOutput([
    `warning_count=${warningsForGitHub.length}`,
    `warnings_json=${toWarningsOutputJson(listingType, warningsForGitHub)}`,
    `security_error_count=${securityErrorsForOutput.length}`,
    `security_warning_count=${securityWarningsForOutput.length}`,
    `security_errors_json=${toLimitedOutputJson(securityErrorsForOutput)}`,
    `security_warnings_json=${toLimitedOutputJson(securityWarningsForOutput)}`,
    `integrity_listings=${stats.listings}`,
    `integrity_versions_checked=${stats.versions_checked}`,
    `integrity_complete_versions=${stats.complete_versions}`,
    `integrity_incomplete_versions=${stats.incomplete_versions}`,
    `integrity_filtered_versions=${stats.filtered_versions}`,
    `integrity_cache_hits=${stats.cache_hits}`,
    `registry_fetches_added=${stats.registry_fetches_added}`,
    `adjusted_delta_total=${stats.adjusted_delta_total}`,
    `clamped_versions=${stats.clamped_versions}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
