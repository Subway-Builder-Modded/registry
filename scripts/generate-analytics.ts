import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface SnapshotEntry {
  file: string;
  date: Date;
}

interface SnapshotData {
  schema_version?: unknown;
  snapshot_date?: unknown;
  generated_at?: unknown;
  maps?: { downloads?: Record<string, Record<string, unknown>> };
  mods?: { downloads?: Record<string, Record<string, unknown>> };
}

interface ListingMeta {
  name: string;
  author: string;
}

interface ListingWindowRow {
  rank: number;
  listing_type: "map" | "mod";
  id: string;
  name: string;
  author: string;
  download_change: number;
  current_total: number;
  baseline_total: number;
  latest_snapshot: string;
  baseline_snapshot: string;
}

interface ListingAllTimeRow {
  rank: number;
  listing_type: "map" | "mod";
  id: string;
  name: string;
  author: string;
  total_downloads: number;
  latest_snapshot: string;
}

interface AuthorAssetCountRow {
  rank: number;
  author: string;
  asset_count: number;
  map_count: number;
  mod_count: number;
  total_downloads: number;
}

interface AuthorTotalDownloadsRow {
  rank: number;
  author: string;
  total_downloads: number;
  asset_count: number;
  map_count: number;
  mod_count: number;
}

interface MapPopulationRow {
  rank: number;
  id: string;
  name: string;
  author: string;
  city_code: string;
  country: string;
  population: number;
  population_count: number;
  points_count: number;
}

type ListingKey = `${"maps" | "mods"}:${string}`;

const TOP_LISTINGS = 30;
const TOP_AUTHORS = 20;
const WINDOWS = [1, 3, 7, 14] as const;

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function toListingTotals(snapshot: SnapshotData): Map<ListingKey, number> {
  const totals = new Map<ListingKey, number>();
  for (const listingType of ["maps", "mods"] as const) {
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

function loadManifestMeta(repoRoot: string, listingType: "maps" | "mods", id: string): ListingMeta {
  const manifestPath = join(repoRoot, listingType, id, "manifest.json");
  try {
    const manifest = loadJsonFile<Record<string, unknown>>(manifestPath);
    const name = typeof manifest.name === "string" && manifest.name.trim() !== ""
      ? manifest.name
      : id;
    const author = typeof manifest.author === "string" && manifest.author.trim() !== ""
      ? manifest.author
      : "UNKNOWN";
    return { name, author };
  } catch {
    return { name: id, author: "UNKNOWN" };
  }
}

function toNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function loadMapPopulationRows(repoRoot: string): MapPopulationRow[] {
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
      rows.push({
        id,
        name: toNonEmptyString(manifest.name, id),
        author: toNonEmptyString(manifest.author, "UNKNOWN"),
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

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv<T extends object>(
  path: string,
  headers: (keyof T)[],
  rows: T[],
): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsv(row[key as keyof T])).join(","));
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}

function main(): void {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const historyDir = join(repoRoot, "history");
  const analyticsDir = join(repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const snapshots = listSnapshots(historyDir);
  if (snapshots.length === 0) {
    throw new Error(`No snapshots found in ${historyDir}`);
  }

  const latest = snapshots[snapshots.length - 1];
  const latestData = loadJsonFile<SnapshotData>(join(historyDir, latest.file));
  const latestTotals = toListingTotals(latestData);

  const listingMeta = new Map<ListingKey, ListingMeta>();
  for (const key of latestTotals.keys()) {
    const [listingType, id] = key.split(":") as ["maps" | "mods", string];
    listingMeta.set(key, loadManifestMeta(repoRoot, listingType, id));
  }

  const rowsForWindow = (days: number): ListingWindowRow[] => {
    const baseline = resolveBaselineSnapshot(snapshots, latest.date, days);
    const baselineData = loadJsonFile<SnapshotData>(join(historyDir, baseline.file));
    const baselineTotals = toListingTotals(baselineData);

    const rows: Omit<ListingWindowRow, "rank">[] = [];
    for (const [key, currentTotal] of latestTotals.entries()) {
      const baselineTotal = baselineTotals.get(key) ?? 0;
      const change = currentTotal - baselineTotal;
      const [listingType, id] = key.split(":") as ["maps" | "mods", string];
      const meta = listingMeta.get(key) ?? { name: id, author: "UNKNOWN" };
      rows.push({
        listing_type: toListingLabel(listingType),
        id,
        name: meta.name,
        author: meta.author,
        download_change: change,
        current_total: currentTotal,
        baseline_total: baselineTotal,
        latest_snapshot: latest.file,
        baseline_snapshot: baseline.file,
      });
    }

    rows.sort((a, b) =>
      b.download_change - a.download_change
      || b.current_total - a.current_total
      || a.id.localeCompare(b.id));

    return rows.slice(0, TOP_LISTINGS).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  };

  const allTimeRows = (() => {
    const rows: Omit<ListingAllTimeRow, "rank">[] = [];
    for (const [key, total] of latestTotals.entries()) {
      const [listingType, id] = key.split(":") as ["maps" | "mods", string];
      const meta = listingMeta.get(key) ?? { name: id, author: "UNKNOWN" };
      rows.push({
        listing_type: toListingLabel(listingType),
        id,
        name: meta.name,
        author: meta.author,
        total_downloads: total,
        latest_snapshot: latest.file,
      });
    }
    rows.sort((a, b) => b.total_downloads - a.total_downloads || a.id.localeCompare(b.id));
    return rows.slice(0, TOP_LISTINGS).map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
  })();

  const authorStats = new Map<string, Omit<AuthorAssetCountRow, "rank">>();
  for (const [key, total] of latestTotals.entries()) {
    const [listingType] = key.split(":") as ["maps" | "mods", string];
    const meta = listingMeta.get(key) ?? { name: "", author: "UNKNOWN" };
    const previous = authorStats.get(meta.author) ?? {
      author: meta.author,
      asset_count: 0,
      map_count: 0,
      mod_count: 0,
      total_downloads: 0,
    };
    previous.asset_count += 1;
    if (listingType === "maps") previous.map_count += 1;
    if (listingType === "mods") previous.mod_count += 1;
    previous.total_downloads += total;
    authorStats.set(meta.author, previous);
  }

  const authorRowsByAssetCount: AuthorAssetCountRow[] = [...authorStats.values()]
    .sort((a, b) =>
      b.asset_count - a.asset_count
      || b.total_downloads - a.total_downloads
      || a.author.localeCompare(b.author))
    .slice(0, TOP_AUTHORS)
    .map((row, index) => ({ rank: index + 1, ...row }));

  const authorRowsByTotalDownloads: AuthorTotalDownloadsRow[] = [...authorStats.values()]
    .sort((a, b) =>
      b.total_downloads - a.total_downloads
      || b.asset_count - a.asset_count
      || a.author.localeCompare(b.author))
    .slice(0, TOP_AUTHORS)
    .map((row, index) => ({
      rank: index + 1,
      author: row.author,
      total_downloads: row.total_downloads,
      asset_count: row.asset_count,
      map_count: row.map_count,
      mod_count: row.mod_count,
    }));

  writeCsv<ListingWindowRow>(
    join(analyticsDir, "most_popular_last_1d.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "download_change",
      "current_total",
      "baseline_total",
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
      "download_change",
      "current_total",
      "baseline_total",
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
      "download_change",
      "current_total",
      "baseline_total",
      "latest_snapshot",
      "baseline_snapshot",
    ],
    rowsForWindow(WINDOWS[2]),
  );

  writeCsv<ListingAllTimeRow>(
    join(analyticsDir, "most_popular_all_time.csv"),
    [
      "rank",
      "listing_type",
      "id",
      "name",
      "author",
      "total_downloads",
      "latest_snapshot",
    ],
    allTimeRows,
  );

  writeCsv<AuthorAssetCountRow>(
    join(analyticsDir, "authors_by_asset_count.csv"),
    [
      "rank",
      "author",
      "asset_count",
      "map_count",
      "mod_count",
      "total_downloads",
    ],
    authorRowsByAssetCount,
  );

  writeCsv<AuthorTotalDownloadsRow>(
    join(analyticsDir, "authors_by_total_downloads.csv"),
    [
      "rank",
      "author",
      "total_downloads",
      "asset_count",
      "map_count",
      "mod_count",
    ],
    authorRowsByTotalDownloads,
  );

  const mapPopulationRows = loadMapPopulationRows(repoRoot);
  writeCsv<MapPopulationRow>(
    join(analyticsDir, "maps_by_population.csv"),
    [
      "rank",
      "id",
      "name",
      "author",
      "city_code",
      "country",
      "population",
      "population_count",
      "points_count",
    ],
    mapPopulationRows,
  );

  console.log(`Generated analytics CSVs in ${analyticsDir}`);
  console.log(`Latest snapshot: ${latest.file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
