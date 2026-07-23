import type { SourceQuality } from "./constants.js";
/**
 * Canonical data-quality rubric ladders, transcribed from docs/data-quality.md.
 *
 * This module is the single source of truth for the seven-tier data-quality
 * system: enum values, numeric rubric weights, plain-language issue-form
 * labels, and short descriptions all live here. The scoring library, the
 * answers-file schema, the generated issue-form dropdowns, and the
 * data-quality-questions doc tables must all derive from these constants.
 *
 * Bump RUBRIC_VERSION when any weight or threshold changes; scored manifests
 * pin the version they were computed under so re-scores are deliberate.
 */
export declare const RUBRIC_VERSION = 1;
export declare const DATA_QUALITY_TIERS: readonly ["very-high", "high", "medium", "low", "very-low", "absent", "unknown"];
export type DataQualityTier = (typeof DATA_QUALITY_TIERS)[number];
export type ScoredDataQualityTier = Exclude<DataQualityTier, "unknown">;
/** Grade letter aliases (docs/data-quality.md §8). Display sugar; never stored. */
export declare const DATA_QUALITY_TIER_GRADES: Record<DataQualityTier, string>;
/**
 * Tier thresholds on the weighted composite score, ordered descending.
 * A tier applies when weighted_score >= min.
 */
export declare const DATA_QUALITY_TIER_THRESHOLDS: ReadonlyArray<{
    tier: ScoredDataQualityTier;
    min: number;
}>;
export declare function tierForWeightedScore(weightedScore: number): ScoredDataQualityTier;
/**
 * Collapse map from rubric tier to the legacy three-value source_quality tag.
 *
 * Used ONLY to initialize source_quality on brand-new listings that already
 * carry a reviewed tier at creation time. The legacy field is write-once and
 * otherwise fully decoupled from the tier: existing values are frozen
 * historical self-reports and are never rewritten (plan decision D1).
 */
export declare const TIER_TO_SOURCE_QUALITY: Record<ScoredDataQualityTier, SourceQuality>;
/** Returns null for "unknown" — no initialization signal (caller falls back to the default). */
export declare function collapseTier(tier: DataQualityTier): SourceQuality | null;
/** Pillar weights (docs/data-quality.md §1). */
export declare const PILLAR_WEIGHTS: {
    readonly workplace: 0.5;
    readonly resident: 0.35;
    readonly od: 0.15;
};
export interface DataQualityLadderRung<V extends string = string> {
    /** Canonical enum value stored in maps/<id>/data-quality.json answers. */
    value: V;
    /** Rubric multiplier for this rung. */
    weight: number;
    /**
     * Plain-language option label emitted into the generated issue forms.
     * Null when the rung is reviewer-assigned only (not offered as a form option).
     */
    formLabel: string | null;
    /** Shorthand of the rubric rung, for reviewers and generated docs. */
    description: string;
}
/** Workplace count ground truth (docs/data-quality.md §4). */
export declare const WORKPLACE_COUNT_LADDER: readonly [{
    readonly value: "physical_measured";
    readonly weight: 1;
    readonly formLabel: "A government census or survey that counts where people actually work";
    readonly description: "Physical, instrument-measured: a census place-of-work question or establishment census measures where each employee physically works";
}, {
    readonly value: "physical_inferred";
    readonly weight: 0.85;
    readonly formLabel: "Government statistics reconstructed to actual work locations from linked records";
    readonly description: "Physical, inferred: a register the statistics office has cross-referenced to physical work location";
}, {
    readonly value: "registered_self_declared";
    readonly weight: 0.7;
    readonly formLabel: "A government business register — jobs counted at each company's registered address";
    readonly description: "Registered, self-declared: counts taken at the firm's declared establishment/HQ address; multi-site firms collapse onto one node";
}, {
    readonly value: "size_bands";
    readonly weight: 0.5;
    readonly formLabel: "Counts of businesses by size range, not exact job counts";
    readonly description: "Institutional worker sizes: firms binned by employee-count band per area — a size distribution, not a headcount at a location";
}, {
    readonly value: "estimated_proxy";
    readonly weight: 0.3;
    readonly formLabel: "Estimated from population or other indirect statistics";
    readonly description: "Estimated, census-anchored proxy: magnitude bootstrapped from a real published figure then redistributed by an independent signal";
}, {
    readonly value: "none";
    readonly weight: 0;
    readonly formLabel: "No real-world job data";
    readonly description: "No census anchor, or a residence employment count used verbatim as workplace";
}];
/** Resident count ground truth (docs/data-quality.md §5). */
export declare const RESIDENT_COUNT_LADDER: readonly [{
    readonly value: "employed_residents";
    readonly weight: 1;
    readonly formLabel: "Employed residents — people with jobs, counted where they live";
    readonly description: "Counts people who have a job, at their place of residence — exactly the origin set that generates commutes";
}, {
    readonly value: "working_age";
    readonly weight: 0.7;
    readonly formLabel: "Everyone of working age (roughly 15–64)";
    readonly description: "Counts everyone of working age living in the area, employed or not — approximate to the commuter pool";
}, {
    readonly value: "total_population";
    readonly weight: 0.4;
    readonly formLabel: "Total population, including children and retirees";
    readonly description: "Counts every resident — the origin total is materially larger and more skewed than the true commuter set";
}, {
    readonly value: "none";
    readonly weight: 0;
    readonly formLabel: "No census population data";
    readonly description: "No residence-side count is used";
}];
/**
 * Spatial Resolution R — where mass can land (docs/data-quality.md §3).
 * Not asked directly; the collapsed placement form questions map onto (R, I)
 * pairs via the *_PLACEMENT_FORM_OPTIONS tables below.
 */
export declare const SPATIAL_RESOLUTION_LADDER: readonly [{
    readonly value: "exact_footprints";
    readonly weight: 1;
    readonly formLabel: null;
    readonly description: "Exact building footprints: an authoritative national cadastre / building register places mass to the individual structure";
}, {
    readonly value: "mesh_125_or_adm5";
    readonly weight: 0.9;
    readonly formLabel: null;
    readonly description: "Uniform census mesh ≤125 m, OR an official ADM5 unit (census block / sub-里) carrying a measured per-cell count";
}, {
    readonly value: "mesh_250";
    readonly weight: 0.85;
    readonly formLabel: null;
    readonly description: "Fine, complete published census mesh ≤250 m";
}, {
    readonly value: "mesh_500";
    readonly weight: 0.75;
    readonly formLabel: null;
    readonly description: "Medium published census mesh ≤500 m, unrefined — a building-footprint refinement within the cell lifts toward the ≤250 m tier";
}, {
    readonly value: "ml_hybrid_footprints";
    readonly weight: 0.7;
    readonly formLabel: null;
    readonly description: "ML / satellite or multi-source footprints (Overture, GHS-OBAT, …) — near-complete coverage, geometry inferred, no native use-tags";
}, {
    readonly value: "osm_footprints";
    readonly weight: 0.6;
    readonly formLabel: null;
    readonly description: "Crowd-sourced OSM footprints alone — accurate where present but incomplete and uneven";
}, {
    readonly value: "mesh_1km";
    readonly weight: 0.5;
    readonly formLabel: null;
    readonly description: "Coarse published census mesh ≤1 km";
}, {
    readonly value: "admin_polygon";
    readonly weight: 0.3;
    readonly formLabel: null;
    readonly description: "No sub-admin geometry; mass spread across the whole unit";
}];
/** Intensity Fidelity I — how the total is shared among candidate locations (docs/data-quality.md §3). */
export declare const INTENSITY_FIDELITY_LADDER: readonly [{
    readonly value: "measured_per_unit";
    readonly weight: 1;
    readonly formLabel: null;
    readonly description: "Directly measured per cell / building: the unit already carries its own measured count, nothing is apportioned";
}, {
    readonly value: "fine_types_calibrated";
    readonly weight: 0.85;
    readonly formLabel: null;
    readonly description: "Fine building-type weights (NACE-class or dwelling-level), with per-type weights tuned to the country's own published figures";
}, {
    readonly value: "fine_types_generic";
    readonly weight: 0.6;
    readonly formLabel: null;
    readonly description: "Fine building-type weights from generic or international rules of thumb, not locally verified";
}, {
    readonly value: "coarse_sector";
    readonly weight: 0.5;
    readonly formLabel: null;
    readonly description: "Coarse sector split (primary/secondary/tertiary or office/industrial/retail); within a sector, mass spread by size";
}, {
    readonly value: "binary_split";
    readonly weight: 0.4;
    readonly formLabel: null;
    readonly description: "Binary worker/resident split: mass routed onto the correct side and spread by size, no productive types distinguished";
}, {
    readonly value: "size_only";
    readonly weight: 0.25;
    readonly formLabel: null;
    readonly description: "No building-type distinction at all — demand spread by raw building size across every building";
}, {
    readonly value: "uniform";
    readonly weight: 0.1;
    readonly formLabel: null;
    readonly description: "Demand spread evenly, ignoring building size and location";
}];
/**
 * Granularity of the measured count + multiplier G (docs/data-quality.md §2, §8).
 * The weight field is the G multiplier. Rungs with a null formLabel are
 * reviewer-refined (the form's grid option maps to mesh_250 as the middle mesh).
 */
export declare const GRANULARITY_LADDER: readonly [{
    readonly value: "mesh_125";
    readonly weight: 1;
    readonly formLabel: null;
    readonly description: "Mesh — very-fine, uniform (≤125 m)";
}, {
    readonly value: "mesh_250";
    readonly weight: 0.95;
    readonly formLabel: "Small uniform grid squares, roughly 100–250 m";
    readonly description: "Mesh — fine (≤250 m)";
}, {
    readonly value: "mesh_500";
    readonly weight: 0.9;
    readonly formLabel: null;
    readonly description: "Mesh — medium (≤500 m)";
}, {
    readonly value: "mesh_1km";
    readonly weight: 0.85;
    readonly formLabel: null;
    readonly description: "Mesh — coarse (≤1 km)";
}, {
    readonly value: "mesh_coarse";
    readonly weight: 0.65;
    readonly formLabel: null;
    readonly description: "Mesh — very-coarse (>1 km)";
}, {
    readonly value: "adm5";
    readonly weight: 0.95;
    readonly formLabel: "Individual buildings or census blocks";
    readonly description: "Measured-pop ADM5 unit (census block / sub-里)";
}, {
    readonly value: "adm4";
    readonly weight: 0.9;
    readonly formLabel: "Neighborhoods or districts within a city";
    readonly description: "Sub-municipal (ADM4)";
}, {
    readonly value: "adm3";
    readonly weight: 0.7;
    readonly formLabel: "Whole cities or municipalities";
    readonly description: "Municipal (ADM3)";
}, {
    readonly value: "adm2";
    readonly weight: 0.5;
    readonly formLabel: "Counties or larger regions";
    readonly description: "Regional (ADM2)";
}, {
    readonly value: "adm1";
    readonly weight: 0.3;
    readonly formLabel: "States or provinces";
    readonly description: "Provincial (ADM1)";
}, {
    readonly value: "none";
    readonly weight: 0;
    readonly formLabel: "Not based on official statistics areas";
    readonly description: "No census anchor";
}];
/** O/D metric (docs/data-quality.md §6). */
export declare const OD_METRIC_LADDER: readonly [{
    readonly value: "full_matrix";
    readonly weight: 1;
    readonly formLabel: "Yes — a full table of commuters between every pair of areas";
    readonly description: "Every home-area → work-area commute flow is counted directly";
}, {
    readonly value: "structured_marginals";
    readonly weight: 0.75;
    readonly formLabel: "Partial — per-area totals plus how far or where trips tend to go";
    readonly description: "Per-area in/out totals plus distance/containment shares or destination pins";
}, {
    readonly value: "marginal_od";
    readonly weight: 0.5;
    readonly formLabel: "Only how many commute into and out of each area";
    readonly description: "Only each area's total out- and in-commuters — no distance or direction";
}, {
    readonly value: "synthetic_measured_marginals";
    readonly weight: 0.25;
    readonly formLabel: "No flow data, but measured job and employed-resident totals per area that the estimates are forced to add up to";
    readonly description: "Synthetic flows doubly-constrained (IPF) to real measured origin and destination totals";
}, {
    readonly value: "prior_informed_synthetic";
    readonly weight: 0.1;
    readonly formLabel: null;
    readonly description: "Synthetic marginals with flows IPF-bounded under an informed prior calibrated from analogue countries; reviewer distinguishes from 'none'";
}, {
    readonly value: "none";
    readonly weight: 0;
    readonly formLabel: "No — flows are fully estimated";
    readonly description: "No commute flow data and no bounding — unconstrained gravity or nothing";
}];
export type WorkplaceCountAnchor = (typeof WORKPLACE_COUNT_LADDER)[number]["value"];
export type ResidentCountAnchor = (typeof RESIDENT_COUNT_LADDER)[number]["value"];
export type SpatialResolution = (typeof SPATIAL_RESOLUTION_LADDER)[number]["value"];
export type IntensityFidelity = (typeof INTENSITY_FIDELITY_LADDER)[number]["value"];
export type MetricGranularity = (typeof GRANULARITY_LADDER)[number]["value"];
export type OdMetric = (typeof OD_METRIC_LADDER)[number]["value"];
/** Looks up a rung weight; throws on an unknown value so bad answers fail loudly. */
export declare function ladderWeight<V extends string>(ladder: readonly DataQualityLadderRung<V>[], value: V): number;
/**
 * Collapsed placement form options (one question per pillar in the issue
 * forms), each pinning a canonical (R, I) pair. Reviewers refine the pair
 * when the pipeline warrants it (e.g. official vs ML footprints).
 */
export interface PlacementFormOption {
    formLabel: string;
    resolution: SpatialResolution;
    intensity: IntensityFidelity;
}
export declare const WORKPLACE_PLACEMENT_FORM_OPTIONS: readonly PlacementFormOption[];
export declare const RESIDENT_PLACEMENT_FORM_OPTIONS: readonly PlacementFormOption[];
//# sourceMappingURL=data-quality-ladders.d.ts.map