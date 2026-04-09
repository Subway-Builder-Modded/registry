import { z } from "zod";
import { LocationTagSchema, LevelOfDetailSchema, SourceQualitySchema, SpecialDemandTagSchema, } from "./constants.js";
// --- Grid statistics (from map-analytics-grid.ts / map-detail-metrics.ts / map-polycentrism.ts) ---
const MetricSummarySchema = z.object({
    p10: z.number(),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p90: z.number(),
    mean: z.number(),
});
const GridDetailPropertiesSchema = z.object({
    radiusKm: z.number(),
    expectedPointSpacingKm: z.number(),
    normalizedRadius: z.number(),
    activityPerPoint: z.number(),
    playableAreaKm2: z.number(),
    playableAreaPerPointKm2: z.number(),
    playableCatchmentRadiusKm: z.number(),
    localityScore: z.number(),
    deaggregationScore: z.number(),
    score: z.number(),
});
const PolycentrismCenterSchema = z.object({
    longitude: z.number(),
    latitude: z.number(),
    massShare: z.number(),
    assignedMass: z.number(),
    assignedPointCount: z.number(),
    prominenceRatio: z.number(),
});
const PolycentrismVariantMetricsSchema = z.object({
    score: z.number(),
    continuousScore: z.number(),
    detectedCenterCount: z.number(),
    effectiveCenterCount: z.number(),
    largestCenterShare: z.number(),
    bandwidthKm: z.number(),
    reliabilityScore: z.number(),
    supportLevel: z.enum(["low", "medium", "high"]),
    usedFallback: z.boolean(),
    topCenters: z.array(PolycentrismCenterSchema),
    // debug is present in the TypeScript type but omitted from manifest JSON output
    debug: z.unknown().optional(),
});
export const GridStatisticsSchema = z.object({
    residentWeightedNearestNeighborKm: MetricSummarySchema,
    workerWeightedNearestNeighborKm: MetricSummarySchema,
    commuteDistanceKm: MetricSummarySchema,
    residentCellDensity: MetricSummarySchema,
    workerCellDensity: MetricSummarySchema,
    detail: GridDetailPropertiesSchema,
    polycentrism: z.object({ activity: PolycentrismVariantMetricsSchema }),
});
// --- Manifest schemas ---
export const UpdateConfigSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("github"),
        repo: z.string().regex(/^[^/]+\/[^/]+$/),
    }),
    z.object({
        type: z.literal("custom"),
        url: z.string().url(),
    }),
]);
export const InitialViewStateSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    zoom: z.number(),
    pitch: z.number().optional(),
    bearing: z.number(),
});
const BaseManifestSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().min(1),
    author: z.string().min(1),
    github_id: z.number().int().min(1),
    description: z.string().min(1),
    tags: z.array(z.string().min(1)).refine((a) => new Set(a).size === a.length, { message: "tags must be unique" }),
    gallery: z.array(z.string().min(1)),
    is_test: z.boolean(),
    source: z.string().url(),
    update: UpdateConfigSchema,
});
export const ModManifestSchema = BaseManifestSchema.strict();
export const MapManifestSchema = BaseManifestSchema.extend({
    gallery: z.array(z.string().min(1)).min(1),
    city_code: z.string().regex(/^[A-Z0-9]{2,4}$/),
    country: z.string().regex(/^[A-Z]{2}$/),
    population: z.number().int().min(0),
    residents_total: z.number().int().min(0),
    points_count: z.number().int().min(0),
    population_count: z.number().int().min(0),
    initial_view_state: InitialViewStateSchema,
    grid_statistics: GridStatisticsSchema.optional(),
    data_source: z.string().min(1),
    source_quality: SourceQualitySchema,
    level_of_detail: LevelOfDetailSchema,
    location: LocationTagSchema,
    special_demand: z.array(SpecialDemandTagSchema).refine((a) => new Set(a).size === a.length, { message: "special_demand must be unique" }),
    file_sizes: z.record(z.number().min(0)),
}).strict();
export const ListingManifestSchema = z.union([MapManifestSchema, ModManifestSchema]);
