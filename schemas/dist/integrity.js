import { z } from "zod";
import { SecurityIssueSchema } from "./security.js";
export const IntegritySourceSchema = z.object({
    update_type: z.enum(["github", "custom"]),
    repo: z.string().optional(),
    tag: z.string().optional(),
    asset_name: z.string().optional(),
    download_url: z.string().optional(),
});
export const IntegrityVersionEntrySchema = z.object({
    is_complete: z.boolean(),
    errors: z.array(z.string()),
    required_checks: z.record(z.boolean()),
    matched_files: z.record(z.string().nullable()),
    release_size: z.number().optional(),
    file_sizes: z.record(z.number()).optional(),
    security_issue: SecurityIssueSchema.optional(),
    source: IntegritySourceSchema,
    fingerprint: z.string(),
    checked_at: z.string(),
});
export const ListingIntegrityEntrySchema = z.object({
    has_complete_version: z.boolean(),
    latest_semver_version: z.string().nullable(),
    latest_semver_complete: z.boolean().nullable(),
    complete_versions: z.array(z.string()),
    incomplete_versions: z.array(z.string()),
    versions: z.record(IntegrityVersionEntrySchema),
});
export const IntegrityOutputSchema = z.object({
    schema_version: z.literal(1),
    generated_at: z.string(),
    listings: z.record(ListingIntegrityEntrySchema),
});
export const IntegrityCacheEntrySchema = z.object({
    fingerprint: z.string(),
    last_checked_at: z.string(),
    result: IntegrityVersionEntrySchema,
});
export const IntegrityCacheSchema = z.object({
    schema_version: z.literal(1),
    entries: z.record(z.record(IntegrityCacheEntrySchema)),
});
