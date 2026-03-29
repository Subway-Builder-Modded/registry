import type { AstRuleCallInWhilePattern } from "../../mod-security-types.js";
import type { AstScanContext } from "../ast-context.js";
import { matchedAt } from "./match-result.js";
import type { MatchResult } from "./match-result.js";

export function matchCallInWhilePattern(
  _sourceAst: unknown,
  pattern: AstRuleCallInWhilePattern,
  context: AstScanContext,
): MatchResult {
  const indexMap = pattern.allow_aliases === true
    ? context.whileCallResolvedFirstIndex
    : context.whileCallDirectFirstIndex;
  let bestIndex = -1;
  for (const calleeName of pattern.callees) {
    const index = indexMap.get(calleeName);
    if (typeof index !== "number") continue;
    if (bestIndex < 0 || index < bestIndex) {
      bestIndex = index;
    }
  }
  return matchedAt(bestIndex);
}
