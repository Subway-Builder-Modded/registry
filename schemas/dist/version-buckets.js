import { z } from "zod";
export const DownloadVersionBucketEntrySchema = z.object({
    max_adjusted_downloads: z.number(),
    last_adjusted_downloads: z.number(),
    updated_at: z.string(),
});
export const DownloadVersionEntrySchema = z.object({
    max_total_downloads: z.number(),
    buckets: z.record(DownloadVersionBucketEntrySchema),
    updated_at: z.string(),
});
export const DownloadVersionListingEntrySchema = z.object({
    versions: z.record(DownloadVersionEntrySchema),
});
export const DownloadVersionBucketLedgerSchema = z.object({
    schema_version: z.literal(1),
    updated_at: z.string(),
    listings: z.record(DownloadVersionListingEntrySchema),
});
