# Fantasy spread teaser research — October 9, 2026

## Recommendation and release boundary

Retain **6 / 9 / 12 fantasy points**, centered on **9**, for this week's research. No final range or production payout table is validated. Prefer combination-specific joint score simulation; do not copy NFL key numbers or payout tables. Start with 3–6 distinct matchups in this 12-team league, bounded by the actual board's disjoint matchup count. A larger league requires its own validated cap.

The released conversion is a research preview: production shows adjusted lines and the original parlay price, but teaser price/payout are pending validation and teaser submission is disabled. Fixture odds are injected only by the local review page. Ordinary parlay selections/lines are never modified. No accepted teaser, production quote operation, settlement RPC or teaser reporting/email support is enabled. No database migrations are introduced.

## Official mechanism research

[DraftKings' official teaser rules](https://support.draftkings.com/dk/en-us/what-is-a-teaser?id=kb_article_view&sysparm_article=KB0010765) describe moving every selected line favorably and reducing the payout. Its regular teaser removes pushed/voided selections, falls back to two legs, and refunds below two with no loss. Its Super/Monster rules differ. These examples inform the mechanism only: the user's confirmed fantasy rules below take precedence. No NFL table was imported.

[DraftKings' placement example](https://support.draftkings.com/dk/en-us/how-do-i-place-a-teaser?id=kb_article_view&sysparm_article=KB0010690) presents the teaser as a conversion from selected bets. We use a qualifying slip conversion with an explicit reverse action. [Sleeper's official matchup API](https://docs.sleeper.com/#getting-matchups-in-a-league) documents paired matchup IDs and commissioner-adjusted points; collection uses `custom_points ?? points` and verifies distinct teams and exactly two teams per matchup.

## Collected evidence

`teaser-completed-scores-2026-w1-w4.json` contains only scores/roster IDs from the league's completed Weeks 1–4: 48 team scores and 24 matchups. Current Week 5 is excluded. The collection timestamp and source digest are retained in `teaser-research-2026-10-09.json`.

| Metric | Result |
|---|---:|
| Signed margin mean / median | 3.33 / 0.45 |
| Signed margin standard deviation | 45.95 |
| Signed margin 25th / 75th percentiles | −31.50 / 40.68 |
| Absolute margin mean / median | 38.57 / 37.70 |
| Absolute margin 25th / 75th percentiles | 18.46 / 56.00 |
| Absolute margin range | 2.64–88.06 |
| Absolute margin ≤ 6 / 9 / 12 | 3 / 4 / 5 out of 24 |

Home orientation is lower roster ID, solely to make descriptive signs reproducible. Actual margins are not pregame forecast errors. These counts do not measure teaser cover improvement; there is no NFL-style key-number inference. Four weeks are four temporal blocks, not 24 independent validation periods. Genuine extreme margins remain included.

Production archive inspection found **zero** `model_forecast_runs` rows for the selected league and three `forecast_snapshots`: two futures and one Week 5 weekly snapshot. The weekly snapshot was captured October 8 at 4:21 PM Eastern; its generation timestamp is October 7 at 12:03 PM Eastern. `teaser-week5-benchmark.json` preserves its six existing spread pairs and team projections, without changing the closed board. Spread metadata lacks team standard deviations, joint draws and covariance. Source chronology/lineup basis still needs verification before this becomes a backtest. No retrospective joint forecasts were fabricated.

## Pricing research and uncertainty

`research-teasers.mjs` runs 100,000 joint Gaussian draws per scenario, seed 19092026. It uses 45.95 as an illustrative margin scale derived from final-score dispersion, divided by √2 for equal independent team scales. All baseline spreads are centered on modeled margins. This is a scale diagnostic, **not a calibrated forecasting model**. The independent, positive-dependence, mixed-dependence, ±25% scale scenarios use common random draws across adjustments to avoid sampling-induced monotonicity reversals.

The positive/mixed stress allocates 40% of a selected team's variance to a shared factor. Since its opponent is independent, that corresponds to roughly ±0.20 correlation between selected margins, not a measured league correlation. Scores remain joint; the engine counts simultaneous covers rather than multiplying marginal cover probabilities.

| Three-leg +9 scenario | Joint cover chance | Fair decimal, excluding pushes | Illustrative contractual odds |
|---|---:|---:|---:|
| Independent | 19.18% | 5.21 | +380 |
| Positive dependence | 24.56% | 4.07 | +280 |
| Mixed dependence | 17.63% | 5.67 | +430 |
| 25% wider scale | 17.70% | 5.65 | +420 |
| 25% narrower scale | 21.94% | 4.56 | +320 |

The positive scenario differs from its independence product by about **5.26 percentage points**. This exceeds Monte Carlo noise and materially changes liability. The independent +9 joint probability has a Monte Carlo Wilson 95% interval of approximately 18.94–19.43%; this interval does not cover model or historical-sample uncertainty.

For continuous, no-push research: fair gross decimal = 1 / joint cover probability. The illustrative offer applies a **5% target hold**, then uses the upper Wilson bound to reduce estimation risk: `(1 − 0.05) / p_upper`. It is capped below the corresponding original parlay/subset payout and rounded toward the smaller payout in 10-point American increments. The resulting effective hold can exceed 5% because of uncertainty, caps and rounding. The 5% policy is **not approved**. Suspend fewer than 20,000 trials or fewer than 400 wins/failures in any required subset; these are operational research safeguards, not a proof of calibration or effective independence.

Every nonempty subset is saved (63 for six legs), including one-leg and two-leg prices. Exogenous void independence is an explicit unvalidated assumption. If simulated adjusted margins contain a push, research pricing suspends rather than silently pricing it as a loss or ignoring it. Continuous draws cannot validate actual discrete push mass. Production must model win/push/loss patterns jointly and price reduced outcomes conditionally; test the complete expected return `Σ P(outcome) × saved gross payout(outcome)` including zero-leg refunds, the user's loss precedence and void scenarios. Simply using `1 / P(all legs win)` is insufficient when pushes/refunds occur.

## Confirmed settlement

The user's October 9 clarification overrides the earlier two-leg fallback recommendation:

- Any losing leg loses the ticket, even when other legs push or are voided.
- With no loss, remove pushed/voided legs; **one or two remaining winning legs still cash**, using prices fixed at acceptance.
- Zero remaining legs refunds the stake. This is the stated implementation assumption for the all-push/all-void case; it is not a push-loss rule.
- Unresolved legs wait. A missing saved settlement price requires review, never today's model.
- Whole-ticket admin void refunds the stake exactly once through the existing ledger mechanism, overriding individual outcomes.

The pure settlement fixtures exercise these amounts after a JSON round trip of the research contract. They do not demonstrate production ledger idempotency or authorization; those remain launch gates. Existing promo database fixtures verify ordinary push/void/refund behavior continues to pass.

## Data/database contract for the later acceptance release

Keep simulations outside database transactions. Server-side quotes must be authenticated and scoped to membership, league, season, weekly pregame board and current revision. Recheck authoritative market state, phase, cutoff, lineup availability, disjoint teams/matchups, 3–validated-max legs and absence of market boosts/promo offer IDs. Accept only IDs and adjustment; reject client odds, probabilities, payouts and lines. Quote expiry, allowed adjustments, pricing policy and validated state come from versioned server configuration.

Persist league/user/board identity; original quote IDs and revisions; sorted stable leg order and matchup/team/selected-side identity; original and adjusted spreads; per-leg unboosted contractual odds; adjustment configuration/version; original parlay price; joint win/push/loss probabilities and conditional fallback prices; model/config/code versions; random seed, effective sample diagnostics, joint-input digest/provenance/captured times; dependence assumptions; policy hold, confidence bound, liability/stake caps and rounding; full gross payout at stake; zero-leg refund/loss/admin-void precedence; expiry and accepted time. Save all price paths needed for each push/void subset; selecting a subset must not rerun today's simulation. Freeze terms at acceptance and distinguish later outcome corrections from original projections.

An additive migration must use exact `numeric` odds/stake and cent-based payouts, foreign keys scoped by league, immutable accepted terms, RLS membership read policies, no direct member writes to quotes/settlement, privileged service-only quote writes, restricted security-definer functions with empty `search_path`, and indexes for league/revision/expiry lookups. A short acceptance transaction locks board/quote/wallet in a consistent order, rechecks revision and expiry after locks, atomically consumes one quote and request ID, writes ticket/legs/ledger/email outbox and updates balance. Uniqueness on league/user/request handles retry/concurrency; settlement has a unique refund/payout ledger key. Never alter the ordinary parlay path or physically delete accepted tickets.

This is a specification, not an applied migration. Teaser acceptance stays unavailable until concurrent/stale/expiry/league-isolation tests run against the actual new RPC and hosted test schema. Ticket history, reporting and confirmations must show the saved ticket type/adjusted terms before enabling.

## Validation report

**Assessment: share with caveats for research; not ready for accepted teaser pricing.**

Source checks verified 12 distinct teams and six exact matchup pairs per completed week, numeric scores, no duplicated weeks, and no current incomplete-week inclusion. Margin arithmetic was recomputed from the raw score pairs; each matchup appears once. Quantiles use linear interpolation. No outliers were removed. Simulation independence was checked against the product approximation, and shared-factor tests confirm the engine responds to dependence. All tested adjustment/subset payout curves are monotone; sign/cross-zero math and conservative contractual rounding pass. Saved one/two/all-leg settlement, zero-leg refunds, loss precedence and missing-price review pass.

The main unresolved limitations are four weekly blocks, no completed original joint forecast history, artificial dependence/variance assumptions, unvalidated discrete push/void pricing, hold/liability decisions and no hosted teaser acceptance/settlement test. More simulated draws cannot solve those data/model limitations. A prospective Week 5 forecast-error check can inform the range but six new matchups cannot establish stable correlations.

## Collection and next review

Keep betting closed. Preserve the existing Week 5 benchmark, normal immutable model/source archives and live shadow logs. Do not regenerate the closed board to create purported pregame history. Newly collected observations after NFL starts must be labeled with actual capture time/phase and never substituted for the Wednesday forecast.

After the week is fully completed and scoring corrections are reviewed, use `collect-teaser-scores.mjs LEAGUE_ID 5 OUTPUT` and join the six saved benchmark pairs by roster ID/matchup. Compute signed forecast-margin errors, actual cover/push outcomes at 0/6/9/12 for both sides, week-block uncertainty and 3–6-leg joint hit rates across all compatible side combinations. Distinguish score corrections, lineup deviations and source timing. The prospective original-spread check can guide the next center; lack of archived covariance prevents claiming that a historical joint price was calibrated.

Future generation through existing `save_model_forecast` can collect richer prospective inputs after migration 032; no such records were yet observed in this inspection. Verify actual successful scheduled captures rather than assuming the existence of a table proves collection. No new recurring automation or live betting window was created by this research release.

## Verification and rollback

Completed: `test:teasers`, compiled `test:api` as part of `build`, `lint` (existing warnings, zero errors), `test:lines`, `test:promos`, and local `test-teasers-ux.mjs`. Browser evidence: 390×844 and 1440×1000, dark/light, sign crossing, all choices, comparison payouts, preserved originals, conversion back, invalidation after leg removal, and disabled unpriced state; zero external requests/page errors. The Python runtime lacked Playwright, so Webapp Testing's networkidle/reconnaissance workflow used the installed Node Playwright package. Physical devices were not tested.

Rollback: revert only the research preview and strict request guard release; no database rollback is required and no accepted teaser terms exist. Preserve ordinary parlay/promo settlement and unrelated releases. Never enable by merely setting a UI flag or removing the server rejection.
