import type * as D from "../download-definitions.js";
import type { IntegrityCacheEntry } from "../integrity.js";
import { loadSecurityRules } from "../mod-security.js";
import type { LoadedSecurityRules } from "../mod-security.js";

export function resolveModSecurityRules(
  listingType: D.GenerateDownloadsOptions["listingType"],
  repoRoot: string,
): LoadedSecurityRules | null {
  if (listingType !== "mod") return null;
  return loadSecurityRules(repoRoot);
}

export function getStrictFingerprintCacheForListingType(
  listingType: D.GenerateDownloadsOptions["listingType"],
  strictFingerprintCache: boolean,
): boolean {
  // Mod integrity includes security scanning, which is expensive.
  // Reuse matching cache fingerprints for mods regardless of age so we only
  // rescan when a fingerprint changes (new version/rules) or when forced.
  return strictFingerprintCache || listingType === "mod";
}

export function isLegacyModCacheMissingSecurityCheck(
  listingType: D.GenerateDownloadsOptions["listingType"],
  cacheEntry: IntegrityCacheEntry | undefined,
): boolean {
  if (listingType !== "mod" || !cacheEntry) return false;
  const securityScanPassed = cacheEntry.result.required_checks?.security_scan_passed;
  return typeof securityScanPassed !== "boolean";
}

export function getSecurityFingerprintValue(
  modSecurityRules: LoadedSecurityRules | null,
): string {
  return modSecurityRules?.fingerprint ?? "security:none";
}

export function getSecurityFingerprintPart(
  listingType: D.GenerateDownloadsOptions["listingType"],
  modSecurityRules: LoadedSecurityRules | null,
): string {
  if (listingType !== "mod") return "";
  return `:${getSecurityFingerprintValue(modSecurityRules)}`;
}

