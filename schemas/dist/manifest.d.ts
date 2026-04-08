import { z } from "zod";
declare const MetricSummarySchema: z.ZodObject<{
    p10: z.ZodNumber;
    p25: z.ZodNumber;
    p50: z.ZodNumber;
    p75: z.ZodNumber;
    p90: z.ZodNumber;
    mean: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    mean: number;
}, {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    mean: number;
}>;
declare const GridDetailPropertiesSchema: z.ZodObject<{
    radiusKm: z.ZodNumber;
    expectedPointSpacingKm: z.ZodNumber;
    normalizedRadius: z.ZodNumber;
    activityPerPoint: z.ZodNumber;
    playableAreaKm2: z.ZodNumber;
    playableAreaPerPointKm2: z.ZodNumber;
    playableCatchmentRadiusKm: z.ZodNumber;
    localityScore: z.ZodNumber;
    deaggregationScore: z.ZodNumber;
    score: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    radiusKm: number;
    expectedPointSpacingKm: number;
    normalizedRadius: number;
    activityPerPoint: number;
    playableAreaKm2: number;
    playableAreaPerPointKm2: number;
    playableCatchmentRadiusKm: number;
    localityScore: number;
    deaggregationScore: number;
    score: number;
}, {
    radiusKm: number;
    expectedPointSpacingKm: number;
    normalizedRadius: number;
    activityPerPoint: number;
    playableAreaKm2: number;
    playableAreaPerPointKm2: number;
    playableCatchmentRadiusKm: number;
    localityScore: number;
    deaggregationScore: number;
    score: number;
}>;
declare const PolycentrismCenterSchema: z.ZodObject<{
    longitude: z.ZodNumber;
    latitude: z.ZodNumber;
    massShare: z.ZodNumber;
    assignedMass: z.ZodNumber;
    assignedPointCount: z.ZodNumber;
    prominenceRatio: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    longitude: number;
    latitude: number;
    massShare: number;
    assignedMass: number;
    assignedPointCount: number;
    prominenceRatio: number;
}, {
    longitude: number;
    latitude: number;
    massShare: number;
    assignedMass: number;
    assignedPointCount: number;
    prominenceRatio: number;
}>;
declare const PolycentrismVariantMetricsSchema: z.ZodObject<{
    score: z.ZodNumber;
    continuousScore: z.ZodNumber;
    detectedCenterCount: z.ZodNumber;
    effectiveCenterCount: z.ZodNumber;
    largestCenterShare: z.ZodNumber;
    bandwidthKm: z.ZodNumber;
    reliabilityScore: z.ZodNumber;
    supportLevel: z.ZodEnum<["low", "medium", "high"]>;
    usedFallback: z.ZodBoolean;
    topCenters: z.ZodArray<z.ZodObject<{
        longitude: z.ZodNumber;
        latitude: z.ZodNumber;
        massShare: z.ZodNumber;
        assignedMass: z.ZodNumber;
        assignedPointCount: z.ZodNumber;
        prominenceRatio: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        longitude: number;
        latitude: number;
        massShare: number;
        assignedMass: number;
        assignedPointCount: number;
        prominenceRatio: number;
    }, {
        longitude: number;
        latitude: number;
        massShare: number;
        assignedMass: number;
        assignedPointCount: number;
        prominenceRatio: number;
    }>, "many">;
    debug: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    score: number;
    continuousScore: number;
    detectedCenterCount: number;
    effectiveCenterCount: number;
    largestCenterShare: number;
    bandwidthKm: number;
    reliabilityScore: number;
    supportLevel: "low" | "medium" | "high";
    usedFallback: boolean;
    topCenters: {
        longitude: number;
        latitude: number;
        massShare: number;
        assignedMass: number;
        assignedPointCount: number;
        prominenceRatio: number;
    }[];
    debug?: unknown;
}, {
    score: number;
    continuousScore: number;
    detectedCenterCount: number;
    effectiveCenterCount: number;
    largestCenterShare: number;
    bandwidthKm: number;
    reliabilityScore: number;
    supportLevel: "low" | "medium" | "high";
    usedFallback: boolean;
    topCenters: {
        longitude: number;
        latitude: number;
        massShare: number;
        assignedMass: number;
        assignedPointCount: number;
        prominenceRatio: number;
    }[];
    debug?: unknown;
}>;
export declare const GridStatisticsSchema: z.ZodObject<{
    residentWeightedNearestNeighborKm: z.ZodObject<{
        p10: z.ZodNumber;
        p25: z.ZodNumber;
        p50: z.ZodNumber;
        p75: z.ZodNumber;
        p90: z.ZodNumber;
        mean: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }>;
    workerWeightedNearestNeighborKm: z.ZodObject<{
        p10: z.ZodNumber;
        p25: z.ZodNumber;
        p50: z.ZodNumber;
        p75: z.ZodNumber;
        p90: z.ZodNumber;
        mean: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }>;
    commuteDistanceKm: z.ZodObject<{
        p10: z.ZodNumber;
        p25: z.ZodNumber;
        p50: z.ZodNumber;
        p75: z.ZodNumber;
        p90: z.ZodNumber;
        mean: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }>;
    residentCellDensity: z.ZodObject<{
        p10: z.ZodNumber;
        p25: z.ZodNumber;
        p50: z.ZodNumber;
        p75: z.ZodNumber;
        p90: z.ZodNumber;
        mean: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }>;
    workerCellDensity: z.ZodObject<{
        p10: z.ZodNumber;
        p25: z.ZodNumber;
        p50: z.ZodNumber;
        p75: z.ZodNumber;
        p90: z.ZodNumber;
        mean: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }, {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    }>;
    detail: z.ZodObject<{
        radiusKm: z.ZodNumber;
        expectedPointSpacingKm: z.ZodNumber;
        normalizedRadius: z.ZodNumber;
        activityPerPoint: z.ZodNumber;
        playableAreaKm2: z.ZodNumber;
        playableAreaPerPointKm2: z.ZodNumber;
        playableCatchmentRadiusKm: z.ZodNumber;
        localityScore: z.ZodNumber;
        deaggregationScore: z.ZodNumber;
        score: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        radiusKm: number;
        expectedPointSpacingKm: number;
        normalizedRadius: number;
        activityPerPoint: number;
        playableAreaKm2: number;
        playableAreaPerPointKm2: number;
        playableCatchmentRadiusKm: number;
        localityScore: number;
        deaggregationScore: number;
        score: number;
    }, {
        radiusKm: number;
        expectedPointSpacingKm: number;
        normalizedRadius: number;
        activityPerPoint: number;
        playableAreaKm2: number;
        playableAreaPerPointKm2: number;
        playableCatchmentRadiusKm: number;
        localityScore: number;
        deaggregationScore: number;
        score: number;
    }>;
    polycentrism: z.ZodObject<{
        activity: z.ZodObject<{
            score: z.ZodNumber;
            continuousScore: z.ZodNumber;
            detectedCenterCount: z.ZodNumber;
            effectiveCenterCount: z.ZodNumber;
            largestCenterShare: z.ZodNumber;
            bandwidthKm: z.ZodNumber;
            reliabilityScore: z.ZodNumber;
            supportLevel: z.ZodEnum<["low", "medium", "high"]>;
            usedFallback: z.ZodBoolean;
            topCenters: z.ZodArray<z.ZodObject<{
                longitude: z.ZodNumber;
                latitude: z.ZodNumber;
                massShare: z.ZodNumber;
                assignedMass: z.ZodNumber;
                assignedPointCount: z.ZodNumber;
                prominenceRatio: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }, {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }>, "many">;
            debug: z.ZodOptional<z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        }, {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        }>;
    }, "strip", z.ZodTypeAny, {
        activity: {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        };
    }, {
        activity: {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        };
    }>;
}, "strip", z.ZodTypeAny, {
    residentWeightedNearestNeighborKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    workerWeightedNearestNeighborKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    commuteDistanceKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    residentCellDensity: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    workerCellDensity: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    detail: {
        radiusKm: number;
        expectedPointSpacingKm: number;
        normalizedRadius: number;
        activityPerPoint: number;
        playableAreaKm2: number;
        playableAreaPerPointKm2: number;
        playableCatchmentRadiusKm: number;
        localityScore: number;
        deaggregationScore: number;
        score: number;
    };
    polycentrism: {
        activity: {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        };
    };
}, {
    residentWeightedNearestNeighborKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    workerWeightedNearestNeighborKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    commuteDistanceKm: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    residentCellDensity: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    workerCellDensity: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        mean: number;
    };
    detail: {
        radiusKm: number;
        expectedPointSpacingKm: number;
        normalizedRadius: number;
        activityPerPoint: number;
        playableAreaKm2: number;
        playableAreaPerPointKm2: number;
        playableCatchmentRadiusKm: number;
        localityScore: number;
        deaggregationScore: number;
        score: number;
    };
    polycentrism: {
        activity: {
            score: number;
            continuousScore: number;
            detectedCenterCount: number;
            effectiveCenterCount: number;
            largestCenterShare: number;
            bandwidthKm: number;
            reliabilityScore: number;
            supportLevel: "low" | "medium" | "high";
            usedFallback: boolean;
            topCenters: {
                longitude: number;
                latitude: number;
                massShare: number;
                assignedMass: number;
                assignedPointCount: number;
                prominenceRatio: number;
            }[];
            debug?: unknown;
        };
    };
}>;
export type MetricSummary = z.infer<typeof MetricSummarySchema>;
export type GridDetailProperties = z.infer<typeof GridDetailPropertiesSchema>;
export type PolycentrismCenter = z.infer<typeof PolycentrismCenterSchema>;
export type PolycentrismVariantMetrics = z.infer<typeof PolycentrismVariantMetricsSchema>;
export type GridStatistics = z.infer<typeof GridStatisticsSchema>;
export declare const UpdateConfigSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"github">;
    repo: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "github";
    repo: string;
}, {
    type: "github";
    repo: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"custom">;
    url: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "custom";
    url: string;
}, {
    type: "custom";
    url: string;
}>]>;
export declare const InitialViewStateSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    zoom: z.ZodNumber;
    bearing: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
}, {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
}>;
export declare const ModManifestSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    author: z.ZodString;
    github_id: z.ZodNumber;
    description: z.ZodString;
    tags: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    gallery: z.ZodArray<z.ZodString, "many">;
    is_test: z.ZodBoolean;
    source: z.ZodString;
    update: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"github">;
        repo: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "github";
        repo: string;
    }, {
        type: "github";
        repo: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"custom">;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "custom";
        url: string;
    }, {
        type: "custom";
        url: string;
    }>]>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
}, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
}>;
export declare const MapManifestSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    author: z.ZodString;
    github_id: z.ZodNumber;
    description: z.ZodString;
    tags: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    is_test: z.ZodBoolean;
    source: z.ZodString;
    update: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"github">;
        repo: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "github";
        repo: string;
    }, {
        type: "github";
        repo: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"custom">;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "custom";
        url: string;
    }, {
        type: "custom";
        url: string;
    }>]>;
} & {
    gallery: z.ZodArray<z.ZodString, "many">;
    city_code: z.ZodString;
    country: z.ZodString;
    population: z.ZodNumber;
    residents_total: z.ZodNumber;
    points_count: z.ZodNumber;
    population_count: z.ZodNumber;
    initial_view_state: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
        zoom: z.ZodNumber;
        bearing: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    }, {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    }>;
    grid_statistics: z.ZodOptional<z.ZodObject<{
        residentWeightedNearestNeighborKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        workerWeightedNearestNeighborKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        commuteDistanceKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        residentCellDensity: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        workerCellDensity: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        detail: z.ZodObject<{
            radiusKm: z.ZodNumber;
            expectedPointSpacingKm: z.ZodNumber;
            normalizedRadius: z.ZodNumber;
            activityPerPoint: z.ZodNumber;
            playableAreaKm2: z.ZodNumber;
            playableAreaPerPointKm2: z.ZodNumber;
            playableCatchmentRadiusKm: z.ZodNumber;
            localityScore: z.ZodNumber;
            deaggregationScore: z.ZodNumber;
            score: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        }, {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        }>;
        polycentrism: z.ZodObject<{
            activity: z.ZodObject<{
                score: z.ZodNumber;
                continuousScore: z.ZodNumber;
                detectedCenterCount: z.ZodNumber;
                effectiveCenterCount: z.ZodNumber;
                largestCenterShare: z.ZodNumber;
                bandwidthKm: z.ZodNumber;
                reliabilityScore: z.ZodNumber;
                supportLevel: z.ZodEnum<["low", "medium", "high"]>;
                usedFallback: z.ZodBoolean;
                topCenters: z.ZodArray<z.ZodObject<{
                    longitude: z.ZodNumber;
                    latitude: z.ZodNumber;
                    massShare: z.ZodNumber;
                    assignedMass: z.ZodNumber;
                    assignedPointCount: z.ZodNumber;
                    prominenceRatio: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }, {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }>, "many">;
                debug: z.ZodOptional<z.ZodUnknown>;
            }, "strip", z.ZodTypeAny, {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            }, {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            }>;
        }, "strip", z.ZodTypeAny, {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        }, {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        }>;
    }, "strip", z.ZodTypeAny, {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    }, {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    }>>;
    data_source: z.ZodString;
    source_quality: z.ZodEnum<["low-quality", "medium-quality", "high-quality"]>;
    level_of_detail: z.ZodEnum<["low-detail", "medium-detail", "high-detail"]>;
    location: z.ZodEnum<["caribbean", "central-america", "central-asia", "east-africa", "east-asia", "europe", "middle-east", "north-africa", "north-america", "oceania", "south-america", "south-asia", "southeast-asia", "southern-africa", "west-africa"]>;
    special_demand: z.ZodEffects<z.ZodArray<z.ZodEnum<["airports", "entertainment", "ferries", "hospitals", "parks", "schools", "universities"]>, "many">, ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[], ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[]>;
    file_sizes: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
    city_code: string;
    country: string;
    population: number;
    residents_total: number;
    points_count: number;
    population_count: number;
    initial_view_state: {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    };
    data_source: string;
    source_quality: "low-quality" | "medium-quality" | "high-quality";
    level_of_detail: "low-detail" | "medium-detail" | "high-detail";
    location: "caribbean" | "central-america" | "central-asia" | "east-africa" | "east-asia" | "europe" | "middle-east" | "north-africa" | "north-america" | "oceania" | "south-america" | "south-asia" | "southeast-asia" | "southern-africa" | "west-africa";
    special_demand: ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[];
    file_sizes: Record<string, number>;
    grid_statistics?: {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    } | undefined;
}, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
    city_code: string;
    country: string;
    population: number;
    residents_total: number;
    points_count: number;
    population_count: number;
    initial_view_state: {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    };
    data_source: string;
    source_quality: "low-quality" | "medium-quality" | "high-quality";
    level_of_detail: "low-detail" | "medium-detail" | "high-detail";
    location: "caribbean" | "central-america" | "central-asia" | "east-africa" | "east-asia" | "europe" | "middle-east" | "north-africa" | "north-america" | "oceania" | "south-america" | "south-asia" | "southeast-asia" | "southern-africa" | "west-africa";
    special_demand: ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[];
    file_sizes: Record<string, number>;
    grid_statistics?: {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    } | undefined;
}>;
export declare const ListingManifestSchema: z.ZodUnion<[z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    author: z.ZodString;
    github_id: z.ZodNumber;
    description: z.ZodString;
    tags: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    is_test: z.ZodBoolean;
    source: z.ZodString;
    update: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"github">;
        repo: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "github";
        repo: string;
    }, {
        type: "github";
        repo: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"custom">;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "custom";
        url: string;
    }, {
        type: "custom";
        url: string;
    }>]>;
} & {
    gallery: z.ZodArray<z.ZodString, "many">;
    city_code: z.ZodString;
    country: z.ZodString;
    population: z.ZodNumber;
    residents_total: z.ZodNumber;
    points_count: z.ZodNumber;
    population_count: z.ZodNumber;
    initial_view_state: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
        zoom: z.ZodNumber;
        bearing: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    }, {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    }>;
    grid_statistics: z.ZodOptional<z.ZodObject<{
        residentWeightedNearestNeighborKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        workerWeightedNearestNeighborKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        commuteDistanceKm: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        residentCellDensity: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        workerCellDensity: z.ZodObject<{
            p10: z.ZodNumber;
            p25: z.ZodNumber;
            p50: z.ZodNumber;
            p75: z.ZodNumber;
            p90: z.ZodNumber;
            mean: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }, {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        }>;
        detail: z.ZodObject<{
            radiusKm: z.ZodNumber;
            expectedPointSpacingKm: z.ZodNumber;
            normalizedRadius: z.ZodNumber;
            activityPerPoint: z.ZodNumber;
            playableAreaKm2: z.ZodNumber;
            playableAreaPerPointKm2: z.ZodNumber;
            playableCatchmentRadiusKm: z.ZodNumber;
            localityScore: z.ZodNumber;
            deaggregationScore: z.ZodNumber;
            score: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        }, {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        }>;
        polycentrism: z.ZodObject<{
            activity: z.ZodObject<{
                score: z.ZodNumber;
                continuousScore: z.ZodNumber;
                detectedCenterCount: z.ZodNumber;
                effectiveCenterCount: z.ZodNumber;
                largestCenterShare: z.ZodNumber;
                bandwidthKm: z.ZodNumber;
                reliabilityScore: z.ZodNumber;
                supportLevel: z.ZodEnum<["low", "medium", "high"]>;
                usedFallback: z.ZodBoolean;
                topCenters: z.ZodArray<z.ZodObject<{
                    longitude: z.ZodNumber;
                    latitude: z.ZodNumber;
                    massShare: z.ZodNumber;
                    assignedMass: z.ZodNumber;
                    assignedPointCount: z.ZodNumber;
                    prominenceRatio: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }, {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }>, "many">;
                debug: z.ZodOptional<z.ZodUnknown>;
            }, "strip", z.ZodTypeAny, {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            }, {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            }>;
        }, "strip", z.ZodTypeAny, {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        }, {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        }>;
    }, "strip", z.ZodTypeAny, {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    }, {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    }>>;
    data_source: z.ZodString;
    source_quality: z.ZodEnum<["low-quality", "medium-quality", "high-quality"]>;
    level_of_detail: z.ZodEnum<["low-detail", "medium-detail", "high-detail"]>;
    location: z.ZodEnum<["caribbean", "central-america", "central-asia", "east-africa", "east-asia", "europe", "middle-east", "north-africa", "north-america", "oceania", "south-america", "south-asia", "southeast-asia", "southern-africa", "west-africa"]>;
    special_demand: z.ZodEffects<z.ZodArray<z.ZodEnum<["airports", "entertainment", "ferries", "hospitals", "parks", "schools", "universities"]>, "many">, ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[], ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[]>;
    file_sizes: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
    city_code: string;
    country: string;
    population: number;
    residents_total: number;
    points_count: number;
    population_count: number;
    initial_view_state: {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    };
    data_source: string;
    source_quality: "low-quality" | "medium-quality" | "high-quality";
    level_of_detail: "low-detail" | "medium-detail" | "high-detail";
    location: "caribbean" | "central-america" | "central-asia" | "east-africa" | "east-asia" | "europe" | "middle-east" | "north-africa" | "north-america" | "oceania" | "south-america" | "south-asia" | "southeast-asia" | "southern-africa" | "west-africa";
    special_demand: ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[];
    file_sizes: Record<string, number>;
    grid_statistics?: {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    } | undefined;
}, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
    city_code: string;
    country: string;
    population: number;
    residents_total: number;
    points_count: number;
    population_count: number;
    initial_view_state: {
        longitude: number;
        latitude: number;
        zoom: number;
        bearing: number;
    };
    data_source: string;
    source_quality: "low-quality" | "medium-quality" | "high-quality";
    level_of_detail: "low-detail" | "medium-detail" | "high-detail";
    location: "caribbean" | "central-america" | "central-asia" | "east-africa" | "east-asia" | "europe" | "middle-east" | "north-africa" | "north-america" | "oceania" | "south-america" | "south-asia" | "southeast-asia" | "southern-africa" | "west-africa";
    special_demand: ("airports" | "entertainment" | "ferries" | "hospitals" | "parks" | "schools" | "universities")[];
    file_sizes: Record<string, number>;
    grid_statistics?: {
        residentWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerWeightedNearestNeighborKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        commuteDistanceKm: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        residentCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        workerCellDensity: {
            p10: number;
            p25: number;
            p50: number;
            p75: number;
            p90: number;
            mean: number;
        };
        detail: {
            radiusKm: number;
            expectedPointSpacingKm: number;
            normalizedRadius: number;
            activityPerPoint: number;
            playableAreaKm2: number;
            playableAreaPerPointKm2: number;
            playableCatchmentRadiusKm: number;
            localityScore: number;
            deaggregationScore: number;
            score: number;
        };
        polycentrism: {
            activity: {
                score: number;
                continuousScore: number;
                detectedCenterCount: number;
                effectiveCenterCount: number;
                largestCenterShare: number;
                bandwidthKm: number;
                reliabilityScore: number;
                supportLevel: "low" | "medium" | "high";
                usedFallback: boolean;
                topCenters: {
                    longitude: number;
                    latitude: number;
                    massShare: number;
                    assignedMass: number;
                    assignedPointCount: number;
                    prominenceRatio: number;
                }[];
                debug?: unknown;
            };
        };
    } | undefined;
}>, z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    author: z.ZodString;
    github_id: z.ZodNumber;
    description: z.ZodString;
    tags: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    gallery: z.ZodArray<z.ZodString, "many">;
    is_test: z.ZodBoolean;
    source: z.ZodString;
    update: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"github">;
        repo: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "github";
        repo: string;
    }, {
        type: "github";
        repo: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"custom">;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "custom";
        url: string;
    }, {
        type: "custom";
        url: string;
    }>]>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
}, {
    schema_version: 1;
    source: string;
    id: string;
    name: string;
    author: string;
    github_id: number;
    description: string;
    tags: string[];
    gallery: string[];
    is_test: boolean;
    update: {
        type: "github";
        repo: string;
    } | {
        type: "custom";
        url: string;
    };
}>]>;
export type UpdateConfig = z.infer<typeof UpdateConfigSchema>;
export type InitialViewState = z.infer<typeof InitialViewStateSchema>;
export type ModManifest = z.infer<typeof ModManifestSchema>;
export type MapManifest = z.infer<typeof MapManifestSchema>;
export type ListingManifest = z.infer<typeof ListingManifestSchema>;
export {};
//# sourceMappingURL=manifest.d.ts.map