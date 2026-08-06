import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestDirectory } from "../lib/manifests.js";
import { loadRepoLiveness } from "../lib/repo-liveness.js";

// Daily review pass over definitively-unreachable source repos (deleted,
// renamed without redirect, or made private), as recorded in maps/mods
// repo-liveness.json by the download generators. Once a repo has been
// unreachable past the threshold, opens one maintainer review issue per repo
// (label: repo-unreachable); when a repo recovers or stops being referenced,
// closes its issue. Deprecation itself stays a human decision made through
// the existing deprecate-asset flow — this only makes sure a dead repo
// cannot sit unnoticed while the generators quietly preserve its last-known
// download counts.

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY ?? "Subway-Builder-Modded/registry";
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const thresholdHours = Number(process.env.REPO_LIVENESS_THRESHOLD_HOURS) || 72;

const REPO_UNREACHABLE_LABEL = "repo-unreachable";

if (!token) {
  console.error("GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

const apiHeaders: Record<string, string> = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

interface OverdueRepo {
  repo: string;
  dir: ManifestDirectory;
  listings: string[];
  firstUnreachableAt: string;
  lastCheckedAt: string;
  hoursUnreachable: number;
  lastKnownDownloads: Record<string, number>;
}

interface IssueListItem {
  number: number;
  title: string;
}

function buildIssueTitle(repo: string): string {
  return `Unreachable source repository: ${repo}`;
}

function parseIssueTitle(title: string): string | null {
  const match = /^Unreachable source repository: (\S+)$/.exec(title.trim());
  return match ? match[1]! : null;
}

function buildIssueBody(entry: OverdueRepo): string {
  const listingLines = entry.listings.map((id) => {
    const total = entry.lastKnownDownloads[id];
    const suffix = total !== undefined ? ` — ${total} preserved downloads` : "";
    return `- \`${entry.dir}/${id}\`${suffix}`;
  });
  return [
    `The source repository \`${entry.repo}\` has been definitively unreachable`,
    `(deleted, renamed without redirect, or made private) since`,
    `**${entry.firstUnreachableAt}** — about **${Math.floor(entry.hoursUnreachable / 24)} day(s)** —`,
    `last confirmed at ${entry.lastCheckedAt}.`,
    "",
    "Affected listings:",
    ...listingLines,
    "",
    "Download counts and integrity state are preserved automatically while the",
    "repo is unreachable, so there is no data-loss urgency. Suggested review:",
    "",
    "1. Check whether the repo moved (rename/transfer) — if so, update the listing manifests.",
    "2. If the author intends to keep it unavailable, deprecate the listing(s) via the",
    "   **Deprecate asset** issue form (download counts are frozen automatically on deprecation).",
    "3. If the outage was temporary, this issue closes itself once the repo is reachable again.",
    "",
    "_Opened automatically by the repo-liveness review workflow; see KNOWN_INCIDENTS.md_",
    "_(2026-08-04 private-repo wipe) for the incident that motivated this check._",
  ].join("\n");
}

function loadListingTotals(dir: ManifestDirectory): Record<string, Record<string, number>> {
  const path = resolve(REPO_ROOT, dir, "downloads.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, Record<string, number>>;
  } catch {
    return {};
  }
}

function collectRepoState(nowMs: number): { overdue: OverdueRepo[]; tracked: Set<string> } {
  const overdue: OverdueRepo[] = [];
  const tracked = new Set<string>();
  for (const dir of ["maps", "mods"] as const) {
    const liveness = loadRepoLiveness(REPO_ROOT, dir);
    const downloads = loadListingTotals(dir);
    for (const [repo, entry] of Object.entries(liveness.repos)) {
      tracked.add(repo);
      const firstMs = Date.parse(entry.first_unreachable_at);
      if (!Number.isFinite(firstMs)) continue;
      const hours = (nowMs - firstMs) / 3_600_000;
      if (hours < thresholdHours) continue;
      const lastKnownDownloads: Record<string, number> = {};
      for (const listing of entry.listings) {
        const versions = downloads[listing];
        if (versions) {
          lastKnownDownloads[listing] = Object.values(versions).reduce((sum, n) => sum + n, 0);
        }
      }
      overdue.push({
        repo,
        dir,
        listings: entry.listings,
        firstUnreachableAt: entry.first_unreachable_at,
        lastCheckedAt: entry.last_checked_at,
        hoursUnreachable: Math.floor(hours),
        lastKnownDownloads,
      });
    }
  }
  overdue.sort((a, b) => a.repo.localeCompare(b.repo));
  return { overdue, tracked };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, { ...init, headers: { ...apiHeaders, ...(init?.headers ?? {}) } });
}

async function ensureLabelExists(): Promise<void> {
  const response = await api(`/repos/${repository}/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: REPO_UNREACHABLE_LABEL,
      color: "d93f0b",
      description: "Source repo for one or more listings is unreachable; maintainer review needed",
    }),
  });
  // 422 = already exists — the expected steady state.
  if (!response.ok && response.status !== 422) {
    throw new Error(`Failed to ensure ${REPO_UNREACHABLE_LABEL} label: HTTP ${response.status}`);
  }
}

async function listOpenLivenessIssues(): Promise<IssueListItem[]> {
  const issues: IssueListItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api(
      `/repos/${repository}/issues?labels=${REPO_UNREACHABLE_LABEL}&state=open&per_page=100&page=${page}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to list ${REPO_UNREACHABLE_LABEL} issues: HTTP ${response.status}`);
    }
    const batch = await response.json() as IssueListItem[];
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

async function openIssue(entry: OverdueRepo): Promise<void> {
  const response = await api(`/repos/${repository}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: buildIssueTitle(entry.repo),
      body: buildIssueBody(entry),
      labels: [REPO_UNREACHABLE_LABEL],
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to open issue for ${entry.repo}: HTTP ${response.status}`);
  }
}

async function closeIssue(issue: IssueListItem, reason: string): Promise<void> {
  const commentResponse = await api(`/repos/${repository}/issues/${issue.number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: reason }),
  });
  if (!commentResponse.ok) {
    throw new Error(`Failed to comment on #${issue.number}: HTTP ${commentResponse.status}`);
  }
  const response = await api(`/repos/${repository}/issues/${issue.number}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  if (!response.ok) {
    throw new Error(`Failed to close #${issue.number}: HTTP ${response.status}`);
  }
}

async function main(): Promise<void> {
  const { overdue, tracked } = collectRepoState(Date.now());
  console.log(
    `[repo-liveness] tracked unreachable repos: ${tracked.size}, overdue (>${thresholdHours}h): ${overdue.length}`,
  );

  const openIssues = await listOpenLivenessIssues();
  const openByRepo = new Map<string, IssueListItem>();
  for (const issue of openIssues) {
    const repo = parseIssueTitle(issue.title);
    if (repo) openByRepo.set(repo, issue);
  }

  const summary = { opened: 0, closed: 0, unchanged: 0 };
  for (const entry of overdue) {
    if (openByRepo.has(entry.repo)) {
      console.log(`[repo-liveness] ${entry.repo}: issue already open (#${openByRepo.get(entry.repo)!.number})`);
      summary.unchanged += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[repo-liveness] ${entry.repo}: DRY RUN — would open review issue`);
      continue;
    }
    await ensureLabelExists();
    await openIssue(entry);
    console.log(`[repo-liveness] ${entry.repo}: opened review issue`);
    summary.opened += 1;
  }

  for (const [repo, issue] of openByRepo) {
    if (tracked.has(repo)) continue;
    if (dryRun) {
      console.log(`[repo-liveness] ${repo}: DRY RUN — would close #${issue.number} (repo recovered or delisted)`);
      continue;
    }
    await closeIssue(
      issue,
      "The repository is reachable again (or is no longer referenced by any active listing). Closing automatically.",
    );
    console.log(`[repo-liveness] ${repo}: closed #${issue.number} (recovered or delisted)`);
    summary.closed += 1;
  }

  console.log(
    `[repo-liveness] Done: opened=${summary.opened}, closed=${summary.closed}, unchanged=${summary.unchanged}`,
  );
}

main().catch((error) => {
  console.error(`[repo-liveness] Failed: ${(error as Error).message}`);
  process.exit(1);
});
