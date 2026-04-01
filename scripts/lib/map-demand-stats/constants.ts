import { resolveTimeoutMsFromEnv } from "../http.js";

export const CACHE_FILE_NAME = "demand-stats-cache.json";
export const DEMAND_STATS_CACHE_SCHEMA_VERSION = 2;
export const GRID_SCHEMA_VERSION = 2;
export const UNCHANGED_SKIP_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MAP_DEMAND_FETCH_TIMEOUT_MS = resolveTimeoutMsFromEnv("REGISTRY_FETCH_TIMEOUT_MS", 45_000);
