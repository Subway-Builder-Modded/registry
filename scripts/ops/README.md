# scripts/ops

Manual operational tooling — nothing here runs in scheduled automation.
Invoke via the package scripts in `scripts/package.json` (names unchanged from
when these lived at the top level), e.g. `pnpm --dir scripts run audit-download-history`.

- `audit-download-history.ts` — verify download-history snapshots for consistency.
- `rebuild-download-history-from-git.ts` / `rebuild-download-version-buckets.ts` —
  deterministic rebuilds from git history; part of the 429-cascade recovery playbook.
- `backfill-download-attribution.ts` — step 1 of the canonical consistency suite
  (see README "Canonical consistency suite").
- `spotcheck-attribution-logs.ts` — attribution log diagnostics.
- `create-manual-download-attribution.ts` — the manual download-correction path.
- `audit-shared-map-attribution.ts` + `export-shared-map-attribution-audit.sh` —
  parameterized shared-pack attribution audits.
- `backfill-website-analytics.ts` — refetch missed hourly Cloudflare snapshots
  (worker/capture outage gap-filler).
- `backfill-data-quality.ts` — seven-tier data-quality backfill; retained until the
  migration is confirmed to need no reruns.

One-time migrations that already ran are deleted rather than kept here — git
history is the archive (see tmp/plans/registry-downsizing-audit.md for the list).
