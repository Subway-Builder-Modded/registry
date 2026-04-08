import { z } from "zod";
export declare const DownloadVersionBucketEntrySchema: z.ZodObject<{
    max_adjusted_downloads: z.ZodNumber;
    last_adjusted_downloads: z.ZodNumber;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    max_adjusted_downloads: number;
    last_adjusted_downloads: number;
}, {
    updated_at: string;
    max_adjusted_downloads: number;
    last_adjusted_downloads: number;
}>;
export declare const DownloadVersionEntrySchema: z.ZodObject<{
    max_total_downloads: z.ZodNumber;
    buckets: z.ZodRecord<z.ZodString, z.ZodObject<{
        max_adjusted_downloads: z.ZodNumber;
        last_adjusted_downloads: z.ZodNumber;
        updated_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        updated_at: string;
        max_adjusted_downloads: number;
        last_adjusted_downloads: number;
    }, {
        updated_at: string;
        max_adjusted_downloads: number;
        last_adjusted_downloads: number;
    }>>;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    max_total_downloads: number;
    buckets: Record<string, {
        updated_at: string;
        max_adjusted_downloads: number;
        last_adjusted_downloads: number;
    }>;
}, {
    updated_at: string;
    max_total_downloads: number;
    buckets: Record<string, {
        updated_at: string;
        max_adjusted_downloads: number;
        last_adjusted_downloads: number;
    }>;
}>;
export declare const DownloadVersionListingEntrySchema: z.ZodObject<{
    versions: z.ZodRecord<z.ZodString, z.ZodObject<{
        max_total_downloads: z.ZodNumber;
        buckets: z.ZodRecord<z.ZodString, z.ZodObject<{
            max_adjusted_downloads: z.ZodNumber;
            last_adjusted_downloads: z.ZodNumber;
            updated_at: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }>>;
        updated_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        updated_at: string;
        max_total_downloads: number;
        buckets: Record<string, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }>;
    }, {
        updated_at: string;
        max_total_downloads: number;
        buckets: Record<string, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }>;
    }>>;
}, "strip", z.ZodTypeAny, {
    versions: Record<string, {
        updated_at: string;
        max_total_downloads: number;
        buckets: Record<string, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }>;
    }>;
}, {
    versions: Record<string, {
        updated_at: string;
        max_total_downloads: number;
        buckets: Record<string, {
            updated_at: string;
            max_adjusted_downloads: number;
            last_adjusted_downloads: number;
        }>;
    }>;
}>;
export declare const DownloadVersionBucketLedgerSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    updated_at: z.ZodString;
    listings: z.ZodRecord<z.ZodString, z.ZodObject<{
        versions: z.ZodRecord<z.ZodString, z.ZodObject<{
            max_total_downloads: z.ZodNumber;
            buckets: z.ZodRecord<z.ZodString, z.ZodObject<{
                max_adjusted_downloads: z.ZodNumber;
                last_adjusted_downloads: z.ZodNumber;
                updated_at: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>>;
            updated_at: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }>>;
    }, "strip", z.ZodTypeAny, {
        versions: Record<string, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }>;
    }, {
        versions: Record<string, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }>;
    }>>;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    schema_version: 1;
    listings: Record<string, {
        versions: Record<string, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }>;
    }>;
}, {
    updated_at: string;
    schema_version: 1;
    listings: Record<string, {
        versions: Record<string, {
            updated_at: string;
            max_total_downloads: number;
            buckets: Record<string, {
                updated_at: string;
                max_adjusted_downloads: number;
                last_adjusted_downloads: number;
            }>;
        }>;
    }>;
}>;
export type DownloadVersionBucketEntry = z.infer<typeof DownloadVersionBucketEntrySchema>;
export type DownloadVersionEntry = z.infer<typeof DownloadVersionEntrySchema>;
export type DownloadVersionListingEntry = z.infer<typeof DownloadVersionListingEntrySchema>;
export type DownloadVersionBucketLedger = z.infer<typeof DownloadVersionBucketLedgerSchema>;
//# sourceMappingURL=version-buckets.d.ts.map