// The repository's code owners (.github/CODEOWNERS), by GitHub numeric ID.
//
// These accounts may retire a listing they do not own. The Terms of Service
// reserve that authority — §2(a) for content left broken, §3(a) for takedowns
// — but the retirement forms otherwise accept only the publisher or active
// caretaker, so acting on an abandoned listing meant bypassing the flow and
// hand-editing the manifest.
//
// Deliberately a versioned constant rather than a repo variable: changing who
// can retire someone else's listing should require a reviewed PR, and the
// CODEOWNERS rule above means these two must approve it.
const MAINTAINER_GITHUB_IDS: readonly number[] = [
  268817724, // subway-builder-modded-admin
  19807509, // ahkimn
];

export function isMaintainer(githubId: string | number | undefined): boolean {
  if (githubId === undefined) return false;
  const id = typeof githubId === "number" ? githubId : Number.parseInt(githubId, 10);
  return Number.isFinite(id) && MAINTAINER_GITHUB_IDS.includes(id);
}
