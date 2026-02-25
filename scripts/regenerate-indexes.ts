import { readdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function getListingIds(dir: string): string[] {
  const fullPath = resolve(REPO_ROOT, dir);
  if (!existsSync(fullPath)) return [];

  return readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const manifestPath = resolve(fullPath, entry.name, "manifest.json");
      return existsSync(manifestPath);
    })
    .map((entry) => entry.name)
    .sort();
}

function writeIndex(dir: string, key: string, ids: string[]) {
  const indexPath = resolve(REPO_ROOT, dir, "index.json");
  const content = JSON.stringify({ schema_version: 1, [key]: ids }, null, 2) + "\n";

  // Only write if changed
  if (existsSync(indexPath)) {
    const current = readFileSync(indexPath, "utf-8");
    if (current === content) {
      console.log(`${dir}/index.json is already up to date.`);
      return false;
    }
  }

  writeFileSync(indexPath, content);
  console.log(`Updated ${dir}/index.json with ${ids.length} entries.`);
  return true;
}

function main() {
  let changed = false;

  const modIds = getListingIds("mods");
  if (writeIndex("mods", "mods", modIds)) changed = true;

  const mapIds = getListingIds("maps");
  if (writeIndex("maps", "maps", mapIds)) changed = true;

  if (!changed) {
    console.log("No changes needed.");
  }
}

main();
