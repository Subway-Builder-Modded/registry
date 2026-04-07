import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeJsonFile } from "./lib/json-utils.js";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  computePlayableAreaDebugGeoJson,
  type PlayableAreaDebugResult,
} from "./lib/map-playable-area.js";
import { parseDemandGridData } from "./lib/map-demand-stats.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliOptions {
  inputDir: string;
  outputDir: string;
  cityCodes: string[];
}

interface PlayableAreaDebugReportEntry {
  cityCode: string;
  demandDataPath: string;
  pointCount: number;
  playableAreaKm2: number;
  playableAreaPerPointKm2: number;
  playableCatchmentRadiusKm: number;
  finalGeoJsonPath: string;
  stagedGeoJsonPath: string;
}

interface PlayableAreaDebugReportFailure {
  cityCode: string;
  error: string;
}

interface PlayableAreaDebugReport {
  sourceDir: string;
  generatedAt: string;
  processedCount: number;
  failedCount: number;
  entries: PlayableAreaDebugReportEntry[];
  failures: PlayableAreaDebugReportFailure[];
}

function parseCliArgs(argv: string[], repoRoot: string): CliOptions {
  let inputDir: string | null = null;
  let outputDir = resolve(repoRoot, "tmp", "playable-area-debug");
  const cityCodes: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--input-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing directory value after '--input-dir'");
      }
      inputDir = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-dir=")) {
      inputDir = arg.slice("--input-dir=".length).trim();
      continue;
    }
    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing directory value after '--output-dir'");
      }
      outputDir = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length).trim();
      continue;
    }
    if (arg === "--city") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing city code value after '--city'");
      }
      cityCodes.push(value.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--city=")) {
      cityCodes.push(arg.slice("--city=".length).trim());
      continue;
    }
    throw new Error(
      `Unknown argument '${arg}'. Supported flags: --input-dir <dir>, --output-dir <dir>, --city <code>.`,
    );
  }

  if (!inputDir || inputDir === "") {
    throw new Error("Missing required --input-dir <dir> argument.");
  }

  return { inputDir, outputDir, cityCodes };
}

function findDemandDataPath(cityFolder: string): string | null {
  const jsonPath = resolve(cityFolder, "demand_data.json");
  if (statIfFile(jsonPath)) return jsonPath;

  const gzPath = resolve(cityFolder, "demand_data.json.gz");
  if (statIfFile(gzPath)) return gzPath;

  return null;
}

function statIfFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readDemandPayload(demandDataPath: string): unknown {
  const buffer = readFileSync(demandDataPath);
  const rawText = demandDataPath.toLowerCase().endsWith(".gz")
    ? gunzipSync(buffer).toString("utf-8")
    : buffer.toString("utf-8");
  return JSON.parse(rawText);
}

function writeGeoJson(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFile(path, content);
}

function writeReport(path: string, report: PlayableAreaDebugReport): void {
  writeGeoJson(path, report);
}

function buildCityDebugOutputs(
  cityCode: string,
  outputDir: string,
  debug: PlayableAreaDebugResult,
): {
  finalGeoJsonPath: string;
  stagedGeoJsonPath: string;
} {
  const cityOutputDir = resolve(outputDir, cityCode);
  const finalGeoJsonPath = resolve(cityOutputDir, `${cityCode}.playable-area-final.geojson`);
  const stagedGeoJsonPath = resolve(cityOutputDir, `${cityCode}.playable-area-stages.geojson`);

  writeGeoJson(finalGeoJsonPath, debug.finalPlayableArea);
  writeGeoJson(stagedGeoJsonPath, debug.stagedCells);

  return { finalGeoJsonPath, stagedGeoJsonPath };
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const cli = parseCliArgs(process.argv.slice(2), repoRoot);
  const sourceRoot = resolve(cli.inputDir);
  const requestedCityCodes = cli.cityCodes.length > 0
    ? new Set(cli.cityCodes.map((cityCode) => cityCode.trim()).filter((cityCode) => cityCode !== ""))
    : null;

  const report: PlayableAreaDebugReport = {
    sourceDir: sourceRoot,
    generatedAt: new Date().toISOString(),
    processedCount: 0,
    failedCount: 0,
    entries: [],
    failures: [],
  };

  const cityFolders = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      cityCode: entry.name,
      folderPath: resolve(sourceRoot, entry.name),
    }))
    .filter((entry) => !requestedCityCodes || requestedCityCodes.has(entry.cityCode))
    .sort((a, b) => a.cityCode.localeCompare(b.cityCode));

  for (const cityFolder of cityFolders) {
    try {
      const demandDataPath = findDemandDataPath(cityFolder.folderPath);
      if (!demandDataPath) {
        throw new Error("demand_data.json or demand_data.json.gz not found");
      }

      const payload = readDemandPayload(demandDataPath);
      const demandData = parseDemandGridData(payload);
      const debug = computePlayableAreaDebugGeoJson(
        demandData.points.map((point) => ({
          longitude: point.location[0],
          latitude: point.location[1],
        })),
      );
      const written = buildCityDebugOutputs(cityFolder.cityCode, cli.outputDir, debug);

      report.entries.push({
        cityCode: cityFolder.cityCode,
        demandDataPath,
        pointCount: demandData.points.length,
        playableAreaKm2: debug.metrics.playableAreaKm2,
        playableAreaPerPointKm2: debug.metrics.playableAreaPerPointKm2,
        playableCatchmentRadiusKm: debug.metrics.playableCatchmentRadiusKm,
        finalGeoJsonPath: written.finalGeoJsonPath,
        stagedGeoJsonPath: written.stagedGeoJsonPath,
      });
    } catch (error) {
      report.failures.push({
        cityCode: cityFolder.cityCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  report.processedCount = report.entries.length;
  report.failedCount = report.failures.length;

  const reportPath = resolve(cli.outputDir, "playable-area-debug-report.json");
  writeReport(reportPath, report);

  console.log(`Wrote playable area debug report to ${reportPath}`);
  console.log(`Processed cities: ${report.processedCount}`);
  console.log(`Failed cities: ${report.failedCount}`);
  for (const entry of report.entries) {
    console.log(
      `[playable-area-debug] ${entry.cityCode}: ${entry.playableAreaKm2.toFixed(1)} km^2 from ${entry.pointCount} points`,
    );
  }
  for (const failure of report.failures) {
    console.warn(`[playable-area-debug] ${failure.cityCode}: ${failure.error}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
