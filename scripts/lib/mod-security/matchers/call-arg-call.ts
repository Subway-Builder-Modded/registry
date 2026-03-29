import type { AstRuleCallArgCallPattern } from "../../mod-security-types.js";
import type { AstScanContext } from "../ast-context.js";
import { getCalleeName, safeNodeStart } from "../ast-context.js";
import { matchedAt } from "./match-result.js";
import type { MatchResult } from "./match-result.js";
import { traverse } from "../ast-context.js";

export function matchCallArgCallPattern(
  sourceAst: unknown,
  pattern: AstRuleCallArgCallPattern,
  _context: AstScanContext,
): MatchResult {
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
  return matchedAt(matchIndex);
}
