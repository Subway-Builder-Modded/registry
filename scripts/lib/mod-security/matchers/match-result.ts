export interface MatchResult {
  matched: boolean;
  index: number;
}

export function noMatch(): MatchResult {
  return { matched: false, index: -1 };
}

export function matchedAt(index: number): MatchResult {
  if (!Number.isFinite(index) || index < 0) return noMatch();
  return { matched: true, index };
}

