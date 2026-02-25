import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function parseCheckedBoxes(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const checked = raw
    .split("\n")
    .filter((line) => line.startsWith("- [X]") || line.startsWith("- [x]"))
    .map((line) => line.replace(/^- \[[Xx]\]\s*/, "").trim())
    .filter(Boolean);
  // Return null if nothing was checked (user wants to keep current tags)
  return checked.length > 0 ? checked : null;
}

function parseGalleryImages(raw: string | undefined): string[] | null {
  if (!raw || raw === "_No response_") return null;
  const urls: string[] = [];
  for (const line of raw.split("\n")) {
    const mdMatch = line.match(/!\[.*?\]\((.*?)\)/);
    if (mdMatch) {
      urls.push(mdMatch[1]);
    } else {
      const trimmed = line.trim();
      if (trimmed.startsWith("http")) {
        urls.push(trimmed);
      }
    }
  }
  return urls.length > 0 ? urls : null;
}

async function downloadGalleryImages(urls: string[], galleryDir: string): Promise<string[]> {
  mkdirSync(galleryDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] ?? "png";
    const filename = `screenshot${i + 1}.${ext}`;
    const filePath = resolve(galleryDir, filename);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to download ${url}: ${response.status}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(filePath, buffer);
      paths.push(`gallery/${filename}`);
    } catch (err) {
      console.warn(`Failed to download ${url}: ${err}`);
    }
  }
  return paths;
}

function isPresent(value: string | undefined): value is string {
  return !!value && value !== "_No response_" && value !== "None" && value !== "No change";
}

async function main() {
  const type = process.env.LISTING_TYPE; // "mod" or "map"
  const issueJson = process.env.ISSUE_JSON;

  if (!issueJson) {
    console.error("ISSUE_JSON environment variable is required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson);
  const id = type === "map" ? data["map-id"] : data["mod-id"];
  const dir = type === "map" ? "maps" : "mods";
  const manifestPath = resolve(REPO_ROOT, dir, id, "manifest.json");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // Update only provided fields
  if (isPresent(data.name)) manifest.name = data.name;
  if (isPresent(data.description)) manifest.description = data.description;
  if (isPresent(data.source)) manifest.source = data.source;

  const newTags = parseCheckedBoxes(data.tags);
  if (newTags) manifest.tags = newTags;

  // Update type
  if (isPresent(data["update-type"])) {
    if (data["update-type"] === "GitHub Releases" && isPresent(data["github-repo"])) {
      manifest.update = { type: "github", repo: data["github-repo"] };
    } else if (data["update-type"] === "Custom URL" && isPresent(data["custom-update-url"])) {
      manifest.update = { type: "custom", url: data["custom-update-url"] };
    }
  } else {
    // Update type not changing, but repo/url might be updated
    if (manifest.update.type === "github" && isPresent(data["github-repo"])) {
      manifest.update.repo = data["github-repo"];
    }
    if (manifest.update.type === "custom" && isPresent(data["custom-update-url"])) {
      manifest.update.url = data["custom-update-url"];
    }
  }

  // Map-specific fields
  if (type === "map") {
    if (isPresent(data["city-code"])) manifest.city_code = data["city-code"];
    if (isPresent(data.country)) manifest.country = data.country;
    if (isPresent(data.population)) manifest.population = parseInt(data.population, 10);
  }

  // Gallery images
  const galleryUrls = parseGalleryImages(data.gallery);
  if (galleryUrls) {
    const galleryDir = resolve(REPO_ROOT, dir, id, "gallery");
    manifest.gallery = await downloadGalleryImages(galleryUrls, galleryDir);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Updated ${dir}/${id}/manifest.json`);
}

main();
