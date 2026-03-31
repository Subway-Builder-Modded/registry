import type { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";
import type { DownloadAttributionDelta } from "../download-attribution.js";
import type { InitialViewState } from "../manifests.js";

export interface DemandStats {
  residents_total: number;
  points_count: number;
  population_count: number;
  initial_view_state: InitialViewState;
}

export interface ExtractDemandStatsOptions {
  warnings?: string[];
  requireResidentTotalsMatch?: boolean;
}

export interface DemandStatsCacheGridEntry {
  schema_version: number;
}

export interface ParsedDemandDataPayloadResult {
  stats: Omit<DemandStats, "initial_view_state">;
  residentsTotalByPoint: number;
  residentsTotalByPop: number;
}

export interface MapDemandExtractionResult {
  stats: DemandStats;
  grid: FeatureCollection<Polygon, GeoJsonProperties>;
}

export interface GenerateMapDemandStatsOptions {
  repoRoot: string;
  token?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  mapId?: string;
  strictFingerprintCache?: boolean;
  attributionDelta?: DownloadAttributionDelta;
}

export interface GenerateMapDemandStatsResult {
  processedMaps: number;
  updatedMaps: number;
  gridFilesWritten: number;
  skippedMaps: number;
  skippedUnchanged: number;
  extractionFailures: number;
  residentsDeltaTotal: number;
  attributionFetchesAdded: number;
  warnings: string[];
  rateLimit: {
    queries: number;
    totalCost: number;
    firstRemaining: number | null;
    lastRemaining: number | null;
    estimatedConsumed: number | null;
    resetAt: string | null;
  };
}

export type JsonObject = Record<string, unknown>;

export type MapUpdateSource =
  | { type: "github"; repo: string }
  | { type: "custom"; url: string };

export interface DemandStatsCacheEntry {
  source_fingerprint: string;
  last_checked_at: string;
  stats?: DemandStats;
  grid?: DemandStatsCacheGridEntry;
}

export type DemandStatsCache = Record<string, DemandStatsCacheEntry>;

export interface DemandStatsCacheFile {
  schema_version: number;
  listings: DemandStatsCache;
}

export interface ResolvedInstallTarget {
  zipUrl: string;
  sourceFingerprint: string;
  attributionAssetKey?: string;
}
