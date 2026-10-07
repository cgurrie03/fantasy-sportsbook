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

10,000 deterministic simulations use current records, points scored, the remaining fantasy schedule, and separate best-lineup forecasts for every NFL week through the championship. Each weekly mean blends 60% of its provider projection with 40% historical team scoring. Scoring variance shrinks toward league variance using four prior observations, with floors of 20 points and 18% of team strength. Each simulated season also samples uncertainty in underlying strength: score SD divided by the square root of historical weeks plus four. This avoids treating small-sample team strength as certain. NFL byes and depth are reflected in provider weekly forecasts. Current inactive players are excluded this week; future availability follows provider forecasts and reserve players may return, while taxi players stay excluded. Missing future forecasts fall back explicitly with an admin warning; incomplete current lineups use historical scoring for that week's season estimate.

The model does not predict unknown injuries, transactions or commissioner changes. The blend and uncertainty settings are transparent modeling assumptions, not parameters fitted through a historical calibration study. Base American odds round to 10 for matchup/player markets, 25 for Weekly Specials and 50 for Futures, with future quotes capped at ±10,000. At the cap, implied quote probabilities can differ from the underlying simulated probability. Accepted ticket snapshots and combined parlay payouts are not re-rounded.

During playoffs, the actual Sleeper bracket determines remaining championship paths and removes eliminated teams. Qualification and last-place results use completed regular-season matchups only; playoff points cannot alter draft order. Exact ties at the qualification boundary or last place remain unresolved for admin review. Championship settlement waits for Sleeper's confirmed first-place winner.

## Validation and release

- Production build and compiled API import checks pass.
- Futures tests cover probability totals, deterministic simulations, actual bracket progression, traded ownership, tied standings, standalone placement, stale quotes, immutable accepted odds, duplicate settlement/refund prevention, resolved-market closure, cutoff isolation, and cash floors.
- Read-only generation against live Sleeper returned 48 selections for 12 teams. The latest price policy rounds futures to 50.
- Migration `202610070017_season_futures.sql` applied to the project's Supabase database; readiness query confirmed schema, standalone rule, and Tuesday refresh support. No futures bets or markets were published during setup.
- Migration `202610070018_market_odds_rounding.sql` applied; live verification found zero incorrectly rounded prices across existing quotes. Accepted ticket snapshots were retained.
- Code deployment and initial admin generation/publication remain separate from this database update.
