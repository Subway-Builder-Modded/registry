import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  collectLocalGridStatistics,
  writeLocalGridStatisticsReport,
} from "./lib/local-grid-statistics.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

interface CliOptions {
  inputDir: string;
  outputPath: string;
  cityCodes: string[];
}

function parseCliArgs(argv: string[], repoRoot: string): CliOptions {
  let inputDir: string | null = null;
  let outputPath = resolve(repoRoot, "analytics", "local_grid_statistics.json");
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
    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing file path value after '--output'");
      }
      outputPath = value.trim();
      index += 1;
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
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length).trim();
      continue;
    }
    throw new Error(
      `Unknown argument '${arg}'. Supported flags: --input-dir <dir>, --output <file>, --city <code>.`,
    );
  }

  if (!inputDir || inputDir === "") {
    throw new Error("Missing required --input-dir <dir> argument.");
  }

  return { inputDir, outputPath, cityCodes };
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const cli = parseCliArgs(process.argv.slice(2), repoRoot);
  const report = await collectLocalGridStatistics(cli.inputDir, {
    cityCodes: cli.cityCodes.length > 0 ? cli.cityCodes : undefined,
  });
  writeLocalGridStatisticsReport(cli.outputPath, report);

  console.log(`Wrote local grid statistics report to ${resolve(cli.outputPath)}`);
  console.log(`Processed cities: ${report.processedCount}`);
  console.log(`Failed cities: ${report.failedCount}`);
  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.warn(`[local-grid-statistics] ${failure.cityCode}: ${failure.error}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
