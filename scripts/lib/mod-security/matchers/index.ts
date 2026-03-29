import type { AstRulePattern, CompiledSecurityRule } from "../../mod-security-types.js";
import type { AstScanContext } from "../ast-context.js";
import type { MatchResult } from "./match-result.js";
import { noMatch } from "./match-result.js";
import type { AstPatternMatcher, AstRulePatternKind } from "./types.js";
import { matchCallArgCallPattern } from "./call-arg-call.js";
import { matchCallInWhilePattern } from "./call-in-while.js";

const AST_PATTERN_MATCHERS: { [K in AstRulePatternKind]: AstPatternMatcher<K> } = {
  "call-arg-call": matchCallArgCallPattern,
  "call-in-while": matchCallInWhilePattern,
};

export function findAstRuleMatch(
  sourceAst: unknown,
  rule: Extract<CompiledSecurityRule, { type: "ast" }>,
  context: AstScanContext,
): MatchResult {
  const pattern = rule.pattern;
  const matcher = AST_PATTERN_MATCHERS[pattern.kind] as AstPatternMatcher<AstRulePatternKind>;
  return matcher(
    sourceAst,
    pattern as Extract<AstRulePattern, { kind: AstRulePatternKind }>,
    context,
  );
}

export function findRuleMatch(
  source: string,
  sourceAst: unknown | null,
  astContext: AstScanContext | null,
  rule: CompiledSecurityRule,
): MatchResult {
  if (!rule.enabled) return noMatch();

  if (rule.type === "literal") {
    const index = source.indexOf(rule.pattern);
    return index >= 0 ? { matched: true, index } : noMatch();
  }

  if (rule.type === "regex") {
    const matcher = rule.compiledPattern;
    if (!matcher) return noMatch();
    matcher.lastIndex = 0;
    const match = matcher.exec(source);
    if (typeof match?.index === "number") return { matched: true, index: match.index };
    return noMatch();
  }

  if (!sourceAst || !astContext) return noMatch();
  return findAstRuleMatch(sourceAst, rule, astContext);
}

