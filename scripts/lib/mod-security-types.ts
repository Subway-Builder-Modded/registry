// Data types serialized to JSON — defined in @registry/schemas
export type {
  SecuritySeverity,
  SecurityRuleType,
  AstRuleCallArgCallPattern,
  AstRuleCallInWhilePattern,
  AstRulePattern,
  SecurityRule,
  SecurityRulesFile,
  SecurityFinding,
  SecurityIssue,
} from "@registry/schemas";

import type { SecurityRule } from "@registry/schemas";

// Runtime-only types (not serialized to JSON)

export type CompiledSecurityRule =
  | (Extract<SecurityRule, { type: "literal" }> & {
    enabled: boolean;
  })
  | (Extract<SecurityRule, { type: "regex" }> & {
    enabled: boolean;
    compiledPattern?: RegExp;
  })
  | (Extract<SecurityRule, { type: "ast" }> & {
    enabled: boolean;
  });

export interface LoadedSecurityRules {
  schemaVersion: 1;
  sourcePath: string;
  fingerprint: string;
  rules: CompiledSecurityRule[];
}
