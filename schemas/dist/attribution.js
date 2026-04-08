import { z } from "zod";
export const DownloadAttributionEntrySchema = z.object({
    count: z.number(),
    updated_at: z.string(),
    by_source: z.record(z.number()),
});
export const DownloadAttributionDailyEntrySchema = z.object({
    total: z.number(),
    assets: z.record(z.number()),
});
export const DownloadAttributionTimelineEntrySchema = z.object({
    total: z.number(),
    assets: z.record(z.number()),
});
export const DownloadAttributionLedgerSchema = z.object({
    schema_version: z.literal(2),
    updated_at: z.string(),
    assets: z.record(DownloadAttributionEntrySchema),
    applied_delta_ids: z.record(z.string()),
    daily: z.record(DownloadAttributionDailyEntrySchema),
    timeline: z.record(DownloadAttributionTimelineEntrySchema),
});
export const DownloadAttributionDeltaSchema = z.object({
    schema_version: z.literal(2),
    delta_id: z.string(),
    source: z.string(),
    generated_at: z.string(),
    assets: z.record(z.number()),
});
