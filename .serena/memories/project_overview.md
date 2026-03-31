# The-Railyard project overview
- Purpose: repository for The Railyard registry data, download history, analytics CSV generation, integrity/security checks, and related automation.
- Stack: TypeScript/Node.js scripts in `scripts/`; GitHub Actions workflows in `.github/workflows`; JSON/CSV registry and analytics artifacts under repo root.
- Key runtime areas: `scripts/lib/*.ts` for reusable logic, `scripts/tests/*.ts` for `node:test` coverage, top-level `maps/`, `mods/`, `history/`, `analytics/`, `authors/` for repo data.
- Important analytics entrypoints: `scripts/generate-analytics.ts` -> `scripts/lib/analytics-core.ts`; `scripts/generate-railyard-app-analytics.ts` for app download analytics.
- Scheduled automation: cache/history and analytics workflows in `.github/workflows`, notably `cache-download-history.yml` and `regenerate-registry-analytics.yml`.