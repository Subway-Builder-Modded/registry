import fs from 'fs';
import { pathToFileURL } from 'url';

const BASE_ANNOUNCEMENT = `# New $TYPE! 🎉🎉

## $NAME ($AUTHOR)

*$DESCRIPTION*

See more [here](https://subwaybuildermodded.com/railyard/$TYPE_LOWER/$NAME_LOWER).`

export async function makeAnnouncement(filename: string) {
    const manifestContent = fs.readFileSync(`../${filename}`, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    const modName = manifest.name?.trim();
    const modId = manifest.id?.trim();
    const modAuthor = manifest.author?.trim();
    const modDescription = manifest.description?.trim();
    const modType = filename.includes("maps") ? "Map" : "Mod";
    const images = manifest.gallery;
    const webhookUrl = process.env.DISCORD_ANNOUNCEMENT_WEBHOOK_URL?.trim();

    if (!modId || !modAuthor || !modDescription || !modType || !webhookUrl) {
        throw new Error('Missing required environment variables. Please set MOD_ID, MOD_AUTHOR, MOD_DESCRIPTION, MOD_TYPE, and DISCORD_WEBHOOK_URL.');
    }

    const announcement = BASE_ANNOUNCEMENT
        .replace('$TYPE', modType)
        .replace('$NAME', modName || modId)
        .replace('$AUTHOR', modAuthor)
        .replace('$DESCRIPTION', modDescription)
        .replace('$TYPE_LOWER', modType.toLowerCase() + 's')
        .replace('$NAME_LOWER', modId.toLowerCase());

    if (images.length === 0) {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: announcement }),
        });

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`Failed to send announcement (${response.status} ${response.statusText}): ${responseText}`);
        }
        return;
    }

    const formdata = new FormData();
    formdata.append('payload_json', JSON.stringify({ content: announcement }));

    const imageBlobs = await Promise.all(images.map(async (imageUrl: string, index: number) => {
        const imageResponse = await fetch(`https://raw.githubusercontent.com/Subway-Builder-Modded/The-Railyard/refs/heads/main/${modType.toLowerCase()}s/${modId}/${imageUrl}`);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image ${index + 1} (${imageUrl}): HTTP ${imageResponse.status}`);
        }
        return imageResponse.blob();
    }));

    imageBlobs.forEach((blob, index) => {
        formdata.append(`file[${index}]`, blob, `image${index}.png`);
    });

    const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formdata,
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Failed to send announcement (${response.status} ${response.statusText}): ${responseText}`);
    }
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