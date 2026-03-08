import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MIN_SCREENSHOT_SIZE = 5 * 1024; // 5KB — badges/icons are typically smaller

/**
 * Convert GitHub `/blob/` URLs to `/raw/` URLs so they return the actual file
 * content instead of an HTML page.
 */
export function normalizeGitHubUrl(url: string): string {
  const blobMatch = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/
  );
  if (blobMatch) {
    return `https://github.com/${blobMatch[1]}/raw/${blobMatch[2]}`;
  }
  return url;
}

/**
 * Extract image URLs from the gallery form field. Supports:
 * - Markdown image syntax: ![alt](url)
 * - HTML img tags: <img src="url">
 * - Plain URLs (one per line)
 */
export function parseGalleryImages(raw: string | undefined): string[] {
  if (!raw || raw === "_No response_") return [];
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

/**
 * Resolve gallery image URLs via the GitHub API HTML body.
 *
 * GitHub-hosted user-attachment URLs (private-user-images) require JWT-signed
 * URLs that are only available in the rendered HTML body. This function fetches
 * the issue HTML, extracts image URLs from the **Gallery Images** section only
 * (to avoid picking up badge/icon images embedded in the description), and
 * returns them.
 *
 * Falls back to the original markdown URLs if resolution fails or finds nothing.
 */
export async function resolveGalleryUrls(
  markdownUrls: string[]
): Promise<string[]> {
  if (markdownUrls.length === 0) return [];

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const issueNumber = process.env.ISSUE_NUMBER;

  if (!token || !repo || !issueNumber) {
    console.warn(
      "Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or ISSUE_NUMBER — cannot resolve private image URLs"
    );
    return markdownUrls.map(normalizeGitHubUrl);
  }

  try {
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
      console.warn(
        `GitHub API returned ${res.status} when fetching issue HTML body`
      );
      return markdownUrls.map(normalizeGitHubUrl);
    }

    const data = await res.json();
    const html: string = data.body_html || "";

    // Only extract images from the "Gallery Images" section of the issue body,
    // not the entire HTML (which may include badge/icon images from the
    // description field).
    const gallerySectionMatch = html.match(
      /Gallery Images<\/h[23]>([\s\S]*?)(?=<h[23]|$)/i
    );
    const galleryHtml = gallerySectionMatch ? gallerySectionMatch[1] : "";

    const imgUrls: string[] = [];
    const regex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = regex.exec(galleryHtml)) !== null) {
      imgUrls.push(match[1].replaceAll("&amp;", "&"));
    }

    if (imgUrls.length > 0) {
      console.log(
        `Resolved ${imgUrls.length} image URL(s) from gallery section of issue HTML body`
      );
      return imgUrls;
    }

    console.warn(
      "No image URLs found in gallery section of issue HTML body, falling back to markdown URLs"
    );
  } catch (err) {
    console.warn(`Failed to resolve gallery URLs via API: ${err}`);
  }

  return markdownUrls.map(normalizeGitHubUrl);
}

/**
 * Download gallery images to disk.
 *
 * Skips SVG images (likely badges) and images smaller than MIN_SCREENSHOT_SIZE
 * (likely icons/badges rather than actual screenshots).
 */
export async function downloadGalleryImages(
  urls: string[],
  galleryDir: string
): Promise<string[]> {
  mkdirSync(galleryDir, { recursive: true });
  const paths: string[] = [];
  let screenshotIndex = 1;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to download image ${i + 1}: ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";

      // Skip SVGs — these are almost certainly badges/icons, not screenshots
      if (contentType.includes("svg")) {
        console.warn(
          `Skipping image ${i + 1}: SVG content-type (likely a badge/icon)`
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Skip very small images (badges, icons)
      if (buffer.length < MIN_SCREENSHOT_SIZE) {
        console.warn(
          `Skipping image ${i + 1}: too small (${buffer.length} bytes, likely a badge/icon)`
        );
        continue;
      }

      const extMap: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
      };
      const ext =
        extMap[contentType] ||
        url.match(/\.(png|jpg|jpeg|gif|webp)/i)?.[1] ||
        "png";
      const filename = `screenshot${screenshotIndex}.${ext}`;
      const filePath = resolve(galleryDir, filename);

      writeFileSync(filePath, buffer);
      paths.push(`gallery/${filename}`);
      screenshotIndex++;
    } catch (err) {
      console.warn(`Failed to download image ${i + 1}: ${err}`);
    }
  }
  return paths;
}
