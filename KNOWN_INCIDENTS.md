# Known Data Incidents

Registry-affecting data incidents, their causes, the corrections applied (or
deliberately not applied), and the residual effects to keep in mind when
interpreting download counts and analytics. Append new incidents at the top.

---

## 2026-08-04 → 2026-08-05 — Private-repo wipe of three mod listings (fully recovered, listings deprecated)

**What happened:** two authors made their source repos private, and the
download pipeline treated "repository not found" as *fresh emptiness* rather
than *unknown state*. GitHub's GraphQL reports a private/deleted repo as a
non-transient "Could not resolve to a Repository" error, which landed the
repo in **neither** `repoIndexes` **nor** `unavailableRepos` — so the
preserve-previous-counts fallback (which only fires for `unavailableRepos`,
i.e. transient 429/5xx errors) was never reached, and the freshly-initialized
`{}` was written out. Affected listings and losses:

- `danield1909-dantrains` (repo private ~Aug 4 20:30–21:05 UTC): hourly run
  `c592e548d` (#6961) wiped 12 versions, 2,300 → 57 (the 57 survived only via
  a pre-existing `mods/grandfathered-downloads.json` entry).
- `imb11-moveit` (1,255) and `imb11-subwaycine` (33) (repos private Aug 5
  ~21:03–22:07 UTC): hourly run `4df45a6e2` (#7048) wiped both to `{}`.

The wipes surfaced as **negative net-delta** figures in the hourly Discord
report (e.g. `mods.net_downloads: -1158` in `snapshot_2026_08_05.json`).

**Why the two authors' listings diverged:** the same gap existed in **full**
mode (`regenerate-registry-analytics`, 4-hourly), where the `!repoIndex`
branch additionally clobbered the listing's integrity entry with a fresh
empty one. dantrains went private ~4 hours before a full run, so the Aug 5
00:15 full run (`97705a745`) collapsed its integrity
(`has_complete_version: false`) — which the Railyard app treats as
purge-on-launch. The imb11 repos went private ~90 minutes *after* the Aug 5
20:29 full run (`a90d48590`), and only hourly download-only runs (which never
write integrity) saw the 404 — so their integrity entries remained intact.
Pure cadence timing, not different handling.

**Fix:** the `!repoIndex` (repository-not-found) branches now preserve
previous state exactly like the `unavailableRepos` (transient) branches, in
all four sites: listing-level and per-version paths in both
`scripts/lib/downloads-download-only.ts` and `scripts/lib/downloads-full.ts`
(full mode preserves integrity + cache + downloads together). Regression
tests cover the private/deleted-repo case in both modes
(`downloads.integration.test.ts`).

**Recovery:** last-known per-version counts were intact in
`mods/download-version-buckets.json` (monotonic ledger; the wipe couldn't
touch it because `applyVersionBucketMonotonicCounts` only iterates versions
present in the fresh result). All three listings' counts were restored from
the ledger into `mods/downloads.json` **and** frozen into
`mods/grandfathered-downloads.json` (dantrains 2,433 / moveit 1,255 /
subwaycine 33 — bucket maxes, slightly above the last snapshot values by
design). **No lasting data loss.**

**Snapshot correction:** `history/snapshot_2026_08_05.json` (generated 04:01,
between the two wipes) had recorded dantrains post-wipe (57) and
`mods.net_downloads: -1158`. Corrected to the exact last observation before
the repo vanished (21:05 Aug 4 run, `c592e548d^`): adjusted 2,300 per-version,
raw = adjusted + the per-version attribution map (275, static since Aug 1),
`mods.net_downloads: +1085`. This is a reconstruction from committed data,
not an estimate — the repo was unreachable for the entire window between the
last observation and the snapshot, so no downloads could have been recorded.
The imb11 wipe (22:07 Aug 5) never reached a daily snapshot; Aug 1–4
snapshots are clean.

**Deprecation:** all three listings were deprecated in the same change
(maintainer-initiated, `by_github_id: 268817724`) since no installable
versions remain. The grandfathered entries are what keep their download
totals visible: the deprecation overlay wipes deprecated listings from the
pipeline's own output, and the grandfathered merge re-fills every version
afterwards. The app-side purge of installed copies on deprecation is a known,
accepted side effect (revisit possibly in 0.2.10); dantrains installs had
already been purging since Aug 5 00:15 via the integrity collapse.

**Detection playbook for recurrence:** a listing dropping non-zero → `{}` in
`downloads.json` alongside a "skipped all github-release versions
(repository not found or inaccessible)" warning means the repo vanished
upstream. With the fix, counts and integrity are preserved automatically and
the warning reads "preserved previous … (repository not found or
inaccessible)" instead; the remaining action is deciding whether to
deprecate the listing (grandfather its counts first if so).

---

## 2026-04 → 2026-07 — charleston-huntington-wv faulty-client inflation (corrected 2026-07-29)

**What happened:** an automated client repeatedly re-downloaded the map's
**re-uploaded** `CHA.zip` asset (the re-upload gave the asset a new node id
and reset GitHub's counter; the original asset's count was frozen at 5 on
2026-04-11 as part of the April grandfathering). The listing climbed 5 → 800
at a metronomic **~8–10 downloads/day from mid-April through June**, with
increments spread around the clock — including ~03:00 US Eastern for a small
West Virginia–audience map — then cliffed to ~2/day in early July with no
release event. Registry-wide screens (metronomic-growth and July-cliff
signatures across all maps and mods) found no other listing with this
pattern; every other candidate resolved to organic popularity or version
supersession.

**Correction:** peer-scaled organic estimate of **65** (versus small-metro
peers at 18–206 lifetime); **735 downloads attributed to the faulty client**.
Applied across every path that could resurrect the inflated value:

- `+735` manual attribution on the asset's base key (prefix matching covers
  all node-id re-uploads) via `create-manual-download-attribution --apply`;
  the spec is committed at
  `history/manual-attribution-specs/2026_07_28_charleston_huntington_faulty_client.json`
  and re-application is idempotent (`applied_delta_ids`).
- Version-bucket max/last lowered to 65 (both download writers are
  monotonic and would otherwise hold 800 forever).
- `maps/downloads.json` set to 65.
- 106 `history/snapshot_*.json` files re-interpolated (linear 5 → 65 over
  the bot window, never exceeding the recorded value) via
  `scripts/ops/backfill-charleston-snapshot-clamp.ts`, so bucket rebuilds
  from history no longer seed an inflated `history-max:` floor.

**Re-application rules** (see `scripts/ops/README.md`): after any
attribution-ledger rebuild, re-apply the committed manual-attribution specs;
after any snapshot rebuild from git, re-run the charleston clamp script.

**Residual effect:** the listing's historical trajectory Apr–Jul is a
corrected estimate. Going forward the count grows organically once the
asset's raw counter exceeds 800 (`adjusted = raw − 735`).

**Detection notes:** the tell was the combination of (1) rate wildly
disproportionate to the map's audience, (2) metronomic day-over-day
constancy, (3) increments in dead local-time hours, (4) an abrupt rate
cliff untied to any release, and (5) an asset re-upload restarting the
counter right as the pattern began.

---

## 2026-07-28 — GitHub release download-counter stall (no correction applied)

**Window:** ~08:00–19:20 UTC (≈11.5 hours).

**What happened:** GitHub's release-asset `download_count` metric stopped
incrementing platform-wide. Downloads themselves continued to be served; only
the counters froze. Verified against three independent sources: registry map
counts, the Railyard app's own release repo
(`Subway-Builder-Modded/railyard` — hourly snapshots in
`history/railyard_app_downloads.json` show `0.2.9` pinned at 1295 from 16:00
through 19:00 UTC), and an external control repo (`yt-dlp/yt-dlp`, normally
~70 downloads/minute, byte-identical across samples at 19:12–19:17 UTC).

**Registry symptom:** hourly `regenerate-downloads` PRs carried identical
diffs for hours, then pure "+0" cycles after the frozen snapshot merged
(#6275). The pipeline itself was verified healthy — fetches succeeded and
stored values matched `live_raw − attributed` exactly throughout.

**Impact:** the stall window recorded **+37** net downloads versus a
**~1,774–1,878** baseline for the same window on the two preceding days.
When counters resumed (~19:20 UTC), GitHub replayed only a small fraction of
the backlog (≲100 across the registry; post-recovery hourly cycles landed
inside the normal same-hour baseline band). **≈1,700 downloads registry-wide
are permanently unrecorded.**

**Decision:** accepted without correction. The cause is external and
verifiable, the loss is a single-window dip well inside week-scale variance,
and any backfill would have required fabricating per-version estimates —
contrary to the conservative-corrections policy. Interpret the Jul 28
daily totals accordingly.

**Detection playbook for recurrence:** hourly PRs going "+0/+0" (or repeating
identical diffs) while run logs show successful fetches → spot-check
`stored == live_raw − attributed` for a busy listing, then sample a
high-traffic external repo's `download_count` twice a few minutes apart. If
the control is frozen, it is a platform incident: change nothing, let the
cumulative-counter pipeline pick up whatever GitHub reports after recovery,
and record the measured gap here.

---

## 2026-07-08 → 2026-07-09 — Integrity cache wipe + 429 cascade (fully recovered)

**What happened:** a sequence of integrity-pipeline bugs wiped download
counts and integrity data for 20+ map listings across analytics runs
#4418–#4449 (~3,000 downloads temporarily zeroed). Three stacked root
causes:

1. **`INTEGRITY_RULES_VERSION` bump (v6 → v7)** invalidated every existing
   cache entry; the next analytics run re-inspected all versions under the
   new phantom-points check and retroactively failed grandfathered versions
   (`is_complete: false` → undownloadable). Reverted to `v6`; integrity
   files restored from `ae1322f5d`. **Standing rule: never bump
   `INTEGRITY_RULES_VERSION`** — new versions always get fresh inspection
   with all current checks anyway (new fingerprints), while existing cache
   entries must stay valid.
2. **429 cascade:** `fetchCustomVersions` hit `raw.githubusercontent.com`
   unauthenticated with no pacing; burst requests triggered secondary rate
   limits, and transiently-errored listings had empty integrity entries
   written over their previous state. Fixed in `dcb0b9cbe`
   (transient-error listings preserve previous integrity/cache/stats) and
   `a74d7ea7c` (200ms inter-fetch pacing).
3. **Phantom-points check on cache-empty listings:** with the cache wiped
   by (2), re-inspections fired the new `demand_phantom_points` /
   `demand_residents_match` checks against pre-existing versions, silently
   dropping their counts to 0 on every run until the cache was repopulated.

**Recovery:** integrity + cache + download counts restored from last
known-good commits in `a88f8e81b`, `1746fb8a8`, and `17fb22550`/`f501f7518`
(2026-07-09). **No lasting data loss** — counts and integrity state were
fully recovered from git history.

**Detection/recovery playbook:** listings dropping non-zero → 0 in
`downloads.json`, or appearing in `incomplete_versions` with
`demand_phantom_points: false` after previously being complete. Restore
integrity entries **and cache entries and download counts together in one
commit** from the last known-good analytics commit — without the cache
restore, the next run re-inspects and the cycle repeats.

---

## 2026-04-07 → 2026-04-10 — App-side download inflation + integrity invalidation (corrected)

Two related problems, corrected as of 2026-04-11.

### Part 1: inflated download spike (corrected by proportional haircut)

**What happened:** Apr 7–10 download counts spiked artificially from
app-side request behavior, inflating registry counts far above organic
levels.

**Correction:** Apr 6 was the last verifiably clean snapshot and served as
the baseline (deliberately *not* the first spiked date — hard-capping at
Apr 7 would have discarded legitimate organic growth). Each spiked snapshot
was scaled as:

```
corrected = max(apr6Baseline, floor(original × DELTA_HAIRCUT_RATIO))
DELTA_HAIRCUT_RATIO = 0.2864   # weighted avg clamped/pre-clamp across 8 affected mods (1173/4095)
```

Applied by `scripts/backfill-map-version-clamp.ts`.

### Part 2: 14 map versions invalidated by integrity checks (grandfathered)

**What happened:** 14 map versions failed the `config_version_matches_tag`
integrity check (the version in `config.json` did not match the GitHub
release tag). The pipeline marks such versions incomplete and excludes them,
which would have silently dropped their historical download totals —
violating the monotonic non-decrease requirement.

**Correction:** their counts were frozen in
`maps/grandfathered-downloads.json` (the authoritative list of affected
versions and frozen values); `mergeGrandfatheredDownloads()` in
`scripts/lib/grandfathered-downloads.ts` merges the frozen counts back into
pipeline output for incomplete versions only.

**If new versions are invalidated in the future:** add them to
`maps/grandfathered-downloads.json` using the last clean snapshot value from
git history, and check the ceilings in `maps/download-version-buckets.json`.

**Residual effect:** Apr 7–10 totals are corrected estimates, not raw
measurements; the 14 grandfathered versions carry frozen counts that no
longer track upstream.
