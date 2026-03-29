export type SecuritySeverity = "WARNING" | "ERROR";
export type SecurityRuleType = "literal" | "regex" | "ast";

export interface AstRuleCallArgCallPattern {
  kind: "call-arg-call";
  callee: string;
  first_arg_callee: string;
}

export interface AstRuleCallInWhilePattern {
  kind: "call-in-while";
  callees: string[];
  allow_aliases?: boolean;
}

export type AstRulePattern =
  | AstRuleCallArgCallPattern
  | AstRuleCallInWhilePattern;

interface SecurityRuleBase {
  id: string;
  severity: SecuritySeverity;
  description?: string;
  enabled?: boolean;
}

export type SecurityRule =
  | (SecurityRuleBase & {
    type: "literal";
    pattern: string;
  })
  | (SecurityRuleBase & {
    type: "regex";
    pattern: string;
  })
  | (SecurityRuleBase & {
    type: "ast";
    pattern: AstRulePattern;
  });

export interface SecurityRulesFile {
  schema_version: 1;
  rules: SecurityRule[];
}

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

export interface SecurityFinding {
  rule_id: string;
  severity: SecuritySeverity;
  type: SecurityRuleType;
  pattern: string;
  file: string;
  snippet?: string;
}

export interface SecurityIssue {
  findings: SecurityFinding[];
}

