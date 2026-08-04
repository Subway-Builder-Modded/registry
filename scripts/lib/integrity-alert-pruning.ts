import type { IntegrityOutput } from "@subway-builder-modded/registry-schemas";

// Lifecycle automation for creator-facing integrity-alert issues:
// - RESOLVED alerts (the failing version now passes integrity, disappeared, or
//   the listing was deprecated) are closed as completed.
// - STALE alerts (no comment activity for two weeks where the creator never
//   responded — the last word is the bot's alert or a maintainer's) are closed
//   as not_planned; a genuine recurrence re-fires a fresh alert on the next
//   state transition.
// - Alerts where the LAST comment is from the creator (a non-maintainer) are
//   ESCALATED instead: labeled needs-maintainer and maintainers are pinged.
//   Escalated issues are exempt from stale pruning until a human acts.

export const NEEDS_MAINTAINER_LABEL = "needs-maintainer";
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const ALERT_TITLE_REGEX = /^\[Integrity\] (\S+) (\S+): failing checks$/;

export interface AlertIssueRef {
  listingId: string;
  version: string;
}

export function parseAlertIssueTitle(title: string): AlertIssueRef | null {
  const match = ALERT_TITLE_REGEX.exec(title.trim());
  if (!match) return null;
  return { listingId: match[1]!, version: match[2]! };
}

export type AlertResolution =
  | { resolved: true; reason: "version_complete" | "version_removed" | "listing_removed" | "listing_deprecated" }
  | { resolved: false };

/**
 * Determines whether the failure an alert issue describes still exists in the
 * PUBLISHED integrity outputs. The deprecation overlay reports deprecated
 * listings with zero complete versions, so deprecation is detected via the
 * listing_deprecated marker error rather than treated as a live failure.
 */
export function resolveAlertAgainstIntegrity(
  ref: AlertIssueRef,
  integrityByDir: { maps: IntegrityOutput | null; mods: IntegrityOutput | null },
): AlertResolution {
  const listing = integrityByDir.maps?.listings[ref.listingId]
    ?? integrityByDir.mods?.listings[ref.listingId];
  if (!listing) {
    return { resolved: true, reason: "listing_removed" };
  }
  const version = listing.versions[ref.version];
  if (!version) {
    return { resolved: true, reason: "version_removed" };
  }
  if (version.is_complete) {
    return { resolved: true, reason: "version_complete" };
  }
  if (version.errors.includes("listing_deprecated")) {
    return { resolved: true, reason: "listing_deprecated" };
  }
  return { resolved: false };
}

export interface AlertIssueState {
  title: string;
  createdAt: string;
  labels: string[];
  // Most recent issue comment, if any. isMaintainer covers repo
  // admin/maintain collaborators AND bot accounts (the alert body and any
  // automation comments are the registry's side of the conversation).
  lastComment: { createdAt: string; isMaintainer: boolean } | null;
}

export type AlertIssueAction =
  | { action: "close_resolved"; reason: Extract<AlertResolution, { resolved: true }>["reason"] }
  | { action: "close_stale" }
  | { action: "escalate" }
  | { action: "none"; reason: string };

export function decideAlertIssueAction(
  issue: AlertIssueState,
  resolution: AlertResolution,
  now: Date,
): AlertIssueAction {
  if (resolution.resolved) {
    return { action: "close_resolved", reason: resolution.reason };
  }

  const lastActivityAt = Date.parse(issue.lastComment?.createdAt ?? issue.createdAt);
  if (!Number.isFinite(lastActivityAt)) {
    return { action: "none", reason: "unparseable activity timestamp" };
  }
  if (now.getTime() - lastActivityAt < STALE_AFTER_MS) {
    return { action: "none", reason: "recent activity" };
  }

  // The creator has the last word: surface it to maintainers (once) instead of
  // pruning. Already-escalated issues wait for a human.
  if (issue.lastComment && !issue.lastComment.isMaintainer) {
    if (issue.labels.includes(NEEDS_MAINTAINER_LABEL)) {
      return { action: "none", reason: "already escalated" };
    }
    return { action: "escalate" };
  }
  if (issue.labels.includes(NEEDS_MAINTAINER_LABEL)) {
    return { action: "none", reason: "escalated; awaiting maintainer" };
  }

  return { action: "close_stale" };
}

export function buildResolvedCloseComment(
  ref: AlertIssueRef,
  reason: Extract<AlertResolution, { resolved: true }>["reason"],
): string {
  switch (reason) {
    case "version_complete":
      return `\`${ref.listingId}\` \`${ref.version}\` now passes its integrity checks — closing this alert as resolved. Thanks for fixing it!`;
    case "version_removed":
      return `\`${ref.version}\` is no longer part of \`${ref.listingId}\`'s published releases, so this alert no longer applies — closing as resolved.`;
    case "listing_removed":
      return `\`${ref.listingId}\` is no longer in the registry, so this alert no longer applies — closing.`;
    case "listing_deprecated":
      return `\`${ref.listingId}\` has been deprecated, so its versions are intentionally not installable and this alert no longer applies — closing.`;
  }
}

export function buildStaleCloseComment(): string {
  return (
    "Closing this alert as stale — there has been no activity for two weeks. "
    + "The underlying check failure may still exist; if the version starts failing again after a fix attempt, "
    + "a fresh alert will be opened automatically. Feel free to reopen or comment if you are still working on this."
  );
}

export function buildEscalationComment(maintainerMentions: string): string {
  return (
    `${maintainerMentions} — the creator responded to this integrity alert and it has been waiting on a maintainer for two weeks. `
    + `Labeling \`${NEEDS_MAINTAINER_LABEL}\`; this issue is exempt from stale pruning until a maintainer follows up.`
  );
}
