// generate-search-aliases.ts
//
// Populates search_aliases on map manifests using GeoNames alternateNamesV2 data.
// For each map, the initial_view_state lat/lon is matched to the highest-population
// GeoNames city within CITY_MATCH_RADIUS_KM, then alternate names from
// alternateNamesV2 are filtered to clean natural-language exonyms/endonyms.
//
// GeoNames data (~200MB download) is cached in tmp/geonames/ (or --data-dir)
// so repeated runs are cheap.
//
// Usage:
//   tsx generate-search-aliases.ts [options]
//
// Options:
//   --map-id <id>     Process only this map (default: all maps)
//   --force           Re-populate even if search_aliases already set
//   --dry-run         Print what would be written without touching manifests
//   --data-dir <path> GeoNames cache directory (default: <repo>/tmp/geonames)

import { createInterface } from 'node:readline';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

import JSZip from 'jszip';

import { isObject, readJsonFile, writeJsonFile } from './lib/json-utils.js';
import { resolveRepoRoot, runAndExitOnError } from './lib/script-runtime.js';

// --- Constants ---

const CITIES_ZIP_URL = 'https://download.geonames.org/export/dump/cities15000.zip';
const ALT_NAMES_ZIP_URL = 'https://download.geonames.org/export/dump/alternateNamesV2.zip';

// Prefer the highest-population city within this radius rather than the
// closest city, to avoid matching on districts/boroughs (e.g. Mitte < Berlin).
const CITY_MATCH_RADIUS_KM = 50;

const MAX_ALIASES_PER_MAP = 20;

// Natural-language ISO 639 codes to accept from alternateNamesV2.
// Excludes non-linguistic codes: 'iata', 'icao', 'faac', 'faa', 'link',
// 'wkdt', 'unlc', 'nuts', 'abbr', 'post', 'phon', 'piny', 'tcid', 'gns', etc.
const ALLOWED_LANG_CODES = new Set([
  'en', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'pl', 'ru', 'uk',
  'ja', 'zh', 'ko', 'ar', 'tr', 'sv', 'da', 'fi', 'no', 'nb', 'nn',
  'cs', 'sk', 'hr', 'sr', 'bg', 'ro', 'hu', 'el', 'he', 'hi', 'bn',
  'th', 'vi', 'id', 'ms', 'ca', 'eu', 'af', 'sq', 'et', 'lv', 'lt',
  'sl', 'mk', 'be', 'az', 'ka', 'hy', 'uz', 'kk',
]);

// --- Types ---

interface City {
  geonameid: string;
  name: string;
  lat: number;
  lon: number;
  population: number;
}

interface AliasEntry {
  name: string;
  lang: string;
  isPreferred: boolean;
}

interface CliOptions {
  mapId: string | undefined;
  force: boolean;
  dryRun: boolean;
  dataDir: string;
}

// --- Geometry ---

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns the highest-population city within CITY_MATCH_RADIUS_KM.
// Preferring population over proximity avoids matching on inner-city districts
// (e.g. Mitte would lose to Berlin, Śródmieście would lose to Warszawa).
function findBestCity(lat: number, lon: number, cities: City[]): City | null {
  let best: City | null = null;
  let bestPop = -1;
  for (const city of cities) {
    if (
      haversineKm(lat, lon, city.lat, city.lon) <= CITY_MATCH_RADIUS_KM &&
      city.population > bestPop
    ) {
      best = city;
      bestPop = city.population;
    }
  }
  return best;
}

// --- Network / extraction ---

async function downloadToFile(url: string, destPath: string): Promise<void> {
  console.log(`[generate-search-aliases] Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const dest = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), dest);
}

// Uses jszip (already a dep) so no system unzip/7z needed on any platform.
// cities15000.zip is ~1.5MB; alternateNamesV2.zip is ~200MB — both are
// loaded as buffers then streamed to disk, keeping peak RAM reasonable.
async function extractZipEntry(zipPath: string, entryName: string, destDir: string): Promise<void> {
  const destPath = resolve(destDir, entryName);
  const zipBuffer = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipBuffer);
  const entry = zip.file(entryName);
  if (!entry) throw new Error(`${entryName} not found inside ${zipPath}`);
  await pipeline(entry.nodeStream(), createWriteStream(destPath));
}

// --- GeoNames parsing ---

async function parseCities15000(dataDir: string): Promise<City[]> {
  const zipPath = resolve(dataDir, 'cities15000.zip');
  const txtPath = resolve(dataDir, 'cities15000.txt');

  if (!existsSync(txtPath)) {
    if (!existsSync(zipPath)) await downloadToFile(CITIES_ZIP_URL, zipPath);
    console.log('[generate-search-aliases] Extracting cities15000.zip...');
    await extractZipEntry(zipPath, 'cities15000.txt', dataDir);
  }

  // cities15000 tab format (19 columns):
  // [0] geonameid  [1] name  [2] asciiname  [3] alternatenames
  // [4] latitude   [5] longitude            [8] country_code
  // [14] population
  const cities: City[] = [];
  const rl = createInterface({
    input: createReadStream(txtPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parts = line.split('\t');
    if (parts.length < 15) continue;
    const geonameid = parts[0];
    const name = parts[1];
    const lat = parseFloat(parts[4]);
    const lon = parseFloat(parts[5]);
    const population = parseInt(parts[14], 10);
    if (!geonameid || !isFinite(lat) || !isFinite(lon)) continue;
    cities.push({
      geonameid,
      name,
      lat,
      lon,
      population: isFinite(population) ? population : 0,
    });
  }

  console.log(`[generate-search-aliases] Loaded ${cities.length} cities from cities15000.`);
  return cities;
}

async function buildAliasIndex(
  dataDir: string,
  cityGeonameIds: Set<string>,
): Promise<Map<string, AliasEntry[]>> {
  const zipPath = resolve(dataDir, 'alternateNamesV2.zip');
  const txtPath = resolve(dataDir, 'alternateNamesV2.txt');

  if (!existsSync(txtPath)) {
    if (!existsSync(zipPath)) {
      await downloadToFile(ALT_NAMES_ZIP_URL, zipPath);
    }
    console.log('[generate-search-aliases] Extracting alternateNamesV2.zip (~800MB uncompressed)...');
    await extractZipEntry(zipPath, 'alternateNamesV2.txt', dataDir);
  }

  // alternateNamesV2 tab format (up to 10 columns):
  // [0] alternateNameId  [1] geonameid  [2] isoLanguage  [3] alternateName
  // [4] isPreferredName  [5] isShortName  [6] isColloquial  [7] isHistoric
  // [8] From (optional)  [9] To (optional)
  console.log('[generate-search-aliases] Streaming alternateNamesV2.txt (19M+ rows)...');
  const index = new Map<string, AliasEntry[]>();
  const rl = createInterface({
    input: createReadStream(txtPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount % 2_000_000 === 0) {
      process.stdout.write(
        `\r[generate-search-aliases]   ... ${(lineCount / 1_000_000).toFixed(0)}M lines processed`,
      );
    }

    const parts = line.split('\t');
    if (parts.length < 8) continue;

    const geonameid = parts[1];
    if (!cityGeonameIds.has(geonameid)) continue;

    const isoLang = parts[2];
    if (!ALLOWED_LANG_CODES.has(isoLang)) continue;

    const isColloquial = parts[6];
    const isHistoric = parts[7];
    if (isColloquial === '1' || isHistoric === '1') continue;

    const alternateName = parts[3];
    if (!alternateName) continue;

    const entry: AliasEntry = {
      name: alternateName,
      lang: isoLang,
      isPreferred: parts[4] === '1',
    };

    const existing = index.get(geonameid);
    if (existing) {
      existing.push(entry);
    } else {
      index.set(geonameid, [entry]);
    }
  }

  process.stdout.write('\n');
  console.log(`[generate-search-aliases] Indexed aliases for ${index.size} cities.`);
  return index;
}

// --- Alias selection ---

function selectAliases(
  entries: AliasEntry[],
  manifestName: string,
  maxCount: number,
): string[] {
  // isPreferred names first; otherwise preserve file insertion order (stable).
  const sorted = [...entries].sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
    return 0;
  });

  const manifestNameNorm = manifestName.toLowerCase().trim();
  const seen = new Set<string>();
  const result: string[] = [];

  for (const { name } of sorted) {
    const norm = name.toLowerCase().trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (norm === manifestNameNorm) continue; // name field already covers this
    result.push(name);
    if (result.length >= maxCount) break;
  }

  return result;
}

// --- CLI ---

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let mapId: string | undefined;
  let force = false;
  let dryRun = false;
  let dataDir = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--map-id' && args[i + 1]) {
      mapId = args[++i];
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--data-dir' && args[i + 1]) {
      dataDir = args[++i];
    }
  }

  return { mapId, force, dryRun, dataDir };
}

// --- Entry point ---

async function run(): Promise<void> {
  const { mapId: filterMapId, force, dryRun, dataDir: customDataDir } = parseArgs();
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const dataDir = customDataDir || resolve(repoRoot, 'tmp', 'geonames');

  mkdirSync(dataDir, { recursive: true });

  const cities = await parseCities15000(dataDir);
  const cityGeonameIds = new Set(cities.map((c) => c.geonameid));
  const aliasIndex = await buildAliasIndex(dataDir, cityGeonameIds);

  const mapsDir = resolve(repoRoot, 'maps');
  const { maps: allMapIds } = readJsonFile<{ maps: string[] }>(resolve(mapsDir, 'index.json'));
  const mapIds = filterMapId ? allMapIds.filter((id) => id === filterMapId) : allMapIds;

  let processed = 0;
  let updated = 0;
  let skippedAlreadySet = 0;
  let noCity = 0;

  for (const mapId of mapIds.sort()) {
    processed++;
    const manifestPath = resolve(mapsDir, mapId, 'manifest.json');
    const manifest = readJsonFile<Record<string, unknown>>(manifestPath);

    if (manifest['search_aliases'] !== undefined && !force) {
      skippedAlreadySet++;
      continue;
    }

    const viewState = manifest['initial_view_state'];
    if (
      !isObject(viewState) ||
      typeof viewState['latitude'] !== 'number' ||
      typeof viewState['longitude'] !== 'number'
    ) {
      console.warn(`[generate-search-aliases] ${mapId}: missing initial_view_state, skipping`);
      noCity++;
      continue;
    }

    const city = findBestCity(viewState['latitude'] as number, viewState['longitude'] as number, cities);
    if (!city) {
      console.warn(
        `[generate-search-aliases] ${mapId}: no city within ${CITY_MATCH_RADIUS_KM}km of ` +
          `(${viewState['latitude']}, ${viewState['longitude']}), skipping`,
      );
      noCity++;
      continue;
    }

    const rawEntries = aliasIndex.get(city.geonameid) ?? [];
    const aliases = selectAliases(rawEntries, String(manifest['name'] ?? ''), MAX_ALIASES_PER_MAP);

    const preview = aliases.slice(0, 5).join(', ') + (aliases.length > 5 ? '...' : '');
    console.log(
      `[generate-search-aliases] ${mapId} → ${city.name} [${city.geonameid}] ` +
        `(pop ${city.population.toLocaleString()}): [${preview || '(no aliases)'}]`,
    );

    if (!dryRun) {
      manifest['search_aliases'] = aliases;
      writeJsonFile(manifestPath, manifest);
      updated++;
    }
  }

  console.log(
    `[generate-search-aliases] Done: ` +
      `processed=${processed}, updated=${updated}, ` +
      `skipped(already-set)=${skippedAlreadySet}, noCity=${noCity}` +
      (dryRun ? ' (dry-run, no files written)' : ''),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAndExitOnError(run);
}
