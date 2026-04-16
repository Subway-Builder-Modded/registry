import fs from 'fs';
import { pathToFileURL } from 'url';
import { loadAuthorAliasIndex, resolveAuthorPresentation } from './lib/author-aliases.js';
import { resolveRepoRoot } from './lib/script-runtime.js';

const CONTENT_ANNOUNCEMENTS_ROLE_ID = '1492005223680446567';
const MAX_ANNOUNCEMENT_DESCRIPTION_LENGTH = 350;
const ANNOUNCEMENT_REQUEST_DELAY_MS = 750;
const MAX_ANNOUNCEMENT_429_RETRIES = 5;

const BASE_ANNOUNCEMENT = `# New $TYPE! 🎉🎉

## $NAME ($AUTHOR)

$DESCRIPTION

See more [here](https://subwaybuildermodded.com/railyard/$TYPE_LOWER/$NAME_LOWER).`

const ALLOWED_MENTIONS = {
    parse: [],
    roles: [CONTENT_ANNOUNCEMENTS_ROLE_ID],
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const retryAfter = (payload as { retry_after?: unknown }).retry_after;
    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter < 0) {
        return null;
    }
    if (retryAfter > 1000) {
        return Math.ceil(retryAfter);
    }
    return Math.ceil(retryAfter * 1000);
}

async function sendAnnouncementRequest(webhookUrl: string, init: RequestInit): Promise<void> {
    for (let attempt = 0; attempt <= MAX_ANNOUNCEMENT_429_RETRIES; attempt += 1) {
        const response = await fetch(webhookUrl, init);
        if (response.status !== 429) {
            if (!response.ok) {
                const responseText = await response.text();
                throw new Error(`Failed to send announcement (${response.status} ${response.statusText}): ${responseText}`);
            }
            await sleep(ANNOUNCEMENT_REQUEST_DELAY_MS);
            return;
        }

        let retryAfterMs = 5000;
        try {
            retryAfterMs = parseRetryAfterMs(await response.json()) ?? retryAfterMs;
        } catch {
            const retryAfterHeader = response.headers.get('retry-after');
            const parsedRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
            if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0) {
                retryAfterMs = parsedRetryAfter > 1000
                    ? Math.ceil(parsedRetryAfter)
                    : Math.ceil(parsedRetryAfter * 1000);
            }
        }

        if (attempt === MAX_ANNOUNCEMENT_429_RETRIES) {
            throw new Error(`Failed to send announcement: Discord webhook kept returning HTTP 429 after ${MAX_ANNOUNCEMENT_429_RETRIES + 1} attempts.`);
        }

        console.warn(
            `[announcement] Discord webhook rate limited; retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${MAX_ANNOUNCEMENT_429_RETRIES})`,
        );
        await sleep(retryAfterMs + ANNOUNCEMENT_REQUEST_DELAY_MS);
    }
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function truncateWithDots(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    if (maxLength <= 2) {
        return '..'.slice(0, maxLength);
    }
    return `${value.slice(0, maxLength - 2).trimEnd()}..`;
}

function formatDescriptionForDiscord(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const text = decodeHtmlEntities(
        value
            .replace(/\r\n/g, '\n')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]*)`/g, '$1')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/^\s{0,3}#{1,6}\s+.*$/gm, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(?:p|div|li|tr|td|th|details|summary|table|ul|ol|h[1-6])[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    );

    const paragraphs = text
        .split(/\n\s*\n+/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
        .filter((paragraph) => paragraph !== '')
        .filter((paragraph) => !/^(coverage|population summary|map statistics|special demand|additional features|methodology|data sources|license|credits)\b/i.test(paragraph));

    const summaryParts: string[] = [];
    for (const paragraph of paragraphs) {
        summaryParts.push(paragraph);
        if (summaryParts.length >= 2 || summaryParts.join(' ').length >= MAX_ANNOUNCEMENT_DESCRIPTION_LENGTH) {
            break;
        }
    }

    const summary = summaryParts.join(' ').trim();
    return truncateWithDots(summary, MAX_ANNOUNCEMENT_DESCRIPTION_LENGTH);
}

export async function makeAnnouncement(filename: string) {
    const manifestContent = fs.readFileSync(filename, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    if (manifest.is_test === true) {
        console.log('Skipping announcement for test listing.');
        return;
    }
    const modName = manifest.name?.trim();
    const modId = manifest.id?.trim();
    const modAuthor = manifest.author?.trim();
    const modGithubId = typeof manifest.github_id === 'number' && Number.isFinite(manifest.github_id)
        ? manifest.github_id
        : null;
    const modDescription = formatDescriptionForDiscord(manifest.description);
    const modType = filename.includes("maps") ? "Map" : "Mod";
    const images = manifest.gallery;
    const webhookUrl = process.env.DISCORD_ANNOUNCEMENT_WEBHOOK_URL?.trim();
    const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
    const authorAliases = loadAuthorAliasIndex(repoRoot);
    const authorPresentation = modAuthor
        ? resolveAuthorPresentation(modAuthor, modGithubId, authorAliases)
        : null;
    const announcementAuthor = authorPresentation?.attribution_link
        ? `[${authorPresentation.author_alias}](${authorPresentation.attribution_link})`
        : authorPresentation?.author_alias ?? modAuthor;

    if (!modId || !announcementAuthor || !modDescription || !modType || !webhookUrl) {
        throw new Error('Missing required environment variables. Please set MOD_ID, MOD_AUTHOR, MOD_DESCRIPTION, MOD_TYPE, and DISCORD_WEBHOOK_URL.');
    }

    const announcement = BASE_ANNOUNCEMENT
        .replace('$TYPE', modType)
        .replace('$NAME', modName || modId)
        .replace('$AUTHOR', announcementAuthor)
        .replace('$DESCRIPTION', modDescription)
        .replace('$TYPE_LOWER', modType.toLowerCase() + 's')
        .replace('$NAME_LOWER', modId.toLowerCase());
    const announcementWithMention = `<@&${CONTENT_ANNOUNCEMENTS_ROLE_ID}>\n${announcement}`;

    if (images.length === 0) {
        await sendAnnouncementRequest(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: announcementWithMention,
                allowed_mentions: ALLOWED_MENTIONS,
            }),
        });
        return;
    }

    const formdata = new FormData();
    formdata.append('payload_json', JSON.stringify({
        content: announcementWithMention,
        allowed_mentions: ALLOWED_MENTIONS,
    }));

    const imageBlobs = await Promise.all(images.map(async (imageUrl: string, index: number) => {
        const imageResponse = await fetch(`https://raw.githubusercontent.com/Subway-Builder-Modded/registry/refs/heads/main/${modType.toLowerCase()}s/${modId}/${imageUrl}`);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image ${index + 1} (${imageUrl}): HTTP ${imageResponse.status}`);
        }
        return imageResponse.blob();
    }));

    imageBlobs.forEach((blob, index) => {
        formdata.append(`file[${index}]`, blob, `image${index}.png`);
    });

    await sendAnnouncementRequest(webhookUrl, {
        method: 'POST',
        body: formdata,
    });
}

function parseCliArgs(argv: string[]): { filename: string } {
    let filename: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--") {
            continue;
        }
        if (arg === "--filename") {
            filename = argv[index + 1];
            if (!filename || filename.startsWith("-")) {
                throw new Error(`Missing filename value after '${arg}'`);
            }
            filename = filename.trim();
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument '${arg}'. Supported flags: --filename <filename>.`);
    }

    if (!filename) {
        throw new Error('Missing filename. Please provide a filename using --filename.');
    }

    return { filename };
}

async function run() {
    try {
        const { filename } = parseCliArgs(process.argv.slice(2));
        await makeAnnouncement(filename);
        console.log('Announcement sent successfully!');
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    run();
}
