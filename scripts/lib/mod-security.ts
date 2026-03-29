import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";
import type JSZip from "jszip";
import { z } from "zod";

const traverse = (
  (traverseImport as unknown as { default?: typeof traverseImport }).default
  ?? traverseImport
);

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

interface SecurityRulesFile {
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

const LiteralRuleSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["WARNING", "ERROR"]),
  type: z.literal("literal"),
  pattern: z.string().min(1),
  description: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict();

const RegexRuleSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["WARNING", "ERROR"]),
  type: z.literal("regex"),
  pattern: z.string().min(1),
  description: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict();

const AstCallArgCallPatternSchema = z.object({
  kind: z.literal("call-arg-call"),
  callee: z.string().min(1),
  first_arg_callee: z.string().min(1),
}).strict();

const AstCallInWhilePatternSchema = z.object({
  kind: z.literal("call-in-while"),
  callees: z.array(z.string().min(1)).min(1),
  allow_aliases: z.boolean().optional(),
}).strict();

const AstRuleSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["WARNING", "ERROR"]),
  type: z.literal("ast"),
  pattern: z.discriminatedUnion("kind", [
    AstCallArgCallPatternSchema,
    AstCallInWhilePatternSchema,
  ]),
  description: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict();

const SecurityRuleSchema = z.discriminatedUnion("type", [
  LiteralRuleSchema,
  RegexRuleSchema,
  AstRuleSchema,
]);

const SecurityRulesFileSchema = z.object({
  schema_version: z.literal(1),
  rules: z.array(SecurityRuleSchema),
}).strict();

function normalizeForFingerprint(config: SecurityRulesFile): SecurityRulesFile {
  const normalizedRules = config.rules
    .map((rule) => ({
      ...rule,
      enabled: rule.enabled ?? true,
    }))
    .sort((a, b) => {
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      if (a.severity !== b.severity) return a.severity.localeCompare(b.severity);
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      const aPattern = JSON.stringify(a.pattern);
      const bPattern = JSON.stringify(b.pattern);
      if (aPattern !== bPattern) return aPattern.localeCompare(bPattern);
      return (a.description ?? "").localeCompare(b.description ?? "");
    });

  return {
    schema_version: 1,
    rules: normalizedRules,
  };
}

function rulesFingerprint(config: SecurityRulesFile): string {
  const normalized = normalizeForFingerprint(config);
  const serialized = JSON.stringify(normalized);
  const digest = createHash("sha256").update(serialized).digest("hex");
  return `security-rules:${digest}`;
}

function compileRule(rule: SecurityRule): CompiledSecurityRule {
  const enabled = rule.enabled ?? true;
  if (!enabled) {
    return { ...rule, enabled };
  }

  if (rule.type === "regex") {
    try {
      const compiledPattern = new RegExp(rule.pattern);
      return { ...rule, enabled, compiledPattern };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`security rule '${rule.id}' has invalid regex pattern: ${message}`);
    }
  }

  return { ...rule, enabled };
}

function isSourceCodeEntry(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".ts");
}

function extractSnippet(source: string, matchIndex: number): string | undefined {
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

function sortFindings(a: SecurityFinding, b: SecurityFinding): number {
  if (a.severity !== b.severity) {
    return findingSortValue(a.severity) - findingSortValue(b.severity);
  }
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  if (a.rule_id !== b.rule_id) return a.rule_id.localeCompare(b.rule_id);
  return a.pattern.localeCompare(b.pattern);
}

function safeNodeStart(node: unknown): number {
  if (typeof node !== "object" || node === null) return -1;
  const raw = node as { start?: unknown };
  return typeof raw.start === "number" ? raw.start : -1;
}

function getCalleeName(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const typed = node as {
    type?: unknown;
    name?: unknown;
    computed?: unknown;
    property?: unknown;
  };
  if (typed.type === "Identifier" && typeof typed.name === "string") {
    return typed.name;
  }
  if (
    (typed.type === "MemberExpression" || typed.type === "OptionalMemberExpression")
    && typed.computed !== true
    && typeof typed.property === "object"
    && typed.property !== null
    && (typed.property as { type?: unknown }).type === "Identifier"
  ) {
    const propertyName = (typed.property as { name?: unknown }).name;
    return typeof propertyName === "string" ? propertyName : null;
  }
  return null;
}

function patternLabel(rule: CompiledSecurityRule): string {
  if (rule.type !== "ast") return rule.pattern;
  if (rule.pattern.kind === "call-arg-call") {
    return `${rule.pattern.callee}( ${rule.pattern.first_arg_callee}(...) )`;
  }
  return `call-in-while:[${rule.pattern.callees.join(",")}] aliases=${rule.pattern.allow_aliases === true}`;
}

function parseSourceAst(source: string): unknown | null {
  try {
    return parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
      ],
    });
  } catch {
    return null;
  }
}

function resolveAliasName(name: string, aliases: Map<string, string>): string {
  let current = name;
  const visited = new Set<string>();
  while (aliases.has(current) && !visited.has(current)) {
    visited.add(current);
    current = aliases.get(current) ?? current;
  }
  return current;
}

function resolveExpressionName(expression: unknown): string | null {
  return getCalleeName(expression);
}

function collectAliasMappings(ast: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  const mappings: Array<{ alias: string; target: string }> = [];

  traverse(ast as any, {
    VariableDeclarator(path: any) {
      const node = path.node as {
        id?: unknown;
        init?: unknown;
      };
      if (
        typeof node.id !== "object"
        || node.id === null
        || (node.id as { type?: unknown }).type !== "Identifier"
      ) {
        return;
      }
      const alias = (node.id as { name?: unknown }).name;
      if (typeof alias !== "string") return;
      const target = resolveExpressionName(node.init);
      if (!target) return;
      mappings.push({ alias, target });
    },
    AssignmentExpression(path: any) {
      const node = path.node as {
        left?: unknown;
        right?: unknown;
      };
      if (
        typeof node.left !== "object"
        || node.left === null
        || (node.left as { type?: unknown }).type !== "Identifier"
      ) {
        return;
      }
      const alias = (node.left as { name?: unknown }).name;
      if (typeof alias !== "string") return;
      const target = resolveExpressionName(node.right);
      if (!target) return;
      mappings.push({ alias, target });
    },
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const mapping of mappings) {
      const resolvedTarget = resolveAliasName(mapping.target, aliases);
      const current = aliases.get(mapping.alias);
      if (current !== resolvedTarget) {
        aliases.set(mapping.alias, resolvedTarget);
        changed = true;
      }
    }
  }

  return aliases;
}

function findAstRuleMatchIndex(
  sourceAst: unknown,
  rule: Extract<CompiledSecurityRule, { type: "ast" }>,
): number {
  const pattern = rule.pattern;
  if (pattern.kind === "call-arg-call") {
    let matchIndex = -1;
    traverse(sourceAst as any, {
      CallExpression(path: any) {
        if (matchIndex >= 0) return;
        const node = path.node as {
          callee?: unknown;
          arguments?: unknown[];
        };
        const calleeName = getCalleeName(node.callee);
        if (calleeName !== pattern.callee) return;
        const firstArg = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
        if (
          typeof firstArg !== "object"
          || firstArg === null
          || (firstArg as { type?: unknown }).type !== "CallExpression"
        ) {
          return;
        }
        const argCalleeName = getCalleeName((firstArg as { callee?: unknown }).callee);
        if (argCalleeName !== pattern.first_arg_callee) return;
        matchIndex = safeNodeStart(path.node);
      },
    });
    return matchIndex;
  }

  const targetCallees = new Set(pattern.callees);
  const aliases = pattern.allow_aliases === true
    ? collectAliasMappings(sourceAst)
    : new Map<string, string>();

  let matchIndex = -1;
  traverse(sourceAst as any, {
    WhileStatement(path: any) {
      if (matchIndex >= 0) return;
      path.traverse({
        CallExpression(callPath: any) {
          if (matchIndex >= 0) return;
          const node = callPath.node as { callee?: unknown };
          const directName = getCalleeName(node.callee);
          if (!directName) return;
          const nameToCheck = pattern.allow_aliases === true
            ? resolveAliasName(directName, aliases)
            : directName;
          if (!targetCallees.has(nameToCheck)) return;
          matchIndex = safeNodeStart(callPath.node);
        },
      });
    },
  });

  return matchIndex;
}

function findMatchIndex(
  source: string,
  sourceAst: unknown | null,
  rule: CompiledSecurityRule,
): number {
  if (!rule.enabled) return -1;

  if (rule.type === "literal") {
    return source.indexOf(rule.pattern);
  }
  if (rule.type === "regex") {
    const matcher = rule.compiledPattern;
    if (!matcher) return -1;
    matcher.lastIndex = 0;
    const match = matcher.exec(source);
    return typeof match?.index === "number" ? match.index : -1;
  }

  if (!sourceAst) return -1;
  return findAstRuleMatchIndex(sourceAst, rule);
}

export function loadSecurityRules(repoRoot: string): LoadedSecurityRules {
  const sourcePath = resolve(repoRoot, "security-rules.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(sourcePath, "utf-8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read security rules at ${sourcePath}: ${message}`);
  }

  const parsed = SecurityRulesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid security rules file '${sourcePath}': ${issues}`);
  }

  const compiled = parsed.data.rules.map(compileRule);
  return {
    schemaVersion: 1,
    sourcePath,
    fingerprint: rulesFingerprint(parsed.data),
    rules: compiled,
  };
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
  const findings: SecurityFinding[] = [];

  for (const entry of sourceEntries) {
    let source: string;
    try {
      source = await entry.async("string");
    } catch {
      continue;
    }
    const sourceAst = hasAstRules ? parseSourceAst(source) : null;

    for (const rule of activeRules) {
      const matchIndex = findMatchIndex(source, sourceAst, rule);
      if (matchIndex < 0) continue;
      findings.push({
        rule_id: rule.id,
        severity: rule.severity,
        type: rule.type,
        pattern: patternLabel(rule),
        file: entry.name,
        snippet: extractSnippet(source, matchIndex),
      });
    }
  }

  if (findings.length === 0) return undefined;
  findings.sort(sortFindings);
  return { findings };
}
