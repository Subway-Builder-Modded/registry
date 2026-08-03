import { getFlagValue, hasFlag } from "../lib/cli.js";
import { writeJsonFile } from "../lib/json-utils.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateDownloadsData } from "../lib/downloads.js";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
  writeDownloadAttributionDeltaFile,
} from "../lib/download-attribution.js";
import {
  applyVersionBucketMonotonicCounts,
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
} from "../lib/download-version-buckets.js";
import {
  loadGrandfatheredDownloads,
  mergeGrandfatheredDownloads,
} from "../lib/grandfathered-downloads.js";
import { loadContentAnnouncementLedger } from "../lib/content-announcements.js";
import { loadIntegritySnapshot } from "../lib/downloads-support.js";
import { buildPendingAnnouncements } from "../lib/pending-announcements.js";
import type { IntegrityOutput } from "../lib/integrity.js";
import type { ManifestType } from "../lib/manifests.js";
import type { SecurityFinding } from "../lib/mod-security.js";
import {
  appendGitHubOutput,
  getNonEmptyEnv,
  isTruthyEnv,
  resolveRepoRoot,
  runAndExitOnError,
  toWarningsOutputJson,
} from "../lib/script-runtime.js";
import { compareStableSemverAsc, isStableSemverTag } from "../lib/semver.js";
import { filterListingMessages, isTestListing } from "../lib/test-listings.js";
import { isDeprecatedListing } from "../lib/downloads-full/deprecation.js";
import { loadAuthorAliasIndex } from "../lib/author-aliases.js";
import {
  buildIntegrityAlertEmbed,
  buildIntegrityAlertIssueBody,
  buildIntegrityAlertIssueTitle,
  resolveAlertNotifyTarget,
  type AlertNotifyTarget,
} from "../lib/downloads-full/integrity-alerts.js";
import { sendDiscordPayload } from "../lib/discord-webhook.js";

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
  downloads: Record<string, Record<string, number>>,
): string[] {
  if (Object.keys(integrity.listings).length === 0) return warnings;

  return warnings.filter((warning) => {
    const parsed = parseListingWarning(warning);
    if (!parsed || !parsed.version) return true;
    if (!isStableSemverTag(parsed.version)) return true;

    // Suppress attribution-clamped warnings when bucket recovery restored a non-zero count
    if (warning.includes("download attribution clamped")) {
      const recoveredCount = downloads[parsed.listingId]?.[parsed.version];
      if (typeof recoveredCount === "number" && recoveredCount > 0) {
        return false;
      }
    }

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
  const argv = process.argv.slice(2);
  const listingType = resolveListingType(
    getFlagValue(argv, "type") ?? process.env.LISTING_TYPE,
  );
  const mode = resolveMode(getFlagValue(argv, "mode") ?? process.env.DOWNLOADS_MODE);
  const strictFingerprintCache = (
    hasFlag(argv, "strict-fingerprint-cache")
    || isTruthyEnv(process.env.STRICT_FINGERPRINT_CACHE)
    || isTruthyEnv(process.env.REGISTRY_STRICT_FINGERPRINT_CACHE)
  );
  const forceIntegrityRecheck = (
    hasFlag(argv, "force")
    || hasFlag(argv, "force-integrity")
    || isTruthyEnv(process.env.FORCE_INTEGRITY_RECHECK)
  );
  // Comma-separated listing ids whose integrity cache should be bypassed this
  // run — the targeted alternative to a global forced recheck (see
  // GenerateDownloadsOptions.forceRecheckListings). Ids not in this run's
  // listing type are simply never matched, so one value can be passed to both
  // the map and mod invocations.
  const forceRecheckListings = (
    getFlagValue(argv, "force-recheck-listings")
    ?? process.env.FORCE_INTEGRITY_RECHECK_LISTINGS
    ?? ""
  )
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const runId = getNonEmptyEnv("GITHUB_RUN_ID") ?? "local";
  const jobId = getNonEmptyEnv("GITHUB_JOB") ?? "manual";
  const workflowName = getNonEmptyEnv("GITHUB_WORKFLOW") ?? "local";
  const attributionLedger = loadDownloadAttributionLedger(repoRoot);
  const versionBucketLedger = loadDownloadVersionBucketLedger(repoRoot, listingType);
  const outputDir = listingType === "map" ? "maps" : "mods";
  const outputPath = resolve(repoRoot, outputDir, "downloads.json");
  const integrityPath = resolve(repoRoot, outputDir, "integrity.json");
  const integrityCachePath = resolve(repoRoot, outputDir, "integrity-cache.json");
  const pendingAnnouncementsPath = resolve(repoRoot, outputDir, "pending-announcements.json");
  const defaultAttributionDeltaPath = resolve(repoRoot, outputDir, "download-attribution-delta.json");
  const attributionDeltaPath = (
    getFlagValue(argv, "attribution-delta-path")
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
    integrityAlerts,
    stats,
    warnings,
    rateLimit,
  } = await generateDownloadsData({
    repoRoot,
    listingType,
    mode,
    strictFingerprintCache,
    forceIntegrityRecheck,
    forceRecheckListings,
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

  writeJsonFile(outputPath, downloads);
  writeDownloadVersionBucketLedger(repoRoot, listingType, versionBucketLedger);
  if (mode === "full") {
    const previousIntegrity = loadIntegritySnapshot(repoRoot, outputDir);
    const pendingAnnouncements = buildPendingAnnouncements({
      newIntegrity: integrity,
      previousIntegrity,
      listingType,
      repoRoot,
      announcementLedger: loadContentAnnouncementLedger(repoRoot),
    });
    writeJsonFile(integrityPath, integrity);
    writeJsonFile(integrityCachePath, integrityCache);
    writeJsonFile(pendingAnnouncementsPath, pendingAnnouncements);
    writeDownloadAttributionDeltaFile(attributionDeltaPath, attributionDelta);
    const discordIntegrityWebhookUrl = (
      process.env.DISCORD_INTEGRITY_WEBHOOK_URL?.trim()
      || process.env.DISCORD_WEBHOOK_URL?.trim()
      || undefined
    );
    if (discordIntegrityWebhookUrl && integrityAlerts.length > 0) {
      const authorIndex = loadAuthorAliasIndex(repoRoot);
      // Group by notify TARGET (active caretaker when set, else the author):
      // for admin-authored/caretaken listings the caretaker owns the release
      // pipeline, so the ping routes to them. The embed keeps showing the
      // listing author's alias — only the mention target changes.
      const alertsByTarget = new Map<string, { target: AlertNotifyTarget; alerts: typeof integrityAlerts }>();
      for (const alert of integrityAlerts) {
        const target = resolveAlertNotifyTarget(alert, authorIndex);
        const group = alertsByTarget.get(target.authorId);
        if (group) {
          group.alerts.push(alert);
        } else {
          alertsByTarget.set(target.authorId, { target, alerts: [alert] });
        }
      }
      for (const { target, alerts: targetAlerts } of alertsByTarget.values()) {
        const discordId = target.discordId;
        const content = discordId ? `<@${discordId}>` : undefined;
        const noDiscordIdNote = discordId ? undefined : `No Discord ID on file for ${target.alias}`;
        const embeds = targetAlerts.slice(0, 10).map((alert) => {
          const authorEntry = authorIndex.authors.find((a) => a.author_id === alert.authorId);
          const authorAlias = authorEntry?.author_alias ?? authorEntry?.author_id ?? alert.authorId;
          return buildIntegrityAlertEmbed(alert, authorAlias, noDiscordIdNote);
        });
        try {
          await sendDiscordPayload(discordIntegrityWebhookUrl, content, embeds);
          console.log(`[downloads][integrity-alert] Sent Discord alert for target=${target.authorId} (${targetAlerts.length} version(s))`);
        } catch (error) {
          console.warn(`[downloads][integrity-alert] Failed to send Discord alert for target=${target.authorId}: ${(error as Error).message}`);
        }
      }
    }
    // GitHub-issue notifications for notify targets (caretaker when set, else
    // author) with no Discord ID on file: the channel embed alone never
    // reaches them, so an @mention issue triggers GitHub's native
    // notification instead. Issue titles are the dedup key against open
    // integrity-alert issues (alerts fire on state transitions, so this only
    // guards reruns/backfills).
    const githubToken = process.env.GITHUB_TOKEN?.trim() || undefined;
    const githubRepository = process.env.GITHUB_REPOSITORY?.trim() || undefined;
    if (githubToken && githubRepository && integrityAlerts.length > 0) {
      const authorIndex = loadAuthorAliasIndex(repoRoot);
      const githubOnlyAlerts = integrityAlerts
        .map((alert) => ({ alert, target: resolveAlertNotifyTarget(alert, authorIndex) }))
        .filter(({ target }) => !target.discordId && target.githubId !== undefined);
      if (githubOnlyAlerts.length > 0) {
        const apiHeaders = {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        };
        let openAlertTitles = new Set<string>();
        try {
          const listResponse = await fetch(
            `https://api.github.com/repos/${githubRepository}/issues?labels=integrity-alert&state=open&per_page=100`,
            { headers: apiHeaders },
          );
          if (listResponse.ok) {
            const openIssues = await listResponse.json() as Array<{ title?: string }>;
            openAlertTitles = new Set(openIssues.map((issue) => issue.title ?? ""));
          } else {
            console.warn(`[downloads][integrity-alert] Failed to list open alert issues: HTTP ${listResponse.status}`);
          }
        } catch (error) {
          console.warn(`[downloads][integrity-alert] Failed to list open alert issues: ${(error as Error).message}`);
        }
        for (const { alert, target } of githubOnlyAlerts) {
          const title = buildIntegrityAlertIssueTitle(alert);
          if (openAlertTitles.has(title)) {
            console.log(`[downloads][integrity-alert] Open issue already exists for ${alert.listingId} ${alert.version}; skipping`);
            continue;
          }
          try {
            const createResponse = await fetch(
              `https://api.github.com/repos/${githubRepository}/issues`,
              {
                method: "POST",
                headers: apiHeaders,
                body: JSON.stringify({
                  title,
                  body: buildIntegrityAlertIssueBody(alert, target.authorId),
                  labels: ["integrity-alert"],
                }),
              },
            );
            if (createResponse.ok) {
              console.log(`[downloads][integrity-alert] Opened GitHub issue for target=${target.authorId} listing=${alert.listingId} version=${alert.version}`);
            } else {
              console.warn(`[downloads][integrity-alert] Failed to open GitHub issue for ${alert.listingId} ${alert.version}: HTTP ${createResponse.status}`);
            }
          } catch (error) {
            console.warn(`[downloads][integrity-alert] Failed to open GitHub issue for ${alert.listingId} ${alert.version}: ${(error as Error).message}`);
          }
        }
      }
    }
    console.log(
      pendingAnnouncements.listings.length > 0
        ? `[downloads] Pending announcements: ${pendingAnnouncements.listings.map((entry) => entry.listing_id).join(", ")}`
        : "[downloads] Pending announcements: none",
    );
    appendGitHubOutput([
      `pending_announcement_count=${pendingAnnouncements.listings.length}`,
      `pending_announcements_json=${JSON.stringify(pendingAnnouncements.listings.map((entry) => entry.listing_id))}`,
    ]);
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
  if (forceRecheckListings.length > 0) {
    console.log(
      `[downloads] Forced recheck listings: ${forceRecheckListings.join(", ")}`,
    );
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
  // Test listings and deprecated listings are both suppressed from outbound
  // warning/alert channels — a deprecated listing whose upstream repo later
  // vanishes must not nag maintainers or authors every run.
  const isSuppressedListing = (dir: "maps" | "mods", listingId: string): boolean =>
    isTestListing(repoRoot, dir, listingId) || isDeprecatedListing(repoRoot, dir, listingId);
  const warningsForGitHub = filterListingMessages(
    filterWarningsForGitHub(warningsForOutput, integrity, downloads),
    (listingId) => isSuppressedListing(listingType === "map" ? "maps" : "mods", listingId),
  );
  const securityErrorsForOutput = filterListingMessages(
    securityAlerts.errors,
    (listingId) => isSuppressedListing("mods", listingId),
  );
  const securityWarningsForOutput = filterListingMessages(
    securityAlerts.warnings,
    (listingId) => isSuppressedListing("mods", listingId),
  );
  const suppressedWarnings = warningsForOutput.length - warningsForGitHub.length;
  if (suppressedWarnings > 0) {
    console.log(
      `[downloads] Suppressed ${suppressedWarnings} older-version warnings from GitHub/Discord output`,
    );
  }
  const hasAuthFailure401 = warnings.some((w) => /GraphQL returned HTTP 401/.test(w));
  const tokenAuthStatus = !token ? "missing" : hasAuthFailure401 ? "invalid" : "ok";
  appendGitHubOutput([
    `warning_count=${warningsForGitHub.length}`,
    `warnings_json=${toWarningsOutputJson(`${listingType}: `, warningsForGitHub)}`,
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
    `token_auth_status=${tokenAuthStatus}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
