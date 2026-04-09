import { z } from "zod";
export declare const IntegritySourceSchema: z.ZodObject<{
    update_type: z.ZodEnum<["github", "custom"]>;
    repo: z.ZodOptional<z.ZodString>;
    tag: z.ZodOptional<z.ZodString>;
    asset_name: z.ZodOptional<z.ZodString>;
    download_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    update_type: "custom" | "github";
    repo?: string | undefined;
    tag?: string | undefined;
    asset_name?: string | undefined;
    download_url?: string | undefined;
}, {
    update_type: "custom" | "github";
    repo?: string | undefined;
    tag?: string | undefined;
    asset_name?: string | undefined;
    download_url?: string | undefined;
}>;
export declare const IntegrityVersionEntrySchema: z.ZodObject<{
    is_complete: z.ZodBoolean;
    errors: z.ZodArray<z.ZodString, "many">;
    required_checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    matched_files: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
    release_size: z.ZodOptional<z.ZodNumber>;
    file_sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    security_issue: z.ZodOptional<z.ZodObject<{
        findings: z.ZodArray<z.ZodObject<{
            rule_id: z.ZodString;
            severity: z.ZodEnum<["WARNING", "ERROR"]>;
            type: z.ZodEnum<["literal", "regex", "ast"]>;
            pattern: z.ZodString;
            file: z.ZodString;
            snippet: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }, {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        findings: {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }[];
    }, {
        findings: {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }[];
    }>>;
    source: z.ZodObject<{
        update_type: z.ZodEnum<["github", "custom"]>;
        repo: z.ZodOptional<z.ZodString>;
        tag: z.ZodOptional<z.ZodString>;
        asset_name: z.ZodOptional<z.ZodString>;
        download_url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        update_type: "custom" | "github";
        repo?: string | undefined;
        tag?: string | undefined;
        asset_name?: string | undefined;
        download_url?: string | undefined;
    }, {
        update_type: "custom" | "github";
        repo?: string | undefined;
        tag?: string | undefined;
        asset_name?: string | undefined;
        download_url?: string | undefined;
    }>;
    fingerprint: z.ZodString;
    checked_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source: {
        update_type: "custom" | "github";
        repo?: string | undefined;
        tag?: string | undefined;
        asset_name?: string | undefined;
        download_url?: string | undefined;
    };
    is_complete: boolean;
    errors: string[];
    required_checks: Record<string, boolean>;
    matched_files: Record<string, string | null>;
    fingerprint: string;
    checked_at: string;
    file_sizes?: Record<string, number> | undefined;
    release_size?: number | undefined;
    security_issue?: {
        findings: {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }[];
    } | undefined;
}, {
    source: {
        update_type: "custom" | "github";
        repo?: string | undefined;
        tag?: string | undefined;
        asset_name?: string | undefined;
        download_url?: string | undefined;
    };
    is_complete: boolean;
    errors: string[];
    required_checks: Record<string, boolean>;
    matched_files: Record<string, string | null>;
    fingerprint: string;
    checked_at: string;
    file_sizes?: Record<string, number> | undefined;
    release_size?: number | undefined;
    security_issue?: {
        findings: {
            type: "literal" | "regex" | "ast";
            severity: "WARNING" | "ERROR";
            pattern: string;
            rule_id: string;
            file: string;
            snippet?: string | undefined;
        }[];
    } | undefined;
}>;
export declare const ListingIntegrityEntrySchema: z.ZodObject<{
    has_complete_version: z.ZodBoolean;
    latest_semver_version: z.ZodNullable<z.ZodString>;
    latest_semver_complete: z.ZodNullable<z.ZodBoolean>;
    complete_versions: z.ZodArray<z.ZodString, "many">;
    incomplete_versions: z.ZodArray<z.ZodString, "many">;
    versions: z.ZodRecord<z.ZodString, z.ZodObject<{
        is_complete: z.ZodBoolean;
        errors: z.ZodArray<z.ZodString, "many">;
        required_checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
        matched_files: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
        release_size: z.ZodOptional<z.ZodNumber>;
        file_sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        security_issue: z.ZodOptional<z.ZodObject<{
            findings: z.ZodArray<z.ZodObject<{
                rule_id: z.ZodString;
                severity: z.ZodEnum<["WARNING", "ERROR"]>;
                type: z.ZodEnum<["literal", "regex", "ast"]>;
                pattern: z.ZodString;
                file: z.ZodString;
                snippet: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }, {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        }, {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        }>>;
        source: z.ZodObject<{
            update_type: z.ZodEnum<["github", "custom"]>;
            repo: z.ZodOptional<z.ZodString>;
            tag: z.ZodOptional<z.ZodString>;
            asset_name: z.ZodOptional<z.ZodString>;
            download_url: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        }, {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        }>;
        fingerprint: z.ZodString;
        checked_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    has_complete_version: boolean;
    latest_semver_version: string | null;
    latest_semver_complete: boolean | null;
    complete_versions: string[];
    incomplete_versions: string[];
    versions: Record<string, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }>;
}, {
    has_complete_version: boolean;
    latest_semver_version: string | null;
    latest_semver_complete: boolean | null;
    complete_versions: string[];
    incomplete_versions: string[];
    versions: Record<string, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }>;
}>;
export declare const IntegrityOutputSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    generated_at: z.ZodString;
    listings: z.ZodRecord<z.ZodString, z.ZodObject<{
        has_complete_version: z.ZodBoolean;
        latest_semver_version: z.ZodNullable<z.ZodString>;
        latest_semver_complete: z.ZodNullable<z.ZodBoolean>;
        complete_versions: z.ZodArray<z.ZodString, "many">;
        incomplete_versions: z.ZodArray<z.ZodString, "many">;
        versions: z.ZodRecord<z.ZodString, z.ZodObject<{
            is_complete: z.ZodBoolean;
            errors: z.ZodArray<z.ZodString, "many">;
            required_checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
            matched_files: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
            release_size: z.ZodOptional<z.ZodNumber>;
            file_sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            security_issue: z.ZodOptional<z.ZodObject<{
                findings: z.ZodArray<z.ZodObject<{
                    rule_id: z.ZodString;
                    severity: z.ZodEnum<["WARNING", "ERROR"]>;
                    type: z.ZodEnum<["literal", "regex", "ast"]>;
                    pattern: z.ZodString;
                    file: z.ZodString;
                    snippet: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }, {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            }, {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            }>>;
            source: z.ZodObject<{
                update_type: z.ZodEnum<["github", "custom"]>;
                repo: z.ZodOptional<z.ZodString>;
                tag: z.ZodOptional<z.ZodString>;
                asset_name: z.ZodOptional<z.ZodString>;
                download_url: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            }, {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            }>;
            fingerprint: z.ZodString;
            checked_at: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        has_complete_version: boolean;
        latest_semver_version: string | null;
        latest_semver_complete: boolean | null;
        complete_versions: string[];
        incomplete_versions: string[];
        versions: Record<string, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>;
    }, {
        has_complete_version: boolean;
        latest_semver_version: string | null;
        latest_semver_complete: boolean | null;
        complete_versions: string[];
        incomplete_versions: string[];
        versions: Record<string, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>;
    }>>;
}, "strip", z.ZodTypeAny, {
    schema_version: 1;
    generated_at: string;
    listings: Record<string, {
        has_complete_version: boolean;
        latest_semver_version: string | null;
        latest_semver_complete: boolean | null;
        complete_versions: string[];
        incomplete_versions: string[];
        versions: Record<string, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>;
    }>;
}, {
    schema_version: 1;
    generated_at: string;
    listings: Record<string, {
        has_complete_version: boolean;
        latest_semver_version: string | null;
        latest_semver_complete: boolean | null;
        complete_versions: string[];
        incomplete_versions: string[];
        versions: Record<string, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>;
    }>;
}>;
export declare const IntegrityCacheEntrySchema: z.ZodObject<{
    fingerprint: z.ZodString;
    last_checked_at: z.ZodString;
    result: z.ZodObject<{
        is_complete: z.ZodBoolean;
        errors: z.ZodArray<z.ZodString, "many">;
        required_checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
        matched_files: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
        release_size: z.ZodOptional<z.ZodNumber>;
        file_sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        security_issue: z.ZodOptional<z.ZodObject<{
            findings: z.ZodArray<z.ZodObject<{
                rule_id: z.ZodString;
                severity: z.ZodEnum<["WARNING", "ERROR"]>;
                type: z.ZodEnum<["literal", "regex", "ast"]>;
                pattern: z.ZodString;
                file: z.ZodString;
                snippet: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }, {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        }, {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        }>>;
        source: z.ZodObject<{
            update_type: z.ZodEnum<["github", "custom"]>;
            repo: z.ZodOptional<z.ZodString>;
            tag: z.ZodOptional<z.ZodString>;
            asset_name: z.ZodOptional<z.ZodString>;
            download_url: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        }, {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        }>;
        fingerprint: z.ZodString;
        checked_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }, {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    fingerprint: string;
    last_checked_at: string;
    result: {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    };
}, {
    fingerprint: string;
    last_checked_at: string;
    result: {
        source: {
            update_type: "custom" | "github";
            repo?: string | undefined;
            tag?: string | undefined;
            asset_name?: string | undefined;
            download_url?: string | undefined;
        };
        is_complete: boolean;
        errors: string[];
        required_checks: Record<string, boolean>;
        matched_files: Record<string, string | null>;
        fingerprint: string;
        checked_at: string;
        file_sizes?: Record<string, number> | undefined;
        release_size?: number | undefined;
        security_issue?: {
            findings: {
                type: "literal" | "regex" | "ast";
                severity: "WARNING" | "ERROR";
                pattern: string;
                rule_id: string;
                file: string;
                snippet?: string | undefined;
            }[];
        } | undefined;
    };
}>;
export declare const IntegrityCacheSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    entries: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        fingerprint: z.ZodString;
        last_checked_at: z.ZodString;
        result: z.ZodObject<{
            is_complete: z.ZodBoolean;
            errors: z.ZodArray<z.ZodString, "many">;
            required_checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
            matched_files: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
            release_size: z.ZodOptional<z.ZodNumber>;
            file_sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            security_issue: z.ZodOptional<z.ZodObject<{
                findings: z.ZodArray<z.ZodObject<{
                    rule_id: z.ZodString;
                    severity: z.ZodEnum<["WARNING", "ERROR"]>;
                    type: z.ZodEnum<["literal", "regex", "ast"]>;
                    pattern: z.ZodString;
                    file: z.ZodString;
                    snippet: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }, {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            }, {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            }>>;
            source: z.ZodObject<{
                update_type: z.ZodEnum<["github", "custom"]>;
                repo: z.ZodOptional<z.ZodString>;
                tag: z.ZodOptional<z.ZodString>;
                asset_name: z.ZodOptional<z.ZodString>;
                download_url: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            }, {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            }>;
            fingerprint: z.ZodString;
            checked_at: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }, {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        fingerprint: string;
        last_checked_at: string;
        result: {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        };
    }, {
        fingerprint: string;
        last_checked_at: string;
        result: {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        };
    }>>>;
}, "strip", z.ZodTypeAny, {
    entries: Record<string, Record<string, {
        fingerprint: string;
        last_checked_at: string;
        result: {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        };
    }>>;
    schema_version: 1;
}, {
    entries: Record<string, Record<string, {
        fingerprint: string;
        last_checked_at: string;
        result: {
            source: {
                update_type: "custom" | "github";
                repo?: string | undefined;
                tag?: string | undefined;
                asset_name?: string | undefined;
                download_url?: string | undefined;
            };
            is_complete: boolean;
            errors: string[];
            required_checks: Record<string, boolean>;
            matched_files: Record<string, string | null>;
            fingerprint: string;
            checked_at: string;
            file_sizes?: Record<string, number> | undefined;
            release_size?: number | undefined;
            security_issue?: {
                findings: {
                    type: "literal" | "regex" | "ast";
                    severity: "WARNING" | "ERROR";
                    pattern: string;
                    rule_id: string;
                    file: string;
                    snippet?: string | undefined;
                }[];
            } | undefined;
        };
    }>>;
    schema_version: 1;
}>;
export type IntegritySource = z.infer<typeof IntegritySourceSchema>;
export type IntegrityVersionEntry = z.infer<typeof IntegrityVersionEntrySchema>;
export type ListingIntegrityEntry = z.infer<typeof ListingIntegrityEntrySchema>;
export type IntegrityOutput = z.infer<typeof IntegrityOutputSchema>;
export type IntegrityCacheEntry = z.infer<typeof IntegrityCacheEntrySchema>;
export type IntegrityCache = z.infer<typeof IntegrityCacheSchema>;
//# sourceMappingURL=integrity.d.ts.map