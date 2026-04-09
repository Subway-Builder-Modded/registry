import { z } from "zod";
export declare const SecuritySeveritySchema: z.ZodEnum<["WARNING", "ERROR"]>;
export declare const SecurityRuleTypeSchema: z.ZodEnum<["literal", "regex", "ast"]>;
export declare const AstRuleCallArgCallPatternSchema: z.ZodObject<{
    kind: z.ZodLiteral<"call-arg-call">;
    callee: z.ZodString;
    first_arg_callee: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "call-arg-call";
    callee: string;
    first_arg_callee: string;
}, {
    kind: "call-arg-call";
    callee: string;
    first_arg_callee: string;
}>;
export declare const AstRuleCallInWhilePatternSchema: z.ZodObject<{
    kind: z.ZodLiteral<"call-in-while">;
    callees: z.ZodArray<z.ZodString, "many">;
    allow_aliases: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    kind: "call-in-while";
    callees: string[];
    allow_aliases?: boolean | undefined;
}, {
    kind: "call-in-while";
    callees: string[];
    allow_aliases?: boolean | undefined;
}>;
export declare const AstRulePatternSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"call-arg-call">;
    callee: z.ZodString;
    first_arg_callee: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "call-arg-call";
    callee: string;
    first_arg_callee: string;
}, {
    kind: "call-arg-call";
    callee: string;
    first_arg_callee: string;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"call-in-while">;
    callees: z.ZodArray<z.ZodString, "many">;
    allow_aliases: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    kind: "call-in-while";
    callees: string[];
    allow_aliases?: boolean | undefined;
}, {
    kind: "call-in-while";
    callees: string[];
    allow_aliases?: boolean | undefined;
}>]>;
export declare const SecurityRuleSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["WARNING", "ERROR"]>;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
} & {
    type: z.ZodLiteral<"literal">;
    pattern: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "literal";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: string;
    description?: string | undefined;
    enabled?: boolean | undefined;
}, {
    type: "literal";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: string;
    description?: string | undefined;
    enabled?: boolean | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["WARNING", "ERROR"]>;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
} & {
    type: z.ZodLiteral<"regex">;
    pattern: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "regex";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: string;
    description?: string | undefined;
    enabled?: boolean | undefined;
}, {
    type: "regex";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: string;
    description?: string | undefined;
    enabled?: boolean | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["WARNING", "ERROR"]>;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
} & {
    type: z.ZodLiteral<"ast">;
    pattern: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"call-arg-call">;
        callee: z.ZodString;
        first_arg_callee: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: "call-arg-call";
        callee: string;
        first_arg_callee: string;
    }, {
        kind: "call-arg-call";
        callee: string;
        first_arg_callee: string;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"call-in-while">;
        callees: z.ZodArray<z.ZodString, "many">;
        allow_aliases: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        kind: "call-in-while";
        callees: string[];
        allow_aliases?: boolean | undefined;
    }, {
        kind: "call-in-while";
        callees: string[];
        allow_aliases?: boolean | undefined;
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "ast";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: {
        kind: "call-arg-call";
        callee: string;
        first_arg_callee: string;
    } | {
        kind: "call-in-while";
        callees: string[];
        allow_aliases?: boolean | undefined;
    };
    description?: string | undefined;
    enabled?: boolean | undefined;
}, {
    type: "ast";
    id: string;
    severity: "WARNING" | "ERROR";
    pattern: {
        kind: "call-arg-call";
        callee: string;
        first_arg_callee: string;
    } | {
        kind: "call-in-while";
        callees: string[];
        allow_aliases?: boolean | undefined;
    };
    description?: string | undefined;
    enabled?: boolean | undefined;
}>]>;
export declare const SecurityRulesFileSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    rules: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["WARNING", "ERROR"]>;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodOptional<z.ZodBoolean>;
    } & {
        type: z.ZodLiteral<"literal">;
        pattern: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "literal";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    }, {
        type: "literal";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["WARNING", "ERROR"]>;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodOptional<z.ZodBoolean>;
    } & {
        type: z.ZodLiteral<"regex">;
        pattern: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "regex";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    }, {
        type: "regex";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["WARNING", "ERROR"]>;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodOptional<z.ZodBoolean>;
    } & {
        type: z.ZodLiteral<"ast">;
        pattern: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"call-arg-call">;
            callee: z.ZodString;
            first_arg_callee: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        }, {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"call-in-while">;
            callees: z.ZodArray<z.ZodString, "many">;
            allow_aliases: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        }, {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "ast";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        } | {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        };
        description?: string | undefined;
        enabled?: boolean | undefined;
    }, {
        type: "ast";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        } | {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        };
        description?: string | undefined;
        enabled?: boolean | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    schema_version: 1;
    rules: ({
        type: "literal";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    } | {
        type: "regex";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    } | {
        type: "ast";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        } | {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        };
        description?: string | undefined;
        enabled?: boolean | undefined;
    })[];
}, {
    schema_version: 1;
    rules: ({
        type: "literal";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    } | {
        type: "regex";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: string;
        description?: string | undefined;
        enabled?: boolean | undefined;
    } | {
        type: "ast";
        id: string;
        severity: "WARNING" | "ERROR";
        pattern: {
            kind: "call-arg-call";
            callee: string;
            first_arg_callee: string;
        } | {
            kind: "call-in-while";
            callees: string[];
            allow_aliases?: boolean | undefined;
        };
        description?: string | undefined;
        enabled?: boolean | undefined;
    })[];
}>;
export declare const SecurityFindingSchema: z.ZodObject<{
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
}>;
export declare const SecurityIssueSchema: z.ZodObject<{
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
}>;
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;
export type SecurityRuleType = z.infer<typeof SecurityRuleTypeSchema>;
export type AstRuleCallArgCallPattern = z.infer<typeof AstRuleCallArgCallPatternSchema>;
export type AstRuleCallInWhilePattern = z.infer<typeof AstRuleCallInWhilePatternSchema>;
export type AstRulePattern = z.infer<typeof AstRulePatternSchema>;
export type SecurityRule = z.infer<typeof SecurityRuleSchema>;
export type SecurityRulesFile = z.infer<typeof SecurityRulesFileSchema>;
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type SecurityIssue = z.infer<typeof SecurityIssueSchema>;
//# sourceMappingURL=security.d.ts.map