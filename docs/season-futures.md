# Season Futures

Approved rules (October 6, 2026):

- League Winner, Make / Miss Playoffs for every team, and #1 Pick.
- #1 Pick tracks regular-season last place. Show the original team with its next-year first-round pick owner in parentheses. Sleeper traded picks supply ownership; accepted ticket labels retain the ownership shown at placement.
- Seven playoff teams, Week 15 start, record then points for seeding, top seed receives the first-round bye. This is the confirmed working assumption and is visible in admin.
- League Winner and #1 Pick are standalone singles. Make/Miss Playoffs supports singles and 2–10 leg playoff-only parlays; opposite outcomes for one team are blocked. Weekly and future selections cannot share a ticket.
- Base futures odds round to 50 and cap at ±10,000; accepted ticket prices remain unchanged.
- Season markets stay available through weekly cutoffs, unless manually closed or their outcome has been resolved.
- Weekly cash floor is max($25, $100 minus open futures stakes). Higher available cash is retained. Open futures do not block the weekly refill; unresolved prior weekly tickets do.

## Administration

League Admin → Lines & Markets → Season Futures → Generate Futures → review → Publish Futures. Recalculate Futures previews updated odds; Publish Futures saves them. Close / Open Futures controls this board independently of weekly markets.

Once a season board exists, Tuesday's generation process refreshes it while retaining its publication status. Accepted tickets retain their original odds, selection, and settlement context. Confirmations use the existing email queue. Voids use the existing one-time stake-refund transaction.

## Odds and settlement

10,000 deterministic simulations use current records, points scored, remaining regular-season matchups, legal best-lineup estimates, historical scoring, and historical variability. Team strength blends 60% historical scoring with 40% current best-lineup estimates; incomplete weekly lineup coverage falls back to historical scoring. These are estimates, not a forecast of future injuries, trades, waivers, or every future NFL bye. Base American odds are rounded to 10 for standard matchup/player markets, 25 for Weekly Specials, and 50 for Season Futures. Profit boosts remain exactly 25% of the rounded base profit. Accepted ticket snapshots and combined parlay payouts are not re-rounded.

During playoffs, the actual Sleeper bracket determines remaining championship paths and removes eliminated teams. Qualification and last-place results use completed regular-season matchups only; playoff points cannot alter draft order. Exact ties at the qualification boundary or last place remain unresolved for admin review. Championship settlement waits for Sleeper's confirmed first-place winner.

## Validation and release

- Production build and compiled API import checks pass.
- Futures tests cover probability totals, deterministic simulations, actual bracket progression, traded ownership, tied standings, standalone placement, stale quotes, immutable accepted odds, duplicate settlement/refund prevention, resolved-market closure, cutoff isolation, and cash floors.
- Read-only generation against live Sleeper returned 48 selections for 12 teams. The latest price policy rounds futures to 50.
- Migration `202610070017_season_futures.sql` applied to the project's Supabase database; readiness query confirmed schema, standalone rule, and Tuesday refresh support. No futures bets or markets were published during setup.
- Migration `202610070018_market_odds_rounding.sql` applied; live verification found zero incorrectly rounded prices across existing quotes. Accepted ticket snapshots were retained.
- Code deployment and initial admin generation/publication remain separate from this database update.
