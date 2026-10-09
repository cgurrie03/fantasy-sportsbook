# Automatic Line Refresh and Live Betting

Read [shared context](PROJECT-CONTEXT.md) first.

## Current handoff — October 8, 2026, after live logging deployment

**Authoritative current status: scheduled refresh infrastructure, starter activity UI, experimental live pricing/logging and automatic weekly assessment are deployed. Live quote publication and live ticket acceptance are NOT enabled.** The detailed implementation history and original target specification below must not be mistaken for completed live betting.

The user understands and accepts this staging: capability exists for collection, experimental estimates and evaluation; prices stay unavailable for betting until accuracy, source freshness and acceptance safeguards pass validation. There is no promised launch next week, automatic confidence threshold, automatic model promotion or automatic family enablement. One completed week may be insufficient. No paid NFL subscription is requested. Continue investigating the free sources without buying services.

### Deployed and functional

| Capability | Current production behavior |
| --- | --- |
| Scheduler | Existing Supabase Cron/pg_net heartbeat invokes the protected worker every minute. Cadence is 15 minutes when ANY NFL game is actually in progress, 120 minutes otherwise. Queue jobs run one family per worker invocation; the first kickoff is detected independently of that timer. |
| Pregame refresh | Revisioned atomic publication of eligible published boards is implemented and regression tested. Closed/draft/paused boards stay closed. Actual unattended pregame publication still awaits verification in a safe pregame window. |
| In-game refresh | After the week has started, the matchup job collects and archives shadow forecasts at each eligible cycle, including inactive gaps at the 120-minute cadence. The quote-publication cycle suspends live markets. It does not publish the experimental prices. |
| Live inputs/model | Actual Sleeper weekly starters/points, scoring settings, prior projections, historical scores and ESPN clocks are captured. live-clock-shadow-v1 estimates final points as observed plus remaining output; finished players have zero remaining output. Invalid inputs suspend affected teams/matchups with logged reasons. Model assumptions are experimental. |
| Logs | Append-only live_forecast_runs includes source inputs/hash, observed/capture times, frozen model configuration, per-team forecasts/reasons and matchup shadow prices. Published forecast_snapshots and live_model_reviews are also immutable. Admin reads are RLS protected; insert RPCs require the current service-worker lease. |
| Accuracy review | model_review jobs are scheduled after the week advances, with explicit previous-week final-game confirmation (including week-18 postseason handling). Reports append on corrected outcome/forecast hashes and never rewrite an earlier assessment. Daily correction checks run during the following week. No actual completed-week live report has been observed yet. |
| Review methodology | Latest valid team/matchup forecast per league-game progress quartile; MAE, RMSE, bias, 80% interval coverage, Brier/log loss, margin/total errors. Changed final lineups are excluded; ties/exclusions are recorded. Repeated snapshots/horizons are not treated as independent evidence. No futures accuracy is inferred. |
| UI | Red In progress sits at the top-left BELOW Game of the Week/Tank Bowl banners when an actual starting player's NFL game is active. No player names/counts. Admin Weekly Schedule displays recent shadow revisions, unavailable prices and eventual accuracy results. |
| Movement indicator | A numeric live line increase displays a small green upward caret; decrease displays a red downward caret relative to the previous visible value. Only the caret disappears after five seconds; the updated amount stays. Initial load/unchanged values/week changes do not animate. This behavior is deployed and preview verified; members currently have no enabled live prices to animate. |
| Ticket safeguards | Server-authoritative revision/freshness/state checks, explicit approval of changed prices, immutable accepted terms, request idempotency and wallet locking are implemented. Live acceptance remains blocked independently of UI state. |
| Preserved behavior | Existing Tuesday rollover/replenishment, Thursday pregame close/promo expiry, admin pause and settlement/email priorities. Interval refreshes do not resend opening emails. League configuration replaces hardcoded API league lookups. Runtime updates write to the database, without repeated Git pushes. |

### Deployment and actual unattended evidence

- Production: https://sportsbook.coopergurrie.com; Supabase project bmvjcdgxwxqalaohpsnw.
- Application commit eb79c03568b51b6742caa4175b036dad155ddfb9: Vercel Ready/Production at October 8, 10:39:44 PM Eastern. Deployment https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/CFKrvST8hQKisYGERdQC5TjkfkXK.
- Last verified repository release 1eb4123af4fc6caca87d9f0b6f8953b0b9edfa09 contains the evidence handoff only; also Vercel Ready, https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/5MaCuqREtTP8QchvgpBB88UdKebR. This handoff revision is documentation only. Verify current production on the next development chat; these are recorded observations, not a new health check.
- Migrations 202610090027_revisioned_refresh.sql, 202610090028_refresh_cache_retention.sql and 202610090029_live_shadow_history.sql were applied successfully to production. Do not reapply or renumber them. New changes need a new migration.
- Cron created the unattended cycle at October 8, 10:46:00 PM Eastern (October 9, 02:46 UTC). Futures completed 10:46 PM, matchups 10:47 PM, players 10:48 PM and specials 10:49 PM. All four jobs completed; the cycle finished suspended as intended. No manual worker invocation.
- Matchup snapshot 9638b47d-dff9-4c5a-94b4-af3472386941 captured five shadow matchup prices and twelve roster input records at 10:47:01 PM Eastern. Weekly board remained closed and live_freshness_verified remained false. This proves unattended collection/logging and safe suspension, not live acceptance or model accuracy.
- Week 5 was ongoing at verification. Automatic end-of-week report execution and actual accuracy remain pending final results. No live bets, purchases or bulk test emails were made.

### Tests completed and their limits

- test:refresh: kickoff/overlap/gap/halftime/overtime/final/delay/unknown/DST scheduling, deduplication/coalescing, staged atomic revisions, pause/closure preservation, quote expiry/source failure, explicit changed-price approval/race orderings, resolved-outcome rejection, ticket immutability/idempotent debit, lease fencing, roles and settlement with original accepted odds.
- test:live: remaining-points boundaries/negative scoring/final players, actual-starter locks, missing/mismatched inputs and overtime suspension, final-week gating, latest-per-horizon deduplication and independently checked error metrics, corrected append-only assessments, RLS restrictions, idempotency and lost-lease rejection.
- test:starters and production-like compiled test:api passed. Existing weekly, futures, reporting, line-model, account and import regressions passed during this work. Futures specifically checked immutable accepted odds/snapshots, refreshes, refunds, settlement and cash-floor rules.
- TypeScript/production build passed. Lint passed with advisory warnings; no clean-zero-warning claim. CI includes refresh/live/starter and existing regression checks.
- Desktop and measured 390×844 mobile previews passed without page overflow. Both caret directions and removal after five seconds were observed while the updated number remained. Review fixtures disable bets and emails.
- PGlite races use sequential transactions in both orderings; simultaneous multi-connection hosted Postgres contention is NOT proven. Feed latency is NOT established by successful HTTP requests or a recent scoring record timestamp. Weekly assessment and unpaused pregame publication are installed/tested paths, not yet observed end-to-end in production.

### Remaining work before enabling any live market

1. Recheck production, heartbeat/queue health, stored shadow inputs and suspension reasons. Investigate scoring disagreements against league rules; do not fill missing observations with invented zeroes or substitute full pregame projections as remaining points.
2. Observe the completed-week model_review job, confirm final outcome coverage/corrections and independently validate reported metrics. Keep enough independent completed-week evidence to evaluate accuracy and probability calibration; define evidence-based launch criteria. There is no agreed numeric accuracy threshold or launch date.
3. Measure actual scoring/status lag and outage detection, distinguish unchanged stats from a stale feed, and choose an acceptance freshness budget. ESPN scoreboard and Sleeper stats/projection endpoints are best-effort/partly undocumented; there is no verified live SLA. Provider fetch times and per-record updated_at are not feed heartbeat evidence. Revisit a provider/product decision only if free sources cannot meet measured requirements.
4. Validate remaining opportunity, uncertainty and shared-game correlations; handle overtime, injury/participation changes and legal lineup changes before kickoff. The current clock-rate prior (30 minutes), standard-deviation floor and normal independent uncertainty are uncalibrated. Actual starter snapshots protect started players but do not prove snap participation.
5. Implement and test live pricing by market family. Current shadow quotes cover matchup spread/total/fair moneyline estimates only. Live team totals, player props, weekly specials and futures/provisional standings are not completed; known/impossible outcomes need family-specific checks.
6. Deliberately implement the live board lifecycle after Thursday close without reviving a paused board or extending pregame promos. Wire validated atomic live publication and fresh server-authoritative acceptance, then exercise changed-price approval, simultaneous acceptance/publication races, retries, source outages and settlement in production-like tests. The current worker/stage/acceptance paths hard-block week_started; changing a family flag alone does NOT launch live betting.
7. Enable each family individually only after those checks pass. No automatic enable job exists. Preserve accepted tickets, opening-email idempotency and higher-priority settlement/replenishment/email jobs.

### Where the next chat should work

Read PROJECT-CONTEXT.md, this current handoff, and (if present) 02-model-evaluation-and-calibration.md. Start with api/_lib/live-model.ts, live-pipeline.ts and live-review.ts; api/weekly-worker.ts; migrations 027–029; scripts/test-live-model.mjs and test-refresh.mjs. Frontend: LineMovement.tsx, LiveModelLog.tsx, Sportsbook.tsx/.css, active-starters helper/endpoint/hook and WeeklySchedule.tsx. Runtime import checks are in scripts/test-api-runtime.mjs; preview fixtures in scripts/render-refresh-review.mjs; commands in package.json and CI in .github/workflows/checks.yml.

Use installed Supabase Postgres Best Practices before database work; React/frontend skills for UI; Statistical Analysis/Validate Data for accuracy claims. Never print secrets. Preserve unrelated dirty docs/promos-boosts-handoff.md and untracked data/, delivery-recovery notes and other handoff files. Stage only task changes. Normal application deployment uses main/Vercel; no CLI-only assumption and no new scheduler service required.

Rollback the collector/UI application change if necessary while retaining immutable tables/logs and all ticket safeguards. Do not delete history or disable the existing settlement scheduler. Raw working source caches expire via migration 028; long-term shadow archive retention/storage growth still needs a deliberate policy compatible with append-only history.

## Earlier implementation history and original target specification

The sections below retain context. Prospective requirements are not additional claims of deployed functionality; the current status above takes precedence.


## Implementation update — October 8, 2026

Status: refresh infrastructure and fail-closed live phase implemented. Migrations `202610090027_revisioned_refresh.sql` and `202610090028_refresh_cache_retention.sql` applied successfully to production through the Supabase SQL editor. Application releases `b1e068b` and `5dcce00` were verified Vercel Ready; the final cache-retention/documentation release follows through the same main-branch flow. Live acceptance is deliberately disabled for every family; this is not a completed live pricing launch.

The user clarified that no paid NFL subscription is wanted; only game-in-progress detection is needed for cadence. ESPN's public scoreboard is used for best-effort cadence detection, not live pricing. It is not an officially documented/SLA-backed API. Sleeper's documented API does not supply a documented remaining-points model. No subscription was purchased or provider account created.

### Functional scope

- Every worker heartbeat merges the current NFL scoreboard with Eastern today/yesterday requests (including overnight games), and filters week-started detection to the Eastern Tuesday–Monday window, independently of the two-hour quote timer. Actual in-progress, halftime and end-period states use 15 minutes; other states use 120 minutes. Suspended/unknown states and source failures fail closed. Week-started stays sticky until the existing Tuesday period changes; final scores never turn into fresh pregame predictions.
- Four explicit interval operations cover matchups, player points, specials and futures. One leased cycle per league stages all families, shares immutable source responses by cycle/path, and publishes complete weekly/future boards in one transaction with revision checks. A failed category cannot expose a partial board. Missed slots coalesce; old cycles expire; claims prioritize settlement, replenishment, cutoff and email operations over interval work. Runtime updates require no Git pushes.
- Closed/draft boards are skipped. Publication pause remains authoritative. Thursday pregame close and promo cutoff are unchanged. Refreshes do not enqueue opening or failure emails. Normal email delivery remains in the worker.
- Server acceptance keeps existing membership, compatibility, wallet locks, request idempotency and accepted snapshots. It additionally rejects expired quotes, stale/unknown game state, suspended/resolved selections and all live-phase acceptance. Database triggers protect accepted stake, line, odds, payout and settlement context; settlement fields remain writable. Ticket classification remains assigned by existing acceptance.
- Board+quotes are loaded as a single RLS-protected database snapshot. Selected prices retain their revision through polling. Revision changes require the explicit “Approve updated lines and prices” action; unavailable selections remain visible.
- Worker, generator and settlement now resolve Sleeper IDs from the requested league configuration; no hardcoded league lookup remains in `api/`.
- Member/admin status UI shows cadence, unavailable-live reason, and admin source/next-due/last-success timestamps. Per-family live flags default false and no enable action is exposed.

### Verification

`test:refresh` executes migrations in PGlite and tests normalized status states, kickoff/overlap/gaps, DST, interval deduplication, four-stage atomic publication, manual revision race, pause/closure preservation, source/quote expiry, server resolved-outcome rejection, immutable accepted terms, duplicate request/debit behavior, lease fencing, role restrictions, and settlement using original accepted odds. PGlite tests exercise both race orderings through sequential transactions; they do not prove simultaneous multi-connection Postgres contention.

Existing `test:weekly`, `test:futures`, `test:lines`, `test:reporting`, `test:accounts`, `test:import`, production-like transpiled `test:api`, and `build` pass. Lint passes with existing advisory warnings. CI now runs refresh, weekly and futures tests. No live ticket or bulk test email was submitted.

Desktop preview was captured at 1440×1000. Mobile viewport was measured at 390×844 with document scroll width 390 (no horizontal overflow). Local review uses illustrative data and blocks ticket/email submission.

Before changes, production `main` and checkout both matched `574ab7d`; Vercel showed Ready. Supabase Cron `sportsbook-weekly-worker` was active on `* * * * *`, automation enabled, publication unpaused, six jobs done and no queued failures. Cron succeeded at 2026-10-09 01:28 UTC; consecutive worker responses at 01:16, 01:17 and 01:18 UTC were HTTP 200 without timeouts. These are old-worker health evidence, distinct from new interval shadow-cycle evidence.

Post-release unattended evidence: at 2026-10-09 01:46 UTC (October 8, 9:46 PM Eastern), game observation showed active=true, week_started=true, interval=15. All four interval jobs finished, and the cycle completed as suspended with the explicit missing observed-starter/remaining-model reason. No manual worker invocation, live acceptance or opening-email replay was used. Actual unattended pregame price publication still needs verification during a safe pregame window; this in-game shadow cycle proves cadence, queue execution and suspension, not live pricing. The first ESPN weekly-range request failed closed with HTTP 400; release 5dcce00 corrected the request shape and added overnight coverage plus regression tests.

### Remaining gates and decisions

All live families remain unavailable because cadence-only status cannot establish safe live prices. Still required: verified observed starter scoring/locks, player ID mapping, a validated remaining-opportunity model and correlated simulations, provisional futures standings, threshold/impossibility suspension, measured observation latency, and a shadow publication/acceptance cycle for each family. The schema marks the weekly live phase separately; it does not reopen the closed Thursday board or enable a live betting window. A future implementation must deliberately define that live window and its promo contract.

The cadence source's fetch timestamp is only a polling timestamp. It is not proof of event or player-stat freshness. A 3-minute status-check budget and 130-minute pregame quote expiry are conservative fail-closed controls, not measured live-feed SLAs. No live freshness budget has been selected.

Documented provider research: [SportsDataIO timing](https://sportsdata.io/help/refresh-rates-feeds-and-timing) describes typical score/stat updates around 20–30 seconds from cable broadcast and a 3-second cache, with polling every 3–5 seconds for licensed real-time access. [SportsDataIO subscriptions](https://sportsdata.io/help/data-rights-and-licensing-questions) and [pricing](https://sportsdata.io/developers) distinguish delayed personal-use access from production licensing. The personal fantasy tier is $99/month or $599/year and is unsuitable for live acceptance; real-time licensing needs a quote. [Sportradar live retrieval](https://developer.sportradar.com/football/docs/nfl-ig-live-game-retrieval) describes live game feeds/push and a 3-second live TTL, and warns schedule status updates on a timer. TTL is not measured end-to-end latency; its applicable license/price was not confirmed. Neither provider's general documentation validates fantasy remaining-points pricing.

### Files and rollback

Changed: `api/_lib/game-status.ts`, generator/worker/settlement/placement APIs, `src/lib/markets.ts`, `Sportsbook`, `WeeklySchedule`, `LineRefreshStatus`, status/review styles, migrations 027–028, `scripts/test-refresh.mjs`, API runtime import list, local review renderer, package scripts and CI checks.

Rollback: redeploy the prior application commit and stop only interval enqueueing by restoring `observe_line_refresh` to a service-only no-op. Preserve all accepted tickets and new archives. Do not delete tickets, replay emails, or roll back the existing settlement scheduler. Keep live acceptance disabled; do not remove freshness/immutability guards just to reopen markets. Migration 028 releases raw source caches when a cycle completes or is superseded, and the heartbeat cleans expired working responses. Published forecasts and accepted snapshots retain their existing archives.

## Starter activity follow-up — October 8, 2026

Added a read-only, membership-protected `/api/active-starters` endpoint and a red In progress badge in the top-left of each matchup card, below its Game of the Week / Tank Bowl banner, when either team has an active starter. It reads the current regular-season NFL week, actual Sleeper matchup starters (not projected optimal lineups), the public player directory and current ESPN game states. Bench players do not trigger badges. Halftime/end-period count as active; final, delayed and suspended games do not. Team abbreviation aliases and defense IDs are mapped. Known Out/IR/PUP/Suspended entries are excluded; missing mappings are labelled incomplete. This means the starter's NFL game is underway, not confirmed participation in the current snap. Player names and counts are not displayed, per the confirmed UI preference. It never changes odds or enables live acceptance.

The browser checks once per minute, removes stale badges after three minutes and displays unavailable status on source failures. The public player directory is cached up to 24 hours per warm function instance, consistent with Sleeper's documented directory guidance; roster and game checks are fresh per request. Provider timestamps/participation are still not a live betting feed SLA.

Verification: `test:starters`, compiled `test:api`, build, lint (existing warnings only), and refresh regressions passed. Real read-only sources returned NFL 2026 week 5, DAL/TB in progress, 12 fantasy rosters, six with active starters and zero missing mappings. Mobile preview measured width/scroll width 390. No schema migration, bets or emails were needed. Added files: starter endpoint/helper, frontend hook/component and targeted tests; updated scoreboard team extraction, Sportsbook styles, review fixture, runtime check and CI.

The 15-minute/120-minute timer is functional, but in-game cycles still suspend rather than publish unsafe pregame-derived live prices. All live acceptance gates above remain. Application deployment uses the established main/Vercel flow; the final receipt in the chat outputs records the verified release.
## Confirmed Behavior

Generate and publish all supported betting lines automatically every 15 minutes while **any NFL game is in progress**, every two hours otherwise. Tuesday's scheduled rollover remains the only automatic week transition. Live betting is explicitly requested. Published boards must also refresh; previously accepted tickets retain their terms.

Do not treat a delayed kickoff, halftime, overtime, weather suspension, postponement or final game as the same state. Define normalized provider states: halftime/overtime belong to in-progress; a suspended game needs a specific status/freshness policy. Investigate the provider's definitions and test them. A schedule-aware heartbeat detects state changes promptly; it must not wait two hours to notice the first kickoff.

## Existing Foundation and Gaps

`docs/scheduler-bootstrap.sql` defines a once-per-minute protected worker dispatcher. `api/weekly-worker.ts` claims one job and runs it within a 60-second function limit. Generation/refresh operations and weekly settlement already exist. Reuse this pipeline after verifying actual Cron runs, worker authentication, and queue health.

Original gap, now fixed: worker/generator/settlement resolve the requested job's league configuration instead of a hardcoded Sleeper league. Do not reintroduce this constant in new jobs. Existing generation operations can retain published boards; intraday refresh operations must explicitly publish valid revisions without reopening a manually paused/closed board.

The current projection model is pregame. It is **not** a live remaining-points model. Source full live inputs before offering live prices.

Documented providers worth evaluating include [SportsDataIO's NFL workflow](https://sportsdata.io/developers/workflow-guide/nfl), which describes scores, statistics and fantasy projections, and [Sportradar's live NFL retrieval](https://developer.sportradar.com/football/docs/nfl-ig-live-game-retrieval), which describes live statistics and push feeds. These are researched candidates, not selected integrations or assurances of affordable access. Compare actual access, identifier mapping, usage terms, latency, historical snapshots and cost. Neither source's general documentation alone validates a fantasy remaining-points pricing model.

## Data and Live Pricing

1. Establish a reliable NFL schedule/status source, observed player statistics, actual league starters/locks, and remaining-game estimates. Verify timestamps, endpoint access, rate limits, provider usage terms and latency. Do not assume undocumented Sleeper endpoints provide supported live projections.
2. Compute projected final fantasy totals as **observed fantasy points plus expected remaining points** for actual scoring starters. Finished players have no remaining points. A game halfway through cannot retain its entire pregame estimate as remaining output.
3. Use positive bench replacements only for slots still legally changeable. Never replace a locked started player with a better bench forecast. Detect player/roster mismatches and distinguish missing data from genuinely zero remaining opportunity.
4. Model uncertainty using remaining time/opportunity and correlations. Recalculate spreads, total, team total and moneyline consistently from the same simulation. Re-evaluate weekly specials and futures with observed results/provisional standings without prematurely treating unfinished games as final wins.
5. Player props should represent final full-game points in v1, labeled clearly. Suspend selections whose threshold is already determined; do not offer a guaranteed over on a threshold already exceeded. A future remaining-points prop requires a different market type and settlement contract.
6. Exact weekly count, highest/lowest and yes/no specials require completion-aware logic. Suspend resolved outcomes and impossible options. All markets need explicit open/suspended/closed/settled states with reasons.

The user requested 15-minute **line regeneration**, not permission to accept 15-minute-old live information. Acceptance must check substantially fresher status/observations and suspend known/resolved or stale outcomes. Select a measurable freshness budget from actual provider performance; if the feed cannot support safe acceptance, keep that live market unavailable and explain why.

## Scheduling and Publication

- Store UTC timestamps; display Eastern using `America/New_York` for DST. Run the heartbeat independently of local browser sessions.
- Track last success, next due, interval, provider freshness, publication pause, and failure reason per league/category. An administrator sees status without needing to click Generate.
- Use unique interval-slot job keys and leased claims. Coalesce missed refreshes into the latest due snapshot instead of replaying every missed interval. Bound retries with backoff and recover abandoned leases.
- Avoid overlapping manual and scheduled updates with a league/board lock and revision check. Share source fetches and simulation inputs across categories, with caching scoped by season/week/league/scoring rules and source revision.
- Divide expensive jobs into bounded tasks rather than exceeding the existing function budget. Preserve settlement, replenishment, cutoff and email priorities; a flood of refresh jobs must not starve them.
- Stage a complete coherent quote revision and atomically publish it. Do not expose half-updated team totals versus match totals. Keep the last valid revision only when it is still fresh enough to accept; otherwise suspend.
- Keep manual pause authoritative. Refreshes cannot silently undo admin closures or publish a partially failed category.
- Intraday refresh does not advance weeks, replenish wallets, settle tickets, or repeatedly send weekly email. Opening email uses the successful final opening revision; later betting uses later revisions.
- Include Season Futures in the requested refresh scope, with a distinct operation rather than letting an unknown refresh suffix fall into the current Weekly Specials branch. Cache reusable simulation inputs, update the current week's outcomes as provisional until final, and preserve original regular-season win-total benchmarks and accepted futures odds.
- Define a separate **live board/phase** after the existing Thursday 8 PM pregame closure. Thursday promo expiry still applies. Preserve current weekly closure jobs until the live lifecycle is implemented deliberately.

## Ticket Acceptance and UX

The server accepts a quote revision, not client-trusted odds. In one authoritative transaction validate league membership, market state/freshness, balance, compatibility, and price; debit once and snapshot all terms. With a changed line, return the new quote and request explicit acceptance. Never silently change a selected spread or payout. Reject already-determined outcomes even if the UI is stale. Include request idempotency and two-tab/race handling.

Show Live, last updated, market suspension reason, and a concise changed-lines review. Keep refreshed amounts readable and avoid layout jumps. A stale/closed selection stays visible in the slip with a reason; it does not disappear silently. Existing ticket history never changes because of this refresh.

## Acceptance Gates

Test first kickoff, overlapping games, gaps with no active game, halftime, overtime, final whistles, delays, cancellations, DST, missed worker runs, stale feeds and provider outages. Test duplicate claims, manual/scheduled races, category partial failures, changed quotes, resolved prop thresholds, live player locks, and immutable accepted tickets. Run a shadow interval cycle with production-like sources and verify jobs execute unattended before live acceptance is enabled. Each market family has its own enable flag; no broad live launch until its tests pass.

## Sources

- [Supabase Cron](https://supabase.com/docs/guides/cron): existing scheduling platform and run history.
- [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing): Hobby frequency does not support this cadence; existing Supabase scheduling avoids assuming a Vercel upgrade is required.
- [Sleeper documented API](https://docs.sleeper.com/): read-only fantasy endpoints and rate-limit guidance. Documentation does not establish a complete live-pricing data feed.
### Live repricing feasibility follow-up

The existing timer checks every 15 minutes during any active game, but in-game quote cycles currently suspend. They do not publish refreshed live lines. A fresh read-only check of Sleeper weekly matchup responses showed points, starters_points and players_points; six league matchups had nonzero points during the Thursday game. The existing undocumented weekly stats endpoint returned HTTP 200 with 145 DAL/TB records and updated_at/last_modified timestamps. The documented matchup API exposes actual starters and team points; general documentation still does not promise live scoring latency or supply a remaining-points model. Individual scoring-record timestamps may represent the last stat change, not feed heartbeat freshness. Reachability alone is not proof of safe acceptance.

Free-source live pricing is a candidate, not ruled out by the lack of a paid subscription. Before enabling it: validate mapping and scoring against league rules, distinguish no new stats from a stale feed, use actual locked starters and a tested remaining-opportunity estimate, run shadow prices and enable families individually. Do not remove the current fail-closed gate or simply rerun the full pregame forecast during active games.

UI follow-up: red In progress now follows the featured banner and precedes the quote grid. The local review includes a featured banner to verify placement. Build/compiled API checks passed; browser inspection confirmed the preceding element is featured-strip. No database change or live acceptance enabled.

### October 8, 2026: live shadow updates and five-second movement indicators

Implemented a free-source shadow collector in the existing interval_matchups worker. Every active-game refresh records actual Sleeper starters, observed scoring, prior projections, historical starter scores, ESPN clocks, source hashes, model version/configuration, per-team suspension reasons and experimental matchup prices. Runtime remains 15 minutes with any active NFL game and 120 minutes otherwise; Tuesday rollover, Thursday pregame closure/promo expiry, admin pause and email/settlement priorities are unchanged. No runtime Git pushes are needed.

The experimental live-clock-shadow-v1 model adds observed points to a remaining-time estimate. Finished players have zero remaining output; started players use actual starters only. It rejects scoring disagreement, missing observations/priors, invalid mappings, empty slots, manual overrides, suspension and unmodeled overtime. The time-rate assumptions and independent normal uncertainty are uncalibrated. Stats row updated_at reflects last stat change, not a verified feed heartbeat. This is shadow-only: no live quotes are published or accepted. Other live market families remain disabled with reasons.

Migration 202610090029_live_shadow_history.sql applied to production: append-only live_forecast_runs/live_model_reviews, immutable published forecast_snapshots, admin-only read policies and service-only lease-fenced insert RPCs. Per-job keys make retries idempotent. No historical tickets or balances are rewritten. Existing accepted-ticket protections remain.

The scheduler queues model_review at priority 8 (interval jobs 9) after the NFL week advances; explicit previous-week scoreboard must show every game final. Week 18 supports postseason completion. The review deduplicates each team to one forecast per progress horizon, excludes changed final starters, and records MAE/RMSE/bias/interval coverage plus Brier/log loss/margin and total errors. Ties and exclusions are explicit. Daily correction checks append reports when outcomes or forecast inputs change. No automatic calibration or market promotion occurs.

Admin Weekly Schedule now shows logged revisions, unavailable shadow lines and the eventual weekly accuracy review. Sportsbook live numeric line changes show a green upward caret or red downward caret relative to the last visible line for five seconds; the new amount remains afterward. Initial load, unchanged values and week changes do not animate. In progress remains red below the featured banner; no player names are listed.

Validation: test:live, test:refresh, test:weekly, test:reporting, compiled API runtime, TypeScript/build passed; lint has existing warnings. Live tests exercise remaining points, locked starters, missing/stale inputs, final-game gating, latest-per-horizon metrics, lease fencing/idempotency, append immutability and RLS. Refresh regressions cover scheduling, quote approval/races, ticket immutability and settlement. Browser preview verifies both caret directions and disappearance after five seconds; review fixtures cannot create bets/emails. Production-like read-only probe at 02:24 UTC returned five shadow matchup forecasts, eleven valid teams and one scoring mismatch suspension; this is not evidence of latency or forecast accuracy.

Remaining gates before live acceptance: measured source freshness, validated remaining opportunity/uncertainty/correlation, overtime and injury-change handling, individual family acceptance tests and deliberate live board enablement. End-of-week accuracy is pending actual week completion. Rollback: revert application collector/UI commit; leave append-only archives and tables intact. Do not disable existing scheduler/ticket safeguards or delete logs.

Deployment verified: application commit eb79c03568b51b6742caa4175b036dad155ddfb9, Vercel CFKrvST8hQKisYGERdQC5TjkfkXK Ready/Production at 10:39:44 PM Eastern. Migration 029 was applied successfully. Supabase Cron started an unattended cycle at 02:46:00 UTC; interval_matchups completed at 02:47:01 UTC and saved snapshot 9638b47d-dff9-4c5a-94b4-af3472386941 with five shadow matchups and all twelve roster input records. Source hash d7e53222820a6d8f48dac6007aa1c8e71937e1b5393d6772b1b246d4a93e68b5. No manual worker invocation. Weekly board remains closed, freshness gate false and acceptance disabled. The same timer reports next due 03:01 UTC. Futures regressions also passed. Admin desktop and measured 390px mobile previews verified without page overflow. Weekly final accuracy remains pending actual week completion.
