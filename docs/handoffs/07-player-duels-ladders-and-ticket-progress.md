# Next Betting Features — October 11, 2026

Read PROJECT-CONTEXT.md and current release handoffs first. Implementation status: receipts and the futures win counter were deployed in 365188b; Head to Head, milestones, winning margins and scheduled ticket-score observations were deployed in 24d6369. See docs/reviews/2026-10-11-extra-markets.md for implemented rules, tests and remaining provider/live-pricing limits. The specifications below preserve the original decisions; dedicated correlated pricing, physical-device sharing verification and unvalidated live acceptance remain future work.

## Head to Head — Confirmed Layout

Add a market category named Head to Head. One matchup dropdown selects exactly one weekly fantasy matchup; never render the entire league's matchups together. Default to the signed-in user's matchup when available. Left team faces right team, with mirrored team identity/avatar/record headers. Show actual Sleeper starters, not the model's hypothetical optimal lineup or a top-12 projection subset.

Each row has left player, centered lineup position/slot, and right player, following Sleeper matchup order. Both sides show player name, image, NFL team/opponent, kickoff day/time Eastern, current weekly projection and season average under this league's scoring. Repeat slots should be labeled RB1/RB2, WR1/WR2, etc. Maintain the same row alignment on mobile; use two deliberate metadata lines rather than tiny text or horizontal page overflow.

The bet selects which named player earns more NFL fantasy points under the league's scoring. Straight winner first; no automatic handicaps unless approved separately. A blank/missing/inactive/bye participant should visibly disable the pair, not be silently replaced with a projected bench player. Updated lineup pairs can produce new quotes, but accepted tickets must retain the original named participants and terms.

Confirmed October 11: compare the same lineup slot, including FLEX/SUPER FLEX when NFL positions differ. A tie or either player not playing voids that head-to-head leg. In a single this refunds the stake; parlay handling must use the approved saved-term void/repricing policy. Repeated slots follow corresponding Sleeper order.

Resolve before enabling: lineup changes after acceptance, cutoff at the earlier player's NFL kickoff, allowed singles/parlays and correlations with existing player props. Singles first remains a recommendation, not an approved restriction. Do not treat a player who participates and scores zero as a non-participant.

Generate joint distributions for player differences, including shared-game/player correlations. Mean projection differences alone cannot establish winner probabilities. Include immutable IDs, scoring context, both event IDs/times, probabilities and acceptance snapshots; implement automatic generation, acceptance validation, results, history, reporting and confirmations together.

## Player and Team Milestone Ladders

Keep current Over/Under markets. Add a collapsed Milestones control to each player card and existing Team Totals area. Three to five selectable thresholds are enough; do not render long extra tables by default. Example player choices 15+, 20+, 25+, 30+; team choices 100+, 125+, 150+, 175+. Actual available thresholds should be centered sensibly on each forecast, not copied identically for every position/team.

These are inclusive milestones: 20+ means actual score >=20; 150+ means >=150. Labels and settlement must agree. A higher target must have an equal/lower win probability and equal/higher payout. Price distribution tails using the existing simulation, not a fixed odds ladder. Apply the correct category rounding policy to posted odds while preserving underlying probabilities.

V1 should reject multiple ladder thresholds for the same player/team in one ticket and overlapping ordinary total picks that duplicate, contradict or compound the same outcome. Do not mistake correlated selections for independent parlay legs. Live ladder availability requires all live-market gates; already achieved outcomes cannot be newly offered.

## Winning Margin on Matchup Cards

Add one collapsed Winning Margin section near Team Totals inside each matchup card, without another top-level category. Choose the winner/team first, then one of three or four labeled bands with displayed odds. Example for decimal fantasy scores: “Under 10”, “10 to under 20”, “20 to under 30”, “30+”. Formally: 0 < margin <10; 10<=margin<20; 20<=margin<30; margin>=30. Exactly tied games require an explicit push/other outcome policy.

Store the selected team and immutable exact lower/upper boundaries; selection text cannot be the settlement parser. Price each band's probability from the joint margin simulation. Prevent opposite teams or overlapping bands in the same ticket, and initially reject same-matchup combinations with ML/spread unless a dedicated correlated-price engine supports them. Compact segmented controls/chips should maintain readable odds and touch targets on mobile.

## Futures Win Counter — Deployed

On open regular-season win-total ticket legs, show Current wins: N. Read the selected subject team's current standings, never the bettor's team. Require the matching league and NFL season. Missing mapping/season/data displays unavailable rather than zero. Settled tickets keep final actual results. Preserve accepted line/odds/payout and wallet state.

Local change made in src/lib/accounts.ts and src/components/TicketHistory.tsx: project the accepted settlement context's kind/team ID into account reads and pass the counter to the shared leg renderer. No schema migration or production write. TypeScript, compiled API fixtures and production build passed; the existing large-bundle warning remains. This counter was subsequently deployed and verified by the receipt release; the subject-team lookup has dedicated browser coverage.

## Receipt and Shareable Images

Current ticket UI already has owner, status, wager, odds, payout, numbered legs/results, time and bet ID. Reuse that contract rather than inventing conflicting labels. Image export should omit admin actions, filter UI and private balance/email. Use compact league branding, owner identity/avatar, prominent status, stake/accepted odds/payout, clear indented leg hierarchy, discreet timestamp/ID, and original versus boosted profit where applicable. Open images say Potential payout; settled images show actual payout and net profit; voided images show refund.

Offer a full-ticket image with variable height and a compact summary image for long parlays. No cropped-off legs masquerading as a full receipt. Mobile sharing can use the supported native share sheet with PNG download fallback; load export libraries only when needed. If showing observed progress, include its observation time so a static image does not imply live synchronization. A receipt is not a bearer token and must not expose authenticated links.

## Regular Ticket Progress

Show observed fantasy points next to each accepted line: player points against threshold; team total against threshold; combined matchup score against accepted total; spread as selected-team adjusted current margin; ML with both current team scores. These are fantasy points, not NFL scoreboard points. Keep current scores visually distinct from final settlement and never label a currently leading leg Won before results are confirmed.

Use a league-scoped read-only progress payload keyed to the accepted ticket's season/week, player/team IDs and event states. Do not read a historical ticket against this week's games or change accepted lines to the latest generated line. Progress uses observations; it does not require enabling live betting. Feed gaps show unavailable/delayed, not fabricated zero. Preserve settlement's independent final-result process.

While any game is active, use the intended 15-minute observation cadence. Outside gametime, accurately show the active cadence rather than promising fifteen-minute refreshes all week. Ticket progress needs an explicit scheduler/feed operation: existing line shadow collection is not proof that a complete ticket tracking endpoint is available. Store source observation/fetch times and last successful refresh; UI labels must not relabel stale observations as fresh because polling succeeded.

Recommended UI: “Updates every 15 minutes · Updated 1:45 PM ET”, small refresh icon while an actual fetch is pending, and a quiet error/retry notice on failure. Keep prior successful scores while reloading, respect reduced motion, pause hidden-tab polling and deduplicate requests. Do not animate an indefinite spinner between scheduled runs. Test completed players, later kickoffs, overtime, postponed games, scoring corrections, no-play pushes, missing data, stale feed and final state.

## Suggested Sequence

1. Verify and deploy the small win-counter UI change through the normal release process.
2. Build read-only ticket score progress and a reusable receipt presentation/export.
3. Confirm head-to-head slot/participation rules, then implement end to end.
4. Add player/team ladders and Winning Margin with correlation/compatibility and settlement tests.
5. Keep remaining live acceptance and teaser rollout gates separate; new UI must not bypass them.
