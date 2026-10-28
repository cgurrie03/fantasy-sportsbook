# Supabase efficiency — first implementation priority

Updated October 28, 2026, following the user's explicit retention decision: **most generated data must be temporary. Do not retain every refreshed betting line, projection or the model inputs used to calculate it.** This supersedes both older archive-everything requirements and this handoff's earlier proposal to reconstruct every published revision indefinitely. This work takes precedence over feature expansion and enabling another league. Read alongside PROJECT-CONTEXT.md. This is a measured diagnosis and implementation handoff, not a deployed optimization or completed cleanup.

## Outcome

Additional context: owner-only development must use a separate test database (handoff 09) but count its traffic inside relevant shared quotas. Expanded fixes/provider efficiency are in handoff 10. Support reporting is specified in handoff 11, remains undeployed, and must have its own small retention/byte budget. If free capacity remains insufficient after measurement, present further optimizations and optional feature limits; do not purchase an upgrade.

Reduce avoidable database growth, database work and Supabase egress while preserving current pricing quality, freshness, accepted tickets, balances, settlement evidence, authorization and useful model evaluation. Treat storage as a bounded operational resource, not a research archive. Optimize the existing league first. New leagues must use the efficient shared infrastructure and their own imported Sleeper settings; do not duplicate cron infrastructure or hardcode 12-team assumptions.

## Retention contract — temporary by default

These are implementation defaults to validate against actual leases and consumers, not promises that cleanup is already running. Durable means retained for normal product operation; retention must not depend on keeping large raw blobs.

| Data | Retention/design |
| --- | --- |
| Current published markets and active predictions | Keep current usable state. Replace on successful atomic publication; do not append a permanent full snapshot for each refresh. Keep prior state only through the tested rollback/recovery interval, initially at most 24 hours. |
| Refresh source/stage payloads | Delete terminal-cycle payloads after a proposed one-hour recovery window, provided publication/lease checks pass. Abandoned payloads should expire within 24 hours after recovery handling. Active cycles cannot be deleted solely because a timer expires: recover or fail them explicitly and alert on stuck leases. |
| Raw provider responses, per-refresh model runs, player pools and detailed experimental live forecasts | Prefer request-scoped or shared short-lived cache. Persist only when needed for recovery/debugging, with a 24-hour TTL and byte cap. Disable the current unconditional permanent archive writes. No default long-term raw-input archive or cold-storage replacement. |
| Compact prediction evaluation samples | Retain designated opening and final-pregame predictions, plus explicitly selected live horizons when useful. Keep only event/player IDs, predicted scores/probabilities, line/price where needed for evaluation, source age/quality flags and model-version ID. No copied rosters, provider payloads or verbose per-selection configuration. Use fixed unique keys per league/season/week/target/horizon; late refreshes replace a provisional sample rather than append unlimited samples. |
| Evaluation samples after outcomes are final | Produce idempotent weekly summaries, then expire row-level samples within seven days of successful evaluation. Review at a 14-day unresolved-work threshold; retain a bounded delayed-outcome set and explicit coverage gaps rather than silently deleting pending evidence or allowing an unlimited backlog. Long-running futures keep only their designated compact horizon samples until final outcome/evaluation, not every refresh. |
| Weekly/season model quality summaries | Retain compact counts, coverage, error/bias, probability/calibration sufficient statistics and version IDs. Bound bin/segment counts and version granularity. Store paired candidate/baseline aggregate comparisons if used. Do not misrepresent these as enough for unrestricted later retraining or replay. |
| Model code/configuration | Version source code in Git; retain small applied configuration versions and effective dates. Reference versions rather than copying the same configuration into each quote. |
| Accepted tickets, saved acceptance terms and settlement context, wallets, ledger, replenishment, boost consumption and administrative financial changes | Retain the records required for correct account history, settlement, disputes and idempotency. Save only necessary ticket-specific terms/evidence; an accepted bet does not require an archive of the entire board. Inspect dependencies before removing referenced archive rows. |
| Live score observations | Keep latest state required for active tickets and settlement. Expire superseded detailed player payloads; retain compact final results/settlement evidence where required. |
| Routine job/cron/refresh logs | Proposed seven days of successful diagnostics and 30 days of failed diagnostics, with a byte cap and compact daily totals thereafter. Preserve compact durable deduplication keys/references separately wherever needed to prevent repeated settlements, replenishments or emails. |
| Email outbox/media | Keep pending/retryable messages; purge delivered message bodies after a proposed seven days while retaining compact delivery/deduplication records. Remove expired unreferenced promo media after a tested grace period. Never delete an object still used by an active offer. |

Cleanup must be scheduled, bounded, indexed, resumable and tenant-safe. TTL alone is insufficient: enforce row/byte budgets too, and check the cleanup heartbeat. The raw-data budget must plateau even when retries, failed reviews or debug capture occur. Persistent debug capture requires an automatic expiry and a hard size limit.

## Preserve quality with less history

Generating current odds uses current provider data, league rules and the active model. It does not require permanent copies of every earlier calculation. Confirm dependencies in code before removing archive writes: current generation, settlement and reports must use explicit current state or the compact records described above.

Maintain accuracy assessment by evaluating selected forecasts across all eligible targets, including markets nobody bet on. Compare forecasts against final outcomes with fixed horizons; compute score MAE/RMSE/bias and appropriate probability scores/calibration summaries from compact samples. Preserve counts, missingness and source-quality coverage so summaries cannot conceal failures. Aggregate additive statistics for exact supported metrics; retain compact bounded samples when a metric cannot be reconstructed from aggregates. Do not average averages or count repeated refreshes as independent predictions.

The tradeoff is intentional: arbitrary historical line movement, full run replay and unrestricted retrospective model experiments will no longer be available. Remove or change UI/report queries that depend on that history; clearly label fixed-horizon reports. Keep current lines, freshness, bet receipts, results, replenishment and product-specific features intact. A short-lived explicitly enabled diagnostic capture can investigate a problem without turning permanent full archiving back on.

## Cost and capacity budgets

Planning acceptance targets for the current shared project, including a comparable second league: database at or below **350 MB**, with investigation at **400 MB**; egress forecast at or below **3 GB per billing cycle**, with investigation at 70% of the recorded 5 GB allowance. These are engineering targets with headroom, not measured outcomes or provider guarantees. Use the provider's units consistently. Recheck actual allowances and all projects sharing an allowance during implementation.

Allocate and record per-table budgets inside the total; reserve room for protected transactional history, indexes/TOAST, migrations and recovery. The temporary-data portion must plateau over a representative two-week run. Use observed daily growth in durable records to project the next season. Do not claim the free tier can last indefinitely as users and ticket history grow.

At a budget warning: run/repair eligible cleanup, stop optional raw/debug captures, identify excessive requests and notify the operator. Do not sacrifice accepted tickets, settlement, authorization, current odds freshness or replenishment to save space. Never enable a paid upgrade automatically. Do not enable another league until measured capacity fits; if protected records alone approach the allowance, present the measured constraint and a compact archive/retention choice for those records separately.

The previous estimates of 166–415 MiB/month per league assumed reduced but continuing permanent archives. They are **superseded as the intended design**: bulk generated data should now have bounded retention, leaving mainly small summaries and transactional history as durable growth. A defensible replacement forecast requires implementing the new schema, measuring row sizes and measuring real ticket/activity volume. No precise post-cleanup storage or monthly egress figure is established yet.

## Measured baseline and limits of the evidence

Read-only production audit on October 28, against application release `d1ea6c98d200326156aef76f8a8a6318b743f897`:

| Measurement | Observed |
| --- | --- |
| Supabase database quota card | 1.085 GB / 0.5 GB, 217% |
| Supabase billing-cycle egress | 5.518 GB / 5 GB, 110%, October 5–November 5 |
| Monthly active users | 8 |
| SQL database size | Approximately 1,020 MiB |
| `model_forecast_runs` | 437 MiB; 349 rows; 95 new in seven days |
| `forecast_snapshots` | 263 MiB; 187 rows; 53 new in seven days |
| `line_refresh_stages` | 248 MiB; 1,758 rows; 600 new in seven days |
| Failed model-review jobs | 18; latest eight inspected errors were statement timeouts, with four attempts |
| Current full weekly + futures quote JSON | 844,986 uncompressed bytes; 861 quotes combined |

Relation sizes include indexes and TOAST. The three large tables total 948 MiB, approximately 93% of SQL database size. Dashboard/SQL sizes differ in units and observation time. Low dead-row counts in these tables indicate retained live payloads are the main issue; this is not evidence that ordinary vacuum alone will solve it.

The archive growth estimate is about 278 MiB/week: whole-relation average bytes per row multiplied by seven-day insert counts. This is a directional estimate, not a measured physical growth delta. Record actual before/after growth over comparable days. The egress dashboard does not attribute bytes to individual endpoints; the polling calculation below establishes a large avoidable traffic path, not an exact attribution of all billed egress.

Evidence files from this audit are in `C:/Users/coope/Documents/Codex/2026-10-28/th/outputs/boff-audit-2026-10-28/`, especially BOFF-capacity-assessment.md, BOFF-audit-evidence.json and BOFF-read-only-checks.sql. Use dated observations as the baseline, and recheck before migrations.

## Why this happens, and the ordered fixes

### 1. Establish measurements and a recovery path

Storage and bandwidth have separate causes and need separate acceptance checks. Record per-table/TOAST/index sizes, seven-day inserted bytes, endpoint response bytes, unchanged-vs-changed polls, database query calls/time/rows, job durations and retries. Attribute by endpoint/job and league without logging private payloads or tokens. Inspect available `pg_stat_statements` and query plans; preserve baseline statistics rather than resetting shared counters casually.

The audit did not find a Supabase migration ledger table or a managed backup. External backup coverage is unknown. Confirm an export and restoration procedure before historical-data changes. Reconcile the actual schema with repository migrations; do not replay all migrations against production. Application optimizations can proceed while this is resolved.

Deliver a compact measurement report, instrumentation and a verified recovery procedure. A plan is not proof that a backup exists.

### 2. Stop retaining completed refresh working data

Refreshes stage quote families in `line_refresh_stages`. Migration `202610090028_refresh_cache_retention.sql` releases `line_refresh_sources` when a cycle leaves staging, but does not release stage quotes. All 1,758 stage rows observed belonged to cycles no longer staging, retaining 248 MiB.

Inspect publication, lease recovery and replay consumers first. Define a short, explicit recovery window based on those consumers. Add bounded, indexed cleanup for terminal cycles whose publication/recovery obligations are complete and which have no active lease. Fence concurrent late writes and recoveries; prove that failed or superseded cycles can still recover correctly. Preserve compact cycle IDs, revision, hashes, timestamps and status for diagnosis.

Apply cleanup prospectively, then remove eligible historical stage payloads in small resumable batches. The full 248 MiB is a candidate working-data footprint, not guaranteed immediate reclaimed disk. Measure logical deletion and physical size separately; ordinary deletion may leave reusable space rather than shrink the relation. Any compaction requiring locks or substantial temporary disk needs a separate maintenance plan. Avoid an unplanned `VACUUM FULL`.

### 3. Replace permanent refresh archives with current state and compact summaries

`api/generate-markets.ts` sends source responses, model inputs, player pool, configuration and full quotes to `save_model_forecast`. Each quote also receives model configuration and explanatory metadata. `capture_forecast` in migration `202610080025_reporting_foundation.sql` archives complete active market rows for each published board revision. The two archive families therefore retain overlapping evidence, while repeated fields also appear across selections and runs. Existing immutable-history triggers intentionally block casual history deletion.

Replace these unconditional full-payload archive writes using the retention contract above. A compact revision token still changes when current pricing or status changes, so clients and acceptance can detect stale quotes without retaining a full permanent copy of every version. Reuse identical public NFL inputs across leagues in short-lived caches; keep scoring, rosters and private outputs correctly scoped.

Preserve accepted ticket terms and the exact settlement context needed for those tickets. Permanent reconstruction of every unbet published revision is explicitly no longer a requirement. Migrate reports/model evaluation to designated compact samples and summaries before expiring their inputs. Keep meaningful freshness/provenance on current state even when displayed odds do not change.

Implement the new format/readers and stop permanent full-payload writes, then summarize useful existing history and delete expired bulk archives in bounded batches. Confirm an export/restore path first; a one-time recovery export must not become recurring permanent raw-data storage. Existing immutable-history triggers need a narrowly authorized migration/cleanup path for temporary archives; retain protection on financial records and compact finalized records where required. Inventory foreign keys and ticket references before deletion, preserve necessary ticket-specific evidence, and never cascade-delete tickets or their terms. Test replay of accepted ticket settlement and parity of the supported fixed-horizon metrics; do not require parity for historical features deliberately retired.

### 4. Stop redownloading unchanged boards

`src/components/Sportsbook.tsx` reloads both weekly and futures boards every 30 seconds while visible, irrespective of selected category. Current quote JSON is approximately 845 KB per round: 120 rounds equal approximately 101 MB per active user-hour before compression and protocol overhead. Actual billed wire bytes must be measured separately. Pregame prices normally regenerate every two hours outside active games and every 15 minutes during active games.

Poll a small authorized manifest containing board revisions/status and relevant freshness versions. Fetch a full board only on first load, revision change or explicit recovery. Load unused categories on demand. Keep price revisions separate from score, starter-status and suspension updates so unchanged prices do not hide important live changes. Use one shared client fetch/cache per league and board; deduplicate concurrent requests and pause hidden tabs. Visibility resume must check freshness immediately.

Preserve server-authoritative acceptance, quote expiry, suspension and changed-price confirmation. Any response cache must honor user authorization and league/version keys; do not cache private league responses globally. Prefer the existing lightweight heartbeat over adding per-client Realtime subscriptions without measuring their cost. An HTTP 304 still performs a request; ensure it actually avoids the expensive underlying data read.

### 5. Bound account, report and model-review reads

`src/lib/accounts.ts` loads all accessible histories, including tickets, legs, balance events, wallet ledger and promotions. Load the selected league and required screen, paginate histories with stable cursors, and return database aggregates for summaries. Claim membership when needed rather than repeatedly treating every refresh as onboarding. Preserve league selection when delayed history returns. Fetch ticket progress only for visible relevant open tickets and only the required player fields.

`src/lib/report-forecasts.ts` loads multiple archive versions. Replace it with designated opening/final/horizon samples and finalized summaries, and revise any UI promising complete line history. Cache finalized report results and refresh live periods only when relevant inputs change. Do not preserve full archives solely to keep an unused export possible.

`api/_lib/model-pipeline.ts` has a generic 500-row paginated reader defaulting to `*`; the review loads whole season forecast snapshots and broad futures histories. Large JSON rows can exceed useful payload and execution bounds even in a modest row batch. Select metadata first, choose exact week/season/horizon IDs, fetch required projected fields only, and process bounded chunks with durable checkpoints. Instrument the exact timeout statement before attributing all 18 failures to this read. Do not solve repeated oversized reads by blindly raising timeout or retry counts.

Use query plans to add only justified league/filter/order indexes and verify RLS plans. Audit every remaining Supabase call, RPC, trigger and scheduled job for wildcard reads, duplicate requests, unnecessary writes and unbounded work. An inventory must record owner, trigger/cadence, scope, columns, bytes, retention and the resulting action or justified no-change decision.

### 6. Share background work and avoid retry amplification

Keep the existing shared once-per-minute scheduler; do not add another heartbeat for each league. Share/cache public schedule and provider inputs, while generating league-specific outputs using actual imported scoring and roster settings. `active-starters` currently runs every minute per client and performs auth/config reads plus provider requests; coalesce league status work and pause hidden clients. Authorization must still be checked for every private request.

Cache configuration with explicit invalidation/versioning. Preserve settlement, replenishment, rollover and email priorities and idempotency. Bound retry attempts, classify transient errors, and checkpoint expensive jobs rather than repeating their entire read workload. Retain failures long enough to diagnose them. Apply explicit retention to operational logs and other temporary caches; keep financial/audit evidence under its own policy.

The worker currently claims one job per invocation. Four pricing families per league means eight dispatch slots per 15 minutes for two leagues, before other jobs. Efficiency work must include fairness and queue-age measurements; increasing parallelism without database measurements could worsen load.

### 7. Prove savings before enabling another league

Use equivalent data and activity for before/after measurements. Complete these gates before declaring the issue fixed:

- No full-board fetch on an unchanged revision after initial load, except a documented recovery; target at least 90% fewer full-board downloads in a scripted unchanged-board hour. Report wire bytes and total Supabase calls separately.
- Completed stage payloads plateau within the tested recovery window; no monotonic accumulation. Demonstrate publication and expired-lease recovery under cleanup races.
- No default permanent full-board or raw model archive on each refresh. Prove expiry and byte caps for source/stage/debug payloads and selected evaluation samples. Report live bytes, physical bytes and growth against the shared-project budgets above.
- Weekly model review completes on a production-sized archive without statement timeouts or unbounded full-archive reads; retries do not repeat completed chunks.
- History screens request bounded pages scoped to the selected league. Accepted tickets retain exact terms and settle identically. Supported fixed-horizon reports/metrics match independently calculated results; retired full-history features are explicitly updated.
- Tickets, balances, replenishment, promotion consumption, settlement and email idempotency remain correct; cross-league reads/writes are denied. A platform admin can oversee the new league without being a fantasy member or receiving a participant wallet.
- Compare one- and two-league scenarios for database size/growth, egress, query execution time, peak connections, lock waits, worker duration, queue age and provider calls. Use imported league settings; include active-game peaks. Require comfortable measured headroom, not just a passing synthetic request.

Current unchanged storage behavior estimates roughly 1.2 GiB new data per 30 days per comparable league, or roughly 2.3 GiB for two, on top of existing history. These are rounded extrapolations, not an infrastructure load test. Recalculate after the fixes. Another league should add its own useful data and activity, while shared inputs and scheduler work remain shared.

## Implementation sequence and completion record

Deliver in reviewable units: (1) measurement/recovery and complete call/dependency inventory; (2) revision-aware browser fetching and bounded reads; (3) staged-data lifecycle with recovery tests; (4) replace full archive writes/readers with current state, selected compact samples and summaries; (5) summarize useful history and safely expire bulk historical payloads; (6) enforce TTL/byte budgets and observe one-/two-league capacity. Stop the accumulation promptly rather than waiting for every unrelated optimization. Steps 2 and 3 address different costs and may be developed independently, but integrate schema changes sequentially.

Record migration names, deployed commit, before/after measurements, retained evidence contract, rollback/restore evidence and outstanding limits here. Preserve existing unrelated checkout changes. Load Supabase Postgres Best Practices before database changes.

Status on October 28: diagnosis and handoff complete; optimization code, cleanup, migrations and production deployment remain to be implemented. No production records were deleted by this handoff update.
