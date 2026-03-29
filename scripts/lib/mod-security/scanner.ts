import type JSZip from "jszip";
import { createAstScanContext, parseSourceAst } from "./ast-context.js";
import { findRuleMatch } from "./matchers/index.js";
import { extractSnippet, isSourceCodeEntry, patternLabel, sortFindings } from "./source-utils.js";
import type { CompiledSecurityRule, SecurityFinding, SecurityIssue } from "../mod-security-types.js";

export async function scanZipForSecurityIssues(
  zip: JSZip,
  rules: CompiledSecurityRule[],
): Promise<SecurityIssue | undefined> {
  if (rules.length === 0) return undefined;
  const activeRules = rules.filter((rule) => rule.enabled);
  if (activeRules.length === 0) return undefined;

  const sourceEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && isSourceCodeEntry(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sourceEntries.length === 0) return undefined;

  const hasAstRules = activeRules.some((rule) => rule.type === "ast");
  const findings: SecurityFinding[] = [];

  for (const entry of sourceEntries) {
    let source: string;
    try {
      source = await entry.async("string");
    } catch {
      continue;
    }
    const sourceAst = hasAstRules ? parseSourceAst(source) : null;
    const astContext = sourceAst ? createAstScanContext(sourceAst) : null;

    for (const rule of activeRules) {
      const match = findRuleMatch(source, sourceAst, astContext, rule);
      if (!match.matched) continue;
      findings.push({
        rule_id: rule.id,
        severity: rule.severity,
        type: rule.type,
        pattern: patternLabel(rule),
        file: entry.name,
        snippet: extractSnippet(source, match.index),
      });
    }
  }

  if (findings.length === 0) return undefined;
  findings.sort(sortFindings);
  return { findings };
}

