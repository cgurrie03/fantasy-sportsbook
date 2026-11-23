# Storage-Saving Priorities For boff

> November 10 update: the dev storage foundation is now implemented. See [STORAGE_IMPLEMENTATION.md](STORAGE_IMPLEMENTATION.md) for deployed status, measured results and remaining integration work. Estimates and audit observations below retain their original date; any earlier "not implemented" status is superseded by that report.
Prepared November 9, 2026, Eastern. All MB are decimal. This is a plan and a read-only measurement update; no database cleanup or ticket migration was performed.

The recommended order below is the order to build and test in dev. Production cleanup should follow validation of the replacement design. Current source refresh is connected; live pricing, acceptance and settlement are not. Ticket compaction is not yet implemented.

## Priorities Still To Implement

| Priority | Technique | Estimated Saving | Status And Basis |
|---|---|---|---|
| 1 | Compact tickets and share immutable rule/context versions | **25.7 MB per moderate season; 96.5 MB per heavy season** | Not implemented. Modeled receipt/history footprint falls from 43.8 to 18.1 MB at moderate usage, or 160.5 to 64.0 MB at heavy usage. This is roughly 59–60% of the modeled receipt/history allocation, not the whole database. Shared scoring/roster/model/lineup versions are part of this saving; do not count them again separately. |
| 2 | Make pricing/forecast storage current-only, with compact calibration summaries and required evidence | **Up to 294.9 MB of existing production archive allocation is a review pool**; net reclaim will be lower | Only the new source cache follows this pattern today. Production model_forecast_runs is 228.4 MB, forecast_snapshots 37.5 MB and live_forecast_runs 29.0 MB. Their entire measured size is an upper bound, not a claim that every row is expendable. Extract/preserve needed calibration, accepted-term and unresolved-result dependencies first. Future growth avoided depends on the rebuilt model's payload/cadence. |
| 3 | Expire obsolete quotes; keep current markets, open futures, accepted terms and the opening ATS benchmark | **4.3 MB of current inactive/unreferenced market-row values identified for review** | Not implemented. There are 1,023 inactive market rows without a direct ticket-leg quote reference. Other dependencies still need checking. The whole markets table occupies 31.9 MB, but we are not claiming all 31.9 MB can be removed. Row-value bytes and table/index allocation are different measurements. |
| 4 | Bound routine job, mail-body and refresh-diagnostic retention | **Up to about 4.1 MB in the measured legacy routine-log table pool**, before required retained records | Partially implemented: only the new dev worker's cron/network records are bounded. The legacy pool comprises automation_jobs, outbound_emails, line_refresh_cycles, line_refresh_sources and weekly_execution_runs. Retain unresolved failures, necessary delivery status and financial/decision audit records; do not indiscriminately clear logs. Exact eligible savings need an age/status/dependency check. |
| 5 | Share live progress and notification inputs rather than saving repeated per-ticket/per-user score snapshots | **Up to 0.29 MB in the present score-observation table is a review pool**; future avoidance depends on traffic | Pending live ticket integration. Required final score/evidence records must remain. For scale only: 20 open tickets × 1 KB snapshot × 4,320 refreshes would produce 86.4 MB of copies; 4,320 corresponds to 20 active hours/week at five-minute intervals over 18 weeks. That is an illustrative bad-design comparison, not existing usage or an extra saving to add to the 50 MB budget. |
| 6 | Generate share images on demand; keep avatar/headshot URLs rather than copied files | **0 MB to reclaim today**; avoids **200 MB per 1,000 permanent 200 KB images** | No permanent Supabase object files currently exist in the inspected projects, and source pictures are linked. Maintain this design when complete sharing is implemented. The 200 KB assumption is illustrative; image dimensions/encoding determine actual size. |
| 7 | Benchmark alternative database compression only after removing duplication | **Additional saving unknown; could be zero** | Existing PostgreSQL compression already works. Test realistic receipt/context values after normalization before changing compression methods or introducing opaque compressed blobs. Preserve useful filtering and settlement access. Do not promise another percentage without measurements. |

## Ticket Estimate Assumptions

This league has 12 teams and 13 participants. The planning horizon is 18 sportsbook weeks, adjustable to the actual league's regular/playoff coverage.

- Moderate: 8 tickets/person/week and 4 legs/ticket = 1,872 tickets and 7,488 legs.
- Heavy: 20 tickets/person/week and 6 legs/ticket = 4,680 tickets and 28,080 legs.
- Current sample averages: 440 bytes/ticket, 2,718 bytes/leg and 199 bytes/legacy credit movement.
- Proposed compact target: 1,000 bytes/leg, with accepted terms/evidence preserved; this target has not been achieved yet.
- Two credit movements/ticket and an illustrative 2× factor for index/page allocation. Additional replenishment/correction entries and context-version dependencies still require measurement.

Formula: participants × tickets/person/week × weeks × (440 + legs/ticket × legBytes + 2 × 199) × 2.

The ticket target includes shared context references; their real retained context rows must also be counted. My Bets and All Bets read the same tickets. Do not remove current-season receipts, explanatory balance entries or unresolved futures to meet a size target.

## Already Done / Already Present

| Technique | What Is Verified | Saving Or Avoidance We Can Honestly Credit |
|---|---|---|
| Latest-state source cache instead of one stored snapshot per poll | 3 rows after 24 successful refreshes; about 7.6 KB current league/NFL JSON; about 0.15 MB allocated cache table | About **0.17 MB of raw duplicate payloads avoided after 24 polls**, compared with keeping 24 copies of today's similarly sized payload. Illustrative all-day five-minute polling of both payloads would otherwise add about 2.18 MB/day raw JSON. Actual league idle polling is slower; physical database/index costs differ. This is source data only, not a completed pricing backend. |
| Omit unchanged payload columns from refresh writes | Implemented in dev worker v8; freshness/counters still advance, changed data still writes | Avoids rewriting roughly **2.4 KB of NFL JSON and/or 5.2 KB of league JSON per unchanged refresh**. This is reduced write activity, not a measured reduction in retained database size. PostgreSQL still updates small row metadata and generates some WAL. |
| Bound this worker's scheduler/network history | Cron run records retained for 24 hours; pg_net responses use six-hour retention | Prevents unbounded growth. Current combined history/response table allocation is about **0.14 MB**. The amount removed by expiry has not yet been measured; we cannot credit the full legacy log pool as already saved. |
| PostgreSQL's native compression — existing platform behaviour, not a newly implemented boff change | 136 sampled context values use pglz; comparing all 197 stored context values with rebuilt uncompressed JSONB values gives 1.39 MB versus 0.64 MB | Approximately **0.75 MB of sampled context-value storage already avoided**. This excludes table/index overhead. Current 2,718-byte average leg already benefits from this compression, so do not add the saving to the ticket-compaction estimate again. |
| Shared frontend assets and linked player/team pictures | The frontend build is about 0.72 MB total on Vercel; inspected Supabase object storage has no files | No newly reclaimed bytes. Assets are shared across leagues; future leagues should not get duplicate app bundles or copied source images. Share-card avoidance is counted in priority 6, not again here. |

## What The Numbers Mean

Current production is approximately **365.1 MB**, and current dev approximately **18.85 MB**, including database/system overhead and dev fixtures. No production space was reclaimed by these dev changes. Much of production's size comes from the legacy forecast archives.

Do not total the figures in the two tables. They mix current allocations, candidate row values, annual growth avoided, existing native compression, and conditional illustrations. Some improvements overlap. Especially, shared context versions are already included in the ticket estimate, and the archive tables may contain records that other features still require.

The approximately **50 MB moderate-season / 100 MB heavy-season** whole-database planning budgets remain conditional targets for the optimized rebuild. They are not achieved production sizes or hard caps. Capacity must be revised after the real receipt writer, pricing payloads, dependencies, indexes and sustained refresh workload are measured.

Deleting old records does not necessarily reduce allocated disk immediately. Standard vacuum normally makes dead space reusable; physical shrinking may require separate maintenance. [PostgreSQL 17 vacuum documentation](https://www.postgresql.org/docs/17/routine-vacuuming.html).

PostgreSQL already compresses large values and normally preserves unchanged out-of-line values during updates. That supports reducing repeated data first and omitting unchanged payload writes. [PostgreSQL 17 TOAST documentation](https://www.postgresql.org/docs/17/storage-toast.html).
