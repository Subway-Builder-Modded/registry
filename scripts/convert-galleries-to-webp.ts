// One-time migration: transcode gallery raster images (PNG/JPG) to WebP and
// rewrite every reference to them in the listing manifest.
//
//   pnpm tsx scripts/convert-galleries-to-webp.ts [--dry-run]
//   WEBP_QUALITY=82 pnpm tsx scripts/convert-galleries-to-webp.ts
//
// Gallery images are referenced two ways: the manifest `gallery` array (relative
// "gallery/<file>") and absolute raw.githubusercontent.com URLs embedded in the
// markdown `description` (e.g. a coverage preview). Both forms contain the path
// substring "gallery/<file>", so after converting the files we replace that
// substring across the whole manifest text — updating array entries and
// description embeds in one pass.
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
import { extname, join, resolve } from "node:path";

const QUALITY = Number(process.env.WEBP_QUALITY ?? 82);
const DRY_RUN = process.argv.includes("--dry-run");
const REPO_ROOT = resolve(import.meta.dirname, "..");
const ASSET_TYPES = ["maps", "mods"] as const;
const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

let convertedImages = 0;
let changedManifests = 0;
let bytesIn = 0;
let bytesOut = 0;
const unreferenced: string[] = [];

for (const assetType of ASSET_TYPES) {
  const typeDir = join(REPO_ROOT, assetType);
  if (!existsSync(typeDir)) continue;

  for (const entry of readdirSync(typeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const listingDir = join(typeDir, entry.name);
    const galleryDir = join(listingDir, "gallery");
    const manifestPath = join(listingDir, "manifest.json");
    if (!existsSync(galleryDir)) continue;

    const rasterFiles = readdirSync(galleryDir).filter((file) =>
      RASTER_EXTENSIONS.has(extname(file).toLowerCase()),
    );
    if (rasterFiles.length === 0) continue;

    let manifestText = existsSync(manifestPath)
      ? readFileSync(manifestPath, "utf8")
      : "";

    for (const file of rasterFiles) {
      const ext = extname(file);
      const srcRel = `gallery/${file}`;
      const webpRel = `gallery/${file.slice(0, -ext.length)}.webp`;
      const srcAbs = join(galleryDir, file);

      bytesIn += statSync(srcAbs).size;
      if (!DRY_RUN) {
        const webp = await sharp(srcAbs).webp({ quality: QUALITY }).toBuffer();
        writeFileSync(join(listingDir, webpRel), webp);
        rmSync(srcAbs);
        bytesOut += webp.length;
      }
      convertedImages++;

      if (manifestText.includes(srcRel)) {
        manifestText = manifestText.split(srcRel).join(webpRel);
      } else {
        unreferenced.push(`${assetType}/${entry.name}/${srcRel}`);
      }
    }

    if (manifestText && manifestText !== readFileSyncSafe(manifestPath)) {
      changedManifests++;
      // Re-parse to guarantee we did not corrupt the JSON before writing.
      JSON.parse(manifestText);
      if (!DRY_RUN) writeFileSync(manifestPath, manifestText);
    }
  }
}

function readFileSyncSafe(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

console.log(`${DRY_RUN ? "[dry-run] " : ""}WebP gallery migration (quality ${QUALITY})`);
console.log(`  images converted: ${convertedImages}`);
console.log(`  manifests rewritten: ${changedManifests}`);
if (!DRY_RUN) {
  console.log(
    `  raster ${(bytesIn / 1048576).toFixed(1)} MB -> webp ${(bytesOut / 1048576).toFixed(1)} MB ` +
      `(${(100 - (100 * bytesOut) / bytesIn).toFixed(0)}% smaller)`,
  );
} else {
  console.log(`  raster to convert: ${(bytesIn / 1048576).toFixed(1)} MB`);
}
if (unreferenced.length > 0) {
  console.log(`\n  ${unreferenced.length} converted files not referenced by their manifest (left as orphan .webp):`);
  for (const ref of unreferenced.slice(0, 20)) console.log(`    ${ref}`);
  if (unreferenced.length > 20) console.log(`    ... and ${unreferenced.length - 20} more`);
}
