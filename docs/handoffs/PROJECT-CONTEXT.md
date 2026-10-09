# Shared Project Context

Snapshot: October 8, 2026. Verify current code and deployment before implementation.

## Project

- Checkout: `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`.
- Private repository: `cgurrie03/fantasy-sportsbook`.
- Current working branch: `stage-1-accounts`; production branch: `main`.
- Last deployment recorded in the preceding work: `574ab7d`, Vercel Ready. Recheck rather than assuming it remains latest.
- Production: https://sportsbook.coopergurrie.com.
- Stack: React 19, TypeScript, Vite, Vercel functions, Supabase/Postgres, Sleeper data, HTML email delivery.
- Supabase project: `bmvjcdgxwxqalaohpsnw`.
- Current league UUID: `13121261-5398-4391-8240-000000000003`; Sleeper league: `1312126153980391424`.
- Current display context: Season 3, NFL 2026, Week 5. These values must become configuration, not new hardcoded constants.
- This is a private fantasy sportsbook using pretend league currency.

## Existing Architecture to Inspect

- `src/App.tsx`: sign-in, selected membership, account/admin navigation, profile and balance.
- `src/components/Sportsbook.tsx` and `.css`: home markets, player points, selected picks, ticket dialog.
- `src/components/MarketAdmin.tsx`, `AdminHub.tsx`, `TicketHistory.tsx`: administration and ticket history.
- `src/components/Reports.tsx`, `ReportFigure.tsx`: grouped reporting and exports.
- `src/lib/markets.ts`: market types, compatibility and price helpers.
- `api/generate-markets.ts`, `api/_lib/line-model.ts`, futures helpers: generation and model inputs.
- `api/weekly-worker.ts`: protected job claim/execution, generation, publication and email operations.
- `docs/scheduler-bootstrap.sql`: Supabase Cron/pg_net once-per-minute worker heartbeat setup. Repository setup is not proof of today's production health.
- `supabase/migrations/`: database operations, authorization, jobs, ticket settlement and reporting archives. Read the relevant migrations in order; never renumber deployed migrations.
- `docs/weekly-execution-plan.md`, `docs/season-futures.md`, `docs/lineup-locks.md`: preceding product rules. New confirmed decisions in this bundle take precedence where they explicitly extend behavior.

## Rules That Must Survive

- Ticket acceptance stores original selections, line values, odds, model/quote context, and payout rules. Later refreshes must not rewrite those snapshots or original projection benchmarks.
- Admin cancellation produces a Voided ticket and exactly one stake refund, with history retained. Do not physically delete accepted bets to hide them.
- Player Points legs push when the player does not play; unresolved results wait for review rather than inventing a result.
- Tuesday replenishment waits for a user's unresolved weekly tickets and flags review. Available cash is topped up to `max($25, $100 - open futures stakes)`, retaining any higher balance.
- Pregame best-lineup modeling uses active roster and bench only. Exclude Taxi and IR. Search valid positive projected alternatives before locking; never use a player twice or put them into an ineligible position.
- During games, a player whose real NFL game has started cannot be hypothetically swapped away. Apply actual league lineup-lock rules and separate observed starts from hypothetical best-lineup forecasts.
- Weekly specials permit singles and compatible parlays; contradicting selections are blocked.
- Make/Miss Playoffs: playoff-only parlays. League Winner and #1 Pick: singles only. Regular-season wins: singles or win-total-only parlays, with half-point lines.
- Odds increments: matchup 10, weekly specials 25, futures 50; futures capped at ±10,000. Keep internal unrounded probabilities separate from displayed prices. Verify how Player Points is classified before applying rounding.
- The bottom five regular-season teams determine the first five draft positions. Show pick ownership separately from the team finishing last. Do not confuse ownership with the modeled outcome.
- Seven playoff teams beginning Week 15, record then points, top seed bye: previously tentatively confirmed; verify actual league settings/custom rules before modeling or settlement.
- Wednesday 7:30 AM Eastern regeneration runs even on an already-published board. Wednesday 8 AM publication/opening email uses the final successful published lines unless publication is paused.
- Opening emails show records, featured matchups, boosted terms, the top four championship contenders, and high/low projected teams. Repeated intraday refreshes must not resend the opening email.
- Tuesday recap is 8:15 AM Eastern after replenishment; reminders target users with nonzero available balance. Existing scheduling, settlement and delivery idempotency must remain intact.
- Reports use completed weeks for final projection performance; reconstructed historical projections must stay distinguished from archived forecasts.

## Development Discipline

Read applicable skills and repository instructions. Load Supabase Postgres Best Practices before any SQL/schema/RLS/job changes. Use frontend and React skills for UI changes; React Email for email changes; Validate Data for forecast claims.

Never print `.env.local`, service-role keys, worker secrets, email credentials, tokens, or private account data. Do not commit secrets. Preserve unrelated untracked `data/` and `docs/2026-10-06-delivery-recovery.md`; stage only intended files.

Use meaningful tests for pricing, authorization, concurrent acceptance, refund/redemption and scheduling behavior. Existing commands include `test:lines`, `test:weekly`, `test:futures`, `test:reporting`, `test:api`, `lint`, and `build`. Inspect which apply. A production-like function-runtime check matters because earlier functions failed after deployment despite UI previews working.

Use preview/test data for acceptance and delivery tests; do not place live bets or send bulk test emails. Show browser previews for visible UI changes. Verify real viewport dimensions before claiming mobile testing.

Each completed chat must update its handoff with files changed, migrations applied, tests, deployment commit/status, remaining decisions and rollback approach. Runtime odds updates are database publications; only application changes need Git/Vercel deployment.

Live follow-up: migration 029 adds immutable shadow histories and automatic completed-week accuracy reviews. The existing worker collects live experimental matchup forecasts; acceptance stays disabled pending freshness/model validation. Admin history and five-second green/red line movement indicators are implemented. See handoff 01 for scope, checks and remaining gates. Deployment/job evidence will be recorded with the verified release.

Live logging production evidence: eb79c03 Vercel Ready at 10:39 PM Eastern. Unattended 10:46 PM cycle saved five experimental matchup forecasts at 10:47 PM. Weekly board closed; live freshness unverified and acceptance disabled. Immutable histories and automatic completed-week reviews are installed. See handoff 01.
