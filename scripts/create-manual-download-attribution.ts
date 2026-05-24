import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildManualDownloadAttributionDelta,
  normalizeManualDownloadAttributionSpec,
  type ResolveManualDownloadAttributionVersionInput,
} from "./lib/manual-download-attribution.js";
import {
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  toDownloadAttributionAssetKey,
  writeDownloadAttributionLedger,
} from "./lib/download-attribution.js";
import { readJsonFile, writeJsonFile } from "./lib/json-utils.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliArgs {
  repoRoot: string;
  specPath: string;
  outputPath: string;
  apply: boolean;
}

interface MapIntegrityVersionSource {
  repo?: string;
  tag?: string;
  asset_name?: string;
}

interface ModIntegrityCacheEntry {
  result?: {
    source?: MapIntegrityVersionSource;
  };
}

function getArgValue(args: string[], name: string): string | undefined {
  const key = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(key)) return arg.slice(key.length);
  }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}`) {
      return args[i + 1];
    }
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const specValue = getArgValue(argv, "spec");
  if (!specValue || specValue.trim() === "") {
    throw new Error("Missing --spec <path>.");
  }
  const specPath = resolve(repoRoot, specValue.trim());
  const outputValue = getArgValue(argv, "output")?.trim();
  const outputPath = outputValue
    ? resolve(repoRoot, outputValue)
    : resolve(repoRoot, "tmp", "manual-download-attribution.delta.json");

  return {
    repoRoot,
    specPath,
    outputPath,
    apply: hasFlag(argv, "apply"),
  };
}

function createVersionResolver(repoRoot: string) {
  const mapsPath = resolve(repoRoot, "maps", "integrity.json");
  const modsPath = resolve(repoRoot, "mods", "integrity-cache.json");
  if (!existsSync(mapsPath)) {
    throw new Error(`Missing ${mapsPath}`);
  }
  if (!existsSync(modsPath)) {
    throw new Error(`Missing ${modsPath}`);
  }

  const integrity = readJsonFile<{
    listings?: Record<string, { versions?: Record<string, { source?: MapIntegrityVersionSource }> }>;
  }>(mapsPath);
  const cache = readJsonFile<{ entries?: Record<string, Record<string, ModIntegrityCacheEntry>> }>(
    modsPath,
  );

  return (input: ResolveManualDownloadAttributionVersionInput): string => {
    if (input.listing_type === "map") {
      const source = integrity.listings?.[input.listing_id]?.versions?.[input.version]?.source;
      if (!source?.repo || !source?.tag || !source?.asset_name) {
        throw new Error(`Could not resolve map asset key for ${input.listing_id}@${input.version}.`);
      }
      return toDownloadAttributionAssetKey(source.repo, source.tag, source.asset_name);
    }

    const source = cache.entries?.[input.listing_id]?.[input.version]?.result?.source;
    if (!source?.repo || !source?.tag || !source?.asset_name) {
      throw new Error(`Could not resolve mod asset key for ${input.listing_id}@${input.version}.`);
    }
    return toDownloadAttributionAssetKey(source.repo, source.tag, source.asset_name);
  };
}

function describeSourceEntry(entry: {
  source_entry: {
    note?: string;
    count: number;
  } & (
    | { asset_key: string }
    | { listing_type: string; listing_id: string; version: string }
  );
  asset_key: string;
}): string {
  const sourceEntry = entry.source_entry;
  const subject = "asset_key" in sourceEntry
    ? sourceEntry.asset_key
    : `${sourceEntry.listing_type}:${sourceEntry.listing_id}@${sourceEntry.version}`;
  const note = sourceEntry.note ? ` | ${sourceEntry.note}` : "";
  return `${subject} -> ${entry.asset_key} (+${sourceEntry.count})${note}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  async function run(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const spec = normalizeManualDownloadAttributionSpec(
      readJsonFile<unknown>(args.specPath),
    );
    const resolveVersion = createVersionResolver(args.repoRoot);
    const result = buildManualDownloadAttributionDelta(spec, resolveVersion);

    mkdirSync(dirname(args.outputPath), { recursive: true });
    writeJsonFile(args.outputPath, result.delta);

    console.log(
      `[manual-download-attribution] wrote delta=${args.outputPath}, assets=${Object.keys(result.delta.assets).length}, fetches=${result.total_fetches}, delta_id=${result.delta.delta_id}`,
    );
    for (const entry of result.resolved_entries) {
      console.log(`  ${describeSourceEntry(entry)}`);
    }

    if (!args.apply) {
      console.log("[manual-download-attribution] preview only; pass --apply to merge into history/registry-download-attribution.json");
      return;
    }

    const ledger = loadDownloadAttributionLedger(args.repoRoot);
    const merged = mergeDownloadAttributionDeltas(ledger, [result.delta]);
    if (merged.skippedDeltaIds.length > 0) {
      console.log(`[manual-download-attribution] delta already applied: ${merged.skippedDeltaIds.join(", ")}`);
      return;
    }

    writeDownloadAttributionLedger(args.repoRoot, merged.ledger);
    console.log(
      `[manual-download-attribution] ledger updated: +${merged.addedFetches} fetches, asset_keys=${merged.assetKeysUpdated}`,
    );
    console.log("[manual-download-attribution] next step: run reconcile-attributed-downloads and regenerate-download-history -- --backfill");
  }

  runAndExitOnError(run);
}
