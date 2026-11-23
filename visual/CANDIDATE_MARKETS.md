# Candidate Markets and UX Improvements

The owner approved these market previews in review 17 except the close-game count special, which is excluded. Alternate lines, position groups and regular-season leader futures now have selectable visual frontends; pricing/settlement remain backend work. Division winners are conditional on actual divisions. The UX items below remain proposals. Existing markets already cover standard moneyline/spread/total, team totals/milestones/winning margins, player head-to-head/points/milestones, weekly scoring extremes and thresholds, championship/playoff/win-total/last-place futures, and boosted offers.

## Highest-Priority Markets

| Category | Addition | Example | Data and Storage |
|---|---|---|---|
| Standard | Alternate spreads and totals | Choose +10.5 instead of +4.5 at a different price | Reuse the matchup forecast/distribution. Generate a bounded ladder on demand; keep accepted terms, not each ladder version. |
| Excluded | Close-game count (not implemented) | Over 2.5 matchups decided by fewer than 10.5 fantasy points | Reuse the current slate and final scores. No separate player history needed. |
| Team Market | Position-group head-to-head | One team's starting RBs vs the opponent's starting RBs | Sum actual eligible starter production under the league's scoring. Define how flex players enter groups; price with the projection model and retain the accepted team/position contract and shared locked-lineup evidence needed for fair settlement. |
| Futures | Regular-season points leader | Which fantasy team finishes with the most points for? | Reuse league standings totals, with a fixed regular-season end and explicit tie handling. |
| Futures | Best regular-season record / top seed | Which team finishes first in the official standings? | Reuse Sleeper records and the league's actual tiebreaks; do not offer both labels as duplicate markets. |
| Futures | Division winner, where supported | Winner of a real Sleeper division | Only when actual divisions exist. The current sample league has none, so this category should be absent there. |

Alternate lines are a sportsbook reference, adapted here to fantasy scoring. DraftKings' NFL market menu explicitly includes alternate totals: https://sportsbook.draftkings.com/leagues/football/nfl . The fantasy examples and storage approach above are our recommendations, not DraftKings specifications.

Alternate lines require calibrated distribution-based pricing; moving a threshold cannot keep its old odds automatically. Combination markets such as winner + total should wait for joint pricing and the combinability rules, rather than multiplying correlated prices. Avoid cash-out for now: it would add repeated repricing and balance/settlement complexity before the core model is ready.

## Highest-Priority UX

1. **Quote freshness and source status:** show when the book last refreshed and the next scheduled refresh. A stale-data state should explain why prices are temporarily unavailable. Keep a current timestamp/status per league, not a refresh history.
2. **Show conflicts before adding a selection:** dim incompatible selections in the context of the current slip and explain the reason on focus/tap. This builds on the existing five-second incompatibility toast.
3. **Follow an individual ticket:** optional per-ticket updates instead of subscribing to every open-ticket event. Store a small bounded set of followed ticket IDs and clear them after settlement/retention.
4. **Pin a few markets:** keep a small list of favourite market categories or team views in the profile. This adds little storage and reduces repeated navigation.

Recommended order: quote freshness/conflict clarity, alternate lines, close-game specials, then season-leader futures and position-group duels. The approved visual market views are now implemented. UX behaviour and backend pricing/settlement specifications remain to be reviewed; see UX_IMPROVEMENTS.md.
