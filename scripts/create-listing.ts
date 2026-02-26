import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

interface ModManifest {
  schema_version: number;
  id: string;
  name: string;
  author: string;
  github_id: number;
  description: string;
  tags: string[];
  gallery: string[];
  source: string;
  update: { type: "github"; repo: string } | { type: "custom"; url: string };
}

interface MapManifest extends ModManifest {
  city_code: string;
  country: string;
  population: number;
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  // Issue parser may return an array of strings or comma-separated string
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw !== "string") return [];
  // Handle checkbox markdown format: "- [X] tag\n- [x] tag"
  if (raw.includes("- [")) {
    return raw
      .split("\n")
      .filter((line) => line.startsWith("- [X]") || line.startsWith("- [x]"))
      .map((line) => line.replace(/^- \[[Xx]\]\s*/, "").trim())
      .filter(Boolean);
  }
  // Handle comma-separated: "tag1, tag2, tag3"
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

function parseGalleryImages(raw: string | undefined): string[] {
  if (!raw || raw === "_No response_") return [];
  // Extract image URLs from: ![alt](url), <img src="url">, or plain URLs
  const urls: string[] = [];
  for (const line of raw.split("\n")) {
    const mdMatch = line.match(/!\[.*?\]\((.*?)\)/);
    if (mdMatch) {
      urls.push(mdMatch[1]);
      continue;
    }
    const imgMatch = line.match(/<img\s[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch) {
      urls.push(imgMatch[1]);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("http")) {
      urls.push(trimmed);
    }
  }
  return urls;
}

function buildUpdate(data: Record<string, string>): ModManifest["update"] {
  if (data["update-type"] === "GitHub Releases") {
    return { type: "github", repo: data["github-repo"]! };
  }
  return { type: "custom", url: data["custom-update-url"]! };
}

async function resolveGalleryUrls(markdownUrls: string[]): Promise<string[]> {
  if (markdownUrls.length === 0) return [];

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const issueNumber = process.env.ISSUE_NUMBER;

  if (!token || !repo || !issueNumber) {
    console.warn("Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or ISSUE_NUMBER — cannot resolve private image URLs");
    return markdownUrls;
  }

  try {
    // Fetch the issue body as HTML — GitHub renders private repo images with
    // JWT-signed URLs at private-user-images.githubusercontent.com that can
    // be fetched without auth. The raw user-attachments/assets URLs 404 with
    // API tokens (GitHub confirmed no API access for these).
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.full+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!res.ok) {
      console.warn(`GitHub API returned ${res.status} when fetching issue HTML body`);
      return markdownUrls;
    }

    const data = await res.json();
    const html: string = data.body_html || "";

    // Extract image URLs from rendered HTML
    const imgUrls: string[] = [];
    const regex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      imgUrls.push(match[1].replaceAll("&amp;", "&"));
    }

    if (imgUrls.length > 0) {
      console.log(`Resolved ${imgUrls.length} image URL(s) from issue HTML body`);
      return imgUrls;
    }

    console.warn("No image URLs found in issue HTML body, falling back to markdown URLs");
  } catch (err) {
    console.warn(`Failed to resolve gallery URLs via API: ${err}`);
  }

  return markdownUrls;
}

async function downloadGalleryImages(urls: string[], galleryDir: string): Promise<string[]> {
  const paths: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to download image ${i + 1}: ${response.status}`);
        continue;
      }

      // Detect extension from Content-Type since JWT URLs lack file extensions
      const contentType = response.headers.get("content-type") || "";
      const extMap: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
      };
      const ext = extMap[contentType] || url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] || "png";
      const filename = `screenshot${i + 1}.${ext}`;
      const filePath = resolve(galleryDir, filename);

      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(filePath, buffer);
      paths.push(`gallery/${filename}`);
    } catch (err) {
      console.warn(`Failed to download image ${i + 1}: ${err}`);
    }
  }
  return paths;
}

async function main() {
  const type = process.env.LISTING_TYPE; // "mod" or "map"
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorId = process.env.ISSUE_AUTHOR_ID;
  const issueAuthorLogin = process.env.ISSUE_AUTHOR_LOGIN;

  if (!issueJson || !issueAuthorId || !issueAuthorLogin) {
    console.error("ISSUE_JSON, ISSUE_AUTHOR_ID, and ISSUE_AUTHOR_LOGIN are required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson);
  const id = type === "map" ? data["map-id"] : data["mod-id"];
  const dir = type === "map" ? "maps" : "mods";
  const listingDir = resolve(REPO_ROOT, dir, id);
  const galleryDir = resolve(listingDir, "gallery");

  mkdirSync(galleryDir, { recursive: true });

  // Download gallery images — resolve markdown URLs to JWT-signed URLs
  // via the GitHub API HTML body (required for private repo attachments)
  const imageUrls = parseGalleryImages(data.gallery);
  const resolvedUrls = await resolveGalleryUrls(imageUrls);
  const galleryPaths = await downloadGalleryImages(resolvedUrls, galleryDir);

  const tags = parseTags(data.tags);

  const manifest: ModManifest | MapManifest = {
    schema_version: 1,
    id,
    name: data.name,
    author: issueAuthorLogin,
    github_id: parseInt(issueAuthorId, 10),
    description: data.description,
    tags,
    gallery: galleryPaths,
    source: data.source,
    update: buildUpdate(data),
    ...(type === "map"
      ? {
          city_code: data["city-code"],
          country: data.country,
          population: parseInt(data.population, 10),
        }
      : {}),
  };

  writeFileSync(
    resolve(listingDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  console.log(`Created ${dir}/${id}/manifest.json`);
}

main();
