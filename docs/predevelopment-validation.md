# BOFF predevelopment validation

November 8, 2026 • Read-only real data, controlled existing checks, and design studies

## Outcome

The agreed football experience is feasible enough to plan concretely. Real source checks confirm team/manager discovery, eligible lineups, and league-score reconstruction. Scheduled dynamic pricing is plausible at the chosen 5–15-minute scale, but current evidence does not validate live prediction accuracy or a provider freshness guarantee. No production changes, new league activation, actual ticket, email, or new recurring monitor were performed.

## Findings by area

| Area | Evidence collected | Verdict / consequence |
| --- | --- | --- |
| Team and co-manager discovery | Real league returns 12 rosters, 13 league users and 13 distinct associated managers including one co-manager. All associated IDs were present in the users response. | Verified for this league. Team count and bettor count must be independent. |
| Emails | Sleeper explicitly keeps contact information private, including from commissioners. | Verified documented limitation. Use commissioner-entered or participant-verified emails plus approved mapping. |
| Midweek strongest lineup | Current league has 43 scoring fields, FLEX/SUPER_FLEX and 11 starting slots. Existing exact-assignment helper found 11 unique eligible roster players for all 12 teams. | Real input/assignment check passes. Current data are not historical pregame predictions and do not prove optimal projections are accurate. |
| Historical score arithmetic | Eight real weeks, 96 team-weeks; reconstructed team totals equal stored Sleeper matchup scores within 0.01 in all 96. No custom score overrides in those rows. | Strong arithmetic reconciliation evidence for the current scoring configuration. |
| Player participation evidence | Five team-weeks include seven missing starter stat rows even though team totals reconcile. Week 8 had complete starter-stat coverage. | Not all player-prop outcomes can be inferred from matching totals or missing=zero. Reconcile participation separately; defer unresolved cases. |
| Source changes during games | Two observations 174 seconds apart: stats body changed and three team scores changed; projection body was unchanged. | Changes are observable. This is not measured event-to-source latency, uptime, or a long-run cadence test. |
| Source timestamps | Stat rows include numeric updated_at and last_modified. Sample timestamps can predate the observation by days. | Useful evidence exists, but timestamps must be interpreted by player/game state; unchanged final/idle players should not be called stale merely because the row is old. A fetch time is not an upstream heartbeat. |
| Source size/cache | Current decoded projection JSON 5,708,356 bytes, stats about 1,693,337 bytes, matchup response 8,536 bytes. | Full raw copies are inappropriate per-member/per-league/per-refresh archives. Share and filter source data. These are decoded payload bytes, not compressed wire or database allocation. |
| API response caching | Projections: s-maxage=600 and stale-while-revalidate=600; rosters/users: 300; matchups: 60 with stale-while-revalidate=300; current stats: 4 with stale-while-revalidate=600. | Polling faster does not guarantee a newer response. Use separate projection/score/game-state cadences and explicit freshness rules. Headers are observed behavior, not an SLA. |
| Playoff support | Real league has seven playoff teams, Week 15 start and a reseeding-related field; winners bracket returns nine rows and traded picks 28 rows. | These are real configuration inputs. Generic 4/6/8 defaults are insufficient; actual 7-team/bracket/reseeding semantics need verification before futures acceptance. Nonfinal bracket rows do not establish final paths. |
| Offer structural feasibility | Archived Week 8 moneylines support 41 underdog combinations, one favorite combination and one 2+-loss-streak combination with 3–5 distinct-matchup legs and base at least +500. | Themed generation is possible on this sample. Counts use simple products of posted odds for structural eligibility, not validated joint probabilities. Some themes have thin candidate pools. |
| Tuesday/Wednesday timing | Rules are now Tuesday 1 a.m. close, Tuesday 7 a.m. settle then refill, Tuesday 8 a.m. recap, Wednesday 6 a.m. opening; futures remain available when valid. | Defined product contract. The current production schedule is different and has not been changed. New dates require clock/DST and late-game acceptance tests during implementation. |
| Communication preferences | Profile-adjustable per-type optional messages with send-time settings check are specified. | Product rule resolved; actual integration remains implementation work. |
| Storage scaling | Current-season receipt estimates compare 12/14/16 participants and 1/5/10 leagues. Raw sources dominate if appended; compact tickets still grow with traffic. | Planning figures exist; physical steady-state footprint needs measurements against the implemented schema and workload. |

## Important code findings before reuse

- The lineup optimizer uses exact slot assignment and avoids duplicate players. The existing `lineupWithReplacements` helper fills genuine roster gaps with a top-three-unrostered-player mean. The owner has now explicitly selected this fallback, so the helper is a reuse candidate after verifying actual free-agent availability, slot eligibility, game locks and injury/bye coverage. Distinguish a forecast pickup estimate from actual roster acquisition and named player-prop subjects. Source uncertainty is not automatically a confirmed shortage.
- The current live clock model explicitly labels itself uncalibrated, without a validated snap/opportunity or injury-change feed. Existing tests do not turn it into a validated conditional pricing model.
- Weekly scorer-field helper currently supports even 8–16-team fields. That is a real compatibility restriction, not a universally flexible league implementation. Odd fields, byes, or larger leagues need defined rules before claiming support.
- The real seven-team playoff format triggered capability review. Source configuration must determine format; the historical UI also contains a hardcoded visual playoff boundary. Replace that assumption with actual settings.
- Production model-review job claiming is excluded even while a panel/control can suggest improvement is enabled. This is a status-consistency problem to fix; do not use the old panel as proof of automatic tuning.
- The old app still sends a legacy forecast shape while compact database paths expect the new format. The rebuild needs one consistent compact contract across pricing, receipts, settlement and minimal evaluation.

## Checks rerun

Existing local `test-live-model.mjs`, `test-settlement-coverage.mjs` and `test-futures.mjs` passed. They cover remaining-score boundaries, started-player locks, score mismatches, suspension conditions, forecast-horizon deduplication, numeric error metrics, settlement completeness, tied/void cases, futures progression, accepted-term preservation and duplicate refund/payment protections within their controlled fixtures. They verify the current code's stated behavior, not the newly requested product end to end. Earlier focused review also passed the scoring, weekly, transition, refresh and retention checks; those were not needlessly repeated here.

## Recommended refresh architecture to validate in development

- One shared sport/season/week source snapshot per required upstream feed, bounded and overwritten. Shared game-state inputs apply across leagues; league rosters and scoring remain scoped.
- Score/game-state checks at an initial 5–15-minute active-game cadence; forecast refreshes honor observed cache behavior and actual changes. A 15-minute operating starting point reduces unnecessary work, with five-minute score checks assessed from measurements. Event schedule triggers avoid a long idle interval missing kickoff.
- Less frequent idle checks, plus source invalidation for lineup/roster changes, scheduled opening/closing, and known game starts. Do not pull future-week projections for every category or every member request.
- Retain only selected scalar player/team values required by active markets and unresolved tickets. The observed roster-filtered stat summary was 108,051 decoded bytes, versus 1.69 MB for the whole stat response. This single-league logical reduction is not equivalent to total database savings and does not include all shared inputs.
- Quote version and effective/source timestamps are rechecked at acceptance. If a scheduled stale quote remains actionable while a material event has occurred, delayed repricing can be exploited; interval polling alone cannot establish fair acceptance. Define short suspension/quote-expiry rules from reliable game state and source-age evidence. If source coverage cannot support that check, affected in-game market availability must remain constrained until it can.
- No automatic all-league stream of historical line ticks. Save the accepted price and necessary version plus a small fixed set of numeric model-evaluation horizons.

For scale: at 20 active hours/week and five-minute polling, 240 refreshes of a 7.4 MB decoded projection+stat payload would produce about **1.78 GB/week of repeated JSON** if appended—even before per-league duplication. This is an illustrative workload, not a measured retention rate or billable traffic forecast. Overwriting/sharing a current cache changes the storage problem; it does not remove network/compute costs. Do not count gzip wire savings as retained database savings.

## Compact model evaluation charter

Question: does a candidate improve real future team-score/margin/total prediction and probability quality over the current model and a simple Sleeper-only baseline, using only information available at forecast time?

- Evaluate weekly predictions by league-week, keeping the two sides of a matchup and related repeated selections together. Do not count every revision as an independent sample.
- Use expanding chronological weeks: train/tune only before the next test week. Keep a final untouched period for a fixed candidate. No shuffled folds or reconstructing a historical forecast with today's roster/projections.
- Primary score/margin/total metric: MAE. Probability quality: log-loss with Brier/calibration as supporting checks. Declare the relevant metric before comparing variants rather than selecting the one that happens to improve.
- Compare against direct league-scored source projections and the frozen current algorithm. Report bias, sample counts, missing inputs and outcomes, and uncertainty alongside averages.
- Current final-score reconstruction does not establish predictive quality. Archived real pregame numeric inputs may enable limited backtesting after provenance/cutoff review; otherwise begin prospective sparse numeric collection. Do not backfill from current projections and label it historical evidence.
- Suggested minimal sampling: one opening and one final-pregame numeric team forecast per week; small predefined game-progress checkpoints only for live validation. Keep target, mean/uncertainty/probability, version, known-at time, source-age/coverage flags, and final target. Do not archive full provider bodies or lineups per quote.
- A provisional promotion rule should require practical improvement in later weeks without materially worse calibration or missing-data behavior, supported across multiple league-weeks. Exact thresholds/minimum sample size need evidence-based selection; no guarantee of “mostly accurate” follows from one league or eight final weeks.
- Any changed evaluation protocol receives a new version. Keep compact totals and bounded diagnostic examples rather than all intermediate model runs.

This charter applies the available validation-design skill's chronological/grouped/metric-lock principles. It is a plan for meaningful measurement, not an assertion a new model has passed.

## Remaining decisions versus remaining evidence

We can define sensible proposals for most remaining rules before product development: standard push handling, fixed weekly reference for beat-projection markets, time-limited offers and fallback generation, and unresolved-results escalation. Owner review is needed before changing accepted contracts, but another broad questionnaire is unnecessary.

Recommended proposals for the next rule review:

1. Keep the published opening projection fixed as the “beat projection” target; adjust its odds, not the event's definition.
2. Resolved by owner: confirmed pushes remove a leg and settle remaining accepted terms with the original profit boost retained, including below the original qualifying count. An all-push ticket refunds the stake without boosted profit.
3. Tied winning weekly scorer selections push under the current convention; changing to split/dead-heat payouts is a separate choice.
4. Resolved by owner: genuinely unfillable slots use the average projected league-scored points of the top three eligible available waiver/free-agent players. Explain the pickup assumption; do not treat the estimate as an actual starter or fabricate a player/result. Missing source information remains separate from a confirmed roster shortage.
5. Preserve old-season compact betting totals, and measure current-season detailed ticket retention as agreed. No archive is retained merely for removed L reports.

Evidence still required after implementation: account-to-team/commissioner activation journey with real approvals; actual user-wallet acceptance and settlement; multi-league simultaneous load; long-run source behavior/outages; real in-game conditional calibration; physical storage growth/cleanup; actual-phone keyboard/focus behavior; final brand/link treatment. These cannot honestly be marked passed before the code and required observations exist.

## Research references

- [Sleeper API documentation](https://docs.sleeper.com/): documented league/user/roster structure, read-only access and call guidance. The observed stats/projections endpoints and ESPN game-state source are supplementary empirical integrations, not a promised v1 live-betting contract.
- [Sleeper contact privacy](https://support.sleeper.com/en/articles/4031220-can-i-email-my-leaguemates): emails unavailable publicly or to commissioners.
- [FanDuel temporary market locks](https://support.fanduel.com/s/article/What-does-the-lock-mean-on-FanDuel): live availability can pause while prices change.
- [DraftKings price changes](https://support.draftkings.com/dk/en-us/why-do-the-odds-sometimes-change-before-i-place-a-bet?id=kb_article_view&sysparm_article=KB0010798): refreshed odds and changed-term confirmation.

Raw working evidence is local and bounded to this review: source-validation, source-followup, historical-validation, contrast pairs and browser checks. Only compact validation results—not full provider payload archives—were saved for this review.
