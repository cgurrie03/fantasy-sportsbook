# Generation and UI audit — October 5, 2026

Reviewed the recent Luna changes to generation, market merging, line editing, publishing, sorting, sportsbook display, and build validation.

## Corrected

- Team totals were half the projected team score. They now equal the full projected score; match totals sum both teams.
- Spreads used half the projection gap. They now use the full gap.
- Player markets copied last week's starter points by array index. They now use current weekly statistical projections scored with this league's settings and identify historical results by player ID.
- Starter selection was mislabeled as a best lineup. An exact slot-assignment optimizer now selects the best available legal lineup, including FLEX and SUPER_FLEX, without duplicating players.
- All current-season completed weeks feed player scoring averages and team variance. Historical adjustment is limited to 15% of the current projection. Provider projections are the main estimate.
- Sleeper-provided injuries inform eligibility; unavailable projected slots score zero and trigger a visible warning. No fabricated $100/team or 10-point/player fallback.
- Generation of one category no longer deletes other categories. Existing quote IDs are reused when regenerating the same market to avoid key collisions and retain accepted ticket references.
- Paired spread and total edits now keep the opposing selections consistent.
- A verified email must have this league's admin membership; removed the global hardcoded admin-email bypass.
- Admin and Home share an ordering helper. Both teams must be above .500 to receive top-group priority.
- Weekly high/low markets share a market key per category so users cannot pick multiple mutually exclusive winners.
- Server API files are now typechecked during production builds. Previously only the client and Vite configuration were checked.
- The week schedule uses the second Thursday in September for 2026. Week 5 opens October 7 at 8 AM Eastern and closes October 8 at 8 PM Eastern.

## Verification

- League scoring, unique-player lineup assignment, FLEX optimization, inactive exclusion, and simulated probabilities tested locally.
- Live Sleeper league settings, weekly projections and all Week 1–4 results verified against all 12 rosters. Rosters 4 and 10 have 10 available projected starters; remaining rosters have 11.
- Current projections include date/opponent, scoring stats and injury fields. Matchup and player pages use compact displays without the -110 quote text.
- Weekly specials generated as a local review artifact, without publishing or sending email.
- Import regression verifies prior tickets, balances, and leaderboard profit remain intact.

## Limits and next work

- This is an estimate, not a calibrated sportsbook pricing model. Historical information is from the current season; prior-season history is not blended across changing rosters.
- Injury expectations are from Sleeper's projection feed, not an independent injury/news service. Questionable players retain the provider forecast; Out/IR/PUP/Suspended/Doubtful are excluded.
- High/low odds use 6,000 independent team-score simulations. Cross-team player/game correlations are not yet modeled.
- Projection endpoints are used by Sleeper's product but not documented in its public API contract. Failure returns an error and preserves existing markets.
- The next release needs live publish/bet placement verification after deployment. No production bets, schedules, or emails were modified in this audit.
- Audit covers the recent Luna implementation paths; it is not an exhaustive review of every historical project file.
