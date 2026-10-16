# Sportsbook audit and reopening review - October 16, 2026

Implementation is prepared locally on `codex/sportsbook-reopening-audit-review`. It has not been deployed. The production database, reopening window, and reopening email have not been changed in this review turn. The earlier October 14 refresh recovery and its 12 sent opening emails remain separate completed work.

## Reopening proposal

- Close Sunday, October 18, 2026 at **12:00 PM Eastern** (`2026-10-18T16:00:00Z`). This one-time window does not rewrite recurring weekly settings.
- Captured public sources: **October 16, 6:41 PM Eastern**. The local price preview uses the repository baseline configuration, not an unverified claim about the production active model. Production activation requires fresh sources, the active production configuration, a matching reviewed snapshot, unchanged board revisions, and admin authorization.
- Recalculated all categories: **789 weekly selections and 72 futures selections**. **630 weekly selections are eligible** in this captured preview; 159 weekly selections and all 72 futures selections remain locked because their required starter/game inputs are incomplete or ineligible. League-wide specials and futures depend on all teams, so incomplete teams can lock those categories while unrelated matchup/player bets remain eligible.
- Current fantasy points appear separately from one-decimal model projections; real zero scores remain visible. Missing scores say Unavailable. Source checked time and delayed-update messaging remain visible. Scheduled score observation is 15 minutes during games and two hours otherwise, with the browser checking the saved observation each minute.
- Pricing adds verified completed starter points to forecasts for unstarted actual starters. Completed players contribute zero remaining variance. In-progress/unknown games, started-player bets, missing inputs, and already-determined outcomes stay locked. The unvalidated elapsed-clock live model remains ineligible.
- Reopening approval and announcement are separate actions. Draft preparation does not publish or queue mail. Announcement delivery uses approved league memberships, duplicate protection, and expiry checks.
- Server acceptance checks the current game state and exact kickoff. Sunday morning games cannot continue accepting stale pregame prices merely because the feed still says Scheduled.
- The approved window survives ordinary four-category refreshes, closes automatically at its deadline, and restores the futures board's normal configuration when the league advances to the next week. Existing accepted terms and wallet balances are preserved.

## Audit status

“Fixed” below means implemented and checked locally, awaiting the user's requested release review. It does not mean deployed.

| ID | Status | Change and evidence |
|---|---|---|
| S01 | Already fixed and verified | October 14 quote/RLS optimization: measured query 39.6s to 4.63s; recurring publication completed. This is database timing, not a guarantee of total device loading time. |
| S02 | Already fixed and verified | Contextual failures, retained snapshots and retry; browser failure/recovery fixtures pass. |
| S03 | Already fixed and verified | Account, markets, futures, tickets and standings load independently; slow/empty/error fixtures pass. |
| S04 | Fixed | Shared canonical event-time formatting; date-only values retain their calendar day and Time TBD. Exact kickoff drives locks. Date-only, midnight, DST and noon tests pass. |
| S05 | Fixed | Visible unavailable/lineup explanations, accessible reasons and admin diagnostics; missing projections differ from actual zero. Screens and value tests checked. |
| S06 | Fixed | Visible and accessible boosted prices use the same computed quote; ordinary/boosted price agreement and immutable accepted terms tested. |
| S07 | Fixed | Spreads and totals display the price as well as the betting target. Desktop/mobile evidence saved. |
| S08 | Fixed | Selected light-theme filters use white on dark gold, exceeding 4.5:1; contrast check and both-theme screen fixtures pass. |
| S09 | Fixed | Void control is outside the disclosure summary; confirmation and server authorization retained. Nested-control check and database permission/refund tests pass. |
| S10 | Fixed | Meaningful URL state for member/account/admin/report pages; reload, Back/Forward, exact ticket and unauthorized admin routes tested. |
| S11 | Fixed | Shared single/parlay labels, including multipick futures, across history and receipts; value/receipt checks pass. |
| S12 | Fixed | Ledger/receipt/history use Season futures rather than the futures board's internal Week 1. Exact-ticket navigation tested. |
| S13 | Fixed | Expanded standings explain settled ROI, settled stake, open stakes and replenishment exclusion. Financial reporting tests pass. |
| S14 | Fixed | Total return explicitly includes stake; profit shown separately. Refund net change is zero; receipt/value/refund tests pass. |
| S15 | Fixed | Personal My Bets removes the redundant bettor selector; visible Filters label/count and reset retained. Browser fixture passes. |
| S16 | Fixed | Search by ticket/selection/team/player, compact mode, 20-ticket increments and deliberate mobile status wrapping. 31-ticket browser fixture passes. |
| S17 | Fixed | Navigation remains on Account/Admin, nested admin breadcrumbs, and Balance History uses h2. Member route/headings fixtures pass. |
| S18 | Fixed | Semantic standings table, column/row headers and named expandable statistics region; column associations are explicit in the rendered component. |
| S19 | Fixed | Completely missing completed weeks trigger bounded results backfill; latest completed coverage/import time is separate from page check time. Missing Week 5 fixture passes even when Weeks 1-4 are final. Production backfill awaits deployment. |
| S20 | Fixed | Consistent one-decimal projections distinguished from betting targets; disabled prices retain legibility. The prior recovery report's narrower label for S20 is superseded by this correction. |
| S21 | Blocked in part | Synthetic read-only demo and eligibility copy are implemented and tested. Portfolio return link is implemented behind `VITE_PORTFOLIO_URL`; the exact HTTPS portfolio destination is still unverified and deliberately unset. |
| S22 | Fixed | Single-use/newest-link/recovery/resend instructions use the hosted setting verified read-only: 3600 seconds/60 minutes. Fresh invalid-link browser fixture passes. No real sign-in email was sent as a test. |

## Audit feature backlog

1. **Public demo:** `/#/demo`, fictional names/data, no private account load or betting/email writes. Public demo fixture passes. Screenshots and URL are ready for the portfolio owner; nobody was messaged. The verified portfolio URL remains the external dependency.
2. **Admin readiness:** Admin > Board Readiness shows source observation, pricing refresh, quote validity, category/lock counts and links to diagnostics; authorization is enforced in the database.
3. **My matchup:** Member-team shortcut preserves the slate and supplies bookmarkable matchup URL state. Target lookup stays within the loaded league board.
4. **Availability:** Shared quote refusal reasons cover missing lineup/input, cutoff, publication, suspension, resolution and reopening game-state checks; admin detail stays available.
5. **Compact searchable history:** Implemented with stable incremental pagination; verified on phone and desktop.
6. **Ledger ticket links:** Balance-history entries open the exact authorized ticket and preserve browser return context; checked with member and league isolation fixtures.

## Checks

Passed: production build/API compilation; account authorization; lineup/line model; active starters; live-model isolation; reporting/ROI; futures; league isolation; teasers; promotions; extra markets; scheduled weekly execution; refresh/rollover; reopening approval/cutoff/ordinary refresh/next-week restoration; audit value checks; audit browser regression; general responsive UI suite; ticket receipt export. All writes/bets/email actions in tests used intercepted fixtures or an in-memory database, never production.

The general UI suite covered 360, 390, 430, 768, 1024 and 1440 widths and both themes, slow/error recovery, empty/suspended/loading states, report CSV/PNG/PDF export, role isolation, price-change approval and reduced viewport height. This models viewport sizes; it is not a claim of physical-device testing. The real captured-source review was also visually inspected at desktop and 390px with no horizontal overflow.

Lint completed with zero errors and nonblocking warnings (existing hook/refresh warnings plus route-synchronization hooks and scratch outputs). No claim of zero warnings is made.

Database migrations `202610160045_reviewed_reopening.sql` and `202610160046_reopening_refresh_and_readiness.sql` applied successfully to the in-memory database. They have **not** been applied to production. Hosted concurrency and final production health/email provider verification remain release checks after approval; no real ticket should be placed simply to test release.

## Review artifacts

- Interactive local review: http://127.0.0.1:5185/reopening-audit-review.html (requires the running local preview server).
- `proposed-lines.csv`: every captured proposed quote, base price/boost, availability and reason; not a published betting board.
- `proposed-category-counts.json`: per-category counts and conditional team forecast diagnostics.
- `reopening-email.html`: rendered announcement draft; no recipients queued or emails sent.
- `reopening-desktop.png`, `reopening-mobile.png`, `locked-selections-desktop.png`: captured-source local UI evidence.
- `fixture-*`: synthetic responsive/report/ticket evidence. These are clearly separate from the real captured public league sources.

## Principal changed files

Backend: `api/generate-markets.ts`, `api/reopening-review.ts`, `api/weekly-worker.ts`, and `api/_lib/{reopening,event-time,reopening-email,auth-policy,mail,email-templates,ticket-progress,extra-markets}.ts`.

Interface: `src/App.tsx`, `src/main.tsx`, navigation/auth/ticket helpers; Sportsbook, AdminHub, Reports, TicketHistory/Filters/Progress, LeagueStandings, MatchupScores, PublicDemo, PortfolioLink, ReadinessPanel and ReopeningReview; existing CSS palette and layout retained.

Tests: `scripts/test-reopening.mjs`, `test-audit-values.mjs`, `test-audit-ux.cjs`, and the affected existing API/futures/extra-market/receipt/UI fixtures. Runtime budget set in `vercel.json`; optional verified portfolio URL documented in `.env.example`.

Unrelated pre-existing handoff/research/data files were preserved and are outside this change.
