import { z } from "zod";
import { type ScoredDataQualityTier } from "./data-quality-ladders.js";
export declare const DataQualityTierSchema: z.ZodEnum<["very-high", "high", "medium", "low", "very-low", "absent", "unknown"]>;
export declare const ScoredDataQualityTierSchema: z.ZodEnum<[ScoredDataQualityTier, ...ScoredDataQualityTier[]]>;
/**
 * Unknown marker: stamped on every unscored map so the field is present on all
 * manifests and always overrides source_quality for new readers (plan D5).
 * Carries no scores and no provenance — nothing was scored.
 */
export declare const UnknownDataQualitySchema: z.ZodObject<{
    tier: z.ZodLiteral<"unknown">;
    rubric_version: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    tier: "unknown";
    rubric_version: number;
}, {
    tier: "unknown";
    rubric_version: number;
}>;
/**
 * Scored block: written only once a reviewer has confirmed the answers file
 * (provenance "reviewed") or the map was backfilled from a pipeline already
 * scored in docs/data-quality.md ("backfill"). Never "self-reported" — the
 * manifest tier is reviewer-gated (plan D3).
 */
export declare const ScoredManifestDataQualitySchema: z.ZodObject<{
    tier: z.ZodEnum<[ScoredDataQualityTier, ...ScoredDataQualityTier[]]>;
    raw_score: z.ZodOptional<z.ZodNumber>;
    weighted_score: z.ZodOptional<z.ZodNumber>;
    rubric_version: z.ZodNumber;
    provenance: z.ZodEnum<["reviewed", "backfill"]>;
}, "strict", z.ZodTypeAny, {
    tier: ScoredDataQualityTier;
    rubric_version: number;
    provenance: "reviewed" | "backfill";
    raw_score?: number | undefined;
    weighted_score?: number | undefined;
}, {
    tier: ScoredDataQualityTier;
    rubric_version: number;
    provenance: "reviewed" | "backfill";
    raw_score?: number | undefined;
    weighted_score?: number | undefined;
}>;
export declare const ManifestDataQualitySchema: z.ZodUnion<[z.ZodObject<{
    tier: z.ZodEnum<[ScoredDataQualityTier, ...ScoredDataQualityTier[]]>;
    raw_score: z.ZodOptional<z.ZodNumber>;
    weighted_score: z.ZodOptional<z.ZodNumber>;
    rubric_version: z.ZodNumber;
    provenance: z.ZodEnum<["reviewed", "backfill"]>;
}, "strict", z.ZodTypeAny, {
    tier: ScoredDataQualityTier;
    rubric_version: number;
    provenance: "reviewed" | "backfill";
    raw_score?: number | undefined;
    weighted_score?: number | undefined;
}, {
    tier: ScoredDataQualityTier;
    rubric_version: number;
    provenance: "reviewed" | "backfill";
    raw_score?: number | undefined;
    weighted_score?: number | undefined;
}>, z.ZodObject<{
    tier: z.ZodLiteral<"unknown">;
    rubric_version: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    tier: "unknown";
    rubric_version: number;
}, {
    tier: "unknown";
    rubric_version: number;
}>]>;
export declare const DATA_QUALITY_PROVENANCE_METHODS: readonly ["self-reported", "reviewed", "backfill"];
/**
 * Canonical rubric answers. Scores and tier are a pure function of this block
 * (scripts/lib/data-quality.ts); CI recomputes and rejects manifests that
 * disagree. od_granularity is null when the O/D rung carries no measured grain
 * (synthetic / prior / none) — the G multiplier is then omitted.
 */
export declare const DataQualityAnswersSchema: z.ZodObject<{
    workplace_count: z.ZodEnum<["physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none", ...("physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none")[]]>;
    workplace_granularity: z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>;
    workplace_resolution: z.ZodEnum<["exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon", ...("exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon")[]]>;
    workplace_intensity: z.ZodEnum<["measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform", ...("measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform")[]]>;
    resident_count: z.ZodEnum<["none" | "employed_residents" | "working_age" | "total_population", ...("none" | "employed_residents" | "working_age" | "total_population")[]]>;
    resident_granularity: z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>;
    resident_resolution: z.ZodEnum<["exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon", ...("exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon")[]]>;
    resident_intensity: z.ZodEnum<["measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform", ...("measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform")[]]>;
    od_metric: z.ZodEnum<["none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic", ...("none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic")[]]>;
    od_granularity: z.ZodNullable<z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>>;
}, "strict", z.ZodTypeAny, {
    workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
    workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
    workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
    workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
    resident_count: "none" | "employed_residents" | "working_age" | "total_population";
    resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
    resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
    resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
    od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
    od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
}, {
    workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
    workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
    workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
    workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
    resident_count: "none" | "employed_residents" | "working_age" | "total_population";
    resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
    resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
    resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
    od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
    od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
}>;
export declare const DataQualityProvenanceSchema: z.ZodObject<{
    method: z.ZodEnum<["self-reported", "reviewed", "backfill"]>;
    /** GitHub login of whoever supplied the answers (author or maintainer). */
    submitted_by: z.ZodString;
    /** GitHub login of the confirming maintainer; null while self-reported. */
    reviewed_by: z.ZodNullable<z.ZodString>;
    /** ISO date (YYYY-MM-DD) the answers were last submitted or confirmed. */
    date: z.ZodString;
}, "strict", z.ZodTypeAny, {
    date: string;
    method: "reviewed" | "backfill" | "self-reported";
    submitted_by: string;
    reviewed_by: string | null;
}, {
    date: string;
    method: "reviewed" | "backfill" | "self-reported";
    submitted_by: string;
    reviewed_by: string | null;
}>;
export declare const DataQualityAnswersFileSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    /** Map id; must match the manifest id of the directory the file sits in. */
    id: z.ZodString;
    answers: z.ZodObject<{
        workplace_count: z.ZodEnum<["physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none", ...("physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none")[]]>;
        workplace_granularity: z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>;
        workplace_resolution: z.ZodEnum<["exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon", ...("exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon")[]]>;
        workplace_intensity: z.ZodEnum<["measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform", ...("measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform")[]]>;
        resident_count: z.ZodEnum<["none" | "employed_residents" | "working_age" | "total_population", ...("none" | "employed_residents" | "working_age" | "total_population")[]]>;
        resident_granularity: z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>;
        resident_resolution: z.ZodEnum<["exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon", ...("exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon")[]]>;
        resident_intensity: z.ZodEnum<["measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform", ...("measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform")[]]>;
        od_metric: z.ZodEnum<["none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic", ...("none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic")[]]>;
        od_granularity: z.ZodNullable<z.ZodEnum<["none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1", ...("none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1")[]]>>;
    }, "strict", z.ZodTypeAny, {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    }, {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    }>;
    /** Methodology narrative (persisted from the submission form). */
    notes: z.ZodString;
    /** Citations / dataset links backing the answers. */
    sources: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** Audit note for ambiguous grain calls (docs/data-quality.md §2). */
    ambiguity_bounds: z.ZodOptional<z.ZodString>;
    /** Map id whose reviewed answers these were inherited from (same-methodology flow). */
    derived_from: z.ZodOptional<z.ZodString>;
    provenance: z.ZodObject<{
        method: z.ZodEnum<["self-reported", "reviewed", "backfill"]>;
        /** GitHub login of whoever supplied the answers (author or maintainer). */
        submitted_by: z.ZodString;
        /** GitHub login of the confirming maintainer; null while self-reported. */
        reviewed_by: z.ZodNullable<z.ZodString>;
        /** ISO date (YYYY-MM-DD) the answers were last submitted or confirmed. */
        date: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    }, {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    }>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    provenance: {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    };
    id: string;
    answers: {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    };
    notes: string;
    sources?: string[] | undefined;
    ambiguity_bounds?: string | undefined;
    derived_from?: string | undefined;
}, {
    schema_version: 1;
    provenance: {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    };
    id: string;
    answers: {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    };
    notes: string;
    sources?: string[] | undefined;
    ambiguity_bounds?: string | undefined;
    derived_from?: string | undefined;
}>, {
    schema_version: 1;
    provenance: {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    };
    id: string;
    answers: {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    };
    notes: string;
    sources?: string[] | undefined;
    ambiguity_bounds?: string | undefined;
    derived_from?: string | undefined;
}, {
    schema_version: 1;
    provenance: {
        date: string;
        method: "reviewed" | "backfill" | "self-reported";
        submitted_by: string;
        reviewed_by: string | null;
    };
    id: string;
    answers: {
        workplace_count: "physical_measured" | "physical_inferred" | "registered_self_declared" | "size_bands" | "estimated_proxy" | "none";
        workplace_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        workplace_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        workplace_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        resident_count: "none" | "employed_residents" | "working_age" | "total_population";
        resident_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1";
        resident_resolution: "exact_footprints" | "mesh_125_or_adm5" | "mesh_250" | "mesh_500" | "ml_hybrid_footprints" | "osm_footprints" | "mesh_1km" | "admin_polygon";
        resident_intensity: "measured_per_unit" | "fine_types_calibrated" | "fine_types_generic" | "coarse_sector" | "binary_split" | "size_only" | "uniform";
        od_metric: "none" | "full_matrix" | "structured_marginals" | "marginal_od" | "synthetic_measured_marginals" | "prior_informed_synthetic";
        od_granularity: "none" | "mesh_250" | "mesh_500" | "mesh_1km" | "mesh_125" | "mesh_coarse" | "adm5" | "adm4" | "adm3" | "adm2" | "adm1" | null;
    };
    notes: string;
    sources?: string[] | undefined;
    ambiguity_bounds?: string | undefined;
    derived_from?: string | undefined;
}>;
export type DataQualityProvenanceMethod = (typeof DATA_QUALITY_PROVENANCE_METHODS)[number];
export type ManifestDataQuality = z.infer<typeof ManifestDataQualitySchema>;
export type DataQualityAnswers = z.infer<typeof DataQualityAnswersSchema>;
export type DataQualityProvenance = z.infer<typeof DataQualityProvenanceSchema>;
export type DataQualityAnswersFile = z.infer<typeof DataQualityAnswersFileSchema>;
//# sourceMappingURL=data-quality.d.ts.map