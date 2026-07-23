import { z } from "zod";
import { DATA_QUALITY_TIERS, GRANULARITY_LADDER, INTENSITY_FIDELITY_LADDER, OD_METRIC_LADDER, RESIDENT_COUNT_LADDER, SPATIAL_RESOLUTION_LADDER, WORKPLACE_COUNT_LADDER, } from "./data-quality-ladders.js";
// --- Zod schemas for the seven-tier data-quality system ---
// Enum values derive from data-quality-ladders.ts (the single source of truth);
// nothing here re-declares a ladder value.
function ladderEnum(ladder) {
    return z.enum(ladder.map((rung) => rung.value));
}
export const DataQualityTierSchema = z.enum(DATA_QUALITY_TIERS);
const SCORED_TIERS = DATA_QUALITY_TIERS.filter((tier) => tier !== "unknown");
export const ScoredDataQualityTierSchema = z.enum(SCORED_TIERS);
// --- Manifest `data_quality` block ---
/**
 * Unknown marker: stamped on every unscored map so the field is present on all
 * manifests and always overrides source_quality for new readers (plan D5).
 * Carries no scores and no provenance — nothing was scored.
 */
export const UnknownDataQualitySchema = z
    .object({
    tier: z.literal("unknown"),
    rubric_version: z.number().int().min(1),
})
    .strict();
/**
 * Scored block: written only once a reviewer has confirmed the answers file
 * (provenance "reviewed") or the map was backfilled from a pipeline already
 * scored in docs/data-quality.md ("backfill"). Never "self-reported" — the
 * manifest tier is reviewer-gated (plan D3).
 */
export const ScoredManifestDataQualitySchema = z
    .object({
    tier: ScoredDataQualityTierSchema,
    raw_score: z.number().min(0).max(1).optional(),
    weighted_score: z.number().min(0).max(1).optional(),
    rubric_version: z.number().int().min(1),
    provenance: z.enum(["reviewed", "backfill"]),
})
    .strict();
export const ManifestDataQualitySchema = z.union([
    ScoredManifestDataQualitySchema,
    UnknownDataQualitySchema,
]);
// --- maps/<id>/data-quality.json (the per-map rubric answers file) ---
export const DATA_QUALITY_PROVENANCE_METHODS = [
    "self-reported",
    "reviewed",
    "backfill",
];
/**
 * Canonical rubric answers. Scores and tier are a pure function of this block
 * (scripts/lib/data-quality.ts); CI recomputes and rejects manifests that
 * disagree. od_granularity is null when the O/D rung carries no measured grain
 * (synthetic / prior / none) — the G multiplier is then omitted.
 */
export const DataQualityAnswersSchema = z
    .object({
    workplace_count: ladderEnum(WORKPLACE_COUNT_LADDER),
    workplace_granularity: ladderEnum(GRANULARITY_LADDER),
    workplace_resolution: ladderEnum(SPATIAL_RESOLUTION_LADDER),
    workplace_intensity: ladderEnum(INTENSITY_FIDELITY_LADDER),
    resident_count: ladderEnum(RESIDENT_COUNT_LADDER),
    resident_granularity: ladderEnum(GRANULARITY_LADDER),
    resident_resolution: ladderEnum(SPATIAL_RESOLUTION_LADDER),
    resident_intensity: ladderEnum(INTENSITY_FIDELITY_LADDER),
    od_metric: ladderEnum(OD_METRIC_LADDER),
    od_granularity: ladderEnum(GRANULARITY_LADDER).nullable(),
})
    .strict();
export const DataQualityProvenanceSchema = z
    .object({
    method: z.enum(DATA_QUALITY_PROVENANCE_METHODS),
    /** GitHub login of whoever supplied the answers (author or maintainer). */
    submitted_by: z.string().min(1),
    /** GitHub login of the confirming maintainer; null while self-reported. */
    reviewed_by: z.string().min(1).nullable(),
    /** ISO date (YYYY-MM-DD) the answers were last submitted or confirmed. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
    .strict();
export const DataQualityAnswersFileSchema = z
    .object({
    schema_version: z.literal(1),
    /** Map id; must match the manifest id of the directory the file sits in. */
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    answers: DataQualityAnswersSchema,
    /** Methodology narrative (persisted from the submission form). */
    notes: z.string().min(1),
    /** Citations / dataset links backing the answers. */
    sources: z.array(z.string().min(1)).optional(),
    /** Audit note for ambiguous grain calls (docs/data-quality.md §2). */
    ambiguity_bounds: z.string().min(1).optional(),
    provenance: DataQualityProvenanceSchema,
})
    .strict()
    .superRefine((file, ctx) => {
    const { method, reviewed_by } = file.provenance;
    if ((method === "reviewed" || method === "backfill") && reviewed_by === null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["provenance", "reviewed_by"],
            message: `reviewed_by is required when provenance.method is "${method}"`,
        });
    }
});
