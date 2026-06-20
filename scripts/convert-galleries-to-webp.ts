// One-time migration: transcode gallery raster images (PNG/JPG/GIF) to WebP and
// rewrite every reference to them in the listing manifest. Idempotent.
//
//   pnpm tsx scripts/convert-galleries-to-webp.ts [--dry-run]
//   WEBP_QUALITY=82 pnpm tsx scripts/convert-galleries-to-webp.ts
//
// Per listing:
//   1. Convert every raster in the gallery/ directory to .webp (delete original).
//   2. Repair manifest references: for each gallery image now present as .webp,
//      replace any raster-extension reference to that basename with .webp. This
//      covers all reference forms — the `gallery` array ("gallery/x.png"), bare
//      description embeds (`src="x.png"`), and absolute raw.githubusercontent
//      URLs — because each contains the basename "x.<ext>". References whose
//      basename has no matching .webp (e.g. an external tile-URL template) are
//      left untouched.
//
// App clients render WebP gallery images already (the desktop app has supported
// the image/webp MIME since its first release), so updating the manifest paths
// and files together is backward compatible for every shipped version.

import sharp from "sharp";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const QUALITY = Number(process.env.WEBP_QUALITY ?? 82);
const DRY_RUN = process.argv.includes("--dry-run");
const REPO_ROOT = resolve(import.meta.dirname, "..");
const ASSET_TYPES = ["maps", "mods"] as const;
const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif"]);

let convertedImages = 0;
let changedManifests = 0;
let repairedReferences = 0;
let bytesIn = 0;
let bytesOut = 0;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const assetType of ASSET_TYPES) {
  const typeDir = join(REPO_ROOT, assetType);
  if (!existsSync(typeDir)) continue;

  for (const entry of readdirSync(typeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const listingDir = join(typeDir, entry.name);
    const galleryDir = join(listingDir, "gallery");
    const manifestPath = join(listingDir, "manifest.json");
    if (!existsSync(galleryDir)) continue;

    // Phase 1: convert every raster in the gallery directory.
    for (const file of readdirSync(galleryDir)) {
      const ext = extname(file).toLowerCase();
      if (!RASTER_EXTENSIONS.has(ext)) continue;

      const srcAbs = join(galleryDir, file);
      bytesIn += statSync(srcAbs).size;
      if (!DRY_RUN) {
        const webp = await sharp(srcAbs).webp({ quality: QUALITY }).toBuffer();
        writeFileSync(join(galleryDir, `${file.slice(0, -ext.length)}.webp`), webp);
        rmSync(srcAbs);
        bytesOut += webp.length;
      }
      convertedImages++;
    }

    // Phase 2: repair manifest references for every gallery image now (or about
    // to be) present as .webp. In a dry run the .webp files do not exist yet, so
    // derive the basenames from the raster files we would convert.
    if (!existsSync(manifestPath)) continue;
    const webpBasenames = new Set<string>();
    for (const file of readdirSync(galleryDir)) {
      const ext = extname(file).toLowerCase();
      if (ext === ".webp") webpBasenames.add(basename(file, ".webp"));
      else if (DRY_RUN && RASTER_EXTENSIONS.has(ext)) {
        webpBasenames.add(basename(file, extname(file)));
      }
    }

    let manifestText = readFileSync(manifestPath, "utf8");
    let changed = false;
    for (const base of webpBasenames) {
      for (const ext of RASTER_EXTENSIONS) {
        const pattern = new RegExp(`${escapeRegExp(base + ext)}`, "g");
        if (pattern.test(manifestText)) {
          manifestText = manifestText.replace(pattern, `${base}.webp`);
          changed = true;
          repairedReferences++;
        }
      }
    }
    if (changed) {
      changedManifests++;
      JSON.parse(manifestText); // guard against corrupting the JSON
      if (!DRY_RUN) writeFileSync(manifestPath, manifestText);
    }
  }
}

console.log(`${DRY_RUN ? "[dry-run] " : ""}WebP gallery migration (quality ${QUALITY})`);
console.log(`  images converted: ${convertedImages}`);
console.log(`  manifests rewritten: ${changedManifests} (${repairedReferences} references)`);
if (!DRY_RUN && bytesIn > 0) {
  console.log(
    `  raster ${(bytesIn / 1048576).toFixed(1)} MB -> webp ${(bytesOut / 1048576).toFixed(1)} MB ` +
      `(${(100 - (100 * bytesOut) / bytesIn).toFixed(0)}% smaller)`,
  );
} else if (bytesIn > 0) {
  console.log(`  raster to convert: ${(bytesIn / 1048576).toFixed(1)} MB`);
}
