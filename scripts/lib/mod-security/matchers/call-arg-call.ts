import type { AstRuleCallArgCallPattern } from "../../mod-security-types.js";
import type { AstScanContext } from "../ast-context.js";
import { matchedAt } from "./match-result.js";
import type { MatchResult } from "./match-result.js";

export function matchCallArgCallPattern(
  _sourceAst: unknown,
  pattern: AstRuleCallArgCallPattern,
  context: AstScanContext,
): MatchResult {
  const key = `${pattern.callee}::${pattern.first_arg_callee}`;
  const matchIndex = context.callArgCallFirstIndex.get(key) ?? -1;
  return matchedAt(matchIndex);
}
