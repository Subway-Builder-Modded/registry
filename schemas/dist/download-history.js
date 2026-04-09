import { z } from "zod";
// Per-section (maps/mods) breakdown within a download history snapshot
const DownloadHistorySectionSchema = z.object({
    downloads: z.record(z.record(z.number())),
    raw_downloads: z.record(z.record(z.number())).optional(),
    attributed_downloads: z.record(z.record(z.number())).optional(),
    total_downloads: z.number(),
    raw_total_downloads: z.number().optional(),
    total_attributed_downloads: z.number().optional(),
    net_downloads: z.number(),
    source_downloads_mode: z.enum(["already_adjusted", "legacy_unadjusted"]).optional(),
    index: z.record(z.unknown()),
    entries: z.number(),
});
// Daily download history snapshot (history/snapshot_YYYY_MM_DD.json)
export const DownloadHistorySnapshotSchema = z.object({
    schema_version: z.literal(2),
    snapshot_date: z.string(),
    generated_at: z.string(),
    total_downloads: z.number(),
    raw_total_downloads: z.number(),
    total_attributed_downloads: z.number(),
    total_attributed_fetches: z.number(),
    net_downloads: z.number(),
    maps: DownloadHistorySectionSchema,
    mods: DownloadHistorySectionSchema,
});
// Attribution-only history snapshot (history/download_attribution_YYYY_MM_DD.json)
export const DownloadAttributionHistorySnapshotSchema = z.object({
    schema_version: z.literal(1),
    snapshot_date: z.string(),
    generated_at: z.string(),
    source_ledger_updated_at: z.string(),
    total_attributed_fetches: z.number(),
    net_attributed_fetches: z.number(),
    daily_attributed_fetches: z.number(),
    assets_daily: z.record(z.number()),
});
