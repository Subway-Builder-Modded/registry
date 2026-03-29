import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  CompiledSecurityRule,
  LoadedSecurityRules,
  SecurityRule,
  SecurityRulesFile,
} from "../mod-security-types.js";

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

