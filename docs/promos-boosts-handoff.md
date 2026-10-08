# Promos & Boosts development handoff

## Goal

Build a dedicated admin Promos & Boosts area for this private fantasy sportsbook. The current admin entry routes to MarketAdmin, so it is not a complete promotion-management interface. Review existing boost behavior before designing the new workflow. Keep the familiar gold/navy design, shared light/dark themes and readable mobile layouts.

## Project and deployment

- Repository: cgurrie03/fantasy-sportsbook (private).
- Local checkout: C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook.
- Local branch stage-1-accounts deploys to remote main with `git push origin HEAD:main`.
- Vercel project fantasy-sportsbook; production https://sportsbook.coopergurrie.com.
- Supabase project bmvjcdgxwxqalaohpsnw; Sleeper league 1312126153980391424.
- `.env.local` contains local configuration: never print secrets or commit the file.
- Keep unrelated untracked data/ and docs/2026-10-06-delivery-recovery.md out of commits.
- Migrations 024–026 are already applied; do not rerun production imports.

## Current relevant code

- src/components/AdminHub.tsx: admin categories and routing; Reports first.
- src/components/MarketAdmin.tsx: generated board management and existing boost references.
- src/lib/markets.ts: `boost_pct`, decimal price/profit boost calculation, pick compatibility.
- api/_lib and Supabase migrations: inspect ticket acceptance and settlement before changing payout rules.
- Weekly automation recalculates Wednesday 7:30 AM Eastern even if already published, publishes 8 AM unless paused and sends opening email with final published quotes.
- Existing accepted tickets preserve their original selections, lines, odds and payout context. New promotion changes must never rewrite them.
- Money is pretend league currency. Cooper is the only approved admin; all mutations must enforce admin authorization on the server/database as appropriate.

## Existing betting rules to preserve

- Weekly specials allow singles and compatible parlays; contradictory picks are blocked.
- Make/Miss Playoffs: playoff-only parlays.
- League Winner and #1 Pick: singles only.
- Regular-season win totals: singles and win-total-only parlays; half-win lines avoid pushes.
- Odds rounding: standard matchup 10, weekly specials 25, futures 50. Futures capped at +/-10,000.
- Inactive Player Points leg pushes. Unresolved weekly tickets delay replenishment and flag admin review.
- Futures cash target is max($25, $100 minus open futures stakes), retaining higher cash.
- Admin voids refund the stake exactly once and retain the ticket as Voided.
- Best lineup projections use active roster and bench, excluding Taxi/IR. Missing eligible positive-projection replacements lock affected markets as last resort.

## Proposed first implementation scope

1. Audit the current featured 25% profit boosts, ticket acceptance calculation and email display. Establish whether existing promotions are market-based, matchup-based or ticket-based.
2. Create a dedicated list/detail/editor UI with draft, scheduled, active, paused and expired states.
3. Configure a clear promo title/description, eligible category/selections, profit boost percentage and Eastern start/end times. Preserve existing rules; do not invent new limits without discussing them.
4. Add a concrete payout preview showing normal odds/payout and boosted profit. A profit boost applies to profit, not the returned stake.
5. Record admin changes and promotion identity in accepted ticket snapshots; prevent double boosting and define stacking behavior explicitly before enabling it.
6. Connect approved promotions to public market/slip displays, ticket confirmation and opening email. Preview with realistic examples before deployment.
7. Integrate activation/expiry with the existing scheduled worker and idempotency safeguards rather than adding a second scheduler.
8. Add meaningful tests for authorization, price calculation, expiry boundaries, duplicate handling and preservation of accepted tickets.

## Decisions still to discuss

- Additional promo types beyond current profit boosts (e.g. parlay boost, team-specific offers).
- Whether offers apply to an individual selection or an entire ticket; eligible stakes and payout caps.
- Per-user usage limits, stacking and whether admin review is required before activation.
- How Game of the Week and Tank Bowl featured boosts interact with manually created offers.

## Latest reports changes

Reports have a grouped dropdown, unified PDF/PNG/CSV export menu, completed-week-only Projected vs. Actual with team total/average differences, inline KPI explanations, Expected vs. Actual Wins, and Popular Selections with ML labels and leg outcome counts. Lineup Efficiency is removed from the menu. Model accuracy explicitly requires original opening forecasts plus final results; older reconstructed starter projections are labelled separately.

## Skills and working conventions

Use frontend-design and vercel-react-best-practices for UI work. Load supabase-postgres-best-practices before any schema/function/RLS migration. Use react-email for email changes. Use validate-data for payout/statistical checks. No subagents unless explicitly authorized. User prefers autonomous completion and has authorized normal development/push/deployment; do not send external emails or communications without specific authorization.

## Verification

Use bundled Node if unavailable on PATH: C:/Users/coope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin.
Run npm run build (also tests compiled API runtime), plus relevant test:accounts, test:reporting, test:weekly, test:lines or test:futures checks. Use the app browser to inspect local UI and verify the pushed commit reaches Vercel Ready. Stage explicit files; never `git add .`.
