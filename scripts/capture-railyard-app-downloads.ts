import { pathToFileURL } from "node:url";
import {
  buildRailyardAppHistorySnapshot,
  createEmptyRailyardAppDownloadHistory,
  loadRailyardAppDownloadHistory,
  toHourBucketIso,
  upsertRailyardAppHistorySnapshot,
  writeRailyardAppDownloadHistory,
  type GitHubReleaseLike,
} from "./lib/railyard-app-downloads.js";
import { getNonEmptyEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

const DEFAULT_REPO = "Subway-Builder-Modded/railyard";
const GITHUB_API_BASE = "https://api.github.com";
const FETCH_TIMEOUT_MS = 45_000;

interface CliArgs {
  repoRoot: string;
  repo: string;
  token: string;
}

interface GitHubReleaseApiAsset {
  name?: unknown;
  download_count?: unknown;
}

interface GitHubReleaseApiResponse {
  tag_name?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  assets?: unknown;
}

function parseArgs(): CliArgs {
  return {
    repoRoot: process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname),
    repo: (process.env.RAILYARD_APP_DOWNLOADS_REPO ?? DEFAULT_REPO).trim(),
    token: (
      getNonEmptyEnv("GH_DOWNLOADS_TOKEN")
      ?? getNonEmptyEnv("GITHUB_TOKEN")
      ?? ""
    ).trim(),
  };
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "registry-app-downloads",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRelease(value: GitHubReleaseApiResponse): GitHubReleaseLike | null {
  if (typeof value.tag_name !== "string") return null;
  const assets = Array.isArray(value.assets)
    ? value.assets
      .filter((asset): asset is GitHubReleaseApiAsset => typeof asset === "object" && asset !== null)
      .map((asset) => ({
        name: typeof asset.name === "string" ? asset.name : "",
        download_count: typeof asset.download_count === "number" ? asset.download_count : 0,
      }))
      .filter((asset) => asset.name !== "")
    : [];

  return {
    tag_name: value.tag_name,
    prerelease: value.prerelease === true,
    draft: value.draft === true,
    assets,
  };
}

async function fetchAllReleases(repo: string, token: string): Promise<GitHubReleaseLike[]> {
  const releases: GitHubReleaseLike[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await fetchJson<GitHubReleaseApiResponse[]>(
      `${GITHUB_API_BASE}/repos/${repo}/releases?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(payload) || payload.length === 0) break;
    for (const rawRelease of payload) {
      const release = normalizeRelease(rawRelease);
      if (release) releases.push(release);
    }
  }
  return releases;
}

async function run(): Promise<void> {
  const cli = parseArgs();
  if (cli.token === "") {
    throw new Error("Missing GH_DOWNLOADS_TOKEN or GITHUB_TOKEN for app download capture.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const snapshotKey = toHourBucketIso(now);
  const releases = await fetchAllReleases(cli.repo, cli.token);
  const snapshot = buildRailyardAppHistorySnapshot(releases, snapshotKey);
  const existingHistory = loadRailyardAppDownloadHistory(cli.repoRoot, cli.repo, nowIso);
  const history = upsertRailyardAppHistorySnapshot({
    history: existingHistory.repo === cli.repo ? existingHistory : createEmptyRailyardAppDownloadHistory(cli.repo, nowIso),
    snapshot,
    snapshotKey,
    updatedAt: nowIso,
  });

  writeRailyardAppDownloadHistory(cli.repoRoot, history);

  const trackedVersions = Object.keys(snapshot.versions).length;
  const trackedAssets = Object.values(snapshot.versions)
    .reduce((sum, version) => sum + Object.keys(version.assets).length, 0);

  console.log(
    `[railyard-app-downloads] repo=${cli.repo} snapshot=${snapshotKey} versions=${trackedVersions} assets=${trackedAssets}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
