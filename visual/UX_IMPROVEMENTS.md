# UX Improvements — Iteration 18

## Try The Visual Examples

[Interaction review](https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups?review=interactions) adds two isolated prototypes. They are not enabled in the normal slate.

**Conflicting selections:** adding a selection immediately mutes incompatible prices with a dashed border. An already-selected price stays removable. Tap, click or keyboard activation explains the exact conflicting selection in the existing five-second message, fading over the last second. Mobile never relies on hover. One evaluator drives both the visual state and add-to-slip guard. This covers the current approved rules; a full market-family correlation matrix and backend enforcement still need validation before expanding allowed combinations.

**Favourite player props:** star a specific Over, Under or milestone side in Player Points & Milestones, then choose Favorites. This is not a favourite-category shortcut. The shortlist holds references, never copied odds, and is limited to 100 in a league/week-scoped browser session for review. The current filter's market/position/search still apply; an empty state explains when they hide favourites. Account sync and the final expiry policy await design approval.

The requested Fliff behaviour informs this example, but an authoritative public walkthrough of that exact Fliff screen could not be independently verified. A documented reference for the same interaction is [PropsMadness: star an Over/Under side and filter Favorites](https://propsmadness.com/help/en/articles/17695448-how-to-build-a-shortlist-in-explore). This supports the pattern without claiming boff copies Fliff's precise UI.

## Following Tickets — Recommended, Not Yet Implemented

A Follow Ticket toggle belongs on the ticket after placement and on expanded tickets in My Bets / All Bets. It should be available for another participant's visible ticket too, subject to profile controls. Own-ticket settlement notifications remain controlled separately so users need not follow every wager just to learn the final result.

Recommend a summary at the end of the early Sunday, late Sunday and standalone NFL game windows. Immediate updates should be reserved for a decisive leg loss, ticket win, push/refund, or a result needing confirmation. Do not notify at every five-minute score poll. A push that leaves remaining legs open should say which legs remain and the revised ticket terms, while retaining the accepted boost. The notification action should open that ticket inline; a winning ticket offers Share This Win.

Needed: a bounded user/ticket reference, delivery-channel preferences and quiet hours, latest delivered event version for deduplication, and cleanup after settlement. Reuse shared scores; do not store a separate progress snapshot per follower. This recommendation does not create real follows or send messages.

## Live Sources And Prices

[Live Dev](https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups?view=live) is now an actual scheduled source connection. Read [LIVE_REFRESH.md](LIVE_REFRESH.md) for cadence, measured storage and limitations. Current scores are connected; calibrated prices and acceptance are not. Archived examples and their simulated price-change review remain separate.

## Other Approved Changes

Injuries display Questionable, Doubtful, Out, IR, with compact middle-dot details and a bounded list. Position Groups now sit in Player Head-To-Head, using matchup filtering and actual league lineup structure. Alternate spread/total presets retain half-point targets and never receive a featured boost. [Postseason Review](https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups?view=postseason) demonstrates real historical rounds and seeds; unknown live formats need verified mapping before prices are offered.
