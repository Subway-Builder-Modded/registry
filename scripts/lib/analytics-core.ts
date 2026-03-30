import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeCsv } from "./csv.js";
import { resolveRepoRoot } from "./script-runtime.js";
import { isTestListing } from "./test-listings.js";
import { loadAuthorAliasIndex, resolveAuthorPresentation, type AuthorAliasIndex } from "./author-aliases.js";

interface SnapshotEntry {
  file: string;
  date: Date;
}

interface SnapshotData {
  schema_version?: unknown;
  snapshot_date?: unknown;
  generated_at?: unknown;
  total_downloads?: unknown;
  raw_total_downloads?: unknown;
  total_attributed_downloads?: unknown;
  net_downloads?: unknown;
  maps?: { downloads?: Record<string, Record<string, unknown>> };
  mods?: { downloads?: Record<string, Record<string, unknown>> };
}

type ListingTotals = Map<ListingKey, number>;

interface ListingMeta {
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  github_id: number | null;
}

interface ListingProjectRow {
  listing_type: "map" | "mod";
  id: string;
  name: string;
  project_key: string;
  project_name: string;
}

interface ListingWindowRow {
  rank: number;
  listing_type: "map" | "mod";
  id: string;
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  download_change: number;
  adjusted_download_change: number;
  current_total: number;
  adjusted_current_total: number;
  baseline_total: number;
  adjusted_baseline_total: number;
  latest_snapshot: string;
  baseline_snapshot: string;
}

interface ListingAllTimeRow {
  rank: number;
  listing_type: "map" | "mod";
  id: string;
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  total_downloads: number;
  adjusted_total_downloads: number;
  latest_snapshot: string;
}

interface ProjectWindowRow {
  rank: number;
  project_key: string;
  project_name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  listing_count: number;
  download_change: number;
  adjusted_download_change: number;
  current_total: number;
  adjusted_current_total: number;
  baseline_total: number;
  adjusted_baseline_total: number;
  latest_snapshot: string;
  baseline_snapshot: string;
}

interface ProjectAllTimeRow {
  rank: number;
  project_key: string;
  project_name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  listing_count: number;
  total_downloads: number;
  adjusted_total_downloads: number;
  latest_snapshot: string;
}

interface AuthorAssetCountRow {
  rank: number;
  author: string;
  author_alias: string;
  attribution_link: string;
  asset_count: number;
  map_count: number;
  mod_count: number;
  total_downloads: number;
  adjusted_total_downloads: number;
}

interface AuthorTotalDownloadsRow {
  rank: number;
  author: string;
  author_alias: string;
  attribution_link: string;
  total_downloads: number;
  adjusted_total_downloads: number;
  asset_count: number;
  map_count: number;
  mod_count: number;
}

interface MapPopulationRow {
  rank: number;
  id: string;
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  city_code: string;
  country: string;
  population: number;
  population_count: number;
  points_count: number;
}

type DailySeriesRow = Record<string, string | number>;
type ListingKey = `${"maps" | "mods"}:${string}`;

const DEFAULT_TOP_LISTINGS = 30;
const DEFAULT_TOP_AUTHORS = 20;
const WINDOWS = [1, 3, 7, 14] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getArgValue(argv: string[], name: string): string | undefined {
  const exact = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(exact)) {
      return arg.slice(exact.length);
    }
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}`) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function validateArgs(argv: string[]): void {
  const valueFlags = new Set(["--top-k-listings", "--top-k-authors"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") continue;
    if (arg.startsWith("--top-k-listings=") || arg.startsWith("--top-k-authors=")) continue;
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown argument '${arg}'. Supported flags: --top-k-listings <n>, --top-k-authors <n>.`,
    );
  }
}

function parseTopK(rawValue: string | undefined, fallback: number, label: string): number | null {
  if (!rawValue || rawValue.trim() === "") return fallback;
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`Invalid ${label} value '${rawValue}'. Expected a non-negative integer.`);
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} value '${rawValue}'. Expected a non-negative integer.`);
  }
  return parsed === 0 ? null : parsed;
}

function limitRows<T>(rows: T[], topK: number | null): T[] {
  return topK === null ? rows : rows.slice(0, topK);
}

function parseSnapshotDate(fileName: string): Date | null {
  const match = fileName.match(/^snapshot_(\d{4})_(\d{2})_(\d{2})\.json$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function listSnapshots(historyDir: string): SnapshotEntry[] {
  return readdirSync(historyDir)
    .filter((file) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(file))
    .map((file) => ({ file, date: parseSnapshotDate(file) }))
    .filter((entry): entry is SnapshotEntry => entry.date instanceof Date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function toListingTotals(snapshot: SnapshotData): ListingTotals {
  const totals = new Map<ListingKey, number>();
  for (const listingType of ["maps", "mods"] as const) {
    // `downloads` is the canonical adjusted/non-attributed listing data in schema v2.
    const downloads = snapshot?.[listingType]?.downloads;
    if (!downloads || typeof downloads !== "object") continue;
    for (const [id, versions] of Object.entries(downloads)) {
      if (!versions || typeof versions !== "object") continue;
      let total = 0;
      for (const count of Object.values(versions)) {
        if (isFiniteNumber(count)) {
          total += count;
        }
      }
      totals.set(`${listingType}:${id}`, total);
    }
  }
  return totals;
}

function buildMonotonicSnapshotTotals(
  snapshots: SnapshotEntry[],
  historyDir: string,
): Map<string, ListingTotals> {
  const monotonicBySnapshot = new Map<string, ListingTotals>();
  const runningMax = new Map<ListingKey, number>();

  for (const snapshot of snapshots) {
    const snapshotData = loadJsonFile<SnapshotData>(join(historyDir, snapshot.file));
    const adjustedTotals = toListingTotals(snapshotData);
    const snapshotMonotonic = new Map<ListingKey, number>();
    const keys = new Set<ListingKey>([
      ...runningMax.keys(),
      ...adjustedTotals.keys(),
    ]);

    for (const key of keys) {
      const previousMax = runningMax.get(key) ?? 0;
      const adjustedTotal = adjustedTotals.get(key) ?? 0;
      const nextMax = Math.max(previousMax, adjustedTotal);
      if (nextMax > 0 || adjustedTotals.has(key) || runningMax.has(key)) {
        runningMax.set(key, nextMax);
        snapshotMonotonic.set(key, nextMax);
      }
    }

    monotonicBySnapshot.set(snapshot.file, snapshotMonotonic);
  }

  return monotonicBySnapshot;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function findSnapshotAtOrBefore(snapshots: SnapshotEntry[], targetDate: Date): SnapshotEntry | null {
  let selected: SnapshotEntry | null = null;
  for (const entry of snapshots) {
    if (entry.date <= targetDate) {
      selected = entry;
    } else {
      break;
    }
  }
  return selected;
}

function resolveBaselineSnapshot(snapshots: SnapshotEntry[], latestDate: Date, days: number): SnapshotEntry {
  const target = addDays(latestDate, -days);
  return findSnapshotAtOrBefore(snapshots, target) ?? snapshots[0];
}

function toListingLabel(listingType: "maps" | "mods"): "map" | "mod" {
  return listingType === "maps" ? "map" : "mod";
}

function filterOutTestListingTotals(
  repoRoot: string,
  totals: ListingTotals,
): ListingTotals {
  const filtered = new Map<ListingKey, number>();
  for (const [key, total] of totals.entries()) {
    const [listingType, id] = key.split(":") as ["maps" | "mods", string];
    if (isTestListing(repoRoot, listingType, id)) continue;
    filtered.set(key, total);
  }
  return filtered;
}

function loadManifestMeta(
  repoRoot: string,
  listingType: "maps" | "mods",
  id: string,
  authorAliases: AuthorAliasIndex,
): ListingMeta {
  const manifestPath = join(repoRoot, listingType, id, "manifest.json");
  try {
    const manifest = loadJsonFile<Record<string, unknown>>(manifestPath);
    const name = typeof manifest.name === "string" && manifest.name.trim() !== ""
      ? manifest.name
      : id;
    const author = typeof manifest.author === "string" && manifest.author.trim() !== ""
      ? manifest.author
      : "UNKNOWN";
    const githubId = typeof manifest.github_id === "number" && Number.isFinite(manifest.github_id)
      ? manifest.github_id
      : null;
    const presentation = resolveAuthorPresentation(author, githubId, authorAliases);
    return {
      name,
      author: presentation.author,
      author_alias: presentation.author_alias,
      attribution_link: presentation.attribution_link,
      github_id: githubId,
    };
  } catch {
    return {
      name: id,
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
  }
}

function parseProjectFromUrl(urlValue: string): { projectKey: string; projectName: string } | null {
  try {
    const parsed = new URL(urlValue);
    const segments = parsed.pathname.split("/").filter((segment) => segment !== "");

    if (parsed.hostname === "github.com" && segments.length >= 2) {
      const owner = segments[0]!;
      const repo = segments[1]!;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }

    if (parsed.hostname === "raw.githubusercontent.com" && segments.length >= 2) {
      const owner = segments[0]!;
      const repo = segments[1]!;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }

    if (parsed.hostname.endsWith(".github.io")) {
      const owner = parsed.hostname.slice(0, -".github.io".length);
      const repo = segments[0] ?? owner;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function loadListingProjectRow(
  repoRoot: string,
  listingType: "maps" | "mods",
  id: string,
): ListingProjectRow {
  const manifestPath = join(repoRoot, listingType, id, "manifest.json");
  const listingLabel = toListingLabel(listingType);

  try {
    const manifest = loadJsonFile<Record<string, unknown>>(manifestPath);
    const name = typeof manifest.name === "string" && manifest.name.trim() !== ""
      ? manifest.name
      : id;

    const sourceUrl = typeof manifest.source === "string" ? manifest.source.trim() : "";
    const update = isObject(manifest.update) ? manifest.update : null;
    const updateRepo = typeof update?.repo === "string" ? update.repo.trim() : "";
    const updateUrl = typeof update?.url === "string" ? update.url.trim() : "";

    const parsedProject = (
      (sourceUrl !== "" ? parseProjectFromUrl(sourceUrl) : null)
      ?? (updateUrl !== "" ? parseProjectFromUrl(updateUrl) : null)
      ?? (updateRepo !== ""
        ? {
          projectKey: updateRepo.toLowerCase(),
          projectName: updateRepo.split("/").pop() ?? updateRepo,
        }
        : null)
    );

    return {
      listing_type: listingLabel,
      id,
      name,
      project_key: parsedProject?.projectKey ?? `${listingLabel}:${id}`,
      project_name: parsedProject?.projectName ?? name,
    };
  } catch {
    return {
      listing_type: listingLabel,
      id,
      name: id,
      project_key: `${listingLabel}:${id}`,
      project_name: id,
    };
  }
}

function toNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function loadMapPopulationRows(repoRoot: string, authorAliases: AuthorAliasIndex): MapPopulationRow[] {
  const indexPath = join(repoRoot, "maps", "index.json");
  const index = loadJsonFile<{ maps?: unknown }>(indexPath);
  const mapIds = Array.isArray(index.maps)
    ? index.maps.filter((value): value is string => typeof value === "string")
    : [];

  const rows: Omit<MapPopulationRow, "rank">[] = [];
  for (const id of mapIds) {
    const manifestPath = join(repoRoot, "maps", id, "manifest.json");
    try {
      const manifest = loadJsonFile<Record<string, unknown>>(manifestPath);
      const author = toNonEmptyString(manifest.author, "UNKNOWN");
      const githubId = typeof manifest.github_id === "number" && Number.isFinite(manifest.github_id)
        ? manifest.github_id
        : null;
      const presentation = resolveAuthorPresentation(author, githubId, authorAliases);
      rows.push({
        id,
        name: toNonEmptyString(manifest.name, id),
        author: presentation.author,
        author_alias: presentation.author_alias,
        attribution_link: presentation.attribution_link,
        city_code: toNonEmptyString(manifest.city_code, ""),
        country: toNonEmptyString(manifest.country, ""),
        population: toNonNegativeNumber(manifest.population),
        population_count: toNonNegativeNumber(manifest.population_count),
        points_count: toNonNegativeNumber(manifest.points_count),
      });
    } catch {
      rows.push({
        id,
        name: id,
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        city_code: "",
        country: "",
        population: 0,
        population_count: 0,
        points_count: 0,
      });
    }
  }

  rows.sort((a, b) =>
    b.population - a.population
    || b.population_count - a.population_count
    || b.points_count - a.points_count
    || a.id.localeCompare(b.id));

  return rows.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));
}

function toSnapshotDateLabel(fileName: string): string {
  const match = fileName.match(/^snapshot_(\d{4}_\d{2}_\d{2})\.json$/);
  return match?.[1] ?? fileName;
}

function buildDailyDeltaSnapshotTotals(
  snapshots: SnapshotEntry[],
  monotonicTotalsBySnapshot: Map<string, ListingTotals>,
): Map<string, ListingTotals> {
  const bySnapshot = new Map<string, ListingTotals>();
  let previousTotals = new Map<ListingKey, number>();

  for (const snapshot of snapshots) {
    const currentTotals = monotonicTotalsBySnapshot.get(snapshot.file) ?? new Map<ListingKey, number>();
    const keys = new Set<ListingKey>([
      ...previousTotals.keys(),
      ...currentTotals.keys(),
    ]);
    const deltaTotals = new Map<ListingKey, number>();
    for (const key of keys) {
      const delta = Math.max(0, (currentTotals.get(key) ?? 0) - (previousTotals.get(key) ?? 0));
      if (delta > 0 || currentTotals.has(key) || previousTotals.has(key)) {
        deltaTotals.set(key, delta);
      }
    }
    bySnapshot.set(snapshot.file, deltaTotals);
    previousTotals = currentTotals;
  }

  return bySnapshot;
}

function buildListingByDayRows(
  snapshotDates: string[],
  latestTotals: ListingTotals,
  dailyDeltasBySnapshot: Map<string, ListingTotals>,
  listingMeta: Map<ListingKey, ListingMeta>,
  listingProjectByKey: Map<ListingKey, ListingProjectRow>,
): DailySeriesRow[] {
  const rows: DailySeriesRow[] = [];
  for (const [key, totalDownloads] of latestTotals.entries()) {
    const [listingType, id] = key.split(":") as ["maps" | "mods", string];
    const meta = listingMeta.get(key) ?? {
      name: id,
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
    const project = listingProjectByKey.get(key);
    const row: DailySeriesRow = {
      listing_type: toListingLabel(listingType),
      id,
      name: meta.name,
      author: meta.author,
      author_alias: meta.author_alias,
      attribution_link: meta.attribution_link,
      project_key: project?.project_key ?? `${toListingLabel(listingType)}:${id}`,
      project_name: project?.project_name ?? meta.name,
      total_downloads: totalDownloads,
    };
    for (const snapshotDate of snapshotDates) {
      row[snapshotDate] = dailyDeltasBySnapshot.get(`snapshot_${snapshotDate}.json`)?.get(key) ?? 0;
    }
    rows.push(row);
  }

  rows.sort((a, b) =>
    Number(b.total_downloads) - Number(a.total_downloads)
    || String(a.id).localeCompare(String(b.id)));
  return rows;
}

function buildProjectByDayRows(
  snapshotDates: string[],
  latestTotals: ListingTotals,
  dailyDeltasBySnapshot: Map<string, ListingTotals>,
  listingMeta: Map<ListingKey, ListingMeta>,
  listingProjectByKey: Map<ListingKey, ListingProjectRow>,
): DailySeriesRow[] {
  const projectRows = new Map<string, DailySeriesRow>();

  for (const [key, totalDownloads] of latestTotals.entries()) {
    const project = listingProjectByKey.get(key);
    if (!project) continue;
    const existing = projectRows.get(project.project_key) ?? {
      project_key: project.project_key,
      project_name: project.project_name,
      author: "",
      author_alias: "",
      attribution_link: "",
      listing_count: 0,
      total_downloads: 0,
    };
    const meta = listingMeta.get(key) ?? {
      name: "",
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
    const authors = new Set(String(existing.author).split("; ").filter(Boolean));
    const authorAliases = new Set(String(existing.author_alias).split("; ").filter(Boolean));
    const attributionLinks = new Set(String(existing.attribution_link).split("; ").filter(Boolean));
    authors.add(meta.author);
    authorAliases.add(meta.author_alias);
    attributionLinks.add(meta.attribution_link);
    existing.author = [...authors].sort().join("; ");
    existing.author_alias = [...authorAliases].sort().join("; ");
    existing.attribution_link = [...attributionLinks].sort().join("; ");
    existing.listing_count = Number(existing.listing_count) + 1;
    existing.total_downloads = Number(existing.total_downloads) + totalDownloads;
    for (const snapshotDate of snapshotDates) {
      existing[snapshotDate] = Number(existing[snapshotDate] ?? 0)
        + (dailyDeltasBySnapshot.get(`snapshot_${snapshotDate}.json`)?.get(key) ?? 0);
    }
    projectRows.set(project.project_key, existing);
  }

  return [...projectRows.values()].sort((a, b) =>
    Number(b.total_downloads) - Number(a.total_downloads)
    || String(a.project_key).localeCompare(String(b.project_key)));
}

function buildAuthorByDayRows(
  snapshotDates: string[],
  latestTotals: ListingTotals,
  dailyDeltasBySnapshot: Map<string, ListingTotals>,
  listingMeta: Map<ListingKey, ListingMeta>,
): DailySeriesRow[] {
  const authorRows = new Map<string, DailySeriesRow>();

  for (const [key, totalDownloads] of latestTotals.entries()) {
    const [listingType] = key.split(":") as ["maps" | "mods", string];
    const meta = listingMeta.get(key) ?? {
      name: "",
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
    const existing = authorRows.get(meta.author) ?? {
      author: meta.author,
      author_alias: meta.author_alias,
      attribution_link: meta.attribution_link,
      asset_count: 0,
      map_count: 0,
      mod_count: 0,
      total_downloads: 0,
    };
    existing.asset_count = Number(existing.asset_count) + 1;
    if (listingType === "maps") existing.map_count = Number(existing.map_count) + 1;
    if (listingType === "mods") existing.mod_count = Number(existing.mod_count) + 1;
    existing.total_downloads = Number(existing.total_downloads) + totalDownloads;
    for (const snapshotDate of snapshotDates) {
      existing[snapshotDate] = Number(existing[snapshotDate] ?? 0)
        + (dailyDeltasBySnapshot.get(`snapshot_${snapshotDate}.json`)?.get(key) ?? 0);
    }
    authorRows.set(meta.author, existing);
  }

  return [...authorRows.values()].sort((a, b) =>
    Number(b.total_downloads) - Number(a.total_downloads)
    || String(a.author).localeCompare(String(b.author)));
}

export function runGenerateAnalyticsCli(
  argv = process.argv.slice(2),
  repoRoot?: string,
): void {
  const resolvedRepoRoot = repoRoot ?? process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  validateArgs(argv);
  const topListings = parseTopK(
    getArgValue(argv, "top-k-listings")
      ?? process.env.ANALYTICS_TOP_K_LISTINGS
      ?? process.env.ANALYTICS_TOP_K,
    DEFAULT_TOP_LISTINGS,
    "top-k-listings",
  );
  const topAuthors = parseTopK(
    getArgValue(argv, "top-k-authors") ?? process.env.ANALYTICS_TOP_K_AUTHORS,
    DEFAULT_TOP_AUTHORS,
    "top-k-authors",
  );
  const historyDir = join(resolvedRepoRoot, "history");
  const analyticsDir = join(resolvedRepoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });
  const authorAliases = loadAuthorAliasIndex(resolvedRepoRoot);

  const snapshots = listSnapshots(historyDir);
  if (snapshots.length === 0) {
    throw new Error(`No snapshots found in ${historyDir}`);
  }

  const latest = snapshots[snapshots.length - 1];
  const latestData = loadJsonFile<SnapshotData>(join(historyDir, latest.file));
  const adjustedTotalsBySnapshot = new Map<string, ListingTotals>();
  adjustedTotalsBySnapshot.set(latest.file, filterOutTestListingTotals(resolvedRepoRoot, toListingTotals(latestData)));
  const monotonicTotalsBySnapshot = buildMonotonicSnapshotTotals(snapshots, historyDir);
  const dailyDeltasBySnapshot = buildDailyDeltaSnapshotTotals(snapshots, monotonicTotalsBySnapshot);
  const snapshotDates = snapshots.map((snapshot) => toSnapshotDateLabel(snapshot.file));
  const latestTotals = filterOutTestListingTotals(
    resolvedRepoRoot,
    monotonicTotalsBySnapshot.get(latest.file) ?? new Map<ListingKey, number>(),
  );
  const latestAdjustedTotals = adjustedTotalsBySnapshot.get(latest.file) ?? new Map<ListingKey, number>();

  const listingMeta = new Map<ListingKey, ListingMeta>();
  for (const key of latestAdjustedTotals.keys()) {
    const [listingType, id] = key.split(":") as ["maps" | "mods", string];
    listingMeta.set(key, loadManifestMeta(resolvedRepoRoot, listingType, id, authorAliases));
  }

  const listingProjectRows: ListingProjectRow[] = [...latestAdjustedTotals.keys()]
    .map((key) => {
      const [listingType, id] = key.split(":") as ["maps" | "mods", string];
      return loadListingProjectRow(resolvedRepoRoot, listingType, id);
    })
    .sort((a, b) =>
      a.project_key.localeCompare(b.project_key)
      || a.listing_type.localeCompare(b.listing_type)
      || a.id.localeCompare(b.id));

  const listingProjectByKey = new Map<ListingKey, ListingProjectRow>();
  for (const row of listingProjectRows) {
    const listingType = row.listing_type === "map" ? "maps" : "mods";
    listingProjectByKey.set(`${listingType}:${row.id}`, row);
  }

  const rowsForWindow = (days: number): ListingWindowRow[] => {
    const baseline = resolveBaselineSnapshot(snapshots, latest.date, days);
    const baselineAdjustedTotals = adjustedTotalsBySnapshot.get(baseline.file)
      ?? (() => {
        const totals = toListingTotals(loadJsonFile<SnapshotData>(join(historyDir, baseline.file)));
        const filteredTotals = filterOutTestListingTotals(resolvedRepoRoot, totals);
        adjustedTotalsBySnapshot.set(baseline.file, filteredTotals);
        return filteredTotals;
      })();
    const baselineTotals = filterOutTestListingTotals(
      resolvedRepoRoot,
      monotonicTotalsBySnapshot.get(baseline.file) ?? new Map<ListingKey, number>(),
    );

    const rows: Omit<ListingWindowRow, "rank">[] = [];
    for (const [key, currentTotal] of latestTotals.entries()) {
      const currentAdjustedTotal = latestAdjustedTotals.get(key) ?? 0;
      const baselineTotal = baselineTotals.get(key) ?? 0;
      const baselineAdjustedTotal = baselineAdjustedTotals.get(key) ?? 0;
      const change = currentTotal - baselineTotal;
      const adjustedChange = currentAdjustedTotal - baselineAdjustedTotal;
      const [listingType, id] = key.split(":") as ["maps" | "mods", string];
      const meta = listingMeta.get(key) ?? {
        name: id,
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        github_id: null,
      };
      rows.push({
        listing_type: toListingLabel(listingType),
        id,
        name: meta.name,
        author: meta.author,
        author_alias: meta.author_alias,
        attribution_link: meta.attribution_link,
        download_change: change,
        adjusted_download_change: adjustedChange,
        current_total: currentTotal,
        adjusted_current_total: currentAdjustedTotal,
        baseline_total: baselineTotal,
        adjusted_baseline_total: baselineAdjustedTotal,
        latest_snapshot: latest.file,
        baseline_snapshot: baseline.file,
      });
    }

    rows.sort((a, b) =>
      b.download_change - a.download_change
      || b.current_total - a.current_total
      || a.id.localeCompare(b.id));

    return limitRows(rows, topListings).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  };

  const allTimeRows = (() => {
    const rows: Omit<ListingAllTimeRow, "rank">[] = [];
    for (const [key, total] of latestTotals.entries()) {
      const [listingType, id] = key.split(":") as ["maps" | "mods", string];
      const meta = listingMeta.get(key) ?? {
        name: id,
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        github_id: null,
      };
      rows.push({
        listing_type: toListingLabel(listingType),
        id,
        name: meta.name,
        author: meta.author,
        author_alias: meta.author_alias,
        attribution_link: meta.attribution_link,
        total_downloads: total,
        adjusted_total_downloads: latestAdjustedTotals.get(key) ?? 0,
        latest_snapshot: latest.file,
      });
    }
    rows.sort((a, b) => b.total_downloads - a.total_downloads || a.id.localeCompare(b.id));
    return limitRows(rows, topListings).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  })();

  const projectRowsForWindow = (days: number): ProjectWindowRow[] => {
    const baseline = resolveBaselineSnapshot(snapshots, latest.date, days);
    const baselineAdjustedTotals = adjustedTotalsBySnapshot.get(baseline.file)
      ?? (() => {
        const totals = toListingTotals(loadJsonFile<SnapshotData>(join(historyDir, baseline.file)));
        const filteredTotals = filterOutTestListingTotals(resolvedRepoRoot, totals);
        adjustedTotalsBySnapshot.set(baseline.file, filteredTotals);
        return filteredTotals;
      })();
    const baselineTotals = filterOutTestListingTotals(
      resolvedRepoRoot,
      monotonicTotalsBySnapshot.get(baseline.file) ?? new Map<ListingKey, number>(),
    );

    const projectStats = new Map<string, Omit<ProjectWindowRow, "rank">>();
    for (const [key, currentTotal] of latestTotals.entries()) {
      const listingProject = listingProjectByKey.get(key);
      if (!listingProject) continue;
      const baselineTotal = baselineTotals.get(key) ?? 0;
      const currentAdjustedTotal = latestAdjustedTotals.get(key) ?? 0;
      const baselineAdjustedTotal = baselineAdjustedTotals.get(key) ?? 0;
      const existing = projectStats.get(listingProject.project_key) ?? {
        project_key: listingProject.project_key,
        project_name: listingProject.project_name,
        author: "",
        author_alias: "",
        attribution_link: "",
        listing_count: 0,
        download_change: 0,
        adjusted_download_change: 0,
        current_total: 0,
        adjusted_current_total: 0,
        baseline_total: 0,
        adjusted_baseline_total: 0,
        latest_snapshot: latest.file,
        baseline_snapshot: baseline.file,
      };
      const meta = listingMeta.get(key) ?? {
        name: "",
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        github_id: null,
      };
      const authors = new Set(existing.author.split("; ").filter(Boolean));
      const authorAliases = new Set(existing.author_alias.split("; ").filter(Boolean));
      const attributionLinks = new Set(existing.attribution_link.split("; ").filter(Boolean));
      authors.add(meta.author);
      authorAliases.add(meta.author_alias);
      attributionLinks.add(meta.attribution_link);
      existing.author = [...authors].sort().join("; ");
      existing.author_alias = [...authorAliases].sort().join("; ");
      existing.attribution_link = [...attributionLinks].sort().join("; ");
      existing.listing_count += 1;
      existing.current_total += currentTotal;
      existing.adjusted_current_total += currentAdjustedTotal;
      existing.baseline_total += baselineTotal;
      existing.adjusted_baseline_total += baselineAdjustedTotal;
      existing.download_change += currentTotal - baselineTotal;
      existing.adjusted_download_change += currentAdjustedTotal - baselineAdjustedTotal;
      projectStats.set(listingProject.project_key, existing);
    }

    const rows = [...projectStats.values()]
      .sort((a, b) =>
        b.download_change - a.download_change
        || b.current_total - a.current_total
        || a.project_key.localeCompare(b.project_key));

    return limitRows(rows, topListings).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  };

  const projectAllTimeRows = (() => {
    const projectStats = new Map<string, Omit<ProjectAllTimeRow, "rank">>();
    for (const [key, total] of latestTotals.entries()) {
      const listingProject = listingProjectByKey.get(key);
      if (!listingProject) continue;
      const existing = projectStats.get(listingProject.project_key) ?? {
        project_key: listingProject.project_key,
        project_name: listingProject.project_name,
        author: "",
        author_alias: "",
        attribution_link: "",
        listing_count: 0,
        total_downloads: 0,
        adjusted_total_downloads: 0,
        latest_snapshot: latest.file,
      };
      const meta = listingMeta.get(key) ?? {
        name: "",
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        github_id: null,
      };
      const authors = new Set(existing.author.split("; ").filter(Boolean));
      const authorAliases = new Set(existing.author_alias.split("; ").filter(Boolean));
      const attributionLinks = new Set(existing.attribution_link.split("; ").filter(Boolean));
      authors.add(meta.author);
      authorAliases.add(meta.author_alias);
      attributionLinks.add(meta.attribution_link);
      existing.author = [...authors].sort().join("; ");
      existing.author_alias = [...authorAliases].sort().join("; ");
      existing.attribution_link = [...attributionLinks].sort().join("; ");
      existing.listing_count += 1;
      existing.total_downloads += total;
      existing.adjusted_total_downloads += latestAdjustedTotals.get(key) ?? 0;
      projectStats.set(listingProject.project_key, existing);
    }

    const rows = [...projectStats.values()]
      .sort((a, b) =>
        b.total_downloads - a.total_downloads
        || b.listing_count - a.listing_count
        || a.project_key.localeCompare(b.project_key));

    return limitRows(rows, topListings).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  })();

  const authorStats = new Map<string, Omit<AuthorAssetCountRow, "rank">>();
  for (const [key, total] of latestTotals.entries()) {
    const [listingType] = key.split(":") as ["maps" | "mods", string];
    const meta = listingMeta.get(key) ?? {
      name: "",
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
    const previous = authorStats.get(meta.author) ?? {
      author: meta.author,
      author_alias: meta.author_alias,
      attribution_link: meta.attribution_link,
      asset_count: 0,
      map_count: 0,
      mod_count: 0,
      total_downloads: 0,
      adjusted_total_downloads: 0,
    };
    previous.asset_count += 1;
    if (listingType === "maps") previous.map_count += 1;
    if (listingType === "mods") previous.mod_count += 1;
    previous.total_downloads += total;
    previous.adjusted_total_downloads += latestAdjustedTotals.get(key) ?? 0;
    authorStats.set(meta.author, previous);
  }

  const authorRowsByAssetCount: AuthorAssetCountRow[] = [...authorStats.values()]
    .sort((a, b) =>
      b.asset_count - a.asset_count
      || b.total_downloads - a.total_downloads
      || a.author.localeCompare(b.author))
    .slice(0, topAuthors ?? authorStats.size)
    .map((row, index) => ({ rank: index + 1, ...row }));

  const authorRowsByTotalDownloads: AuthorTotalDownloadsRow[] = [...authorStats.values()]
    .sort((a, b) =>
      b.total_downloads - a.total_downloads
      || b.asset_count - a.asset_count
      || a.author.localeCompare(b.author))
    .slice(0, topAuthors ?? authorStats.size)
    .map((row, index) => ({
      rank: index + 1,
      author: row.author,
      author_alias: row.author_alias,
      attribution_link: row.attribution_link,
      total_downloads: row.total_downloads,
      adjusted_total_downloads: row.adjusted_total_downloads,
      asset_count: row.asset_count,
      map_count: row.map_count,
      mod_count: row.mod_count,
    }));

  const listingByDayRows = buildListingByDayRows(
    snapshotDates,
    latestTotals,
    dailyDeltasBySnapshot,
    listingMeta,
    listingProjectByKey,
  );
  const projectByDayRows = buildProjectByDayRows(
    snapshotDates,
    latestTotals,
    dailyDeltasBySnapshot,
    listingMeta,
    listingProjectByKey,
  );
  const authorByDayRows = buildAuthorByDayRows(
    snapshotDates,
    latestTotals,
    dailyDeltasBySnapshot,
    listingMeta,
  );

  writeCsv<ListingWindowRow>(
    join(analyticsDir, "most_popular_last_1d.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    rowsForWindow(WINDOWS[0]),
  );

  writeCsv<ListingWindowRow>(
    join(analyticsDir, "most_popular_last_3d.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    rowsForWindow(WINDOWS[1]),
  );

  writeCsv<ListingWindowRow>(
    join(analyticsDir, "most_popular_last_7d.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    rowsForWindow(WINDOWS[2]),
  );

  writeCsv<ProjectWindowRow>(
    join(analyticsDir, "projects_most_popular_last_1d.csv"),
    [
      "rank",
      "project_key",
      "project_name",
      "author",
      "author_alias",
      "attribution_link",
      "listing_count",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    projectRowsForWindow(WINDOWS[0]),
  );

  writeCsv<ProjectWindowRow>(
    join(analyticsDir, "projects_most_popular_last_3d.csv"),
    [
      "rank",
      "project_key",
      "project_name",
      "author",
      "author_alias",
      "attribution_link",
      "listing_count",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    projectRowsForWindow(WINDOWS[1]),
  );

  writeCsv<ProjectWindowRow>(
    join(analyticsDir, "projects_most_popular_last_7d.csv"),
    [
      "rank",
      "project_key",
      "project_name",
      "author",
      "author_alias",
      "attribution_link",
      "listing_count",
      "download_change",
      "adjusted_download_change",
      "current_total",
      "adjusted_current_total",
      "baseline_total",
      "adjusted_baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    projectRowsForWindow(WINDOWS[2]),
  );

  writeCsv<ListingAllTimeRow>(
    join(analyticsDir, "most_popular_all_time.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "total_downloads",
      "adjusted_total_downloads",
      "latest_snapshot",
    ],
    allTimeRows,
  );

  writeCsv<ProjectAllTimeRow>(
    join(analyticsDir, "projects_most_popular_all_time.csv"),
    [
      "rank",
      "project_key",
      "project_name",
      "author",
      "author_alias",
      "attribution_link",
      "listing_count",
      "total_downloads",
      "adjusted_total_downloads",
      "latest_snapshot",
    ],
    projectAllTimeRows,
  );

  writeCsv<AuthorAssetCountRow>(
    join(analyticsDir, "authors_by_asset_count.csv"),
    [
      "rank",
      "author",
      "author_alias",
      "attribution_link",
      "asset_count",
      "map_count",
      "mod_count",
      "total_downloads",
      "adjusted_total_downloads",
    ],
    authorRowsByAssetCount,
  );

  writeCsv<AuthorTotalDownloadsRow>(
    join(analyticsDir, "authors_by_total_downloads.csv"),
    [
      "rank",
      "author",
      "author_alias",
      "attribution_link",
      "total_downloads",
      "adjusted_total_downloads",
      "asset_count",
      "map_count",
      "mod_count",
    ],
    authorRowsByTotalDownloads,
  );

  const mapPopulationRows = loadMapPopulationRows(resolvedRepoRoot, authorAliases);
  writeCsv<MapPopulationRow>(
    join(analyticsDir, "maps_by_population.csv"),
    [
      "rank",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "city_code",
      "country",
      "population",
      "population_count",
      "points_count",
    ],
    mapPopulationRows,
  );

  writeCsv<ListingProjectRow>(
    join(analyticsDir, "listing_projects.csv"),
    [
      "listing_type",
      "id",
      "name",
      "project_key",
      "project_name",
    ],
    listingProjectRows,
  );

  writeCsv<DailySeriesRow>(
    join(analyticsDir, "most_popular_by_day.csv"),
    [
      "listing_type",
      "id",
      "name",
      "author",
      "author_alias",
      "attribution_link",
      "project_key",
      "project_name",
      "total_downloads",
      ...snapshotDates,
    ],
    listingByDayRows,
  );

  writeCsv<DailySeriesRow>(
    join(analyticsDir, "projects_by_day.csv"),
    [
      "project_key",
      "project_name",
      "author",
      "author_alias",
      "attribution_link",
      "listing_count",
      "total_downloads",
      ...snapshotDates,
    ],
    projectByDayRows,
  );

  writeCsv<DailySeriesRow>(
    join(analyticsDir, "authors_by_day.csv"),
    [
      "author",
      "author_alias",
      "attribution_link",
      "asset_count",
      "map_count",
      "mod_count",
      "total_downloads",
      ...snapshotDates,
    ],
    authorByDayRows,
  );

  console.log(`Generated analytics CSVs in ${analyticsDir}`);
  console.log(`Latest snapshot: ${latest.file}`);
  console.log(`Top listings: ${topListings ?? "all"}`);
  console.log(`Top authors: ${topAuthors ?? "all"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runGenerateAnalyticsCli();
}
