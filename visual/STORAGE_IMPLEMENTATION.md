# Dev Storage Implementation
Updated November 10, 2026 (Eastern).

The storage-saving foundation is installed in **dev** (Supabase whlcnlacueweaqpsupqs). Production was not changed. The existing dev frontend deployment remains iteration 20; these changes live in the database, not a new UI bundle.

## Completed
| Area | Implemented behaviour | Retained information |
|---|---|---|
| Ticket receipts | Repeated scoring rules, lineups and large metadata fields are interned in immutable, league-scoped records. Legs carry small references. Admission verifies exact reconstruction. Existing receipts are backfilled losslessly. | Accepted prices/lines, targets, identifiers, results and complete recoverable context. Unknown market contracts stay inline until reviewed. |
| Receipt reads | Normal browsing reads compact legs. ticket_legs_with_evidence expands original context on demand using member RLS. | Members only; cross-league reads and direct evidence writes are denied. |
| Forecasts | Legacy full model/live/report archive writes are disabled. Current forecast view reuses existing compact evaluation samples without copying their payloads. Existing bounded samples and evaluated-sample retirement remain the calibration path. | Required compact evaluation evidence and summaries. This does not connect the visual frontend to calibrated live pricing. |
| Opening benchmarks | First published pregame main spread, moneyline and total recorded as small numeric rows. No full publication snapshot. | Opening ATS/reference terms remain after an unreferenced quote expires. |
| Obsolete quotes | Hourly bounded cleanup removes inactive quotes on boards closed over 7 days, with dependency checks. Unresolved futures and season liabilities are protected. | All ticket-referenced, active, recent, offer/review/stage-referenced quotes; unresolved futures. |
| Ticket progress | One shared numeric observation per league/season/week. Filters unrelated teams and players, drops provider bodies, caps at 64 KiB. Old progress retires after 14 days only outside the current period and with no open tickets. | Current/open-ticket progress plus durable ticket settlement evidence. No per-person score-snapshot copies. |
| Operational records | Existing mail/job/terminal-refresh/evaluation cleanup runs hourly. Last maintenance result replaces one singleton row. This job's cron history expires after 24 hours. | Pending/leased/failed operational records as required by the existing retention contracts; durable delivery/event keys and financial history. |
| Images | Image-less offers supported; fresh persistent promo-image writes blocked. Existing unreferenced legacy images cleaned by existing routine. Shared avatars/headshots remain links. | Referenced legacy art retained. Complete mobile sharing still needs implementation/testing; no permanent share-image collection is introduced. |
| Database compression/indexes | Native JSONB/TOAST compression retained. Removed two redundant new indexes; deduplication and reference indexes remain. | Queryable structured data; no opaque custom compressed ticket blobs. |
| Existing source refresh | Latest-state cache, unchanged-payload write suppression and bounded scheduler/network history remain in place. API verification returned 200 after migration. | Freshness/counters and latest source values. |

## Measured Results
- One-week receipt workload constructed from the real sample league's teams, roster/player inputs, lineup shape and scoring rules: **652,353 → 148,824 row-value bytes**, including shared dictionaries/bundles (**77.19% reduction**).
- 197 legs averaged about **597 bytes per compact leg**, with 28 shared values and 6 bundles in that workload.
- These are local PostgreSQL-engine measurements of a deliberately repeated weekly context, not actual placed production tickets. They exclude indexes/page/WAL allocation and do not prove a 77% saving across a season or the full database.
- Hosted dev before: **19,109,555 bytes**. After: **19,379,891 bytes** (~19.38 MB), with 98,304 bytes allocated to the four new storage relations. Catalog/index activity and normal concurrent work contribute to the overall difference.
- Hosted dev currently has **0 tickets, 0 legs and 0 raw forecast archives**. First housekeeping pass therefore removed no eligible records. This deployment prevents growth; it does not claim a large immediate reclaim.
- Production's earlier **294.9 MB archive pool** and **4.3 MB candidate quote-row pool** remain unmodified review pools. No production-space savings are claimed.
- Keep the prior ~50 MB moderate / ~100 MB heavy single-league budgets as conditional planning allowances until end-to-end use is measured. Do not add overlapping savings.

## Validation
Run from repository root: `node visual/scripts/storage-run.mjs`. Uses local PGlite only; it never connects to hosted databases.
- 15 receipt checks: lossless expansion, immutable accepted terms, evidence references, member/outsider access and compact/expanded settlement parity.
- 25 retention checks: dependencies, active/recent/accepted quotes, unresolved futures, progress pruning, archive/art admission, orphan collection and idempotence.
- Native financial regression: new accepted heavy-context receipt compacts through the real acceptance function; independent participant wallets, repeated requests, boosted claims, refunds, weekly payouts and replenishments remain correct.
- Recovery drill exports fully expanded receipts with null dictionary references and restores using existing financial validation, including evidence equality and financial conservation.
- Routine-retention regression protects pending/leased/failed records, referenced legacy art, provider/event IDs and financial values.
- Native pglz benchmark retained; local engine does not support lz4, so no unverified compression-method change was made.
- Hosted RLS/ACL/trigger checks passed. No performance-advisor findings referenced new relations. The new private maintenance singleton intentionally has RLS with no browser policies (deny by default); existing platform security advisories remain a separate pre-launch review.

## Deployment
Managed migrations applied only to dev:
- 20261110212647 — dev_storage_efficiencies
- 20261110212655 — dev_storage_maintenance_schedule
- 20261110212908 — dev_storage_remove_redundant_indexes

Hourly job: **boff-storage-maintenance**, at minute 17, batch 50. Manually invoked successfully after installation. The next naturally scheduled execution has not yet been observed. Existing five-minute source-refresh scheduler remains active. Maintenance has a 15-second statement timeout and a 500-ms lock timeout.

Source files: server/storage-efficiencies.sql, server/storage-maintenance-schedule.sql and server/storage-remove-redundant-indexes.sql. The fresh-install SQL already omits the redundant indexes; the last file records the hosted follow-up.

## Recovery Contract
Native full database exports must include both receipt_context_values and receipt_context_bundles with ticket_legs. For a portable financial-only export use **server/receipt-recovery.mjs**, which adapts the existing read-only snapshot query for dev and expands receipts inline, clearing database-local bundle IDs. Its recovery drill passes. Never use the unchanged legacy financial-only exporter against compact receipts: it omits the shared dictionaries. Production's existing exporter is unchanged because production still uses its original receipt shape.

## Additional Actions
1. Connect real frontend ticket acceptance, pricing and settlement to this validated storage path. Visual example tickets still remain local; source refresh being live is not the same as live calibrated pricing.
2. Run sustained 1-, 5- and 10-league workloads, including playoff/future-heavy tickets, concurrency, index/page allocation, refresh/WAL and maintenance latency. Replace planning budgets with measured season projections.
3. Before production rollout, integrate the portable export adapter (or shared tables) into the scheduled financial-backup path and repeat the hosted restore drill. Audit legacy archive/quote dependencies, preserve necessary summaries/evidence, then migrate and clean production separately.
4. Observe the first natural hourly maintenance run and review failure/timeout status during the real workload. No action is needed from commissioners.

