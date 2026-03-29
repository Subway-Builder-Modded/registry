import type JSZip from "jszip";
import { createAstScanContext, parseSourceAst } from "./ast-context.js";
import { findRuleMatch } from "./matchers/index.js";
import { extractSnippet, isSourceCodeEntry, patternLabel, sortFindings } from "./source-utils.js";
import type { CompiledSecurityRule, SecurityFinding, SecurityIssue } from "../mod-security-types.js";

const DEFAULT_SCAN_CONCURRENCY = 4;

function getScanConcurrency(): number {
  const rawValue = process.env.MOD_SECURITY_SCAN_CONCURRENCY;
  if (!rawValue) return DEFAULT_SCAN_CONCURRENCY;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SCAN_CONCURRENCY;
  return Math.min(parsed, 16);
}

function shouldParseAstForSource(
  source: string,
  activeRules: CompiledSecurityRule[],
): boolean {
  for (const rule of activeRules) {
    if (rule.type !== "ast") continue;
    if (rule.pattern.kind === "call-in-while") {
      if (source.includes("while")) return true;
      continue;
    }
    if (rule.pattern.kind === "call-arg-call") {
      if (source.includes(rule.pattern.callee) && source.includes(rule.pattern.first_arg_callee)) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

async function scanSourceEntry(
  entry: JSZip.JSZipObject,
  activeRules: CompiledSecurityRule[],
  hasAstRules: boolean,
): Promise<SecurityFinding[]> {
  let source: string;
  try {
    source = await entry.async("string");
  } catch {
    return [];
  }

  const shouldParseAst = hasAstRules && shouldParseAstForSource(source, activeRules);
  const sourceAst = shouldParseAst ? parseSourceAst(source) : null;
  const astContext = sourceAst ? createAstScanContext(sourceAst) : null;

  const findings: SecurityFinding[] = [];
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
  return findings;
}

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
  const concurrency = Math.min(getScanConcurrency(), sourceEntries.length);
  const findingsByWorker: SecurityFinding[][] = Array.from({ length: concurrency }, () => []);
  let nextIndex = 0;

  async function runWorker(workerIndex: number): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= sourceEntries.length) {
        return;
      }
      const entryFindings = await scanSourceEntry(sourceEntries[index], activeRules, hasAstRules);
      if (entryFindings.length > 0) {
        findingsByWorker[workerIndex].push(...entryFindings);
      }
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, (_, workerIndex) => runWorker(workerIndex)),
  );
  const findings = findingsByWorker.flat();

  if (findings.length === 0) return undefined;
  findings.sort(sortFindings);
  return { findings };
}

