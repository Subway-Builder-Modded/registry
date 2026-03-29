import type { AstRulePattern } from "../../mod-security-types.js";
import type { AstScanContext } from "../ast-context.js";
import type { MatchResult } from "./match-result.js";

export type AstRulePatternKind = AstRulePattern["kind"];

export type AstPatternMatcher<K extends AstRulePatternKind> = (
  sourceAst: unknown,
  pattern: Extract<AstRulePattern, { kind: K }>,
  context: AstScanContext,
) => MatchResult;

