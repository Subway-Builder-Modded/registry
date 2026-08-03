import { z } from "zod";
import { DifficultySchema, LocationTagSchema, LevelOfDetailSchema, SourceQualitySchema, SpecialDemandTagSchema, } from "./constants.js";
import { ManifestDataQualitySchema } from "./data-quality.js";
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
// A caretaker window: the period during which a caretaker (a time-locked
// collaborator) maintained the listing. The active caretaker is the entry
// without `until`; downloads of versions released inside a window are
// credited to that caretaker (crediting is applied at the analytics layer).
export const CaretakerWindowSchema = z.object({
    github_id: z.number().int().min(1),
    since: z.string().datetime(),
    until: z.string().datetime().optional(),
});
const CaretakersSchema = z
    .array(CaretakerWindowSchema)
    .superRefine((entries, ctx) => {
    let activeIndex = null;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry.until === undefined) {
            if (activeIndex !== null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [index],
                    message: "at most one caretaker entry may be active (missing until)",
                });
            }
            activeIndex = index;
        }
        else if (Date.parse(entry.until) <= Date.parse(entry.since)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, "until"],
                message: "caretaker until must be after since",
            });
        }
        if (index > 0
            && Date.parse(entries[index - 1].since) > Date.parse(entry.since)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, "since"],
                message: "caretaker entries must be in ascending since order",
            });
        }
    }
    if (activeIndex !== null && activeIndex !== entries.length - 1) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [activeIndex],
            message: "the active caretaker entry (missing until) must be the last entry",
        });
    }
});
// A deprecation record: presence marks the listing as deprecated (there is no
// separate status enum — consumers derive the Deprecated status from this
// field, the same way incompatibility is derived from integrity data).
// Deprecation is requested by the listing's author or active caretaker only,
// never by ordinary collaborators. The listing's manifest, gallery, and
// download attribution are retained; deprecation is not removal.
export const DeprecationSchema = z.object({
    since: z.string().datetime(),
    by_github_id: z.number().int().min(1),
    // Author-supplied, rendered publicly on listing detail pages.
    reason: z.string().min(1).optional(),
});
const BaseManifestSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().min(1),
    author: z.string().min(1),
    github_id: z.number().int().min(1),
    collaborators: z.array(z.number().int().min(1)).refine((a) => new Set(a).size === a.length, { message: "collaborators must be unique" }).optional(),
    // Caretaker history (ascending by since). Invariants enforced above: closed
    // windows have until > since, and at most one entry is active (no until),
    // which must be the last entry. Every caretaker is also a collaborator.
    caretakers: CaretakersSchema.optional(),
    // Present iff the listing is deprecated (see DeprecationSchema above).
    deprecation: DeprecationSchema.optional(),
    description: z.string().min(1),
    tags: z.array(z.string().min(1)).refine((a) => new Set(a).size === a.length, { message: "tags must be unique" }),
    gallery: z.array(z.string().min(1)),
    is_test: z.boolean(),
    source: z.string().url(),
    update: UpdateConfigSchema,
    // Epoch seconds of the listing's latest stable release, emitted by the
    // analytics pipeline so clients can show "last updated" without resolving
    // upstream releases at load time. Optional: not every manifest has been
    // regenerated since this field was introduced.
    last_updated: z.number().int().min(0).optional(),
    // Alternate search terms generated by the search-aliases pipeline (e.g. city
    // exonyms, script variants, endonyms). Not author-provided; absent until the
    // pipeline runs. Available on both map and mod manifests for future use.
    search_aliases: z.array(z.string().min(1)).optional(),
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
    // Seven-tier rubric result (docs/data-quality.md). Optional only for
    // manifests predating the migration; the backfill stamps an explicit unknown
    // marker on every map, and new readers always prefer this field. Fully
    // decoupled from source_quality, which is a frozen, write-once legacy tag.
    data_quality: ManifestDataQualitySchema.optional(),
    // Machine-managed: derived from `country` via COUNTRY_TO_LOCATION at intake.
    location: LocationTagSchema,
    special_demand: z.array(SpecialDemandTagSchema).refine((a) => new Set(a).size === a.length, { message: "special_demand must be unique" }),
    // Author-provided city-select difficulty badge; absent when the author has
    // not rated the map.
    difficulty: DifficultySchema.optional(),
    file_sizes: z.record(z.number().min(0)),
    // Author-provided list of major cities whose territory this map covers but
    // whose names are not reflected in the map name (e.g. a "Gdańsk" map that
    // also covers Gdynia and Sopot). Used by generate-search-aliases to collect
    // GeoNames alternate names for those additional cities.
    included_cities: z.array(z.string().min(1)).optional(),
}).strict();
export const ListingManifestSchema = z.union([MapManifestSchema, ModManifestSchema]);
