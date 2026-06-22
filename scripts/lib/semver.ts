import semver from "semver";

type StableSemverParts = readonly [number, number, number];

export function parseStableSemverTag(tag: string): StableSemverParts | null {
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ] as const;
}

export function normalizeStableSemverTag(tag: string): string | null {
  const parts = parseStableSemverTag(tag);
  if (!parts) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export function isStableSemverTag(tag: string): boolean {
  return parseStableSemverTag(tag) !== null;
}

export function compareStableSemverAsc(a: string, b: string): number {
  const pa = parseStableSemverTag(a);
  const pb = parseStableSemverTag(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  if (pa[2] !== pb[2]) return pa[2] - pb[2];
  return a.localeCompare(b);
}

export function compareStableSemverDesc(a: string, b: string): number {
  const pa = parseStableSemverTag(a);
  const pb = parseStableSemverTag(b);
  if (!pa || !pb) return b.localeCompare(a);
  if (pa[0] !== pb[0]) return pb[0] - pa[0];
  if (pa[1] !== pb[1]) return pb[1] - pa[1];
  if (pa[2] !== pb[2]) return pb[2] - pa[2];
  return b.localeCompare(a);
}

// Validates a game_version semver RANGE (e.g. "<=1.3.0", ">=1.0.0 <2.0.0", "^1.2.0",
// "1.x", "1.2.3 - 1.4.0", "1.0.0 || 2.0.0"). Delegates to node-semver so it stays in
// parity with the consumers: the frontend uses node-semver (semver.satisfies) and the
// backend uses Masterminds/semver, which tracks node-semver. Empty is a violation
// (semver.validRange("") is "", not null, so reject it explicitly).
export function isValidGameVersionRange(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  return semver.validRange(value.trim()) !== null;
}
