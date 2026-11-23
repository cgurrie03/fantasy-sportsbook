# BOFF betting rules: proposed rebuild matrix

November 8, 2026 • Functional proposal following owner approval of singles and compatible parlays

This is the target rules proposal, not a description of existing production restrictions. Standard tickets allow 1–10 eligible selections. Automated preset offers use 3–5 legs. A quoted price is accepted only after checking current version, available balance, eligibility, source freshness, and combination rules. Accepted lines/prices never change afterward.

## Market matrix

“Conditional” means the full combination must pass conflict, correlation, timing, and pricing checks. A mathematical product of individual odds is not automatically a valid price for dependent outcomes.

| Market | Single | Parlay | Price refresh direction | Main combination/settlement rules |
| --- | --- | --- | --- | --- |
| Fantasy moneyline | Yes | Conditional | Adjust odds with win probability | No opposite sides; same-matchup spread combination requires validated combined pricing; tied final matchup pushes. |
| Fantasy spread | Yes | Conditional | Adjust spread; target roughly -110 base price | Distinct compatible matchups form ordinary parlays; exact accepted line equality pushes. |
| Match total | Yes | Conditional | Adjust total; target roughly -110 base price | Same-matchup team/score selections can be correlated; exact equality pushes. |
| Team total | Yes | Conditional | Adjust total; target roughly -110 base price | No opposite over/under; assess correlation with matchup result, match total, milestones and specials. |
| Player points over/under | Yes | Conditional | Proposed: move line around roughly -110; confirm this pricing convention during market design | Named participant and accepted line fixed; confirmed nonparticipation pushes; missing evidence stays unresolved. |
| Player head-to-head | Yes | Conditional | Adjust odds with comparative probability | Distinct compatible matchups for ordinary/H2H boost parlays; no opposite sides; tied/no-play result pushes under retained current convention. |
| Player milestone | Yes | Conditional | Fixed milestone threshold with changing odds | Multiple thresholds for one player are nested outcomes and cannot be treated independently; equality reaches milestone. |
| Team milestone | Yes | Conditional | Fixed threshold with changing odds | Nested thresholds/team totals are dependent; equality reaches milestone. |
| Winning margin band | Yes | Conditional | Fixed range with changing odds | One winning band/side for a matchup; mutually exclusive bands cannot be parlayed; tied fantasy game pushes. |
| Weekly high scorer | Yes | Conditional | Adjust odds | Only one sole winner possible; review tied-winner policy; correlations with totals and related specials require joint handling. |
| Weekly low scorer | Yes | Conditional | Adjust odds | One sole loser/low scorer; a team cannot be both sole high and sole low in an ordinary multi-team field; tied-winner policy explicit. |
| Teams scoring 150+ | Yes | Conditional | Exact/at-least count odds change | Counts constrained by league team count; nesting and league-wide total dependencies checked across the entire ticket. |
| Any team below 100 | Yes | Conditional | Adjust yes/no odds | Boundary remains strictly below 100; reject contradictions with selected team totals/count claims. |
| Any team scoring 200+ | Yes | Conditional | Adjust yes/no odds | Equality at 200 qualifies; reject contradictions with highest-score/team-total claims. |
| Teams beating projection | Yes | Conditional | Adjust odds against a defined fixed reference set | Recommended: one published baseline per week, explicitly labeled. Do not move the event's reference while accepting bets unless creating a distinct market version with its own frozen targets. |
| Weekly average score | Yes | Conditional | Adjust line around roughly -110, if adopted for total-style specials | Use complete actual team count and scores, not participant count; conflicts/correlation with team totals and count specials need joint handling. |
| Highest score total | Yes | Conditional | Adjust line around roughly -110, if adopted for total-style specials | Depends on all teams; review relationships to team totals, high scorer, and any-200 outcomes. |
| League champion | Yes | Conditional | Adjust odds | More than one league champion in one ticket is impossible; exact playoff/bracket rules determine eligibility and settlement. |
| Make/miss playoffs | Yes | Conditional | Adjust odds | Allow singles in rebuild; reject opposite sides and impossible qualification sets. Joint probability must reflect playoff-place limits. |
| Regular-season win total | Yes | Conditional | Move half-win total around -110 or retain total and change odds: choose per-market convention before implementation | Keep playoff wins excluded; assess joint schedule constraints across multiple teams; preserve each accepted total. |
| First-pick/last-place outcome | Yes | Conditional | Adjust odds | Must match actual league draft/last-place rules; multiple mutually exclusive first-pick outcomes cannot be combined. |

The owner explicitly selected roughly -110 for spread/total bets and changing odds for moneylines/other odds-based bets. Extensions of that convention to player points, league-wide score totals, and season win totals above are proposals, not additional confirmed decisions.

## Common ticket checks

- A duplicate selection does not become an extra leg. Opposite or impossible outcome sets are rejected.
- Limits and probability calculations use actual fantasy team count. Balance/leaderboard and once-per-person offers use approved participant count. A 12-team league can have 14 or more participants.
- Same-matchup or shared-player selections require defensible joint pricing; otherwise explain the unavailable combination. Test whole-ticket constraints, not only pairs.
- Quoted lines may change before placement. Clearly show changed terms and ask for a fresh confirmation; do not silently accept an older price.
- A completed or logically resolved outcome is unavailable for new placement. Short source/repricing pauses are separate from the weekly Tuesday close.
- Confirmed pushes remove those legs and recalculate the base from remaining accepted prices. The original accepted profit boost remains, including when the remaining ticket no longer meets its original leg-count or +500 requirement. All-push tickets refund only the stake. A surviving losing leg still loses. Administrative ticket voids remain refunds rather than boosted wins.
- Missing/contradictory data stays unresolved and enters automatic reconciliation before platform-admin escalation. Commissioners cannot choose the outcome or adjust credits.
- Futures can remain available through weekly preparation when pricing and source information are valid. Accepted futures persist across weekly rollover.

## Offer pricing

- Weekly mix: two prebuilt themed boosted parlays plus one claimable boost.
- Preset tickets: 3–5 available compatible legs; confirmed base combined American price **at least +500 before boosting**. Recheck at offer creation and placement. If current valid pricing falls below the threshold, replace/withdraw the unaccepted offer rather than forcing the odds. Accepted tickets keep their original terms.
- Boosts range from 25% to 75%. Working interpretation of “base 5 numbers only”: 25%, 30%, 35%, …, 75%, pending correction if a different meaning was intended.
- Recommended calculation retains current product meaning: increase potential **profit**, not returned stake. At exactly +500, $10 returns $60 before boosting; a 25% boost produces +625 and a $72.50 return; 75% produces +875 and a $97.50 return. This is a proposed explicit calculation, not a claim about new production prices.
- Show original odds crossed out beside boosted odds. Percentage need not be the prominent label; explain eligibility and terms in accessible details.
- Track claim and use distinctly, once per participant. A claimable token is not spent merely by being claimed; redemption is spent only on successful accepted placement. Do not mark it used after a failed submission.
- Expire before the relevant offer event window and its earliest included kickoff. Revalidate all legs and availability at placement. Current accepted tickets retain the actual boosted terms.
- Determine the base from valid underlying selection prices. Do not force a +500 label onto a combination whose probabilities imply a different price solely to satisfy the marketing target.

## Items to resolve before implementing this matrix

1. Resolved: preset parlay base is at least +500 pre-boost, not an exact target.
2. Fixed-versus-moving line convention for player points, weekly total-style specials, and regular-season win totals. Apply the owner's general spread/total rule by default where appropriate, then review concrete examples.
3. Boost treatment after pushed legs is resolved: retain the accepted boost on the remaining ticket. Final tied-weekly-scorer/other exceptional void treatment still needs its explicit rule; do not retroactively change existing accepted contracts.
4. The fixed weekly reference for “beat projection” markets. This event needs a stable definition even while other live prices change.

These are product/rule decisions. Real-source coverage and joint-price validation are implementation investigations; unsupported combinations should be explained rather than advertised as working.
