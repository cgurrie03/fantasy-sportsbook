# Model Assessment and Controlled Improvement

Read [shared context](PROJECT-CONTEXT.md). Recommended additional skill: Statistical Analysis. Status: specifications, not automatic training enabled.

## Goal

At the end of each betting week, assess every supported forecast and market family, learn from final results, and improve gradually without reacting excessively to a noisy week. Autonomous assessment is appropriate immediately; autonomous changes require measurable validation gates. No system can guarantee prediction accuracy or take unknowable future events into account.

## Archive Before Learning

Store immutable forecast versions with league, season/week, model/config version, source observation and fetch timestamps, roster/scoring rules, projected lineup versus actual known starters, pregame/live phase, fair probabilities, uncertainty, displayed lines, rounded odds, margin and promotion adjustments. Include locked markets and exclusion reasons. Save original opening, latest pregame, and selected live-horizon versions separately.

Archive final/corrected outcomes with source revision, actual starters, played/inactive status and settlement rules. Accepted-ticket snapshots are a separate evaluation view. Do not double-count dozens of intraday revisions as independent team-week observations. Preserve each published projection benchmark used by “beat projection” tickets through settlement.

The existing `candidates` function in `api/_lib/line-model.ts` blends historical average toward provider projections with a bounded adjustment. Audit this baseline before adding another correction that duplicates the same signal. Provider projections may already account for injury likelihood; avoid double-discounting.

**Separate lineup-selection error from forecasting error.** An optimal active/bench lineup forecast is a conditional estimate; a manager starting different players is not automatically a systematic scoring-model bias. Evaluate actual-starter player forecasts, best-lineup forecasts, and team market forecasts separately.

## Weekly Scorecard

| Facet | Primary measurements | Important treatment |
| --- | --- | --- |
| Player and team points | MAE, RMSE, signed bias; interval coverage | Separate position, injury/availability, actual starters and horizon; keep genuine extreme games. |
| Spread and totals | Margin/total forecast error, cover probability calibration | A 50% cover rate alone is not proof of a calibrated distribution. Include pushes explicitly. |
| Moneyline and playoff outcomes | Brier score, clipped log loss, calibration bands | Score unrounded fair probability; separate margin and price rounding. |
| Highest/lowest and count specials | Categorical log loss/Brier; count error and coverage | Exact-count choices are mutually exclusive; track omitted probability mass for top-six offers. |
| Weekly average/highest score | Distribution error and interval coverage | Joint team outcomes matter; maximum-of-teams is not simply the highest mean. |
| Futures | Forecast trajectories; final event probability scores | Final accuracy is unavailable until qualification/champion/draft outcome is known. Do not mark current standings as final outcomes. |
| Operational quality | Missing coverage, stale input rate, locked slots, corrections | Distinguish missing data from model weakness. |

Evaluate all generated markets, not only bets people chose. Show sample counts, date ranges and uncertainty. League weeks contain correlated observations; use week-block comparisons rather than treating every player, selection, or quote refresh as independent. Reconstructed old projections can be descriptive context but cannot establish true as-of forecast performance.

## Controlled Improvement Loop

1. Run after verified final outcomes and settlements are reconciled. Unresolved data is excluded with a visible reason. Model assessment failure must not corrupt settlement or block routine recap/rollover.
2. Compare the frozen current model with a small set of candidate configuration changes. Begin with bias shrinkage, variance calibration and bounded recency weighting; avoid rewriting the algorithm automatically.
3. Use chronological walk-forward evaluation and an untouched recent holdout. All inputs must be available at each historical prediction time. Remove look-ahead leakage from future injuries, current records, updated rosters and final stats.
4. Pool cautiously when local samples are small and shrink changes toward the baseline. Cross-league pooling is opt-in, de-identified, scoring-compatible and separately authorized; disconnected leagues must not reveal each other's data.
5. Predeclare minimum samples, practical improvement, confidence checks, worst-segment regression tolerance, and stability bounds. Initial weekly parameter change caps might be 2–5%, but the developer must validate these choices rather than treating them as statistically proven.
6. Promote only a candidate passing every gate. Otherwise record “Assessment completed; insufficient evidence to change.” Four completed local weeks are not strong evidence for fine-grained automatic corrections.
7. Store the promoted configuration and rationale as a versioned database artifact. Do not let an LLM edit/deploy production source code after each week. Provide admin pause, rollback, comparison report and a concise notice of meaningful changes.
8. Monitor the promoted version in shadow/production comparisons; automatically roll back on predefined drift or operational failures. Preserve accepted ticket rules and historical report reproducibility.

Book profit, wager popularity and user losses are business metrics, not the model's training objective. Promotions and rounding must not contaminate the underlying fair forecast assessment.

## Admin Report

Add a compact “This Week's Model Review” with error/bias, reliability, largest misses and causes, candidate-versus-baseline results, data coverage, current version, promotion/hold reason, and next evaluation. Link to grouped existing Model Accuracy & Special Trends reports. Use separate charts for score residuals, probability calibration, uncertainty coverage and version history rather than repeated generic bars.

## Acceptance

Verify scores independently on a known fixture; confirm one result per chosen evaluation horizon, correct push/inactive handling, no live/incomplete-week leakage, correct event probabilities, correlation-aware sample treatment, repeatable seeded simulations and no premature futures settlement. Test no-change for insufficient data, bounded promotion, failed promotion rollback, rerun idempotency, revised final scores, and reproducible old reports after a new version.

Recommended skills: Validate Data, Statistical Analysis, Data Visualization, Build Dashboard, Supabase Postgres Best Practices. The [Statistical Analysis source](https://github.com/anthropics/knowledge-work-plugins/tree/main/data/skills/statistical-analysis) supports statistical care; it does not replace model-specific validation.

## Implemented assessment release — 9 October 2026

Validate Data, Statistical Analysis (installed), Supabase Postgres Best Practices, React/Frontend and browser/test guidance were applied. See [complete methodology and operations](../model-assessment.md) for metric definitions, gates, source treatment and limitations.

Changed: `api/_lib/model-assessment.ts`, `model-pipeline.ts`, `line-model.ts` (frozen count-target replay), `api/generate-markets.ts` (immutable as-of inputs/fair probabilities/distributions), `api/weekly-worker.ts` (isolated review integration), `src/components/ModelReview.tsx/.css`, Reports integration, migration `202610090032_model_assessment.sql`, test:model and compiled-runtime fixtures. Original player history blending, accepted tickets, wallet paths and existing N+ settlement remain intact.

Migration 032 applied successfully in production through the authorized Supabase SQL editor. Initial active configuration equals the frozen baseline; no candidate was forced into production. Pregame generation now fails closed if immutable input logging fails. Player probability/uncertainty is explicitly a new shadow normal diagnostic, with published fixed player prices unchanged. Candidate scope is team-score/variance configuration only; live/player/futures algorithms remain frozen.

Preflight production evidence: 47 tickets; 3 forecast snapshots (one published futures snapshot and two install-time snapshots); 10 live shadow runs; 0 live reviews; 0 failed jobs/expired leases. This sparse, mostly incomplete-Week-5 history cannot establish retrospective model accuracy. No missing source archive is recreated from current information. Local fixture preview is not production performance evidence.

Verified locally: assessment fixtures and append-only correction/rollback/idempotency tests; live, lines, weekly, futures, reporting, refresh, starters, isolation suites; compiled application/function build. Preview screenshots use 1440 and 390 pixel viewports and show no document overflow at 390. Existing advisory lint/main-bundle warnings remain. Hosted concurrency, capacity/outage behavior and actual production candidate power remain unproven.

Deployment receipt and final verification are recorded below after release. Rollback: restore the prior application retaining additive schema and N+ settlement; configuration rollback restores the parent/baseline and pauses improvement. No live bets or bulk test emails are part of verification.
