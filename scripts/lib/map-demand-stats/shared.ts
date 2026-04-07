import type { InitialViewState } from "../manifests.js";
import {
  isObject as _isObject,
  toFiniteNumber as _toFiniteNumber,
} from "../json-utils.js";
import { compareStableSemverDesc } from "../semver.js";
import { parseGitHubReleaseAssetDownloadUrl } from "../release-resolution.js";
import type { JsonObject } from "./types.js";

export { readJsonFile, getDemandPointRef } from "../json-utils.js";

export function compareSemverDescending(a: string, b: string): number {
  return compareStableSemverDesc(a, b);
}

export function warn(warnings: string[], message: string): void {
  warnings.push(message);
}

export function warnListing(warnings: string[], listingId: string, message: string): void {
  warn(warnings, `listing=${listingId}: ${message}`);
}

export function inferPreferredGithubAssetName(sourceUrl: string | undefined, repo: string): string | null {
  if (typeof sourceUrl !== "string" || sourceUrl.trim() === "") {
    return null;
  }

  const parsedAssetUrl = parseGitHubReleaseAssetDownloadUrl(sourceUrl);
  if (parsedAssetUrl) {
    return parsedAssetUrl.repo === repo.toLowerCase()
      ? parsedAssetUrl.assetName
      : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 6) return null;
  if (segments[2] !== "releases" || segments[3] !== "latest" || segments[4] !== "download") {
    return null;
  }

  const sourceRepo = `${decodeURIComponent(segments[0] ?? "").trim()}/${decodeURIComponent(segments[1] ?? "").trim()}`
    .toLowerCase();
  if (!sourceRepo || sourceRepo !== repo.toLowerCase()) {
    return null;
  }

  const assetName = decodeURIComponent(segments.slice(5).join("/")).trim();
  return assetName !== "" ? assetName : null;
}

export function isObject(value: unknown): value is JsonObject {
  return _isObject(value);
}

export function toFiniteNumber(value: unknown): number | null {
  return _toFiniteNumber(value);
}

export function parseInitialViewState(value: unknown): InitialViewState | null {
  if (!isObject(value)) return null;
  const latitude = toFiniteNumber(value.latitude);
  const longitude = toFiniteNumber(value.longitude);
  const zoom = toFiniteNumber(value.zoom);
  const bearing = toFiniteNumber(value.bearing);
  if (latitude === null || longitude === null || zoom === null || bearing === null) {
    return null;
  }
  return { latitude, longitude, zoom, bearing };
}

export function initialViewStateEquals(
  a: InitialViewState | null | undefined,
  b: InitialViewState | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.zoom === b.zoom
    && a.bearing === b.bearing
  );
}

