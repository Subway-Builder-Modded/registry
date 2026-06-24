// seed-included-cities.ts
//
// One-time seed of included_cities for maps whose geographic coverage
// extends well beyond the named city. Run once; safe to re-run (skips
// maps that already have the field unless --force is passed).
//
// Usage: tsx seed-included-cities.ts [--force] [--dry-run]

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readJsonFile, writeJsonFile } from './lib/json-utils.js';
import { resolveRepoRoot, runAndExitOnError } from './lib/script-runtime.js';

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED: Record<string, string[]> = {
  // --- Japan: regional names with no city in the map name ---
  'yukina-nakaumi':       ['Matsue', 'Yonago', 'Izumo'],
  'yukina-tsugaru':       ['Aomori', 'Hirosaki', 'Goshogawara'],
  'yukina-nakadoori':     ['Fukushima', 'Kōriyama'],
  'yukina-okinawa':       ['Naha', 'Okinawa', 'Urasoe', 'Ginowan', 'Uruma', 'Itoman'],
  // 福北 (Fukuoka & Kitakyūshū) — '&' split yields CJK fragments, neither matches GeoNames
  'yukina-northern-kyushu': ['Fukuoka', 'Kitakyushu', 'Kurume', 'Saga', 'Iizuka'],

  // --- Japan: secondary city in map ID but absent from manifest name ---
  // All use "漢字 (Primary-city-only)" format; tokeniser cannot extract secondary
  'yukina-hiroshima-kure':        ['Kure', 'Higashihiroshima', 'Hatsukaichi'],
  'yukina-kagoshima-kirishima':   ['Kirishima', 'Aira', 'Kanoya'],
  'yukina-kobe-akashi':           ['Akashi', 'Nishinomiya', 'Amagasaki', 'Himeji', 'Kakogawa'],
  'yukina-kitakyushu-shimonoseki':['Shimonoseki', 'Ube'],
  'yukina-sapporo-chitose':       ['Chitose', 'Eniwa', 'Kitahiroshima', 'Ishikari', 'Ebetsu', 'Otaru'],
  // 静岡・浜松 (Shizuoka/Hamamatsu) — '·' + '/' split yields broken CJK fragments
  'yukina-shizuoka-hamamatsu':    ['Hamamatsu', 'Shizuoka', 'Fuji', 'Yaizu', 'Kakegawa'],

  // --- Japan: single-city name, major satellite not reachable by coordinate match alone ---
  'yukina-okayama': ['Kurashiki', 'Sōja', 'Tamano'],          // Kurashiki = 67 % of Okayama
  'yukina-nagoya':  ['Toyota', 'Okazaki', 'Ichinomiya', 'Kasugai', 'Gifu'],
  'yukina-osaka':   ['Sakai', 'Higashiōsaka', 'Toyonaka', 'Suita', 'Hirakata'],
  'yukina-kyoto':   ['Uji', 'Nara'],
  'yukina-toyama':  ['Takaoka', 'Imizu', 'Kurobe'],            // Takaoka = 41 %
  'yukina-niigata': ['Nagaoka', 'Sanjō', 'Tsubame'],
  'yukina-nagasaki':['Isahaya', 'Ōmura', 'Sasebo'],
  'yukina-fukuoka': ['Kasuga', 'Dazaifu', 'Itoshima', 'Munakata'],
  'yukina-yamagata':['Tendō', 'Higashine'],

  // --- Poland ---
  'yukina-pl-gdansk':       ['Gdynia', 'Sopot', 'Rumia', 'Wejherowo'],  // Gdynia = 52 %
  'yukina-pl-katowice-gzm': [                                            // entire GZM
    'Sosnowiec', 'Gliwice', 'Zabrze', 'Bytom',
    'Ruda Śląska', 'Tychy', 'Dąbrowa Górnicza', 'Chorzów',
    'Jaworzno', 'Mysłowice',
  ],
  'yukina-pl-legnica':      ['Lubin', 'Głogów', 'Polkowice'],  // Lubin = 76 %, Głogów = 65 %
  'yukina-pl-opole':        ['Kędzierzyn-Koźle', 'Nysa', 'Brzeg'],
  'yukina-bydgoszcz-torun': ['Inowrocław'],
  'yukina-pl-szczecin':     ['Stargard'],
  'yukina-pl-rzeszow':      ['Dębica', 'Przemyśl'],
  'yukina-pl-zielona-gora': ['Nowa Sól'],

  // --- Czech Republic ---
  'yukina-cz-ustecko-chomutov': ['Most', 'Teplice', 'Děčín', 'Litvínov'],
  'yukina-cz-olomouc':          ['Prostějov', 'Přerov', 'Šumperk'],
  'yukina-cz-ostrava':          ['Havířov', 'Frýdek-Místek', 'Karviná', 'Opava'],
  'yukina-cz-karlovy-vary':     ['Sokolov', 'Cheb', 'Mariánské Lázně'],
  'yukina-cz-zlin':             ['Kroměříž', 'Uherské Hradiště', 'Vsetín'],
  'yukina-cz-liberec-jablonec': ['Česká Lípa'],
  'yukina-cz-hradec-pardubice': ['Chrudim'],
  'yukina-cz-ceske-budejovice': ['Písek'],

  // --- Estonia ---
  'yukina-ee-ida-viru': ['Narva', 'Kohtla-Järve', 'Jõhvi', 'Sillamäe'],

  // --- Taiwan ---
  'yukina-tw-taipei':    ['New Taipei', 'Keelung', 'Taoyuan'],
  'yukina-tw-taichung':  ['Changhua'],
  'yukina-tw-kaohsiung': ['Pingtung'],
  'yukina-tw-hsinchu':   ['Miaoli'],
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);

  let updated = 0;
  let skipped = 0;

  for (const [mapId, cities] of Object.entries(SEED).sort(([a], [b]) => a.localeCompare(b))) {
    const manifestPath = resolve(repoRoot, 'maps', mapId, 'manifest.json');
    const manifest = readJsonFile<Record<string, unknown>>(manifestPath);

    if (manifest['included_cities'] !== undefined && !force) {
      skipped++;
      continue;
    }

    console.log(`[seed-included-cities] ${mapId}: [${cities.join(', ')}]`);

    if (!dryRun) {
      manifest['included_cities'] = cities;
      writeJsonFile(manifestPath, manifest);
      updated++;
    }
  }

  console.log(
    `[seed-included-cities] Done: updated=${updated}, skipped(already-set)=${skipped}` +
      (dryRun ? ' (dry-run)' : ''),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAndExitOnError(run);
}
