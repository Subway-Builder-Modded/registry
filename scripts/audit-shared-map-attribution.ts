import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface SnapshotSection {
  downloads: Record<string, Record<string, number>>;
  raw_downloads?: Record<string, Record<string, number>>;
  attributed_downloads?: Record<string, Record<string, number>>;
}

interface SnapshotFile {
  snapshot_date: string;
  maps: SnapshotSection;
}

interface IntegritySource {
  repo?: string;
  tag?: string;
  asset_name?: string;
}

interface IntegrityVersionEntry {
  source?: IntegritySource;
}

interface IntegrityListingEntry {
  versions: Record<string, IntegrityVersionEntry>;
}

interface IntegrityFile {
  listings: Record<string, IntegrityListingEntry>;
}

interface AttributionLedger {
  assets: Record<string, { count: number }>;
}

interface AuditRow {
  id: string;
  version: string;
  snapshot_raw: number;
  snapshot_attributed: number;
  snapshot_adjusted: number;
  integrity_repo: string;
  integrity_tag: string;
  integrity_asset_name: string;
  exact_ledger_attributed: number;
  corrected_adjusted: number;
  status: "ok" | "missing_snapshot_attr" | "wrong_tag_match" | "missing_integrity_source" | "missing_ledger_asset";
}

interface CliOptions {
  inputRoot: string;
  snapshotPath?: string;
  snapshotDate?: string;
  listingId?: string;
  listingPrefix: string;
  repo?: string;
}

const FALLBACK_REPO_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_AUDIT_DIR = "shared-map-attribution-audit";

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputRoot: resolve(FALLBACK_REPO_ROOT, "tmp", DEFAULT_AUDIT_DIR),
    listingPrefix: "yukina-",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-root") {
      options.inputRoot = resolve(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--snapshot") {
      options.snapshotPath = resolve(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--snapshot-date") {
      options.snapshotDate = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--listing-id") {
      options.listingId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--listing-prefix") {
      options.listingPrefix = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      const value = argv[i + 1];
      options.repo = typeof value === "string" ? value.trim().toLowerCase() : "";
      i += 1;
      continue;
    }
    if (arg === "--") {
      continue;
    }
    throw new Error(`Unknown argument '${arg}'`);
  }

  return options;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function resolveSnapshotPath(inputRoot: string, requestedPath?: string, snapshotDate?: string): string {
  if (requestedPath) return requestedPath;
  const registryDir = resolve(inputRoot, "registry");
  if (snapshotDate) {
    return resolve(registryDir, `snapshot_${snapshotDate}.json`);
  }
  const snapshotFiles = readdirSync(registryDir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .sort();
  if (snapshotFiles.length === 0) {
    throw new Error(`No snapshot files found under ${registryDir}`);
  }
  return resolve(registryDir, snapshotFiles[snapshotFiles.length - 1]!);
}

function makeAssetKey(repo: string, tag: string, assetName: string): string {
  return `${repo.toLowerCase()}@${tag}/${assetName}`;
}

function findCandidateAssetKeys(ledger: AttributionLedger, repo: string, assetName: string): string[] {
  const prefix = `${repo.toLowerCase()}@`;
  const suffix = `/${assetName}`;
  return Object.keys(ledger.assets)
    .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
    .sort();
}

function classifyStatus(
  snapshotAttributed: number,
  exactAttributed: number,
  hasExactAsset: boolean,
  hasAnySource: boolean,
): AuditRow["status"] {
  if (!hasAnySource) return "missing_integrity_source";
  if (snapshotAttributed === exactAttributed) {
    return exactAttributed === 0 && !hasExactAsset ? "missing_ledger_asset" : "ok";
  }
  if (snapshotAttributed === 0 && exactAttributed > 0) return "missing_snapshot_attr";
  return "wrong_tag_match";
}

function toCsv(rows: AuditRow[]): string {
  const header = [
    "id",
    "version",
    "snapshot_raw",
    "snapshot_attributed",
    "snapshot_adjusted",
    "integrity_repo",
    "integrity_tag",
    "integrity_asset_name",
    "exact_ledger_attributed",
    "corrected_adjusted",
    "status",
  ];
  const csvRows = rows.map((row) => [
    row.id,
    row.version,
    row.snapshot_raw,
    row.snapshot_attributed,
    row.snapshot_adjusted,
    row.integrity_repo,
    row.integrity_tag,
    row.integrity_asset_name,
    row.exact_ledger_attributed,
    row.corrected_adjusted,
    row.status,
  ].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","));
  return `${header.join(",")}\n${csvRows.join("\n")}\n`;
}

function run(): void {
  const options = parseCliOptions(process.argv.slice(2));
  const snapshotPath = resolveSnapshotPath(options.inputRoot, options.snapshotPath, options.snapshotDate);
  const snapshot = readJsonFile<SnapshotFile>(snapshotPath);
  const integrity = readJsonFile<IntegrityFile>(resolve(options.inputRoot, "registry", "maps.integrity.json"));
  const ledger = readJsonFile<AttributionLedger>(
    resolve(options.inputRoot, "registry", "registry-download-attribution.json"),
  );

  const rows: AuditRow[] = [];
  for (const [id, byVersion] of Object.entries(snapshot.maps.downloads)) {
    if (options.listingId && id !== options.listingId) continue;

    for (const version of Object.keys(byVersion).sort()) {
      const snapshotAdjusted = snapshot.maps.downloads[id]?.[version] ?? 0;
      const snapshotRaw = snapshot.maps.raw_downloads?.[id]?.[version] ?? snapshotAdjusted;
      const snapshotAttributed = snapshot.maps.attributed_downloads?.[id]?.[version] ?? 0;
      const source = integrity.listings[id]?.versions?.[version]?.source;
      const repo = source?.repo?.trim().toLowerCase() ?? "";
      const tag = source?.tag?.trim() ?? "";
      const assetName = source?.asset_name?.trim() ?? "";
      if (!options.listingId && options.repo && repo !== options.repo) continue;
      if (!options.listingId && !options.repo && options.listingPrefix !== "" && !id.startsWith(options.listingPrefix)) continue;
      const hasAnySource = repo !== "" && tag !== "" && assetName !== "";
      const exactKey = hasAnySource ? makeAssetKey(repo, tag, assetName) : "";
      const exactAttributed = exactKey !== "" ? (ledger.assets[exactKey]?.count ?? 0) : 0;
      const hasExactAsset = exactKey !== "" && Object.hasOwn(ledger.assets, exactKey);
      const correctedAdjusted = Math.max(0, snapshotRaw - exactAttributed);

      rows.push({
        id,
        version,
        snapshot_raw: snapshotRaw,
        snapshot_attributed: snapshotAttributed,
        snapshot_adjusted: snapshotAdjusted,
        integrity_repo: repo,
        integrity_tag: tag,
        integrity_asset_name: assetName,
        exact_ledger_attributed: exactAttributed,
        corrected_adjusted: correctedAdjusted,
        status: classifyStatus(snapshotAttributed, exactAttributed, hasExactAsset, hasAnySource),
      });
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));

  const summaryByTag: Record<string, { listings: number; snapshot_attributed: number; exact_ledger_attributed: number }> = {};
  const summaryByAsset: Record<string, { listings: number; snapshot_attributed: number; exact_ledger_attributed: number }> = {};
  for (const row of rows) {
    const tagKey = row.integrity_tag || "(missing)";
    const assetKey = row.integrity_asset_name || "(missing)";
    summaryByTag[tagKey] ??= { listings: 0, snapshot_attributed: 0, exact_ledger_attributed: 0 };
    summaryByAsset[assetKey] ??= { listings: 0, snapshot_attributed: 0, exact_ledger_attributed: 0 };
    summaryByTag[tagKey].listings += 1;
    summaryByTag[tagKey].snapshot_attributed += row.snapshot_attributed;
    summaryByTag[tagKey].exact_ledger_attributed += row.exact_ledger_attributed;
    summaryByAsset[assetKey].listings += 1;
    summaryByAsset[assetKey].snapshot_attributed += row.snapshot_attributed;
    summaryByAsset[assetKey].exact_ledger_attributed += row.exact_ledger_attributed;
  }

  const resultsDir = resolve(options.inputRoot, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(resolve(resultsDir, "shared-map-attribution-audit.csv"), toCsv(rows), "utf8");
  writeFileSync(
    resolve(resultsDir, "shared-map-attribution-audit.json"),
    `${JSON.stringify({
      snapshot_date: snapshot.snapshot_date,
      repo: options.repo ?? null,
      listing_prefix: options.listingId ? null : options.listingPrefix,
      listing_id: options.listingId ?? null,
      total_rows: rows.length,
      status_counts: rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
      by_tag: summaryByTag,
      by_asset: summaryByAsset,
      rows: rows.map((row) => ({
        ...row,
        ledger_asset_candidates: row.integrity_repo && row.integrity_asset_name
          ? findCandidateAssetKeys(ledger, row.integrity_repo, row.integrity_asset_name)
          : [],
      })),
    }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[audit-shared-map-attribution] wrote ${rows.length} rows to tmp/${DEFAULT_AUDIT_DIR}/results/`,
  );
}

run();
