import { resolve } from "node:path";
import { loadIntegritySnapshot } from "../lib/downloads-support.js";
import {
  NEEDS_MAINTAINER_LABEL,
  buildEscalationComment,
  buildResolvedCloseComment,
  buildStaleCloseComment,
  decideAlertIssueAction,
  parseAlertIssueTitle,
  resolveAlertAgainstIntegrity,
} from "../lib/integrity-alert-pruning.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY ?? "Subway-Builder-Modded/registry";
const maintainerMentions = process.env.MAINTAINER_MENTIONS ?? "@ahkimn";
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

if (!token) {
  console.error("GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

const apiHeaders: Record<string, string> = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

interface IssueListItem {
  number: number;
  title: string;
  created_at: string;
  comments: number;
  labels: Array<{ name?: string }>;
}

interface IssueComment {
  created_at: string;
  user: { login?: string; type?: string } | null;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, { ...init, headers: { ...apiHeaders, ...(init?.headers ?? {}) } });
}

async function listOpenAlertIssues(): Promise<IssueListItem[]> {
  const issues: IssueListItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api(
      `/repos/${repository}/issues?labels=integrity-alert&state=open&per_page=100&page=${page}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to list integrity-alert issues: HTTP ${response.status}`);
    }
    const batch = await response.json() as IssueListItem[];
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

async function fetchLastComment(issueNumber: number, commentCount: number): Promise<IssueComment | null> {
  if (commentCount === 0) return null;
  const response = await api(
    `/repos/${repository}/issues/${issueNumber}/comments?per_page=1&page=${commentCount}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch comments for #${issueNumber}: HTTP ${response.status}`);
  }
  const comments = await response.json() as IssueComment[];
  return comments[comments.length - 1] ?? null;
}

const maintainerCache = new Map<string, boolean>();

async function isMaintainerSide(user: IssueComment["user"]): Promise<boolean> {
  const login = user?.login ?? "";
  if (!login) return true;
  if (user?.type === "Bot" || login.endsWith("[bot]")) return true;
  const cached = maintainerCache.get(login);
  if (cached !== undefined) return cached;
  const response = await api(`/repos/${repository}/collaborators/${login}/permission`);
  let maintainer = false;
  if (response.ok) {
    const payload = await response.json() as { role_name?: string; permission?: string };
    const role = payload.role_name ?? payload.permission ?? "";
    maintainer = role === "admin" || role === "maintain";
  }
  maintainerCache.set(login, maintainer);
  return maintainer;
}

async function comment(issueNumber: number, body: string): Promise<void> {
  const response = await api(`/repos/${repository}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(`Failed to comment on #${issueNumber}: HTTP ${response.status}`);
}

async function closeIssue(issueNumber: number, stateReason: "completed" | "not_planned"): Promise<void> {
  const response = await api(`/repos/${repository}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: stateReason }),
  });
  if (!response.ok) throw new Error(`Failed to close #${issueNumber}: HTTP ${response.status}`);
}

async function addLabel(issueNumber: number, label: string): Promise<void> {
  const response = await api(`/repos/${repository}/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: [label] }),
  });
  if (!response.ok) throw new Error(`Failed to label #${issueNumber}: HTTP ${response.status}`);
}

async function main(): Promise<void> {
  const integrityByDir = {
    maps: loadIntegritySnapshot(REPO_ROOT, "maps"),
    mods: loadIntegritySnapshot(REPO_ROOT, "mods"),
  };
  const now = new Date();
  const issues = await listOpenAlertIssues();
  console.log(`[prune-alerts] ${issues.length} open integrity-alert issue(s)`);

  const summary = { closed_resolved: 0, closed_stale: 0, escalated: 0, skipped: 0 };
  for (const issue of issues) {
    const ref = parseAlertIssueTitle(issue.title);
    if (!ref) {
      console.log(`[prune-alerts] #${issue.number} skipped (unrecognized title: ${issue.title})`);
      summary.skipped += 1;
      continue;
    }

    const lastCommentRaw = await fetchLastComment(issue.number, issue.comments);
    const lastComment = lastCommentRaw
      ? { createdAt: lastCommentRaw.created_at, isMaintainer: await isMaintainerSide(lastCommentRaw.user) }
      : null;
    const resolution = resolveAlertAgainstIntegrity(ref, integrityByDir);
    const decision = decideAlertIssueAction(
      {
        title: issue.title,
        createdAt: issue.created_at,
        labels: issue.labels.map((label) => label.name ?? ""),
        lastComment,
      },
      resolution,
      now,
    );

    const describe = `#${issue.number} (${ref.listingId} ${ref.version})`;
    if (decision.action === "none") {
      console.log(`[prune-alerts] ${describe}: no action (${decision.reason})`);
      summary.skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[prune-alerts] ${describe}: DRY RUN — would ${decision.action}`);
      continue;
    }

    if (decision.action === "close_resolved") {
      await comment(issue.number, buildResolvedCloseComment(ref, decision.reason));
      await closeIssue(issue.number, "completed");
      console.log(`[prune-alerts] ${describe}: closed as resolved (${decision.reason})`);
      summary.closed_resolved += 1;
    } else if (decision.action === "close_stale") {
      await comment(issue.number, buildStaleCloseComment());
      await closeIssue(issue.number, "not_planned");
      console.log(`[prune-alerts] ${describe}: closed as stale`);
      summary.closed_stale += 1;
    } else {
      await addLabel(issue.number, NEEDS_MAINTAINER_LABEL);
      await comment(issue.number, buildEscalationComment(maintainerMentions));
      console.log(`[prune-alerts] ${describe}: escalated to maintainers`);
      summary.escalated += 1;
    }
  }

  console.log(
    `[prune-alerts] Done: resolved=${summary.closed_resolved}, stale=${summary.closed_stale}, escalated=${summary.escalated}, skipped=${summary.skipped}`,
  );
}

main().catch((error) => {
  console.error(`[prune-alerts] Failed: ${(error as Error).message}`);
  process.exit(1);
});
