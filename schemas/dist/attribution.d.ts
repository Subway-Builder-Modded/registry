import { z } from "zod";
export declare const DownloadAttributionEntrySchema: z.ZodObject<{
    count: z.ZodNumber;
    updated_at: z.ZodString;
    by_source: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    count: number;
    updated_at: string;
    by_source: Record<string, number>;
}, {
    count: number;
    updated_at: string;
    by_source: Record<string, number>;
}>;
export declare const DownloadAttributionDailyEntrySchema: z.ZodObject<{
    total: z.ZodNumber;
    assets: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    total: number;
    assets: Record<string, number>;
}, {
    total: number;
    assets: Record<string, number>;
}>;
export declare const DownloadAttributionTimelineEntrySchema: z.ZodObject<{
    total: z.ZodNumber;
    assets: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    total: number;
    assets: Record<string, number>;
}, {
    total: number;
    assets: Record<string, number>;
}>;
export declare const DownloadAttributionLedgerSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<2>;
    updated_at: z.ZodString;
    assets: z.ZodRecord<z.ZodString, z.ZodObject<{
        count: z.ZodNumber;
        updated_at: z.ZodString;
        by_source: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        count: number;
        updated_at: string;
        by_source: Record<string, number>;
    }, {
        count: number;
        updated_at: string;
        by_source: Record<string, number>;
    }>>;
    applied_delta_ids: z.ZodRecord<z.ZodString, z.ZodString>;
    daily: z.ZodRecord<z.ZodString, z.ZodObject<{
        total: z.ZodNumber;
        assets: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        total: number;
        assets: Record<string, number>;
    }, {
        total: number;
        assets: Record<string, number>;
    }>>;
    timeline: z.ZodRecord<z.ZodString, z.ZodObject<{
        total: z.ZodNumber;
        assets: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        total: number;
        assets: Record<string, number>;
    }, {
        total: number;
        assets: Record<string, number>;
    }>>;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    assets: Record<string, {
        count: number;
        updated_at: string;
        by_source: Record<string, number>;
    }>;
    schema_version: 2;
    applied_delta_ids: Record<string, string>;
    daily: Record<string, {
        total: number;
        assets: Record<string, number>;
    }>;
    timeline: Record<string, {
        total: number;
        assets: Record<string, number>;
    }>;
}, {
    updated_at: string;
    assets: Record<string, {
        count: number;
        updated_at: string;
        by_source: Record<string, number>;
    }>;
    schema_version: 2;
    applied_delta_ids: Record<string, string>;
    daily: Record<string, {
        total: number;
        assets: Record<string, number>;
    }>;
    timeline: Record<string, {
        total: number;
        assets: Record<string, number>;
    }>;
}>;
export declare const DownloadAttributionDeltaSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<2>;
    delta_id: z.ZodString;
    source: z.ZodString;
    generated_at: z.ZodString;
    assets: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    assets: Record<string, number>;
    schema_version: 2;
    delta_id: string;
    source: string;
    generated_at: string;
}, {
    assets: Record<string, number>;
    schema_version: 2;
    delta_id: string;
    source: string;
    generated_at: string;
}>;
export type DownloadAttributionEntry = z.infer<typeof DownloadAttributionEntrySchema>;
export type DownloadAttributionDailyEntry = z.infer<typeof DownloadAttributionDailyEntrySchema>;
export type DownloadAttributionTimelineEntry = z.infer<typeof DownloadAttributionTimelineEntrySchema>;
export type DownloadAttributionLedger = z.infer<typeof DownloadAttributionLedgerSchema>;
export type DownloadAttributionDelta = z.infer<typeof DownloadAttributionDeltaSchema>;
//# sourceMappingURL=attribution.d.ts.map