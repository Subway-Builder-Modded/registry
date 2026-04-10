import JSZip from "jszip";
import { gunzipSync } from "node:zlib";
import type { ManifestType } from "./manifests.js";
import type { CompiledSecurityRule, SecurityIssue } from "./mod-security.js";
import { scanZipForSecurityIssues } from "./mod-security.js";
import { isObject, toFiniteNumber, bytesToMebibytesRounded, getDemandPointRef } from "./json-utils.js";


export interface IntegritySource {
  update_type: "github" | "custom";
  repo?: string;
  tag?: string;
  asset_name?: string;
  download_url?: string;
}

export interface IntegrityVersionEntry {
  is_complete: boolean;
  errors: string[];
  required_checks: Record<string, boolean>;
  matched_files: Record<string, string | null>;
  release_size?: number;
  file_sizes?: Record<string, number>;
  security_issue?: SecurityIssue;
  source: IntegritySource;
  fingerprint: string;
  checked_at: string;
}

export interface ListingIntegrityEntry {
  has_complete_version: boolean;
  latest_semver_version: string | null;
  latest_semver_complete: boolean | null;
  complete_versions: string[];
  incomplete_versions: string[];
  versions: Record<string, IntegrityVersionEntry>;
}

export interface IntegrityOutput {
  schema_version: 1;
  generated_at: string;
  listings: Record<string, ListingIntegrityEntry>;
}

export interface IntegrityCacheEntry {
  fingerprint: string;
  last_checked_at: string;
  result: IntegrityVersionEntry;
}

export interface IntegrityCache {
  schema_version: 1;
  entries: Record<string, Record<string, IntegrityCacheEntry>>;
}

export interface ZipCompletenessResult {
  isComplete: boolean;
  errors: string[];
  warnings: string[];
  requiredChecks: Record<string, boolean>;
  matchedFiles: Record<string, string | null>;
  fileSizes?: Record<string, number>;
  securityIssue?: SecurityIssue;
  manifestVersion?: string;
  configVersion?: string;
}

interface InspectZipOptions {
  cityCode?: string;
  releaseHasManifestAsset?: boolean;
  expectedReleaseManifestAssetName?: string;
  modSecurityRules?: CompiledSecurityRule[];
}

interface DemandPointCoordinate {
  id: string;
  location: [number, number];
}

const ISOLATED_MAP_POINT_DISTANCE_KM = 100;
const EARTH_RADIUS_KM = 6371.0088;

function listTopLevelFileNames(zip: JSZip): Set<string> {
  const names = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name.includes("/")) continue;
    names.add(entry.name);
  }
  return names;
}

function findTopLevelEntry(zip: JSZip, names: string[]): JSZip.JSZipObject | null {
  for (const name of names) {
    const entry = zip.files[name];
    if (entry && !entry.dir && !entry.name.includes("/")) {
      return entry;
    }
  }
  return null;
}

function getEntryUncompressedSize(entry: JSZip.JSZipObject): number {
  const rawData = entry as unknown as {
    _data?: { uncompressedSize?: unknown };
    options?: { uncompressedSize?: unknown };
  };
  const fromInternalData = rawData._data?.uncompressedSize;
  if (typeof fromInternalData === "number" && Number.isFinite(fromInternalData) && fromInternalData >= 0) {
    return fromInternalData;
  }

  const fromOptions = rawData.options?.uncompressedSize;
  if (typeof fromOptions === "number" && Number.isFinite(fromOptions) && fromOptions >= 0) {
    return fromOptions;
  }

  return 0;
}

function collectZipFileSizes(zip: JSZip): Record<string, number> {
  const fileSizes: Record<string, number> = {};
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of fileEntries) {
    fileSizes[entry.name] = bytesToMebibytesRounded(getEntryUncompressedSize(entry));
  }

  return fileSizes;
}

function firstMatch(files: Set<string>, names: string[]): string | null {
  for (const name of names) {
    if (files.has(name)) {
      return name;
    }
  }
  return null;
}

function findConfigCode(value: unknown): string | null {
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isObject(current) || visited.has(current)) continue;
    visited.add(current);

    const direct = current.code;
    if (typeof direct === "string" && direct.trim() !== "") {
      return direct.trim();
    }

    for (const nestedValue of Object.values(current)) {
      if (isObject(nestedValue)) {
        queue.push(nestedValue);
      }
    }
  }

  return null;
}

async function parseConfigCode(zip: JSZip): Promise<{
  code: string | null;
  version: string | null;
  parseError: string | null;
}> {
  const configEntry = zip.files["config.json"];
  if (!configEntry || configEntry.dir) {
    return { code: null, version: null, parseError: null };
  }

  let rawConfig: string;
  try {
    rawConfig = await configEntry.async("string");
  } catch {
    return { code: null, version: null, parseError: "failed to read top-level config.json" };
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    return { code: null, version: null, parseError: "top-level config.json is not valid JSON" };
  }

  const version = isObject(parsedConfig) && typeof parsedConfig.version === "string" && parsedConfig.version.trim() !== ""
    ? parsedConfig.version.trim()
    : null;

  return {
    code: findConfigCode(parsedConfig),
    version,
    parseError: null,
  };
}

async function parseDemandPointCoordinates(zip: JSZip): Promise<DemandPointCoordinate[]> {
  const demandDataEntry = findTopLevelEntry(zip, ["demand_data.json", "demand_data.json.gz"]);
  if (!demandDataEntry) {
    return [];
  }

  let rawText: string;
  try {
    if (demandDataEntry.name.toLowerCase().endsWith(".gz")) {
      const compressed = await demandDataEntry.async("nodebuffer");
      rawText = gunzipSync(compressed).toString("utf-8");
    } else {
      rawText = await demandDataEntry.async("string");
    }
  } catch {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return [];
  }

  if (!isObject(payload) && !Array.isArray(payload)) {
    return [];
  }

  const pointsRaw = isObject(payload) ? payload.points : null;
  if (!Array.isArray(pointsRaw) && !isObject(pointsRaw)) {
    return [];
  }

  const pointEntries = Array.isArray(pointsRaw)
    ? pointsRaw.map((pointValue, index) => [String(index), pointValue] as const)
    : Object.entries(pointsRaw);

  const coordinates: DemandPointCoordinate[] = [];
  for (const [pointKey, pointValue] of pointEntries) {
    if (!isObject(pointValue)) continue;
    const locationRaw = pointValue.location;
    if (!Array.isArray(locationRaw) || locationRaw.length < 2) continue;
    const longitude = toFiniteNumber(locationRaw[0]);
    const latitude = toFiniteNumber(locationRaw[1]);
    if (longitude === null || latitude === null) continue;
    coordinates.push({
      id: getDemandPointRef(pointValue, pointKey),
      location: [longitude, latitude],
    });
  }

  return coordinates;
}

function greatCircleDistanceKm(a: [number, number], b: [number, number]): number {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const deltaLatitude = toRadians(b[1] - a[1]);
  const deltaLongitude = toRadians(b[0] - a[0]);
  const haversine = (
    Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2
  );
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return EARTH_RADIUS_KM * arc;
}

function findIsolatedDemandPoints(points: DemandPointCoordinate[]): Array<{ id: string; nearestDistanceKm: number }> {
  if (points.length < 2) {
    return [];
  }

  const cellSizeDegrees = 1;
  const bucketKey = (longitude: number, latitude: number): string => (
    `${Math.floor(latitude / cellSizeDegrees)}:${Math.floor(longitude / cellSizeDegrees)}`
  );
  const buckets = new Map<string, number[]>();

  for (let index = 0; index < points.length; index += 1) {
    const [longitude, latitude] = points[index].location;
    const key = bucketKey(longitude, latitude);
    const existing = buckets.get(key) ?? [];
    existing.push(index);
    buckets.set(key, existing);
  }

  const isolated: Array<{ id: string; nearestDistanceKm: number }> = [];
  const latitudeRange = Math.ceil(ISOLATED_MAP_POINT_DISTANCE_KM / 111.32) + 1;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const [longitude, latitude] = point.location;
    const latBucket = Math.floor(latitude / cellSizeDegrees);
    const lonBucket = Math.floor(longitude / cellSizeDegrees);
    const cosLatitude = Math.max(0.01, Math.abs(Math.cos(latitude * (Math.PI / 180))));
    const longitudeRange = Math.ceil(ISOLATED_MAP_POINT_DISTANCE_KM / (111.32 * cosLatitude)) + 1;

    let nearestDistanceKm = Number.POSITIVE_INFINITY;
    let hasNeighborWithinThreshold = false;

    for (let latOffset = -latitudeRange; latOffset <= latitudeRange && !hasNeighborWithinThreshold; latOffset += 1) {
      for (let lonOffset = -longitudeRange; lonOffset <= longitudeRange; lonOffset += 1) {
        const candidateIndexes = buckets.get(`${latBucket + latOffset}:${lonBucket + lonOffset}`);
        if (!candidateIndexes) continue;
        for (const candidateIndex of candidateIndexes) {
          if (candidateIndex === index) continue;
          const distanceKm = greatCircleDistanceKm(point.location, points[candidateIndex].location);
          if (distanceKm < nearestDistanceKm) {
            nearestDistanceKm = distanceKm;
          }
          if (distanceKm <= ISOLATED_MAP_POINT_DISTANCE_KM) {
            hasNeighborWithinThreshold = true;
            break;
          }
        }
        if (hasNeighborWithinThreshold) {
          break;
        }
      }
    }

    if (!hasNeighborWithinThreshold) {
      if (!Number.isFinite(nearestDistanceKm)) {
        for (let candidateIndex = 0; candidateIndex < points.length; candidateIndex += 1) {
          if (candidateIndex === index) continue;
          const distanceKm = greatCircleDistanceKm(point.location, points[candidateIndex].location);
          if (distanceKm < nearestDistanceKm) {
            nearestDistanceKm = distanceKm;
          }
        }
      }
      if (Number.isFinite(nearestDistanceKm) && nearestDistanceKm > ISOLATED_MAP_POINT_DISTANCE_KM) {
        isolated.push({ id: point.id, nearestDistanceKm });
      }
    }
  }

  return isolated;
}

async function inspectMapZip(
  zip: JSZip,
  files: Set<string>,
  fileSizes: Record<string, number>,
  registryCityCode: string | null,
  configCode: string | null,
  configVersion: string | null,
  parseError: string | null,
  configCodeMismatchWarning: string | null,
): Promise<ZipCompletenessResult> {
  const requiredChecks: Record<string, boolean> = {};
  const matchedFiles: Record<string, string | null> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  const configFile = firstMatch(files, ["config.json"]);
  requiredChecks.config_json = configFile !== null;
  matchedFiles.config_json = configFile;
  if (!configFile) {
    errors.push("missing top-level config.json");
  } else if (parseError) {
    errors.push(parseError);
  }

  const demandData = firstMatch(files, ["demand_data.json", "demand_data.json.gz"]);
  requiredChecks.demand_data = demandData !== null;
  matchedFiles.demand_data = demandData;
  if (!demandData) {
    errors.push("missing top-level demand_data.json or demand_data.json.gz");
  } else {
    const demandPoints = await parseDemandPointCoordinates(zip);
    if (demandPoints.length >= 2) {
      const isolatedPoints = findIsolatedDemandPoints(demandPoints);
      requiredChecks.demand_point_spacing = isolatedPoints.length === 0;
      matchedFiles.demand_point_spacing = demandData;
      if (isolatedPoints.length > 0) {
        const examples = isolatedPoints
          .slice(0, 5)
          .map((point) => `${point.id}=${point.nearestDistanceKm.toFixed(1)}km`)
          .join(", ");
        const remainder = isolatedPoints.length > 5
          ? ` (+${isolatedPoints.length - 5} more)`
          : "";
        errors.push(
          `demand_data contains ${isolatedPoints.length} isolated point(s) with nearest-neighbor distance >${ISOLATED_MAP_POINT_DISTANCE_KM}km: ${examples}${remainder}`,
        );
      }
    }
  }

  const buildingsIndex = firstMatch(files, ["buildings_index.json", "buildings_index.json.gz"]);
  requiredChecks.buildings_index = buildingsIndex !== null;
  matchedFiles.buildings_index = buildingsIndex;
  if (!buildingsIndex) {
    errors.push("missing top-level buildings_index.json or buildings_index.json.gz");
  }

  const roads = firstMatch(files, ["roads.geojson", "roads.geojson.gz"]);
  requiredChecks.roads_geojson = roads !== null;
  matchedFiles.roads_geojson = roads;
  if (!roads) {
    errors.push("missing top-level roads.geojson or roads.geojson.gz");
  }

  const runwaysTaxiways = firstMatch(files, ["runways_taxiways.geojson", "runways_taxiways.geojson.gz"]);
  requiredChecks.runways_taxiways_geojson = runwaysTaxiways !== null;
  matchedFiles.runways_taxiways_geojson = runwaysTaxiways;
  if (!runwaysTaxiways) {
    errors.push("missing top-level runways_taxiways.geojson or runways_taxiways.geojson.gz");
  }

  if (configCodeMismatchWarning) {
    warnings.push(configCodeMismatchWarning);
  }

  if (!configCode) {
    requiredChecks.city_pmtiles = false;
    matchedFiles.city_pmtiles = null;
    if (registryCityCode) {
      errors.push(
        `missing code in config.json for PMTiles validation (registry city_code '${registryCityCode}')`,
      );
    } else {
      errors.push("missing code in config.json for PMTiles validation");
    }
  } else {
    const pmtilesName = `${configCode}.pmtiles`;
    const pmtiles = firstMatch(files, [pmtilesName]);
    requiredChecks.city_pmtiles = pmtiles !== null;
    matchedFiles.city_pmtiles = pmtiles;
    if (!pmtiles) {
      if (registryCityCode) {
        errors.push(
          `missing top-level ${pmtilesName} (config code '${configCode}', registry city_code '${registryCityCode}')`,
        );
      } else {
        errors.push(`missing top-level ${pmtilesName} (config code '${configCode}')`);
      }
    }
  }

  return {
    isComplete: errors.length === 0,
    errors,
    warnings,
    requiredChecks,
    matchedFiles,
    fileSizes,
    ...(configVersion !== null ? { configVersion } : {}),
  };
}

async function inspectModZip(
  zip: JSZip,
  files: Set<string>,
  releaseHasManifestAsset: boolean,
  expectedReleaseManifestAssetName: string,
  modSecurityRules: CompiledSecurityRule[],
): Promise<ZipCompletenessResult> {
  const requiredChecks: Record<string, boolean> = {};
  const matchedFiles: Record<string, string | null> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  let manifestVersion: string | undefined;

  requiredChecks.release_manifest_asset = releaseHasManifestAsset;
  matchedFiles.release_manifest_asset = releaseHasManifestAsset ? expectedReleaseManifestAssetName : null;
  if (!releaseHasManifestAsset) {
    errors.push(`release asset ${expectedReleaseManifestAssetName} is missing`);
  }

  const manifestInZip = firstMatch(files, ["manifest.json"]);
  requiredChecks.zip_manifest_json = manifestInZip !== null;
  matchedFiles.zip_manifest_json = manifestInZip;
  if (!manifestInZip) {
    errors.push("missing top-level manifest.json in ZIP");
  }

  if (manifestInZip) {
    try {
      const manifestEntry = zip.files[manifestInZip];
      if (manifestEntry) {
        const raw = await manifestEntry.async("string");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.version === "string") {
          manifestVersion = parsed.version.trim();
        }
      }
    } catch {
      // Cannot read/parse manifest — manifestVersion stays undefined
    }
  }

  let securityIssue: SecurityIssue | undefined;
  try {
    securityIssue = await scanZipForSecurityIssues(zip, modSecurityRules);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requiredChecks.security_scan_passed = false;
    matchedFiles.security_scan_passed = null;
    errors.push(`security scan failed (${message})`);
    return {
      isComplete: false,
      errors,
      warnings,
      requiredChecks,
      matchedFiles,
      fileSizes: undefined,
      securityIssue: undefined,
    };
  }
  const findings = securityIssue?.findings ?? [];
  const errorFindings = findings.filter((finding) => finding.severity === "ERROR");
  const warningFindings = findings.filter((finding) => finding.severity === "WARNING");

  requiredChecks.security_scan_passed = errorFindings.length === 0;
  matchedFiles.security_scan_passed = errorFindings.length === 0 ? "passed" : null;

  if (errorFindings.length > 0) {
    const summary = errorFindings
      .map((finding) => `${finding.rule_id} in ${finding.file}`)
      .join(", ");
    errors.push(`security scan detected ${errorFindings.length} ERROR finding(s): ${summary}`);
  }

  if (warningFindings.length > 0) {
    const summary = warningFindings
      .map((finding) => `${finding.rule_id} in ${finding.file}`)
      .join(", ");
    warnings.push(`security scan detected ${warningFindings.length} WARNING finding(s): ${summary}`);
  }

  return {
    isComplete: errors.length === 0,
    errors,
    warnings,
    requiredChecks,
    matchedFiles,
    fileSizes: undefined,
    securityIssue,
    manifestVersion,
  };
}

export async function inspectZipCompleteness(
  listingType: ManifestType,
  zipBuffer: Buffer,
  options: InspectZipOptions = {},
): Promise<ZipCompletenessResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    return {
      isComplete: false,
      errors: ["ZIP could not be opened"],
      warnings: [],
      requiredChecks: {},
      matchedFiles: {},
    };
  }

  const topLevelFiles = listTopLevelFileNames(zip);
  const zipFileSizes = collectZipFileSizes(zip);
  if (listingType === "map") {
    const registryCityCode = options.cityCode?.trim() || null;
    const configCodeResult = await parseConfigCode(zip);
    const configCode = configCodeResult.code;
    const mismatchWarning = (
      registryCityCode
      && configCode
      && registryCityCode !== configCode
    )
      ? (
        `registry city_code '${registryCityCode}' differs from config code '${configCode}' `
        + `(registry expects '${registryCityCode}.pmtiles', config expects '${configCode}.pmtiles')`
      )
      : null;

    return await inspectMapZip(
      zip,
      topLevelFiles,
      zipFileSizes,
      registryCityCode,
      configCode,
      configCodeResult.version,
      configCodeResult.parseError,
      mismatchWarning,
    );
  }

  const expectedReleaseManifestAssetName = (
    typeof options.expectedReleaseManifestAssetName === "string"
    && options.expectedReleaseManifestAssetName.trim() !== ""
  )
    ? options.expectedReleaseManifestAssetName.trim()
    : "manifest.json";

  return inspectModZip(
    zip,
    topLevelFiles,
    options.releaseHasManifestAsset === true,
    expectedReleaseManifestAssetName,
    options.modSecurityRules ?? [],
  );
}
