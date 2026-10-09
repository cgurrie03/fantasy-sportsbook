# Automatic Line Refresh and Live Betting

Read [shared context](PROJECT-CONTEXT.md) first.

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

Added a read-only, membership-protected `/api/active-starters` endpoint and a red In progress badge in the top-left of each matchup card when either team has an active starter. It reads the current regular-season NFL week, actual Sleeper matchup starters (not projected optimal lineups), the public player directory and current ESPN game states. Bench players do not trigger badges. Halftime/end-period count as active; final, delayed and suspended games do not. Team abbreviation aliases and defense IDs are mapped. Known Out/IR/PUP/Suspended entries are excluded; missing mappings are labelled incomplete. This means the starter's NFL game is underway, not confirmed participation in the current snap. Player names and counts are not displayed, per the confirmed UI preference. It never changes odds or enables live acceptance.

The browser checks once per minute, removes stale badges after three minutes and displays unavailable status on source failures. The public player directory is cached up to 24 hours per warm function instance, consistent with Sleeper's documented directory guidance; roster and game checks are fresh per request. Provider timestamps/participation are still not a live betting feed SLA.

Verification: `test:starters`, compiled `test:api`, build, lint (existing warnings only), and refresh regressions passed. Real read-only sources returned NFL 2026 week 5, DAL/TB in progress, 12 fantasy rosters, six with active starters and zero missing mappings. Mobile preview measured width/scroll width 390. No schema migration, bets or emails were needed. Added files: starter endpoint/helper, frontend hook/component and targeted tests; updated scoreboard team extraction, Sportsbook styles, review fixture, runtime check and CI.

The 15-minute/120-minute timer is functional, but in-game cycles still suspend rather than publish unsafe pregame-derived live prices. All live acceptance gates above remain. Application deployment uses the established main/Vercel flow; the final receipt in the chat outputs records the verified release.
## Confirmed Behavior

Generate and publish all supported betting lines automatically every 15 minutes while **any NFL game is in progress**, every two hours otherwise. Tuesday's scheduled rollover remains the only automatic week transition. Live betting is explicitly requested. Published boards must also refresh; previously accepted tickets retain their terms.

Do not treat a delayed kickoff, halftime, overtime, weather suspension, postponement or final game as the same state. Define normalized provider states: halftime/overtime belong to in-progress; a suspended game needs a specific status/freshness policy. Investigate the provider's definitions and test them. A schedule-aware heartbeat detects state changes promptly; it must not wait two hours to notice the first kickoff.

## Existing Foundation and Gaps

`docs/scheduler-bootstrap.sql` defines a once-per-minute protected worker dispatcher. `api/weekly-worker.ts` claims one job and runs it within a 60-second function limit. Generation/refresh operations and weekly settlement already exist. Reuse this pipeline after verifying actual Cron runs, worker authentication, and queue health.

The worker currently fetches roster standings from a hardcoded Sleeper league at `api/weekly-worker.ts:270`. Resolve the requested job's league configuration instead. Do not replicate this constant in new jobs. Existing generation operations can retain published boards; intraday refresh operations must explicitly publish valid revisions without reopening a manually paused/closed board.

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
