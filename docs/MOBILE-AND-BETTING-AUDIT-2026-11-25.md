# Mobile display and betting audit — November 25, 2026

## Betting repairs and verification

The reported Antonio Williams 10+ / Jacory Croskey-Merritt 10+ parlay was blocked by two legacy rules: the conflict predicate rejected any extra player market sharing a fantasy matchup, and a leg-insertion trigger independently required different fantasy matchups. Both now distinguish overlapping player outcomes from different players. Different-player milestones and player props can share a fantasy matchup. Duplicate or overlapping outcomes for the same player remain blocked. Existing position-group, team-milestone, winning-margin, and other special-market restrictions are preserved.

Applied matching migrations to Development and Production. The exact requested parlay passed Production acceptance in a deliberately rolled-back subtransaction. No audit ticket or financial entry persisted.

Production acceptance probes also passed all 20 currently open market families: moneylines, spreads, matchup totals, team totals, player points, player milestones, player head-to-head, position groups, eight Weekly Specials, champion, first pick, playoff parlays, and win-total parlays. Closed playoff-timing markets were not forced open. Currently unpublished team milestones/winning margins were not live-placement tested; their existing fixture coverage remains applicable. Reward redemption, offers, idempotency, account isolation, and rejection cases retain automated release coverage.

The prior stale-worker acceptance incident is separately documented in `ACCEPTANCE-SYNC-FIX-2026-11-25.md`. Both current placement engines now use the current published board lease; they no longer depend on the retired worker's freshness record.

## Mobile findings addressed

| Priority | Finding | Change |
| --- | --- | --- |
| P1 | Reward award text overlapped percentage inputs at 320px | Mobile awards occupy a full row, with labeled percentage and recipient fields below. Desktop retains its compact grid. |
| P1 | Credit dropdown extended beyond the left edge at narrow widths | Mobile dropdown anchors within viewport margins below the header. |
| P2 | A 320px body minimum forced horizontal page scrolling when a classic scrollbar reduced usable width | Removed the body minimum; scroll gutters stay stable as content loads. Deliberately scrolling tables and offer rails remain contained. |
| P1 | Championship rule badge could push its help icon outside the narrow dialog; participants crowded adjacent columns | Constrained the badge/help grid and stacked mobile automatic toggles, inputs, and finalist details independently. |
| P2 | Gold offer prices and reward headings had insufficient contrast in light mode | Reused the existing theme-aware boosted-price color token. |
| P2 | Long offer modal headings consumed three lines on narrow screens | Reduced only the mobile offer heading size. |
| P2 | Matchup availability used a static Week 8 bye list; recent-form history also came from the preview fixture | Live views now use current roster bye data and authenticated current-season matchup history. |

The mobile navigation remains Weekly Slate, Futures, My Bets, More in four equal columns. Theme changes and the saved, anchored featured-boost explanations remain in place.

## Audit coverage

Live Production visual inspection at 320px and 390px covered sign-in and loading screens, league home, Weekly Slate categories, player duels, position groups, player points/milestones, futures, loaded My Bets and All Bets, standings/managers, profile/preferences/communications/history, all commissioner sections, the featured-rules dialog, platform-owner sections, league intake, balance/notification dropdowns, More, Guide, offers, and the mobile slip. Intentional table/offer scrolling was distinguished from page overflow; overlapping element boxes were visually checked rather than treated as automatic text-collision failures.

The restored application browser rehearsal exercised 84 page/role/width combinations across member, commissioner, owner and 320/390/430/1440px, including configuration tabs and root-overflow assertions. It uses actual candidate code and restored SQL with simulated Auth/provider transports. Live visual inspection supplements those fixtures with real league data. These are browser viewport checks, not physical-device Safari/Android gesture tests.

## Storage and performance

No new refresh schedule, background polling, or persistent audit tickets were introduced. Historical matchup results reuse the existing bounded current-season archive request and browser cache. Conflict checks operate only on the maximum ten selected legs. Mobile repairs are CSS and presentation changes.
