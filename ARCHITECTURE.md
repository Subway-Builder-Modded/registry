# The Railyard - Architecture

The Railyard is the central registry for **Subway Builder** community mods and custom maps. It stores metadata (manifests, gallery images) and points to external sources (GitHub releases, CDNs) for actual downloads and updates.

## Directory Structure

```
The-Railyard/
├── mods/
│   ├── index.json              # Registry of all mod IDs
│   └── <mod-id>/
│       ├── manifest.json       # Mod metadata + update pointer
│       └── gallery/
│           ├── screenshot1.png
│           └── screenshot2.png
├── maps/
│   ├── index.json              # Registry of all map IDs
│   └── <map-id>/
│       ├── manifest.json       # Map metadata + update pointer
│       └── gallery/
│           ├── thumbnail.png
│           └── screenshot1.png
├── ARCHITECTURE.md
└── README.md
```

---

## Mods

### `mods/index.json`

Top-level registry listing every mod by ID.

```json
{
  "schema_version": 1,
  "mods": ["mod-id", "another-mod"]
}
```

### `mods/<mod-id>/manifest.json`

```json
{
  "schema_version": 1,
  "id": "mod-id",
  "name": "Better Trains",
  "author": "SomeModder",
  "description": "Adds realistic train models and sounds.",
  "tags": ["vehicles", "cosmetic"],
  "gallery": ["gallery/screenshot1.png", "gallery/screenshot2.png"],
  "source": "https://github.com/somemodder/better-trains",
  "update": {
    "type": "github",
    "repo": "somemodder/better-trains"
  }
}
```

| Field            | Type       | Description                                                          |
| ---------------- | ---------- | -------------------------------------------------------------------- |
| `schema_version` | `number`   | Schema version for forward compatibility. Currently `1`.             |
| `id`             | `string`   | Unique mod identifier. Must match the directory name.                |
| `name`           | `string`   | Human-readable display name.                                         |
| `author`         | `string`   | Mod author's name or handle.                                         |
| `description`    | `string`   | Short description of what the mod does.                              |
| `tags`           | `string[]` | Categorization tags (e.g. `"vehicles"`, `"cosmetic"`, `"gameplay"`). |
| `gallery`        | `string[]` | Relative paths to gallery images within the mod directory.           |
| `source`         | `string`   | URL to the mod's source code or homepage.                            |
| `update`         | `object`   | Update source configuration (see below).                             |

### Update Types

#### GitHub Releases

The mod manager fetches directly from `https://api.github.com/repos/{repo}/releases`.

```json
"update": {
  "type": "github",
  "repo": "somemodder/better-trains"
}
```

#### Custom URL

Points to a self-hosted `update.json` file maintained by the mod author.

```json
"update": {
  "type": "custom",
  "url": "https://example.com/better-trains/update.json"
}
```

### Custom `update.json` Format

```json
{
  "schema_version": 1,
  "versions": [
    {
      "version": "1.2.0",
      "game_version": ">=2.1.0",
      "date": "2026-02-20",
      "changelog": "Added new express train model.",
      "download": "https://example.com/better-trains/releases/v1.2.0.zip",
      "sha256": "a1b2c3d4..."
    },
    {
      "version": "1.1.0",
      "game_version": ">=2.0.0",
      "date": "2026-01-15",
      "changelog": "Initial public release.",
      "download": "https://example.com/better-trains/releases/v1.1.0.zip",
      "sha256": "e5f6a7b8..."
    }
  ]
}
```

| Field          | Type     | Description                                         |
| -------------- | -------- | --------------------------------------------------- |
| `version`      | `string` | Semver version string.                              |
| `game_version` | `string` | Semver range for game compatibility filtering.      |
| `date`         | `string` | Release date (ISO 8601).                            |
| `changelog`    | `string` | Human-readable changelog entry.                     |
| `download`     | `string` | Direct download URL for the release ZIP.            |
| `sha256`       | `string` | SHA-256 hash of the ZIP for integrity verification. |

---

## Maps

### `maps/index.json`

Top-level registry listing every map by ID.

```json
{
  "schema_version": 1,
  "maps": ["raleigh", "dublin", "toronto"]
}
```

### `maps/<map-id>/manifest.json`

```json
{
  "schema_version": 1,
  "id": "raleigh",
  "name": "Raleigh",
  "author": "muffintime",
  "city_code": "RDU",
  "country": "US",
  "population": 1500000,
  "description": "Custom map of the Raleigh metropolitan area.",
  "tags": ["north-america", "medium-city"],
  "gallery": ["gallery/thumbnail.png", "gallery/screenshot1.png"],
  "source": "https://github.com/muffintime/sb-raleigh",
  "update": {
    "type": "github",
    "repo": "muffintime/sb-raleigh"
  }
}
```

Maps share all fields from the mod manifest, plus three map-specific fields:

| Field        | Type     | Description                                                                                         |
| ------------ | -------- | --------------------------------------------------------------------------------------------------- |
| `city_code`  | `string` | 2-4 letter IATA/ICAO city code used by the game internally. Must not clash with vanilla city codes. |
| `country`    | `string` | ISO 3166-1 alpha-2 country code. Used to sort maps into country tabs in the mod manager UI.         |
| `population` | `number` | Metropolitan area population. Used for display and sorting without needing to download the map.     |

### Update Types

Identical to mods. Both `github` and `custom` types work the same way.

### Map Download ZIP Format

The download ZIP must follow [Kronifer's Map Manager](https://github.com/Subway-Builder-Modded/subwaybuilder-patcher/releases) format. Files must be at the root of the ZIP, not nested in a subfolder:

```
map-name.zip
├── config.json
├── demand_data.json
├── buildings_index.json
├── roads.geojson
├── runways_taxiways.geojson
└── XXX.pmtiles              (XXX = city code)
```

### Map Tags

Suggested tag vocabulary:

- **Region:** `north-america`, `europe`, `asia`, `oceania`, `south-america`, `africa`
- **Size:** `small-city` (<500K), `medium-city` (500K-2M), `large-city` (2M+)
- **Data quality:** `good-data`, `ok-data`, `limited-data`
- **Features:** `universities`, `airports`, `entertainment`

## Design Principles

- **Metadata only in this repo.** Actual mod/map binaries live on GitHub Releases, CDNs, or other file hosts. This keeps the repo lightweight.
- **Unified schema.** Mods and maps share the same update mechanism (`github` or `custom`), so the mod manager uses one code path for fetching and updating both.
- **Manifest = storefront, ZIP = runtime.** The manifest contains browsing/discovery metadata. The ZIP's internal `config.json` is the source of truth for game-facing configuration. Some fields (like `population`, `country`) are intentionally duplicated so the mod manager can display information before download.
- **Integrity verification.** `sha256` hashes in custom update files allow the mod manager to verify downloads. GitHub releases rely on GitHub's own integrity guarantees.
- **Compatibility filtering.** `game_version` semver ranges let the mod manager hide incompatible versions from users.
