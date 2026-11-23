# Full Storage Estimate — One boff League

> November 10 update: the dev storage foundation is now implemented. See [STORAGE_IMPLEMENTATION.md](STORAGE_IMPLEMENTATION.md) for deployed status, measured results and remaining integration work. Estimates and audit observations below retain their original date; any earlier "not implemented" status is superseded by that report.
Measured November 9, 2026 (Eastern). Decimal MB throughout; 1 MB = 1,000,000 bytes. Estimates describe a completed, optimized rebuild, not an already-achieved production footprint.

## Planning Answer

For this 12-team, 13-participant league, budget **approximately 50 MB for one moderately active season**, or **approximately 100 MB for a heavily used season**. This includes the database's shared starting overhead. If this league remained alone on its own database, that overhead would still be present. Additional leagues on the same database would share it rather than each adding another 20 MB.

| Component | Moderate Season Planning Allowance | Basis |
|---|---:|---|
| Shared database/system tables, Auth and minimum application-table allocation | About 20 MB | Current whole dev database is measured at 18.82 MB, including existing dev fixtures. Using 20 MB as a conservative starting allowance is an estimate, not an attribution of every byte to this league. |
| Current-season tickets, accepted legs and wager/payout balance history | About 18.1 MB | 13 participants × 8 tickets/week × 18 weeks; four legs per ticket; compact target of 1,000 bytes/leg; measured 440-byte ticket and two 199-byte ledger rows; illustrative 2× index/page allowance. |
| Current boards, futures, roster/player inputs, source cache and compact season/ATS/calibration summaries | 1–3 MB | Engineering budget for the rebuilt data shape; current source cache alone is only about 0.13 MB allocated. Current projections/pricing are not connected, so this larger allowance has not been validated. |
| Additional settings, replenishments/corrections, offer claims and bounded operational records | 1–2 MB | Planning allowance beyond the starting database and wager/payout assumption; no permanent share-card images or reports. |
| Operating headroom | Roughly 7–10 MB | Allows for varying receipts, dependencies, indexes and normal row-version allocation. It is a reserve, not stored user data. |
| Rounded planning budget | **About 50 MB** | A capacity target to validate with real tickets and the rebuilt backend. |

This models 18 sportsbook weeks as a conservative planning horizon, not a hardcoded season length. Adjust for the actual fantasy regular season and playoff format. Both My Bets and All Bets read the same receipt records; they do not duplicate them. Futures remain until settled even across a weekly close.

## Traffic Changes The Result

| Usage For The Same 13 Participants | Tickets / Season | Legs / Season | Ticket + Credit History Estimate | Rounded Whole-Database Planning Budget |
|---|---:|---:|---:|---:|
| Moderate: 8 tickets/person/week, 4 legs/ticket | 1,872 | 7,488 | 18.1 MB | About 50 MB |
| Heavy: 20 tickets/person/week, 6 legs/ticket | 4,680 | 28,080 | 64.0 MB | About 100 MB |

The compact 1,000-byte leg is a **target**, not the current implementation. Keeping today's measured 2,718-byte average leg raises the moderate receipt-history estimate to **43.8 MB**, making the comparable complete planning budget roughly **70–80 MB**. The actual 89-ticket sample is small; the multiplier for indexes/page allocation is illustrative and must be replaced with load-test measurements.

Formula: participants × tickets/person/week × weeks × (440 + legs/ticket × legBytes + 2 × 199) × 2. Replenishment and correction entries beyond two movements per ticket are covered separately above. Actual future dependency records must be counted too; don't delete evidence or accepted terms to reach an arbitrary size.

## What Is Actually Stored Today

| Measured Item | Current Size |
|---|---:|
| Entire dev Postgres database, including fixtures/system overhead | **18.82 MB** |
| Public application tables within that dev database | 3.09 MB |
| New live-cache table, including index/TOAST allocation | **0.131 MB** |
| Current league + shared NFL JSON inside that table | 7,580 bytes |
| Current frontend assets on Vercel, shared across all leagues | Approximately 0.72 MB |
| Supabase object storage | No stored objects in the inspected dev or production projects |
| Existing production database, with legacy retained data | **365.07 MB** |

These rows overlap: the live-cache table is included in public tables, and public tables are included in the whole database. Do not add all measured rows together. Vercel frontend files are separate from the Supabase database and shared rather than copied per league. Sleeper images are linked rather than stored as copies.

Production still retains roughly 228.4 MB in model_forecast_runs, 37.5 MB in forecast_snapshots and 29.0 MB in live_forecast_runs. Those three alone total about 294.9 MB. It also has about 31.9 MB of sportsbook_markets. The new dev refresh does not delete, migrate or shrink any of that production data. No production writes or cleanup were performed for this estimate.

## Why Five-Minute Refreshes Do Not Mean Seasonal Cache Growth

The source process still has **three rows after 17 successful refreshes**: internal control, current NFL status and current league data. Refreshes overwrite current values. They do not save another book, forecast, score snapshot or copied player catalog at every poll. The active/idle cadence changes API requests, computation and write activity; it should not multiply retained data by the number of refreshes.

Postgres still creates temporary row versions and WAL. Observed cache allocation rose from about 80 KiB to 128 KiB during operation; that is normal physical allocation, not proof that retained source history is growing. Autovacuum and sustained-load testing must verify a stable long-run footprint. Cron history is bounded to 24 hours for this job, while pg_net responses use six-hour retention.

The 50/100 MB budgets assume the same current-state approach is carried into the rebuilt pricing process. They do not include externally managed backup/PITR copies, transient WAL, provider-side logs, deployment history or bandwidth. Those resources are billed/measured separately from this database estimate and are not per-league duplicate app records.

## What Still Needs Measurement

Real accepted/settled receipt sizes after compaction; current pricing inputs and outputs; version/evidence dependencies; actual participant activity; custom-playoff state; and physical index/row-version allocation under sustained refreshes. Start with the 50 MB moderate target, then revise from those measurements. The target must preserve required current-season receipts and reliable settlement evidence.
