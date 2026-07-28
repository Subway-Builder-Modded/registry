import {
  DEFAULT_LEVEL_OF_DETAIL,
  DEFAULT_MAP_DATA_SOURCE,
  DEFAULT_SOURCE_QUALITY,
  MAX_OSM_SOURCE_QUALITY,
  isOsmDataSource,
} from "./map-constants.js";

const EMPTY_ISSUE_VALUES = new Set(["_No response_", "None", "No change"]);

export function getOptionalIssueValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || EMPTY_ISSUE_VALUES.has(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function isPresentIssueValue(value: unknown): value is string {
  return getOptionalIssueValue(value) !== undefined;
}

/** Selected labels from an issue-form checkbox field (array or markdown checkbox lines). */
export function parseCheckedBoxes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof raw !== "string" || !raw || raw === "_No response_") return [];
  return raw
    .split("\n")
    .filter((line) => line.startsWith("- [X]") || line.startsWith("- [x]"))
    .map((line) => line.replace(/^- \[[Xx]\]\s*/, "").trim())
    .filter(Boolean);
}

export function combineMapTags(location: string, specialDemand: string[]): string[] {
  return Array.from(new Set([location, ...specialDemand]));
}

export function getRequiredIssueValue(fieldName: string, value: unknown): string {
  const resolved = getOptionalIssueValue(value);
  if (!resolved) {
    throw new Error(`${fieldName} is required`);
  }
  return resolved;
}

export function getMapDataSource(value: unknown): string {
  return getOptionalIssueValue(value) ?? DEFAULT_MAP_DATA_SOURCE;
}

export function getMapSourceQuality(value: unknown): string {
  return getOptionalIssueValue(value) ?? DEFAULT_SOURCE_QUALITY;
}

export function getMapLevelOfDetail(value: unknown): string {
  return getOptionalIssueValue(value) ?? DEFAULT_LEVEL_OF_DETAIL;
}

export function normalizeSourceQualityForDataSource(
  dataSource: string,
  sourceQuality: string,
): string {
  if (isOsmDataSource(dataSource) && sourceQuality === "high-quality") {
    return MAX_OSM_SOURCE_QUALITY;
  }
  return sourceQuality;
}
