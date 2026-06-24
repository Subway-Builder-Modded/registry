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
  // Each entry pairs romaji (for GeoNames lookup) with kanji (direct fallback search term).
  'yukina-nakaumi':       ['Matsue', '松江', 'Yonago', '米子', 'Izumo', '出雲'],
  'yukina-tsugaru':       ['Aomori', '青森', 'Hirosaki', '弘前', 'Goshogawara', '五所川原'],
  'yukina-nakadoori':     ['Fukushima', '福島', 'Kōriyama', '郡山'],
  'yukina-okinawa':       ['Naha', '那覇', 'Okinawa', '沖縄市', 'Urasoe', '浦添', 'Ginowan', '宜野湾', 'Uruma', 'うるま市', 'Itoman', '糸満'],
  // 福北 (Fukuoka & Kitakyūshū) — '&' split yields CJK fragments, neither matches GeoNames
  'yukina-northern-kyushu': ['Fukuoka', '福岡', 'Kitakyushu', '北九州', 'Kurume', '久留米', 'Saga', '佐賀', 'Iizuka', '飯塚'],

  // --- Japan: secondary city in map ID but absent from manifest name ---
  // All use "漢字 (Primary-city-only)" format; tokeniser cannot extract secondary
  'yukina-hiroshima-kure':        ['Kure', '呉', 'Higashihiroshima', '東広島', 'Hatsukaichi', '廿日市'],
  'yukina-kagoshima-kirishima':   ['Kirishima', '霧島', 'Aira', '姶良', 'Kanoya', '鹿屋'],
  'yukina-kobe-akashi':           ['Akashi', '明石', 'Nishinomiya', '西宮', 'Amagasaki', '尼崎', 'Himeji', '姫路', 'Kakogawa', '加古川'],
  'yukina-kitakyushu-shimonoseki':['Shimonoseki', '下関', 'Ube', '宇部'],
  'yukina-sapporo-chitose':       ['Chitose', '千歳', 'Eniwa', '恵庭', 'Kitahiroshima', '北広島', 'Ishikari', '石狩', 'Ebetsu', '江別', 'Otaru', '小樽'],
  // 静岡・浜松 (Shizuoka/Hamamatsu) — '·' + '/' split yields broken CJK fragments
  'yukina-shizuoka-hamamatsu':    ['Hamamatsu', '浜松', 'Shizuoka', '静岡', 'Fuji', '富士', 'Yaizu', '焼津', 'Kakegawa', '掛川'],

  // --- Japan: single-city name, major satellite not reachable by coordinate match alone ---
  'yukina-okayama': ['Kurashiki', '倉敷', 'Sōja', '総社', 'Tamano', '玉野'],   // Kurashiki = 67 %
  'yukina-nagoya':  ['Toyota', '豊田', 'Okazaki', '岡崎', 'Ichinomiya', '一宮', 'Kasugai', '春日井', 'Gifu', '岐阜'],
  'yukina-osaka':   ['Sakai', '堺', 'Higashiōsaka', '東大阪', 'Toyonaka', '豊中', 'Suita', '吹田', 'Hirakata', '枚方'],
  'yukina-kyoto':   ['Uji', '宇治', 'Nara', '奈良'],
  'yukina-toyama':  ['Takaoka', '高岡', 'Imizu', '射水', 'Kurobe', '黒部'],     // Takaoka = 41 %
  'yukina-niigata': ['Nagaoka', '長岡', 'Sanjō', '三条', 'Tsubame', '燕'],
  'yukina-nagasaki':['Isahaya', '諫早', 'Ōmura', '大村', 'Sasebo', '佐世保'],
  'yukina-fukuoka': ['Kasuga', '春日', 'Dazaifu', '太宰府', 'Itoshima', '糸島', 'Munakata', '宗像'],
  'yukina-yamagata':['Tendō', '天童', 'Higashine', '東根'],

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
  'yukina-tw-taipei':    ['New Taipei', '新北市', 'Keelung', '基隆', 'Taoyuan', '桃園'],
  'yukina-tw-taichung':  ['Changhua', '彰化'],
  'yukina-tw-kaohsiung': ['Pingtung', '屏東'],
  'yukina-tw-hsinchu':   ['Miaoli', '苗栗'],
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
