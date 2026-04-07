import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import JSZip from "jszip";
import { extractDemandStatsFromZipBuffer, type DemandStats } from "./map-demand-stats.js";
import { isObject, writeJsonFile } from "./json-utils.js";

export interface LocalGridStatisticsEntry {
  cityCode: string;
  folderPath: string;
  demandDataPath: string;
  usedSyntheticConfig: boolean;
  warnings: string[];
  stats: DemandStats;
  grid_statistics: Record<string, unknown>;
}

export interface LocalGridStatisticsFailure {
  cityCode: string;
  folderPath: string;
  error: string;
}

export interface LocalGridStatisticsReport {
  sourceDir: string;
  generatedAt: string;
  processedCount: number;
  failedCount: number;
  entries: LocalGridStatisticsEntry[];
  failures: LocalGridStatisticsFailure[];
}

export interface CollectLocalGridStatisticsOptions {
  cityCodes?: string[];
}

function buildSyntheticConfig(cityCode: string): string {
  return JSON.stringify({
    code: cityCode,
    initialViewState: {
      latitude: 0,
      longitude: 0,
      zoom: 0,
      bearing: 0,
    },
  });
}

function findDemandDataPath(cityFolder: string): string | null {
  const jsonPath = resolve(cityFolder, "demand_data.json");
  if (existsSync(jsonPath) && statSync(jsonPath).isFile()) return jsonPath;

  const gzPath = resolve(cityFolder, "demand_data.json.gz");
  if (existsSync(gzPath) && statSync(gzPath).isFile()) return gzPath;

  return null;
}

async function buildZipBufferFromCityFolder(cityCode: string, cityFolder: string): Promise<{
  zipBuffer: Buffer;
  demandDataPath: string;
  usedSyntheticConfig: boolean;
}> {
  const demandDataPath = findDemandDataPath(cityFolder);
  if (!demandDataPath) {
    throw new Error("demand_data.json or demand_data.json.gz not found");
  }

  const zip = new JSZip();
  zip.file(basename(demandDataPath), readFileSync(demandDataPath));

  const configPath = resolve(cityFolder, "config.json");
  if (existsSync(configPath) && statSync(configPath).isFile()) {
    zip.file("config.json", readFileSync(configPath, "utf-8"));
    return {
      zipBuffer: await zip.generateAsync({ type: "nodebuffer" }),
      demandDataPath,
      usedSyntheticConfig: false,
    };
  }

  zip.file("config.json", buildSyntheticConfig(cityCode));
  return {
    zipBuffer: await zip.generateAsync({ type: "nodebuffer" }),
    demandDataPath,
    usedSyntheticConfig: true,
  };
}

export async function collectLocalGridStatistics(
  sourceDir: string,
  options: CollectLocalGridStatisticsOptions = {},
): Promise<LocalGridStatisticsReport> {
  const sourceRoot = resolve(sourceDir);
  const entries: LocalGridStatisticsEntry[] = [];
  const failures: LocalGridStatisticsFailure[] = [];
  const requestedCityCodes = options.cityCodes
    ? new Set(options.cityCodes.map((cityCode) => cityCode.trim()).filter((cityCode) => cityCode !== ""))
    : null;

  const cityFolders = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      cityCode: entry.name,
      folderPath: resolve(sourceRoot, entry.name),
    }))
    .filter((entry) => !requestedCityCodes || requestedCityCodes.has(entry.cityCode))
    .sort((a, b) => a.cityCode.localeCompare(b.cityCode));

  for (const cityFolder of cityFolders) {
    const warnings: string[] = [];
    try {
      const prepared = await buildZipBufferFromCityFolder(cityFolder.cityCode, cityFolder.folderPath);
      const extraction = await extractDemandStatsFromZipBuffer(cityFolder.cityCode, prepared.zipBuffer, {
        warnings,
      });
      const gridStatistics = (extraction.grid as typeof extraction.grid & { properties?: unknown }).properties;

      entries.push({
        cityCode: cityFolder.cityCode,
        folderPath: cityFolder.folderPath,
        demandDataPath: prepared.demandDataPath,
        usedSyntheticConfig: prepared.usedSyntheticConfig,
        warnings,
        stats: extraction.stats,
        grid_statistics: isObject(gridStatistics) ? gridStatistics : {},
      });
    } catch (error) {
      failures.push({
        cityCode: cityFolder.cityCode,
        folderPath: cityFolder.folderPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    sourceDir: sourceRoot,
    generatedAt: new Date().toISOString(),
    processedCount: entries.length,
    failedCount: failures.length,
    entries,
    failures,
  };
}

export function writeLocalGridStatisticsReport(outputPath: string, report: LocalGridStatisticsReport): void {
  const resolvedOutputPath = resolve(outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeJsonFile(resolvedOutputPath, report);
}

