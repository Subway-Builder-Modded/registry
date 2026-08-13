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
  Applied specs are committed under `history/manual-attribution-specs/`;
  application is idempotent (`applied_delta_ids`), so **after any
  attribution-ledger rebuild, re-apply every committed spec**.
- `repair-loop-inflated-downloads.ts` — spec-driven, re-runnable repair for client
  re-download loops (excess over a baseline/superseded-peer/peer-adoption organic
  allowance → per-day attribution deltas + snapshot clamp + bucket-ceiling
  lowering). Specs live under
  `history/loop-repair-specs/`; like manual-attribution specs, **re-apply after any
  attribution-ledger rebuild**. See KNOWN_INCIDENTS.md 2026-08 French-city entry.
- `backfill-charleston-snapshot-clamp.ts` — one-shot snapshot re-interpolation
  for the charleston-huntington-wv faulty-client inflation (KNOWN_INCIDENTS.md,
  2026-07 entry). Retained because **any snapshot rebuild from git
  (`rebuild-download-history-from-git.ts`) must be followed by re-running this
  clamp** — pre-correction snapshot values would otherwise reseed an inflated
  `history-max:` floor via `rebuild-download-version-buckets.ts`.
- `audit-shared-map-attribution.ts` + `export-shared-map-attribution-audit.sh` —
  parameterized shared-pack attribution audits.
- `backfill-website-analytics.ts` — refetch missed hourly Cloudflare snapshots
  (worker/capture outage gap-filler).
- `backfill-hourly-downloads.ts` — deterministically rebuilds
  `analytics/hourly/downloads.csv` (rolling per-listing hourly deltas) from the
  git history of `downloads.json`; initial backfill and the recovery path if
  the hourly appender's series is ever lost or corrupted. Caveat: any
  administrative counter RAISE (grandfathered restore, ledger-rebuild recovery)
  reads as a one-hour download burst — the clamp only guards drops. After such
  a recovery (and after any backfill re-run spanning one), prune the affected
  bucket rows manually; they otherwise distort the hour-of-day seasonality
  until they age out of the 14-day window.

One-time migrations that already ran are deleted rather than kept here — git
history is the archive (see tmp/plans/registry-downsizing-audit.md for the list).
