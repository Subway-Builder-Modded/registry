# Subway Builder Modded Registry
![image0](https://github.com/user-attachments/assets/b0659a85-ac6a-40cf-9cd3-bb9dcb99f6a4)

The central registry for all **Subway Builder Modded** community created content.

> [!WARNING]
> **Work in Progress** - Railyard and the registry are still under active development. Expect changes to the submission process, schema, and tooling.

## Submit Your Work

All submissions are handled through GitHub Issues. Pick a template to get started:

- [Publish a New Mod](https://github.com/Subway-Builder-Modded/registry/issues/new?template=publish-mod.yml)
- [Publish a New Map](https://github.com/Subway-Builder-Modded/registry/issues/new?template=publish-map.yml)
- [Update an Existing Mod](https://github.com/Subway-Builder-Modded/registry/issues/new?template=update-mod.yml)
- [Update an Existing Map](https://github.com/Subway-Builder-Modded/registry/issues/new?template=update-map.yml)
- [Update Your Author Profile](https://github.com/Subway-Builder-Modded/registry/issues/new?template=update-author.yml)
- [Report an Issue](https://github.com/Subway-Builder-Modded/registry/issues/new?template=report.yml)

## How It Works

The registry stores metadata only - manifests, gallery images, and pointers to where your mod or map is actually hosted (GitHub Releases, CDNs, etc.). When you submit through an issue template, CI validates your submission and opens a PR automatically. Once merged, your listing goes live.

## Map Issue Templates

`publish-map.yml` and `update-map.yml` are generated from a shared script:

- Generate both templates:
  - `pnpm --dir scripts run generate:map-templates`
- Verify templates are up to date:
  - `pnpm --dir scripts run check:map-templates`

## Registry Analytics

Download and release-integrity snapshots are generated into:

- `maps/downloads.json`
- `mods/downloads.json`
- `maps/integrity.json`
- `mods/integrity.json`

Local commands:

- Generate full registry analytics (downloads + integrity):
  - `pnpm --dir scripts run generate-registry-analytics`
- Generate maps only:
  - `pnpm --dir scripts run generate-registry-analytics:maps`
- Generate mods only:
  - `pnpm --dir scripts run generate-registry-analytics:mods`
- Generate maps only (download-only mode):
  - `pnpm --dir scripts run generate-downloads:maps:download-only`
- Generate mods only (download-only mode):
  - `pnpm --dir scripts run generate-downloads:mods:download-only`
- Generate map demand stats only:
  - `pnpm --dir scripts run generate-registry-demand-stats`
- Sync map manifest `file_sizes` from latest complete integrity versions:
  - `pnpm --dir scripts run sync-map-file-sizes`

Integrity behavior:

- Only semver versions (`vX.Y.Z` or `X.Y.Z`) are eligible for download counting.
- Versions that fail integrity checks are excluded from `downloads.json`.
- Non-semver versions are still recorded in `integrity.json` as incomplete.

Automation:

- `regenerate-downloads-hourly.yml` runs hourly in download-only mode (updates downloads only; no ZIP integrity pass).
- `regenerate-registry-analytics.yml` runs every 3 hours in full mode (refreshes downloads + integrity + integrity cache, map demand stats, and syncs map manifest `file_sizes` from integrity).
- Full mode posts two Discord summaries (downloads/integrity and map demand stats) to the same webhook secret: `DISCORD_WEBHOOK_URL`.

## Security

Mod security scanning runs inside the full integrity pass and is contributor-configurable.

Configuration:

- Rules live at `security-rules.json` in the repository root.
- Each rule has:
  - `id` (stable identifier)
  - `severity` (`ERROR` or `WARNING`)
  - `type` (`literal`, `regex`, or `ast`)
  - `pattern` (string for `literal`/`regex`, object for `ast`)
  - optional `description`, `enabled`

Current enforcement model:

- The scanner inspects all `.js` and `.ts` files inside each mod ZIP.
- `ERROR` findings hard-fail version completeness (`is_complete=false`), so those versions are excluded from `mods/downloads.json`.
- `WARNING` findings are recorded but do not block completeness.
- Security findings are written to `mods/integrity.json` and cached in `mods/integrity-cache.json` under `security_issue.findings`.
- Full analytics posts separate Discord alerts for security `ERROR` (red) and `WARNING` (yellow/orange).

AST rule support:

- `call-arg-call`: match calls like `eval(atob(...))`.
- `call-in-while`: match configured calls inside `while` loops, with optional alias resolution (`allow_aliases: true`).

Fixtures and validation:

- Rule fixtures live under `scripts/tests/fixtures/security-rules/<rule-id>/`.
- Each enabled rule must have a matching folder with at least one `.js` fixture that triggers it.
- You can add multiple fixtures per rule (for example alias and non-alias variants).

Commands:

- Run focused security-rule fixture validation:
  - `pnpm --dir scripts run test:security-rules`
- Run full scripts test suite:
  - `pnpm --dir scripts run test`
- Force a fresh mod integrity/security evaluation (ignore cache):
  - `pnpm --dir scripts run generate-registry-analytics:mods -- --force`

How to add a new security rule:

1. Add the rule to `security-rules.json` (with `enabled: true` when ready).
2. Create `scripts/tests/fixtures/security-rules/<rule-id>/` and add one or more offending `.js` fixtures.
3. Run `pnpm --dir scripts run test:security-rules` and confirm all fixture checks pass.
4. Run a full mod integrity pass (`generate-registry-analytics:mods -- --force`) to verify runtime behavior.

## Download History

Daily combined download snapshots are cached under:

- `history/snapshot_YYYY_MM_DD.json`

Each snapshot includes:

- `maps` and `mods` sections
- embedded current `downloads` and `index` payloads
- canonical `raw_downloads` baseline (or legacy fallback to historical `downloads` when `raw_downloads` is absent)
- canonical `attributed_downloads` from strict source-key attribution matching
- adjusted `downloads = max(0, raw_downloads - attributed_downloads)`
- `total_downloads`
- `net_downloads` versus the previous snapshot (or total on first snapshot)
- `entries` count from the corresponding `index.json`

Local command:

- Generate/update today’s history snapshot:
  - `pnpm --dir scripts run generate-download-history`

- Canonical consistency suite (deterministic historical rebuild):
  1. `pnpm --dir scripts run backfill-download-attribution -- --days 90 --rebuild-ledger`
  2. `pnpm --dir scripts run generate-download-history -- --backfill`
  3. `pnpm --dir scripts run analytics`

Backfill normalization uses a fixed historical attribution cutoff of `04:00:00 UTC` for each snapshot date.

Shared-pack attribution audit:

- Export an attribution audit bundle under `tmp/shared-map-attribution-audit/`:
  - `bash scripts/export-shared-map-attribution-audit.sh 2026_03_30`
- Audit JP shared-pack listings by prefix:
  - `pnpm --dir scripts run audit-shared-map-attribution -- --snapshot-date 2026_03_30 --listing-prefix yukina-`
- Audit a shared pack by exact source repo:
  - `pnpm --dir scripts run audit-shared-map-attribution -- --snapshot-date 2026_03_30 --repo rslurry/subwaybuilder-maps`
  - `pnpm --dir scripts run audit-shared-map-attribution -- --snapshot-date 2026_03_30 --repo maximilian284/subwaybuilder-it-maps`
- Audit a single listing:
  - `pnpm --dir scripts run audit-shared-map-attribution -- --snapshot-date 2026_03_30 --listing-id yukina-osaka`

The audit writes:

- `tmp/shared-map-attribution-audit/results/shared-map-attribution-audit.json`
- `tmp/shared-map-attribution-audit/results/shared-map-attribution-audit.csv`

It compares snapshot attribution against the exact `repo/tag/asset_name` stored in `maps/integrity.json`, which is especially useful for shared custom repos where listing version and release tag differ.

Automation:

- `cache-download-history.yml` runs daily (and on manual dispatch), commits `history/snapshot_YYYY_MM_DD.json`, and posts summary stats to Discord.

Separate Railyard app download analytics:

- Capture hourly `Subway-Builder-Modded/railyard` release download history:
  - `pnpm --dir scripts run capture-railyard-app-downloads`
- Generate app download analytics artifacts:
  - `pnpm --dir scripts run generate-railyard-app-analytics`

The hourly workflow writes:

- `history/railyard_app_downloads.json`
- `analytics/railyard_app_downloads.json`
- `analytics/railyard_app_downloads.csv`

## Map Demand Stats

Map manifests now support auto-derived demand metrics from map ZIPs:

- `population` (auto-derived from residents total, kept for backwards compatibility)
- `residents_total`
- `points_count`
- `population_count`
- `maps/<map-id>/grid.geojson` (generated demand grid artifact committed by the registry analytics workflow)
- `file_sizes` (synced from integrity for the latest complete semver version)

The demand-stats cache at `maps/demand-stats-cache.json` is schema-versioned. Grid algorithm changes should bump the grid schema version so the next registry analytics run regenerates cached grids.

Local command:

- Generate/refresh map demand stats:
  - `pnpm --dir scripts run generate-registry-demand-stats`
  - (alias) `pnpm --dir scripts run generate-map-demand-stats`
  - Force refresh all maps (ignore SHA/cache skip):
    - `pnpm --dir scripts run generate-registry-demand-stats -- --force`
  - Refresh one map by id:
    - `pnpm --dir scripts run generate-registry-demand-stats -- --id <map-id>`

For technical details, see [ARCHITECTURE.md](ARCHITECTURE.md).
