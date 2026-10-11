# Head to Head, Ladders, Margins and Ticket Progress

## Scope

Receipt sharing now supplies a PNG, short message and public sportsbook URL to the native share menu. Copy text includes the website URL as a fallback; device share targets may omit captions. No automatic SMS is sent.

Head to Head is a new Home category with one selected weekly matchup, defaulting to the user's matchup. Both actual Sleeper starters appear across each slot, including cross-position FLEX/SUPER FLEX. Names, player images, projections, season averages, NFL teams/opponents and Eastern kickoffs are shown. Missing or inactive participants stay visible and locked. Named player IDs and the earlier kickoff are frozen in acceptance. Ties or non-participation push; participation with zero points is not a no-play.

Player milestones are expandable inside Player Points cards. Team milestones and winning margins are expandable inside matchup cards. Milestones include equality. Winning ranges are positive margins under 10, 10 to under 20, 20 to under 30 and 30+. Tied fantasy games push margin bets. These new kinds permit singles and parlays across separate fantasy matchups; same-matchup combinations are rejected by client and database. Existing ordinary ticket rules are retained.

Matchups generation includes team milestones/margins; Player Points generation includes player milestones and actual-starter head-to-head pairs. Both admin regeneration and scheduled refresh/publication preserve those kinds. Pregame generation and acceptance gates remain authoritative; these changes do not enable unvalidated live pricing. New quotes appear after the next permitted regeneration and publication, rather than manufacturing quotes from stale published markets.

Prices use model forecast means/uncertainty and Gaussian tail/difference approximations. Empirical paired covariance shrinks toward independence with eight prior observations and is bounded. Prices round to the standard 10-point odds increment. Probabilities and method/version metadata are archived for the existing assessment pipeline. This is an explicit approximation, not a claim of guaranteed accuracy or a newly calibrated empirical model.

## Provisional ticket scores

The existing scheduled worker refreshes a separate, league/season/week-scoped score snapshot for open weekly tickets. Cadence is 15 minutes while any NFL game is in progress, two hours otherwise. Source requests are skipped while the saved snapshot is within that interval. Team/match totals, ML/spread scores, player props, milestones and head-to-head progress use accepted IDs/lines. Missing player participation stays unavailable/awaiting play, not fabricated zero. Future win counters were deployed in the previous receipt release.

The browser polls cached database observations once a minute while visible, deduplicates in-flight requests and preserves prior observations after failures. It shows an actual fetching indicator, Checked time and delayed-data status. Provider observation timestamps are unavailable, so fetch times are not presented as proof of provider freshness. Progress never determines settlement or changes accepted terms, balances or payout.

## Validation and deployment

- TypeScript, compiled API-runtime fixtures, production build and lint completed.
- New PGlite/logic checks: ties, no-play, incomplete results, inclusive milestones, exact margin boundaries, actual FLEX slots, earlier cutoff, pricing monotonicity, cadence reuse/change, original snapshots, single acceptance, wallet retry protection, parlay conflicts, expired player cutoff and cross-league RLS.
- Existing promotions, weekly execution, revisioned refresh, model assessment and futures tests passed.
- Browser fixtures: 390px/1440px, light/dark; one matchup only, default user matchup, dropdown switching, expanded ladders/margins; receipt sharing includes image/message/URL. Existing UX workflows and report exports passed.
- Migration 034 applied to the existing hosted project through its SQL editor; existing tickets and wallets were not altered.
- Browser/native share APIs are intercepted in tests. Physical-device message delivery and provider/model calibration remain empirical verification, not guaranteed by fixtures.

Next review: populated new markets after permitted regeneration, physical-phone image/caption behavior, first scheduled score snapshot and newly settled market outcomes.
