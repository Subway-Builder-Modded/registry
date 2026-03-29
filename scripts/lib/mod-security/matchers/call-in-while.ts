import type { AstRuleCallInWhilePattern } from "../../mod-security-types.js";
import { getCalleeName, resolveAliasName, safeNodeStart, traverse } from "../ast-context.js";
import type { AstScanContext } from "../ast-context.js";
import { matchedAt } from "./match-result.js";
import type { MatchResult } from "./match-result.js";

export function matchCallInWhilePattern(
  sourceAst: unknown,
  pattern: AstRuleCallInWhilePattern,
  context: AstScanContext,
): MatchResult {
  const targetCallees = new Set(pattern.callees);
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
            ? resolveAliasName(directName, context.aliases)
            : directName;
          if (!targetCallees.has(nameToCheck)) return;
          matchIndex = safeNodeStart(callPath.node);
        },
      });
    },
  });

  return matchedAt(matchIndex);
}
