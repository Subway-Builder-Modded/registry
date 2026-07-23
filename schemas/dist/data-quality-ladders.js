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
export const RUBRIC_VERSION = 1;
export const DATA_QUALITY_TIERS = [
    "very-high",
    "high",
    "medium",
    "low",
    "very-low",
    "absent",
    "unknown",
];
/** Grade letter aliases (docs/data-quality.md §8). Display sugar; never stored. */
export const DATA_QUALITY_TIER_GRADES = {
    "very-high": "A",
    high: "B",
    medium: "C",
    low: "D",
    "very-low": "E",
    absent: "F",
    unknown: "U",
};
/**
 * Tier thresholds on the weighted composite score, ordered descending.
 * A tier applies when weighted_score >= min.
 */
export const DATA_QUALITY_TIER_THRESHOLDS = [
    { tier: "very-high", min: 0.75 },
    { tier: "high", min: 0.6 },
    { tier: "medium", min: 0.45 },
    { tier: "low", min: 0.3 },
    { tier: "very-low", min: 0.15 },
    { tier: "absent", min: 0 },
];
export function tierForWeightedScore(weightedScore) {
    for (const { tier, min } of DATA_QUALITY_TIER_THRESHOLDS) {
        if (weightedScore >= min)
            return tier;
    }
    return "absent";
}
/**
 * Collapse map from rubric tier to the legacy three-value source_quality tag.
 *
 * Used ONLY to initialize source_quality on brand-new listings that already
 * carry a reviewed tier at creation time. The legacy field is write-once and
 * otherwise fully decoupled from the tier: existing values are frozen
 * historical self-reports and are never rewritten (plan decision D1).
 */
export const TIER_TO_SOURCE_QUALITY = {
    "very-high": "high-quality",
    high: "high-quality",
    medium: "medium-quality",
    low: "low-quality",
    "very-low": "low-quality",
    absent: "low-quality",
};
/** Returns null for "unknown" — no initialization signal (caller falls back to the default). */
export function collapseTier(tier) {
    return tier === "unknown" ? null : TIER_TO_SOURCE_QUALITY[tier];
}
/** Pillar weights (docs/data-quality.md §1). */
export const PILLAR_WEIGHTS = {
    workplace: 0.5,
    resident: 0.35,
    od: 0.15,
};
/** Workplace count ground truth (docs/data-quality.md §4). */
export const WORKPLACE_COUNT_LADDER = [
    {
        value: "physical_measured",
        weight: 1.0,
        formLabel: "A government census or survey that counts where people actually work",
        description: "Physical, instrument-measured: a census place-of-work question or establishment census measures where each employee physically works",
    },
    {
        value: "physical_inferred",
        weight: 0.85,
        formLabel: "Government statistics reconstructed to actual work locations from linked records",
        description: "Physical, inferred: a register the statistics office has cross-referenced to physical work location",
    },
    {
        value: "registered_self_declared",
        weight: 0.7,
        formLabel: "A government business register — jobs counted at each company's registered address",
        description: "Registered, self-declared: counts taken at the firm's declared establishment/HQ address; multi-site firms collapse onto one node",
    },
    {
        value: "size_bands",
        weight: 0.5,
        formLabel: "Counts of businesses by size range, not exact job counts",
        description: "Institutional worker sizes: firms binned by employee-count band per area — a size distribution, not a headcount at a location",
    },
    {
        value: "estimated_proxy",
        weight: 0.3,
        formLabel: "Estimated from population or other indirect statistics",
        description: "Estimated, census-anchored proxy: magnitude bootstrapped from a real published figure then redistributed by an independent signal",
    },
    {
        value: "none",
        weight: 0,
        formLabel: "No real-world job data",
        description: "No census anchor, or a residence employment count used verbatim as workplace",
    },
];
/** Resident count ground truth (docs/data-quality.md §5). */
export const RESIDENT_COUNT_LADDER = [
    {
        value: "employed_residents",
        weight: 1.0,
        formLabel: "Employed residents — people with jobs, counted where they live",
        description: "Counts people who have a job, at their place of residence — exactly the origin set that generates commutes",
    },
    {
        value: "working_age",
        weight: 0.7,
        formLabel: "Everyone of working age (roughly 15–64)",
        description: "Counts everyone of working age living in the area, employed or not — approximate to the commuter pool",
    },
    {
        value: "total_population",
        weight: 0.4,
        formLabel: "Total population, including children and retirees",
        description: "Counts every resident — the origin total is materially larger and more skewed than the true commuter set",
    },
    {
        value: "none",
        weight: 0,
        formLabel: "No census population data",
        description: "No residence-side count is used",
    },
];
/**
 * Spatial Resolution R — where mass can land (docs/data-quality.md §3).
 * Not asked directly; the collapsed placement form questions map onto (R, I)
 * pairs via the *_PLACEMENT_FORM_OPTIONS tables below.
 */
export const SPATIAL_RESOLUTION_LADDER = [
    {
        value: "exact_footprints",
        weight: 1.0,
        formLabel: null,
        description: "Exact building footprints: an authoritative national cadastre / building register places mass to the individual structure",
    },
    {
        value: "mesh_125_or_adm5",
        weight: 0.9,
        formLabel: null,
        description: "Uniform census mesh ≤125 m, OR an official ADM5 unit (census block / sub-里) carrying a measured per-cell count",
    },
    {
        value: "mesh_250",
        weight: 0.85,
        formLabel: null,
        description: "Fine, complete published census mesh ≤250 m",
    },
    {
        value: "ml_hybrid_footprints",
        weight: 0.7,
        formLabel: null,
        description: "ML / satellite or multi-source footprints (Overture, GHS-OBAT, …) — near-complete coverage, geometry inferred, no native use-tags",
    },
    {
        value: "osm_footprints",
        weight: 0.6,
        formLabel: null,
        description: "Crowd-sourced OSM footprints alone — accurate where present but incomplete and uneven",
    },
    {
        value: "mesh_1km",
        weight: 0.5,
        formLabel: null,
        description: "Coarse published census mesh ≤1 km",
    },
    {
        value: "admin_polygon",
        weight: 0.3,
        formLabel: null,
        description: "No sub-admin geometry; mass spread across the whole unit",
    },
];
/** Intensity Fidelity I — how the total is shared among candidate locations (docs/data-quality.md §3). */
export const INTENSITY_FIDELITY_LADDER = [
    {
        value: "measured_per_unit",
        weight: 1.0,
        formLabel: null,
        description: "Directly measured per cell / building: the unit already carries its own measured count, nothing is apportioned",
    },
    {
        value: "fine_types_calibrated",
        weight: 0.85,
        formLabel: null,
        description: "Fine building-type weights (NACE-class or dwelling-level), with per-type weights tuned to the country's own published figures",
    },
    {
        value: "fine_types_generic",
        weight: 0.6,
        formLabel: null,
        description: "Fine building-type weights from generic or international rules of thumb, not locally verified",
    },
    {
        value: "coarse_sector",
        weight: 0.5,
        formLabel: null,
        description: "Coarse sector split (primary/secondary/tertiary or office/industrial/retail); within a sector, mass spread by size",
    },
    {
        value: "binary_split",
        weight: 0.4,
        formLabel: null,
        description: "Binary worker/resident split: mass routed onto the correct side and spread by size, no productive types distinguished",
    },
    {
        value: "size_only",
        weight: 0.25,
        formLabel: null,
        description: "No building-type distinction at all — demand spread by raw building size across every building",
    },
    {
        value: "uniform",
        weight: 0.1,
        formLabel: null,
        description: "Demand spread evenly, ignoring building size and location",
    },
];
/**
 * Granularity of the measured count + multiplier G (docs/data-quality.md §2, §8).
 * The weight field is the G multiplier. Rungs with a null formLabel are
 * reviewer-refined (the form's grid option maps to mesh_250 as the middle mesh).
 */
export const GRANULARITY_LADDER = [
    {
        value: "mesh_125",
        weight: 1.0,
        formLabel: null,
        description: "Mesh — very-fine, uniform (≤125 m)",
    },
    {
        value: "mesh_250",
        weight: 0.95,
        formLabel: "Small uniform grid squares, roughly 100–250 m",
        description: "Mesh — fine (≤250 m)",
    },
    {
        value: "mesh_500",
        weight: 0.9,
        formLabel: null,
        description: "Mesh — medium (≤500 m)",
    },
    {
        value: "mesh_1km",
        weight: 0.85,
        formLabel: null,
        description: "Mesh — coarse (≤1 km)",
    },
    {
        value: "mesh_coarse",
        weight: 0.65,
        formLabel: null,
        description: "Mesh — very-coarse (>1 km)",
    },
    {
        value: "adm5",
        weight: 0.95,
        formLabel: "Individual buildings or census blocks",
        description: "Measured-pop ADM5 unit (census block / sub-里)",
    },
    {
        value: "adm4",
        weight: 0.9,
        formLabel: "Neighborhoods or districts within a city",
        description: "Sub-municipal (ADM4)",
    },
    {
        value: "adm3",
        weight: 0.7,
        formLabel: "Whole cities or municipalities",
        description: "Municipal (ADM3)",
    },
    {
        value: "adm2",
        weight: 0.5,
        formLabel: "Counties or larger regions",
        description: "Regional (ADM2)",
    },
    {
        value: "adm1",
        weight: 0.3,
        formLabel: "States or provinces",
        description: "Provincial (ADM1)",
    },
    {
        value: "none",
        weight: 0,
        formLabel: "Not based on official statistics areas",
        description: "No census anchor",
    },
];
/** O/D metric (docs/data-quality.md §6). */
export const OD_METRIC_LADDER = [
    {
        value: "full_matrix",
        weight: 1.0,
        formLabel: "Yes — a full table of commuters between every pair of areas",
        description: "Every home-area → work-area commute flow is counted directly",
    },
    {
        value: "structured_marginals",
        weight: 0.75,
        formLabel: "Partial — per-area totals plus how far or where trips tend to go",
        description: "Per-area in/out totals plus distance/containment shares or destination pins",
    },
    {
        value: "marginal_od",
        weight: 0.5,
        formLabel: "Only how many commute into and out of each area",
        description: "Only each area's total out- and in-commuters — no distance or direction",
    },
    {
        value: "synthetic_measured_marginals",
        weight: 0.25,
        formLabel: "No flow data, but measured job and employed-resident totals per area that the estimates are forced to add up to",
        description: "Synthetic flows doubly-constrained (IPF) to real measured origin and destination totals",
    },
    {
        value: "prior_informed_synthetic",
        weight: 0.1,
        formLabel: null,
        description: "Synthetic marginals with flows IPF-bounded under an informed prior calibrated from analogue countries; reviewer distinguishes from 'none'",
    },
    {
        value: "none",
        weight: 0,
        formLabel: "No — flows are fully estimated",
        description: "No commute flow data and no bounding — unconstrained gravity or nothing",
    },
];
/** Looks up a rung weight; throws on an unknown value so bad answers fail loudly. */
export function ladderWeight(ladder, value) {
    const rung = ladder.find((r) => r.value === value);
    if (!rung) {
        throw new Error(`Unknown data-quality ladder value: ${JSON.stringify(value)}`);
    }
    return rung.weight;
}
export const WORKPLACE_PLACEMENT_FORM_OPTIONS = [
    {
        formLabel: "Nothing to place — the data is already per building or block",
        resolution: "mesh_125_or_adm5",
        intensity: "measured_per_unit",
    },
    {
        formLabel: "Official building footprints, split by workplace type with densities tuned to match real statistics",
        resolution: "exact_footprints",
        intensity: "fine_types_calibrated",
    },
    {
        formLabel: "Building footprints, split by workplace type using standard assumptions",
        resolution: "ml_hybrid_footprints",
        intensity: "fine_types_generic",
    },
    {
        formLabel: "Buildings split only into homes vs workplaces, then by size",
        resolution: "ml_hybrid_footprints",
        intensity: "binary_split",
    },
    {
        formLabel: "OpenStreetMap buildings, split by size",
        resolution: "osm_footprints",
        intensity: "size_only",
    },
    {
        formLabel: "Spread evenly across each area",
        resolution: "admin_polygon",
        intensity: "uniform",
    },
];
export const RESIDENT_PLACEMENT_FORM_OPTIONS = [
    {
        formLabel: "Nothing to place — the data is already per building or block",
        resolution: "mesh_125_or_adm5",
        intensity: "measured_per_unit",
    },
    {
        formLabel: "Official building footprints with per-building dwelling counts or residential floor area",
        resolution: "exact_footprints",
        intensity: "fine_types_calibrated",
    },
    {
        formLabel: "Building footprints, with homes identified and weighted using standard assumptions",
        resolution: "ml_hybrid_footprints",
        intensity: "fine_types_generic",
    },
    {
        formLabel: "Buildings split only into homes vs workplaces, then by size",
        resolution: "ml_hybrid_footprints",
        intensity: "binary_split",
    },
    {
        formLabel: "OpenStreetMap buildings, split by size",
        resolution: "osm_footprints",
        intensity: "size_only",
    },
    {
        formLabel: "Spread evenly across each area",
        resolution: "admin_polygon",
        intensity: "uniform",
    },
];
