# Shared Project Context

## Latest verified checkpoint — November 2, 2026 ET

**18 complete / 6 remaining.** Start with [handoff 40](40-SHARED-POLICY-AND-CAPABILITY-GATES.md), [consolidated continuation](../NEXT-SESSION.md) and [remaining gates](../REMAINING-MILESTONES.md). Qualified/deployed source e5ee1e2 passed43/43; protected READY Development dpl_DbHMid37bWgGwLMbfgVKexFgLQy2. Milestone16 is complete for the declared supported profile; production remains unchanged. Wallet17 and notification18 are complete DEV. Full platform recovery, historical production cleanup, external release controls, final audit/capacity and approved production release remain open. Owner key import/phone access are complete; full restore drill is owner-deferred. No GitHub push, production action, second real league or new scheduled continuation is authorized.

The earlier preparation/status narrative below is historical and does not override this checkpoint or the user's later decisions. Original handoff documents specify work; they do not grant production or external-publication approval.

## Historical context


Implementation continuation: read [13-implementation-checkpoint.md](13-implementation-checkpoint.md). Local safety/efficiency fixes are under test on `codex/boff-handoff-implementation`; nothing new is hosted. New owner decision: each approved user has an independent wallet per league, even when co-owning the same fantasy team. The legacy team-keyed wallet schema has not been migrated; existing financial tests do not prove this new behavior. Preserve original bettor attribution and never copy a shared balance into multiple accounts.

Start with [current handoff status](00-current-handoff-status.md): preparation is ready to hand off, but dev hosting, efficiency implementation and second-league readiness gates remain open. New handoff files/scripts and local development branch have not been pushed; preserve pre-existing dirty work.

## Current priority — October 28, 2026

**Email revamp requirement:** [handoff 12](12-email-lifecycle-and-season-storylines.md) adds A25. Revamp all notifications to follow current actual betting/settlement processes, with no Thursday closing reminder when the applicable final opportunity is Monday. Propose a weekly edition, actual-deadline reminder/merged ticket watch and confirmed results/replenishment recap. Rotate factual storylines and markets throughout the season, including meaningful champion/#1-pick odds movement. Retain tiny comparable weekly references, not full refresh history. Inventory auth/receipts/admin messages too. Old Thursday-specific communication directions are superseded; verify runtime eligibility and do not change acceptance rules merely to fit emails. Implement/preview in dev, release only after owner approval; no real-member test campaign.

**Dev infrastructure checkpoint:** owner-created Supabase `fantasy-sportsbook-dev` verified Healthy, reference `whlcnlacueweaqpsupqs`, Free/Nano, us-east-1; production remains separate. Local `development` branch created at `d1ea6c9` in the existing repository, without switching/staging dirty files or pushing a preview. No second repository is needed. Dev schema/auth/mail, safe Preview variables, protected dev domain and release controls remain to be configured; the hosted dev application is not ready. See handoff 09 for the next sequence.

**Development and onboarding decisions:** owner-only development with independent test accounts/data; every production release requires Cooper's approval. Recommended one repository with dev/feature branches and a separate Supabase test project, proposed domain `dev.sportsbook.coopergurrie.com`; setup is not complete. See [09](09-development-and-release-environments.md). All supported sportsbook settings start from shared defaults and can be overridden per league, initially by Cooper only. Cooper imports/reviews a Sleeper ID; commissioner distributes a league signup link; managers verify email and request approved team mapping. Teams appear without manager signup; existing users use one account and an authorized league selector. Sleeper does not provide documented member-email access; do not promise email auto-import. If free allowances remain insufficient, present further optimization options rather than purchasing an upgrade. [10](10-expanded-audit-implementation.md) expands all findings. [11](11-support-and-automatic-bug-reports.md) adds a button left of `?`, automatic errors with optional Add details, manual reports and receipt/status; **do not deploy support yet**.

**Retention decision, superseding all earlier archive requirements:** most generated data is temporary. Do not permanently store each refreshed betting line, projection or model-input payload. Keep current state, short-lived recovery/debug data, selected compact evaluation samples until reviewed, and small finalized accuracy summaries. Preserve accepted ticket terms, settlement/financial records and required idempotency keys. Full historical board/model replay is intentionally retired. Handoff 08 defines proposed TTLs, hard byte caps, cleanup monitoring and shared-project capacity targets; no savings or production cleanup are claimed yet.

User-directed first priority is **Supabase efficiency across every process**. Read [handoff 08](08-supabase-efficiency.md) before implementing any expansion. The read-only audit measured 1.085/0.5 GB database storage and 5.518/5 GB billing-cycle egress with eight monthly users; three payload-heavy tables account for approximately 93% of SQL database size. Remove permanent refresh archives, expire temporary payloads, reduce unchanged-board downloads, bound history reads and prevent model-review retry amplification. Preserve accepted terms, financial history, authorization and useful compact evaluation. The handoff contains code evidence, an ordered plan and measurable launch gates; no optimization or cleanup is deployed by this documentation update.

Latest release verified during the October 28 audit: `d1ea6c98d200326156aef76f8a8a6318b743f897`; audit checkout branch: `codex/sportsbook-reopening-audit-review`. Older release and rollout statements below are historical and require rechecking before implementation. Additional leagues are separate Sleeper NFL leagues, imported using their actual settings during onboarding. Cooper needs platform oversight without a fantasy membership/team/wallet in the second league. Sign-in/sign-up and league isolation remain required audit work. BOFF (Betting on Fantasy Football) is the user's proposed name, not a deployed rename.

Teaser handoff update, October 10: latest verified application release is **cd8a551b657fbafe825acfc1fd2a4801d5da12da**, pushed to main and verified against production assets/anonymous guards at **6:13:23 PM Eastern**. Deployed: qualifying Parlay / Teaser tabs, 6/9/12 fantasy-point preview (default 9), native bottom-sheet selector with outlined chevron button, one original/points/new-line list, “How teasers work” disclosure, conversion back, and empty wager value with 0 placeholder. **Production teaser pricing, accepted tickets and settlement are not implemented or enabled.** Local review odds are sample fixtures. One/two remaining winning legs may cash after pushes/voids; any loss loses; zero-leg refund remains an assumption to confirm. No teaser migration or live bet occurred. [Handoff 04](04-teasers.md) now separates deployed functionality, completed tests, deployment evidence and remaining research/server/database gates. This documentation-only update creates no application deployment; preserve other workstreams and verify latest remote/Vercel source before continuing.

Snapshot: October 10, 2026, after the deployed teaser slip and dropdown refinements. Read handoff 04 for teaser deployed/planned status and handoff 03 for promo implementation, tests and remaining work; handoffs 01/02/06 retain their own workstream status. Earlier rollout notes are history. Verify latest Vercel source before new work.

**Current product status:** 15-minute active-game / 120-minute inactive scheduling, pregame revision/acceptance safeguards, actual-starter matchup status, experimental live quote logs and automatic completed-week accuracy review are deployed. Dedicated league promos, fixed tickets, atomic one-use profit boosts, private validated images and the two-step selection picker are also deployed (handoff 03). Experimental prices are not published for ordinary live betting; its acceptance remains disabled. Manual fixed promos use the explicit availability exception documented in handoff 03. No automatic live launch next week or model promotion is promised. See the authoritative status and remaining gates at the top of handoff 01.

## Project

- Checkout: `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`.
- Private repository: `cgurrie03/fantasy-sportsbook`.
- Current working branch: `stage-1-accounts`; production branch: `main`.
- Last verified application release: `cd8a551b657fbafe825acfc1fd2a4801d5da12da`, October 10 teaser selector/help refinement; production assets/anonymous guards matched at 22:13:23 UTC. Prior tab-layout release `19b325a` was Vercel Ready/Production; see handoff 04 for scope and evidence. Promo migration 033 remains applied; no teaser migration was applied. This documentation update creates no new application deployment.
- Production: https://sportsbook.coopergurrie.com.
- Stack: React 19, TypeScript, Vite, Vercel functions, Supabase/Postgres, Sleeper data, HTML email delivery.
- Supabase project: `bmvjcdgxwxqalaohpsnw`.
- Current league UUID: `13121261-5398-4391-8240-000000000003`; Sleeper league: `1312126153980391424`.
- Recorded display context: Season 3, NFL 2026, Week 5. API league lookups now resolve configuration. Never add new hardcoded league/week constants.
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

Live follow-up: migration 029 adds immutable shadow histories and automatic completed-week accuracy reviews. The existing worker collects live experimental matchup forecasts; acceptance stays disabled pending freshness/model validation. Admin history and five-second green/red line movement indicators are implemented. See handoff 01 for scope, checks and remaining gates. Deployment/job evidence is recorded in handoff 01; all four 10:46–10:49 PM Eastern interval jobs completed unattended.

Live logging production evidence: eb79c03 Vercel Ready at 10:39 PM Eastern. Unattended 10:46 PM cycle saved five experimental matchup forecasts at 10:47 PM. Weekly board closed; live freshness unverified and acceptance disabled. Immutable histories and automatic completed-week reviews are installed. See handoff 01.

## Current audit release boundary — 9 October 2026

Handoff 06 is authoritative for completed UX, database migrations 030/031, recipient isolation and count-market work. Title-right eligibility, compact live notice, adjacent odds arrows and removal of redundant descriptions are deployed. Exact and At Least N+ generation/settlement code is deployed; existing published boards were not regenerated, so N+ buttons remain disabled until new quotes are published by the normal admin/worker flow. Test data is not proof of live N+ acceptance. Do not roll back to an Exact-only settlement worker after N+ tickets exist.

Owner-only onboarding/activation menu and new switching workflow remain planned. Database constraints reserve owner approval; no second live league is enabled. Existing approved dual-membership switching is preserved and tested. General private-file features remain planned; private promo images and offers are now implemented in handoff 03. Hosted promo redemption contention passed in isolated schemas; this does not satisfy unrelated concurrency, worker capacity/outage or physical-device gates. Ordinary experimental live acceptance remains disabled. No live bets or bulk test emails were performed. See handoff 06 for its exact tests, production evidence, priorities and safe rollback.

## Weekly model assessment release — 9 October 2026

Handoff 02 and `docs/model-assessment.md` describe immutable pregame archives, confirmed/corrected outcome revisions, all-generated-market review, chronological candidate replay, bounded versioned promotion, pause and rollback. Migration 032 is applied. Production postflight preserves all 47 accepted tickets; initial score/variance scales remain 1 with no promotion events. Current incomplete Week 5 is excluded. Sparse legacy snapshots do not establish retrospective accuracy. Live acceptance remains disabled; player probabilities are shadow diagnostics. Application deployment uses normal Git/Vercel releases, never weekly LLM source rewrites. Hosted concurrency, worker capacity and sufficient production validation evidence remain outstanding.

Assessment handoff 02 now separates deployed behavior from unvalidated/planned work. Its application commit `bbfbe07` was verified Vercel Ready/Production, alias sportsbook.coopergurrie.com; migration 032 is applied. That release was subsequently extended by promo commits `e49f83d` and `84d9ce6`; no assessment logic changed in those releases. No completed authenticated production assessment/promotion/rollback has yet been observed; initial baseline was active at assessment postflight. Read handoff 02 for exact gates, completed tests, remaining validation and safe next steps. This documentation update does not change production configuration or introduce another application deployment.

## Promos & Boosts release boundary — 9 October 2026

Handoff 03 is the current authoritative summary, replacing its earlier prototype-only instructions. Core release `e49f83d` and selection-picker follow-ups through `c31910e` are deployed; migration `202610090033_promotions.sql` is already applied. Home cards, mobile dots, image-overlay Claim, dedicated drafts/scheduling/usage, immutable fixed slips and atomic boosts are functional. Fixed selections use category → selection (Player Points adds a matchup dropdown), ordered Matchups → Player Projections → Weekly Specials. Only active quotes appear; matchup headings group opposing choices together, and totals have team/matchup names and current lines.

Admin-selected Eastern expiry replaces the old universal Thursday promo deadline. Extra profit is permanently uncapped; the example retains a $20 maximum wager and at least five distinct Player Points selections. Schedule offer opens no second menu: current published/open weeks appear immediately; other selected weeks wait for publication/opening and their week. Separate appearance-date picking and typed-code redemption are not implemented. Emails retain existing templates. Fully pushed boost tickets refund without restoration; full admin void restores a boost once with unchanged expiry. Fixed use remains consumed after void unless the user requests a different policy.

Build/lint, isolated database/UI regressions and hosted synthetic contention completed; latest live assets/auth smoke verified. No authenticated production member acceptance/settlement, physical-device audit or bulk test mail was performed. Do not confuse fixture art or prototype HTML with live offers. Admins supply actual artwork and terms. Preserve promo snapshots and settlement support after accepted promo tickets exist; disable offers to pause use. See handoff 03 for commands, exact evidence, optional work, test-schema residue and dirty-checkout precautions.
