import type { CompiledSecurityRule, SecurityFinding, SecuritySeverity } from "../mod-security-types.js";

export function isSourceCodeEntry(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".ts");
}

export function extractSnippet(source: string, matchIndex: number): string | undefined {
  if (!Number.isFinite(matchIndex) || matchIndex < 0 || source.length === 0) return undefined;
  const radius = 60;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(source.length, matchIndex + radius);
  const raw = source.slice(start, end).replace(/\s+/g, " ").trim();
  return raw === "" ? undefined : raw;
}

function findingSortValue(severity: SecuritySeverity): number {
  return severity === "ERROR" ? 0 : 1;
}

export function sortFindings(a: SecurityFinding, b: SecurityFinding): number {
  if (a.severity !== b.severity) {
    return findingSortValue(a.severity) - findingSortValue(b.severity);
  }
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  if (a.rule_id !== b.rule_id) return a.rule_id.localeCompare(b.rule_id);
  return a.pattern.localeCompare(b.pattern);
}

export function patternLabel(rule: CompiledSecurityRule): string {
  if (rule.type !== "ast") return rule.pattern;
  if (rule.pattern.kind === "call-arg-call") {
    return `${rule.pattern.callee}( ${rule.pattern.first_arg_callee}(...) )`;
  }
  return `call-in-while:[${rule.pattern.callees.join(",")}] aliases=${rule.pattern.allow_aliases === true}`;
}

