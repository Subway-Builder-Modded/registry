import { z } from "zod";

export const SecuritySeveritySchema = z.enum(["WARNING", "ERROR"]);
export const SecurityRuleTypeSchema = z.enum(["literal", "regex", "ast"]);

export const AstRuleCallArgCallPatternSchema = z.object({
  kind: z.literal("call-arg-call"),
  callee: z.string(),
  first_arg_callee: z.string(),
});

export const AstRuleCallInWhilePatternSchema = z.object({
  kind: z.literal("call-in-while"),
  callees: z.array(z.string()),
  allow_aliases: z.boolean().optional(),
});

export const AstRulePatternSchema = z.discriminatedUnion("kind", [
  AstRuleCallArgCallPatternSchema,
  AstRuleCallInWhilePatternSchema,
]);

const SecurityRuleBaseSchema = z.object({
  id: z.string(),
  severity: SecuritySeveritySchema,
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const SecurityRuleSchema = z.discriminatedUnion("type", [
  SecurityRuleBaseSchema.extend({
    type: z.literal("literal"),
    pattern: z.string(),
  }),
  SecurityRuleBaseSchema.extend({
    type: z.literal("regex"),
    pattern: z.string(),
  }),
  SecurityRuleBaseSchema.extend({
    type: z.literal("ast"),
    pattern: AstRulePatternSchema,
  }),
]);

export const SecurityRulesFileSchema = z.object({
  schema_version: z.literal(1),
  rules: z.array(SecurityRuleSchema),
});

export const SecurityFindingSchema = z.object({
  rule_id: z.string(),
  severity: SecuritySeveritySchema,
  type: SecurityRuleTypeSchema,
  pattern: z.string(),
  file: z.string(),
  snippet: z.string().optional(),
});

export const SecurityIssueSchema = z.object({
  findings: z.array(SecurityFindingSchema),
});

export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;
export type SecurityRuleType = z.infer<typeof SecurityRuleTypeSchema>;
export type AstRuleCallArgCallPattern = z.infer<typeof AstRuleCallArgCallPatternSchema>;
export type AstRuleCallInWhilePattern = z.infer<typeof AstRuleCallInWhilePatternSchema>;
export type AstRulePattern = z.infer<typeof AstRulePatternSchema>;
export type SecurityRule = z.infer<typeof SecurityRuleSchema>;
export type SecurityRulesFile = z.infer<typeof SecurityRulesFileSchema>;
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type SecurityIssue = z.infer<typeof SecurityIssueSchema>;
