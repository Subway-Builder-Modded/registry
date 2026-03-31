import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import type { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";
import { generateGrid, type DemandData } from "../map-analytics-grid.js";
import {
  getDemandPointRef,
  isObject,
  parseInitialViewState,
  toFiniteNumber,
  warnListing,
} from "./shared.js";
import type {
  ExtractDemandStatsOptions,
  MapDemandExtractionResult,
  ParsedDemandDataPayloadResult,
} from "./types.js";

function findDemandDataEntry(zip: JSZip): JSZip.JSZipObject | null {
  const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  const exactJson = allEntries.find((entry) => entry.name === "demand_data.json");
  if (exactJson) return exactJson;
  const exactGz = allEntries.find((entry) => entry.name === "demand_data.json.gz");
  if (exactGz) return exactGz;

  const jsonByBasename = allEntries.find((entry) => entry.name.toLowerCase().endsWith("/demand_data.json"));
  if (jsonByBasename) return jsonByBasename;
  const gzByBasename = allEntries.find((entry) => entry.name.toLowerCase().endsWith("/demand_data.json.gz"));
  if (gzByBasename) return gzByBasename;

  return null;
}

function findConfigEntry(zip: JSZip): JSZip.JSZipObject | null {
  const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  const exactConfig = allEntries.find((entry) => entry.name === "config.json");
  if (exactConfig) return exactConfig;
  const byBasename = allEntries.find((entry) => entry.name.toLowerCase().endsWith("/config.json"));
  return byBasename ?? null;
}

function parseDemandDataPayload(payload: unknown): ParsedDemandDataPayloadResult {
  if (!isObject(payload)) {
    throw new Error("demand data payload must be an object");
  }

  const points = payload.points;
  const popsMap = (isObject(payload.pops_map) || Array.isArray(payload.pops_map))
    ? payload.pops_map
    : payload.pops;
  if (!isObject(points) && !Array.isArray(points)) {
    throw new Error("demand data missing collection field 'points'");
  }
  if (!isObject(popsMap) && !Array.isArray(popsMap)) {
    throw new Error("demand data missing collection field 'pops_map' (or legacy 'pops')");
  }

  const popSizeById = new Map<string, number>();
  let residentsTotalByPop = 0;
  const popEntries = Array.isArray(popsMap)
    ? popsMap.map((popValue, index) => [String(index), popValue] as const)
    : Object.entries(popsMap);
  for (const [popKey, popValue] of popEntries) {
    if (!isObject(popValue)) continue;
    const popRef = getDemandPointRef(popValue, popKey);
    const popId = typeof popValue.id === "string" && popValue.id.trim() !== ""
      ? popValue.id
      : popKey;
    const size = typeof popValue.size === "number" && Number.isFinite(popValue.size)
      ? popValue.size
      : undefined;
    if (size !== undefined && size < 0) {
      throw new Error(`population entry '${popRef}' has negative size value`);
    }
    if (size !== undefined) {
      residentsTotalByPop += size;
    }
    if (!popId || size === undefined) continue;
    popSizeById.set(popId, size);
  }

  let residentsTotalByPoint = 0;
  const pointEntries = Array.isArray(points)
    ? points.map((pointValue, index) => [`index ${index}`, pointValue] as const)
    : Object.entries(points);
  const hasAnyExplicitResidents = pointEntries.some(([, pointValue]) => (
    isObject(pointValue)
    && typeof pointValue.residents === "number"
    && Number.isFinite(pointValue.residents)
  ));
  for (const [pointKeyOrIndex, pointValue] of pointEntries) {
    const pointRef = getDemandPointRef(pointValue, pointKeyOrIndex);
    if (!isObject(pointValue)) {
      throw new Error(`demand point '${pointRef}' is malformed`);
    }

    let residents: number | null = null;
    if (typeof pointValue.residents === "number" && Number.isFinite(pointValue.residents)) {
      residents = pointValue.residents;
    } else if (hasAnyExplicitResidents) {
      residents = 0;
    } else {
      const popIdsRaw = Array.isArray(pointValue.popIds)
        ? pointValue.popIds
        : (Array.isArray(pointValue.pop_ids) ? pointValue.pop_ids : null);
      if (popIdsRaw && popIdsRaw.every((value) => typeof value === "string")) {
        residents = popIdsRaw.reduce((sum, popId) => sum + (popSizeById.get(popId) ?? 0), 0);
      }
    }

    if (residents === null) {
      throw new Error(`demand point '${pointRef}' missing numeric residents value`);
    }
    if (residents < 0) {
      throw new Error(`demand point '${pointRef}' has negative residents value`);
    }
    residentsTotalByPoint += residents;
  }

  const residentsTotal = Math.min(residentsTotalByPoint, residentsTotalByPop);

  return {
    stats: {
      residents_total: residentsTotal,
      points_count: Array.isArray(points) ? points.length : Object.keys(points).length,
      population_count: Array.isArray(popsMap) ? popsMap.length : Object.keys(popsMap).length,
    },
    residentsTotalByPoint,
    residentsTotalByPop,
  };
}

function parseDemandGridData(payload: unknown): DemandData {
  if (!isObject(payload)) {
    throw new Error("demand data payload must be an object");
  }

  const pointsRaw = payload.points;
  const popsRaw = payload.pops;
  if (!Array.isArray(pointsRaw)) {
    throw new Error("demand data missing grid-compatible 'points' array");
  }
  if (!Array.isArray(popsRaw)) {
    throw new Error("demand data missing grid-compatible 'pops' array");
  }

  const popSizeById = new Map<string, number>();
  const popsMap = payload.pops_map;
  if (isObject(popsMap) || Array.isArray(popsMap)) {
    const popEntries = Array.isArray(popsMap)
      ? popsMap.map((popValue, index) => [String(index), popValue] as const)
      : Object.entries(popsMap);
    for (const [popKey, popValue] of popEntries) {
      if (!isObject(popValue)) continue;
      const popId = typeof popValue.id === "string" && popValue.id.trim() !== ""
        ? popValue.id.trim()
        : popKey;
      const size = typeof popValue.size === "number" && Number.isFinite(popValue.size)
        ? popValue.size
        : null;
      if (!popId || size === null) continue;
      popSizeById.set(popId, size);
    }
  }

  const hasAnyExplicitResidents = pointsRaw.some((pointValue) => (
    isObject(pointValue)
    && typeof pointValue.residents === "number"
    && Number.isFinite(pointValue.residents)
  ));

  const points = pointsRaw.map((pointValue, index): DemandData["points"][number] => {
    if (!isObject(pointValue)) {
      throw new Error(`grid point at index ${index} is malformed`);
    }

    const pointRef = getDemandPointRef(pointValue, `index ${index}`);
    const locationRaw = pointValue.location;
    if (!Array.isArray(locationRaw) || locationRaw.length < 2) {
      throw new Error(`grid point '${pointRef}' missing valid location tuple`);
    }
    const longitude = toFiniteNumber(locationRaw[0]);
    const latitude = toFiniteNumber(locationRaw[1]);
    if (longitude === null || latitude === null) {
      throw new Error(`grid point '${pointRef}' has non-numeric coordinates`);
    }

    const jobs = typeof pointValue.jobs === "number" && Number.isFinite(pointValue.jobs)
      ? pointValue.jobs
      : 0;
    if (jobs < 0) {
      throw new Error(`grid point '${pointRef}' has negative jobs value`);
    }

    let residents: number | null = null;
    if (typeof pointValue.residents === "number" && Number.isFinite(pointValue.residents)) {
      residents = pointValue.residents;
    } else if (hasAnyExplicitResidents) {
      residents = 0;
    } else {
      const popIdsRaw = Array.isArray(pointValue.popIds)
        ? pointValue.popIds
        : (Array.isArray(pointValue.pop_ids) ? pointValue.pop_ids : null);
      if (popIdsRaw && popIdsRaw.every((value) => typeof value === "string")) {
        residents = popIdsRaw.reduce((sum, popId) => sum + (popSizeById.get(popId) ?? 0), 0);
      }
    }

    if (residents === null) {
      throw new Error(`grid point '${pointRef}' missing numeric residents value`);
    }
    if (residents < 0) {
      throw new Error(`grid point '${pointRef}' has negative residents value`);
    }

    return {
      id: pointRef,
      location: [longitude, latitude],
      jobs,
      residents,
    };
  });

  const pops = popsRaw.map((popValue, index): DemandData["pops"][number] => {
    if (!isObject(popValue)) {
      throw new Error(`grid commute at index ${index} is malformed`);
    }

    const residenceIdValue = popValue.residenceId;
    const jobIdValue = popValue.jobId;
    const drivingDistanceValue = popValue.drivingDistance;
    const residenceId = (
      typeof residenceIdValue === "string"
      || (typeof residenceIdValue === "number" && Number.isFinite(residenceIdValue))
    ) ? String(residenceIdValue) : null;
    const jobId = (
      typeof jobIdValue === "string"
      || (typeof jobIdValue === "number" && Number.isFinite(jobIdValue))
    ) ? String(jobIdValue) : null;
    const drivingDistance = typeof drivingDistanceValue === "number" && Number.isFinite(drivingDistanceValue)
      ? drivingDistanceValue
      : null;
    if (!residenceId || !jobId || drivingDistance === null) {
      throw new Error(`grid commute at index ${index} is missing residenceId/jobId/drivingDistance`);
    }
    if (drivingDistance < 0) {
      throw new Error(`grid commute at index ${index} has negative drivingDistance`);
    }
    return { residenceId, jobId, drivingDistance };
  });

  return { points, pops };
}

export async function extractDemandStatsFromZipBuffer(
  listingId: string,
  zipBuffer: Buffer,
  options: ExtractDemandStatsOptions = {},
): Promise<MapDemandExtractionResult> {
  const warnings = options.warnings;
  const requireResidentTotalsMatch = options.requireResidentTotalsMatch === true;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    throw new Error(`listing=${listingId}: ZIP could not be opened`);
  }

  const entry = findDemandDataEntry(zip);
  if (!entry) {
    throw new Error(`listing=${listingId}: demand_data.json or demand_data.json.gz not found in ZIP`);
  }

  let rawText: string;
  try {
    if (entry.name.toLowerCase().endsWith(".gz")) {
      const compressed = await entry.async("nodebuffer");
      rawText = gunzipSync(compressed).toString("utf-8");
    } else {
      rawText = await entry.async("string");
    }
  } catch {
    throw new Error(`listing=${listingId}: failed to read demand data entry '${entry.name}'`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(`listing=${listingId}: demand data file is not valid JSON`);
  }

  const configEntry = findConfigEntry(zip);
  if (!configEntry) {
    throw new Error(`listing=${listingId}: config.json not found in ZIP`);
  }

  let configRawText: string;
  try {
    configRawText = await configEntry.async("string");
  } catch {
    throw new Error(`listing=${listingId}: failed to read config entry '${configEntry.name}'`);
  }

  let configPayload: unknown;
  try {
    configPayload = JSON.parse(configRawText);
  } catch {
    throw new Error(`listing=${listingId}: config.json is not valid JSON`);
  }

  const initialViewState = parseInitialViewState(
    isObject(configPayload)
      ? (configPayload.initialViewState ?? configPayload.initial_view_state)
      : null,
  );
  if (!initialViewState) {
    throw new Error(
      `listing=${listingId}: config.json missing valid initialViewState with numeric latitude/longitude/zoom/bearing`,
    );
  }

  const parsed = parseDemandDataPayload(payload);
  if (parsed.residentsTotalByPoint !== parsed.residentsTotalByPop) {
    const delta = parsed.residentsTotalByPoint - parsed.residentsTotalByPop;
    if (requireResidentTotalsMatch) {
      throw new Error(
        `listing=${listingId}: resident totals mismatch (points=${parsed.residentsTotalByPoint}, pops=${parsed.residentsTotalByPop}, delta=${delta})`,
      );
    }
    if (warnings) {
      warnListing(
        warnings,
        listingId,
        `resident totals differ (points=${parsed.residentsTotalByPoint}, pops=${parsed.residentsTotalByPop}, delta=${delta}); using minimum=${parsed.stats.residents_total}`,
      );
    }
  }

  let gridData: FeatureCollection<Polygon, GeoJsonProperties>;
  try {
    gridData = await generateGrid(parseDemandGridData(payload), listingId);
  } catch (error) {
    throw new Error(`listing=${listingId}: failed to generate grid data (${(error as Error).message})`);
  }

  return {
    stats: {
      ...parsed.stats,
      initial_view_state: initialViewState,
    },
    grid: gridData,
  };
}
