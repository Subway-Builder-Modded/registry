import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import type {
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { fetchWithTimeout } from "./http.js";
import { readJsonFile } from "./json-utils.js";

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_MERCATOR_LAT = 85.05112878;
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_OVERPASS_FALLBACK_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const DEFAULT_OVERPASS_TIMEOUT_SECONDS = 90;
const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_SVG_SIZE = 2048;
const OVERPASS_USER_AGENT = "subway-builder-modded-registry-basemap/1.0";
const OVERPASS_MAX_SUBDIVISION_DEPTH = 6;
const INCLUDED_ROAD_CLASSES = new Set<RoadClass>([
  "primary",
  "trunk",
  "motorway",
]);
const ROAD_STROKE_COLOR = "#7a7a7a";
const MAX_POINTS_PER_PATH = 1200;

const ROAD_RENDER_ORDER: RoadClass[] = ["primary", "trunk", "motorway"];

const ROAD_STROKE_WIDTH_BY_CLASS: Record<RoadClass, number> = {
  motorway: 12,
  trunk: 8,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  local: 2,
  service: 2,
  path: 1,
  other: 1,
};

export interface LonLatBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GenerateBasemapOptions {
  fetchImpl?: typeof fetch;
  overpassUrl?: string;
  overpassTimeoutSeconds?: number;
  fetchTimeoutMs?: number;
  svgSize?: number;
  generatedAt?: Date;
}

export interface GenerateBasemapResult {
  listingId: string;
  outputPath: string;
  roadCount: number;
  originalBbox: LonLatBbox;
  squareBbox: LonLatBbox;
}

export class MissingGridGeoJsonError extends Error {
  constructor(listingId: string, gridPath: string) {
    super(`[map-basemap] listing=${listingId}: grid file not found at ${gridPath}`);
    this.name = "MissingGridGeoJsonError";
  }
}

type GridFeatureCollection = FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>;

type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "local" | "service" | "path" | "other";

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, unknown>;
  geometry?: Array<{ lat?: number; lon?: number }>;
}

interface MercatorPoint {
  x: number;
  y: number;
}

interface MercatorBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RoadFeature {
  id: string;
  roadClass: RoadClass;
  coordinates: Array<{ lon: number; lat: number }>;
}

function assertFiniteNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }
}

function validateLonLat(lon: number, lat: number, context: string): void {
  if (lon < -180 || lon > 180) {
    throw new Error(`${context}: longitude out of bounds (${lon})`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`${context}: latitude out of bounds (${lat})`);
  }
  if (lat < -MAX_MERCATOR_LAT || lat > MAX_MERCATOR_LAT) {
    throw new Error(`${context}: latitude outside supported Web Mercator range (${lat})`);
  }
}

function validateBbox(bbox: LonLatBbox, context: string): void {
  validateLonLat(bbox.minLon, bbox.minLat, context);
  validateLonLat(bbox.maxLon, bbox.maxLat, context);
  if (bbox.minLon >= bbox.maxLon) {
    throw new Error(`${context}: invalid bbox, minLon >= maxLon`);
  }
  if (bbox.minLat >= bbox.maxLat) {
    throw new Error(`${context}: invalid bbox, minLat >= maxLat`);
  }
  const lonSpan = bbox.maxLon - bbox.minLon;
  if (lonSpan > 180) {
    throw new Error(`${context}: antimeridian-crossing bbox is not supported`);
  }
}

function lonLatToMercator(lon: number, lat: number): MercatorPoint {
  validateLonLat(lon, lat, "Web Mercator projection");
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: EARTH_RADIUS_METERS * lonRad,
    y: EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
}

function mercatorToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon = (x / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_METERS)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}

function bboxToSquareMercatorBounds(bbox: LonLatBbox): MercatorBbox {
  validateBbox(bbox, "squareBboxFromLonLatBbox");

  const southWest = lonLatToMercator(bbox.minLon, bbox.minLat);
  const northEast = lonLatToMercator(bbox.maxLon, bbox.maxLat);

  const width = northEast.x - southWest.x;
  const height = northEast.y - southWest.y;
  if (width <= 0 || height <= 0) {
    throw new Error("squareBboxFromLonLatBbox: non-positive projected bbox dimensions");
  }

  const centerX = (southWest.x + northEast.x) / 2;
  const centerY = (southWest.y + northEast.y) / 2;
  const halfSize = Math.max(width, height) / 2;

  return {
    minX: centerX - halfSize,
    maxX: centerX + halfSize,
    minY: centerY - halfSize,
    maxY: centerY + halfSize,
  };
}

function mercatorBoundsToLonLatBbox(bounds: MercatorBbox): LonLatBbox {
  const southWest = mercatorToLonLat(bounds.minX, bounds.minY);
  const northEast = mercatorToLonLat(bounds.maxX, bounds.maxY);
  const bbox: LonLatBbox = {
    minLon: southWest.lon,
    minLat: southWest.lat,
    maxLon: northEast.lon,
    maxLat: northEast.lat,
  };
  validateBbox(bbox, "squareBboxFromLonLatBbox");
  return bbox;
}

function collectCoordinatesFromPolygonCoordinates(
  coordinates: Position[][],
  onCoordinate: (position: Position) => void,
): void {
  for (const ring of coordinates) {
    if (!Array.isArray(ring)) continue;
    for (const position of ring) {
      onCoordinate(position);
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function resolveRoadClass(highway: string): RoadClass {
  const value = highway.toLowerCase();
  if (value === "motorway" || value === "motorway_link") return "motorway";
  if (value === "trunk" || value === "trunk_link") return "trunk";
  if (value === "primary" || value === "primary_link") return "primary";
  if (value === "secondary" || value === "secondary_link") return "secondary";
  if (value === "tertiary" || value === "tertiary_link") return "tertiary";
  if (value === "residential" || value === "unclassified" || value === "living_street") return "local";
  if (value === "service") return "service";
  if (
    value === "pedestrian"
    || value === "footway"
    || value === "cycleway"
    || value === "path"
    || value === "track"
  ) {
    return "path";
  }
  return "other";
}

function shouldExcludeLoopLikeWay(highway: string, tags: Record<string, unknown>): boolean {
  const normalized = highway.toLowerCase();
  if (normalized.endsWith("_link")) {
    return true;
  }

  const junction = typeof tags.junction === "string" ? tags.junction.toLowerCase() : "";
  if (junction === "roundabout" || junction === "circular") {
    return true;
  }

  return false;
}

function roadStrokeWidthForClass(roadClass: RoadClass): number {
  return ROAD_STROKE_WIDTH_BY_CLASS[roadClass];
}

function projectLonLatToSvg(
  lon: number,
  lat: number,
  squareMercatorBounds: MercatorBbox,
  svgSize: number,
): { x: number; y: number } {
  const merc = lonLatToMercator(lon, lat);
  const width = squareMercatorBounds.maxX - squareMercatorBounds.minX;
  const height = squareMercatorBounds.maxY - squareMercatorBounds.minY;
  if (width <= 0 || height <= 0) {
    throw new Error("Cannot project roads: square Mercator bounds are invalid");
  }

  const x = ((merc.x - squareMercatorBounds.minX) / width) * svgSize;
  const y = ((squareMercatorBounds.maxY - merc.y) / height) * svgSize;
  return { x, y };
}

function roadToPathDataChunks(
  road: RoadFeature,
  squareMercatorBounds: MercatorBbox,
  svgSize: number,
): string[] {
  const chunks: string[] = [];
  let currentParts: string[] = [];
  let pointsInChunk = 0;

  for (const coordinate of road.coordinates) {
    const projected = projectLonLatToSvg(
      coordinate.lon,
      coordinate.lat,
      squareMercatorBounds,
      svgSize,
    );
    const point = `${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;

    if (pointsInChunk === 0) {
      currentParts = [`M${point}`];
      pointsInChunk = 1;
      continue;
    }

    currentParts.push(`L${point}`);
    pointsInChunk += 1;

    if (pointsInChunk >= MAX_POINTS_PER_PATH) {
      chunks.push(currentParts.join(" "));
      currentParts = [`M${point}`];
      pointsInChunk = 1;
    }
  }

  if (pointsInChunk >= 2) {
    chunks.push(currentParts.join(" "));
  }

  return chunks;
}

function buildOverpassQuery(bbox: LonLatBbox, timeoutSeconds: number): string {
  const south = bbox.minLat.toFixed(7);
  const west = bbox.minLon.toFixed(7);
  const north = bbox.maxLat.toFixed(7);
  const east = bbox.maxLon.toFixed(7);

  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    `(`,
    `  way["highway"](${south},${west},${north},${east});`,
    `);`,
    `out tags geom;`,
  ].join("\n");
}

function normalizeOverpassUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return DEFAULT_OVERPASS_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid OSM_OVERPASS_URL value: '${value}'`);
  }

  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/api/interpreter";
  }

  return parsed.toString();
}

function isOverpassResponseTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("cannot create a string longer") || normalized.includes("invalid string length");
}

function splitBboxIntoQuadrants(bbox: LonLatBbox): LonLatBbox[] {
  const midLon = (bbox.minLon + bbox.maxLon) / 2;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;

  return [
    { minLon: bbox.minLon, minLat: bbox.minLat, maxLon: midLon, maxLat: midLat },
    { minLon: midLon, minLat: bbox.minLat, maxLon: bbox.maxLon, maxLat: midLat },
    { minLon: bbox.minLon, minLat: midLat, maxLon: midLon, maxLat: bbox.maxLat },
    { minLon: midLon, minLat: midLat, maxLon: bbox.maxLon, maxLat: bbox.maxLat },
  ];
}

function dedupeRoads(roads: RoadFeature[]): RoadFeature[] {
  const deduped = new Map<string, RoadFeature>();
  for (const road of roads) {
    const existing = deduped.get(road.id);
    if (!existing || road.coordinates.length > existing.coordinates.length) {
      deduped.set(road.id, road);
    }
  }
  return Array.from(deduped.values());
}

async function fetchRoadsFromOverpassSingleBbox(
  bbox: LonLatBbox,
  options: GenerateBasemapOptions,
): Promise<{ roads: RoadFeature[]; overpassUrl: string }> {
  const explicitOverpassUrl = options.overpassUrl ?? process.env.OSM_OVERPASS_URL;
  const endpointCandidates = explicitOverpassUrl
    ? [normalizeOverpassUrl(explicitOverpassUrl)]
    : [
      normalizeOverpassUrl(DEFAULT_OVERPASS_URL),
      ...DEFAULT_OVERPASS_FALLBACK_URLS.map((value) => normalizeOverpassUrl(value)),
    ];
  const overpassTimeoutSeconds = options.overpassTimeoutSeconds ?? DEFAULT_OVERPASS_TIMEOUT_SECONDS;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!Number.isInteger(overpassTimeoutSeconds) || overpassTimeoutSeconds <= 0) {
    throw new Error("Invalid overpass timeout, expected a positive integer number of seconds");
  }
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new Error("Invalid fetch timeout, expected a positive integer number of milliseconds");
  }

  const query = buildOverpassQuery(bbox, overpassTimeoutSeconds);
  const formBody = new URLSearchParams({ data: query }).toString();
  const endpointErrors: string[] = [];
  let response: Response | null = null;
  let selectedEndpoint = endpointCandidates[0];

  for (const endpoint of endpointCandidates) {
    selectedEndpoint = endpoint;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
            "user-agent": OVERPASS_USER_AGENT,
          },
          body: formBody,
        },
        {
          timeoutMs: fetchTimeoutMs,
        },
      );

      if (response.status === 406) {
        // Some Overpass mirrors reject one POST encoding but accept raw query text.
        response = await fetchWithTimeout(
          fetchImpl,
          endpoint,
          {
            method: "POST",
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "user-agent": OVERPASS_USER_AGENT,
            },
            body: query,
          },
          {
            timeoutMs: fetchTimeoutMs,
          },
        );
      }

      if (response.ok) {
        break;
      }

      const body = await response.text();
      endpointErrors.push(`${endpoint}: status=${response.status}, body=${body.slice(0, 250)}`);
      response = null;
    } catch (error) {
      endpointErrors.push(`${endpoint}: ${(error as Error).message}`);
      response = null;
    }
  }

  if (!response) {
    throw new Error(
      [
        "Overpass request failed for all configured endpoints.",
        ...endpointErrors.map((entry) => `- ${entry}`),
        "Hint: set OSM_OVERPASS_URL to a reachable /api/interpreter endpoint.",
      ].join("\n"),
    );
  }

  const parsed = await response.json() as { elements?: unknown };
  const elements = Array.isArray(parsed.elements) ? parsed.elements as OverpassElement[] : [];
  const roads: RoadFeature[] = [];

  for (const element of elements) {
    if (element.type !== "way") continue;
    const tags = element.tags;
    if (!tags || typeof tags !== "object") continue;

    const highwayValue = tags.highway;
    if (typeof highwayValue !== "string" || highwayValue.trim() === "") continue;
    if (shouldExcludeLoopLikeWay(highwayValue, tags)) continue;

    const geometry = Array.isArray(element.geometry) ? element.geometry : [];
    const coordinates: Array<{ lon: number; lat: number }> = [];

    for (const point of geometry) {
      if (!point) continue;
      const lon = point.lon;
      const lat = point.lat;
      if (typeof lon !== "number" || !Number.isFinite(lon)) continue;
      if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
      coordinates.push({ lon, lat });
    }

    if (coordinates.length < 2) continue;

    roads.push({
      id: String(element.id ?? `${roads.length}`),
      roadClass: resolveRoadClass(highwayValue),
      coordinates,
    });
  }

  return { roads, overpassUrl: selectedEndpoint };
}

async function fetchRoadsFromOverpass(
  bbox: LonLatBbox,
  options: GenerateBasemapOptions,
  depth = 0,
): Promise<{ roads: RoadFeature[]; overpassUrl: string }> {
  try {
    const single = await fetchRoadsFromOverpassSingleBbox(bbox, options);
    const filteredRoads = single.roads.filter((road) => INCLUDED_ROAD_CLASSES.has(road.roadClass));
    return { roads: filteredRoads, overpassUrl: single.overpassUrl };
  } catch (error) {
    if (!isOverpassResponseTooLargeError(error) || depth >= OVERPASS_MAX_SUBDIVISION_DEPTH) {
      throw error;
    }

    console.warn(
      `[map-basemap] Overpass response too large at depth=${depth}; subdividing bbox (${bbox.minLat.toFixed(5)},${bbox.minLon.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLon.toFixed(5)})`,
    );

    const quadrants = splitBboxIntoQuadrants(bbox);
    const mergedRoads: RoadFeature[] = [];
    let selectedEndpoint = options.overpassUrl ?? process.env.OSM_OVERPASS_URL ?? DEFAULT_OVERPASS_URL;

    for (const quadrant of quadrants) {
      const result = await fetchRoadsFromOverpass(quadrant, options, depth + 1);
      selectedEndpoint = result.overpassUrl;
      mergedRoads.push(...result.roads);
    }

    const filteredRoads = dedupeRoads(mergedRoads).filter((road) => INCLUDED_ROAD_CLASSES.has(road.roadClass));
    return { roads: filteredRoads, overpassUrl: selectedEndpoint };
  }
}

async function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: string): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

async function writeRoadsSvgFile(
  outputPath: string,
  listingId: string,
  roads: RoadFeature[],
  originalBbox: LonLatBbox,
  squareBbox: LonLatBbox,
  squareMercatorBounds: MercatorBbox,
  options: GenerateBasemapOptions,
  overpassUrl: string,
): Promise<void> {
  const svgSize = options.svgSize ?? DEFAULT_SVG_SIZE;
  if (!Number.isInteger(svgSize) || svgSize <= 0) {
    throw new Error("Invalid SVG size, expected a positive integer");
  }

  const metadata = {
    generated_at: (options.generatedAt ?? new Date()).toISOString(),
    listing_id: listingId,
    original_bbox: originalBbox,
    square_bbox: squareBbox,
    source_attribution: "Contains OpenStreetMap data (c) OpenStreetMap contributors",
    overpass_url: overpassUrl,
    road_count: roads.length,
  };

  const stream = createWriteStream(outputPath, { encoding: "utf-8" });
  try {
    await writeChunk(stream, `<?xml version="1.0" encoding="UTF-8"?>\n`);
    await writeChunk(
      stream,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" role="img" aria-label="Road basemap for ${escapeXml(listingId)}">\n`,
    );
    await writeChunk(stream, `<metadata>${escapeXml(JSON.stringify(metadata))}</metadata>\n`);
    await writeChunk(stream, `<g id="roads">\n`);

    for (const roadClass of ROAD_RENDER_ORDER) {
      for (const road of roads) {
        if (road.roadClass !== roadClass) continue;
        const pathDataChunks = roadToPathDataChunks(road, squareMercatorBounds, svgSize);
        if (pathDataChunks.length === 0) continue;

        const strokeWidth = roadStrokeWidthForClass(roadClass);
        const elementId = `${roadClass}-${road.id}`;
        for (let index = 0; index < pathDataChunks.length; index += 1) {
          const pathData = pathDataChunks[index];
          const chunkSuffix = pathDataChunks.length > 1 ? `-${index + 1}` : "";
          const line = `<path id="road-${escapeXml(elementId)}${chunkSuffix}" class="road ${roadClass}" d="${pathData}" stroke="${ROAD_STROKE_COLOR}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>\n`;
          await writeChunk(stream, line);
        }
      }
    }

    await writeChunk(stream, `</g>\n</svg>\n`);
    stream.end();
    await once(stream, "finish");
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function parseGridFeatureCollection(value: unknown, listingId: string): GridFeatureCollection {
  if (!value || typeof value !== "object") {
    throw new Error(`[map-basemap] listing=${listingId}: invalid grid.geojson (expected object)`);
  }

  const candidate = value as { type?: unknown; features?: unknown };
  if (candidate.type !== "FeatureCollection") {
    throw new Error(`[map-basemap] listing=${listingId}: invalid grid.geojson (expected FeatureCollection)`);
  }
  if (!Array.isArray(candidate.features)) {
    throw new Error(`[map-basemap] listing=${listingId}: invalid grid.geojson (missing features array)`);
  }

  return value as GridFeatureCollection;
}

function getGridPath(repoRoot: string, listingId: string): string {
  return resolve(repoRoot, "maps", listingId, "grid.geojson");
}

export function getBasemapPath(repoRoot: string, listingId: string): string {
  return resolve(repoRoot, "maps", listingId, "basemap.svg");
}

export function computeGridBbox(grid: GridFeatureCollection): LonLatBbox {
  if (!Array.isArray(grid.features) || grid.features.length === 0) {
    throw new Error("computeGridBbox: grid is empty");
  }

  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let seenCoordinate = false;

  const includePosition = (position: Position): void => {
    if (!Array.isArray(position) || position.length < 2) return;
    const lon = position[0];
    const lat = position[1];
    assertFiniteNumber(lon, "computeGridBbox: invalid longitude coordinate");
    assertFiniteNumber(lat, "computeGridBbox: invalid latitude coordinate");
    validateLonLat(lon, lat, "computeGridBbox");
    seenCoordinate = true;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };

  for (const feature of grid.features) {
    const geometry = feature?.geometry as ({ type?: unknown; coordinates?: unknown } | null);
    if (!geometry) continue;

    if (geometry.type === "Polygon") {
      collectCoordinatesFromPolygonCoordinates((geometry as Polygon).coordinates, includePosition);
      continue;
    }

    if (geometry.type === "MultiPolygon") {
      for (const polygonCoordinates of (geometry as MultiPolygon).coordinates) {
        collectCoordinatesFromPolygonCoordinates(polygonCoordinates, includePosition);
      }
      continue;
    }

    throw new Error(`computeGridBbox: unsupported geometry type '${String(geometry.type)}'`);
  }

  if (!seenCoordinate) {
    throw new Error("computeGridBbox: grid has no polygon coordinates");
  }

  const bbox: LonLatBbox = { minLon, minLat, maxLon, maxLat };
  validateBbox(bbox, "computeGridBbox");
  return bbox;
}

export function squareBboxFromLonLatBbox(bbox: LonLatBbox): LonLatBbox {
  const squareMercatorBounds = bboxToSquareMercatorBounds(bbox);
  return mercatorBoundsToLonLatBbox(squareMercatorBounds);
}

export async function writeBasemapFromGrid(
  repoRoot: string,
  listingId: string,
  grid: GridFeatureCollection,
  options: GenerateBasemapOptions = {},
): Promise<GenerateBasemapResult> {
  const originalBbox = computeGridBbox(grid);
  const squareMercatorBounds = bboxToSquareMercatorBounds(originalBbox);
  const squareBbox = mercatorBoundsToLonLatBbox(squareMercatorBounds);

  const { roads, overpassUrl } = await fetchRoadsFromOverpass(squareBbox, options);
  const outputPath = getBasemapPath(repoRoot, listingId);
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeRoadsSvgFile(
    outputPath,
    listingId,
    roads,
    originalBbox,
    squareBbox,
    squareMercatorBounds,
    options,
    overpassUrl,
  );

  return {
    listingId,
    outputPath,
    roadCount: roads.length,
    originalBbox,
    squareBbox,
  };
}

export async function writeBasemapFromGridFile(
  repoRoot: string,
  listingId: string,
  options: GenerateBasemapOptions = {},
): Promise<GenerateBasemapResult> {
  const gridPath = getGridPath(repoRoot, listingId);
  if (!existsSync(gridPath)) {
    throw new MissingGridGeoJsonError(listingId, gridPath);
  }

  const parsed = readJsonFile<unknown>(gridPath);
  const grid = parseGridFeatureCollection(parsed, listingId);
  return writeBasemapFromGrid(repoRoot, listingId, grid, options);
}
