export { loadSecurityRules } from "./mod-security/rules-loader.js";
export { scanZipForSecurityIssues } from "./mod-security/scanner.js";

export type {
  AstRuleCallArgCallPattern,
  AstRuleCallInWhilePattern,
  AstRulePattern,
  CompiledSecurityRule,
  LoadedSecurityRules,
  SecurityFinding,
  SecurityIssue,
  SecurityRule,
  SecurityRuleType,
  SecurityRulesFile,
  SecuritySeverity,
} from "./mod-security-types.js";

