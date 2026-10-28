# Model Assessment and Controlled Improvement — Development Handoff

**October 28 priority update:** [Supabase efficiency handoff 08](08-supabase-efficiency.md) takes precedence. The user explicitly does not want permanent history of every refreshed line, projection or model calculation. Replace full archive writes with current state, short-lived bounded diagnostics, selected compact fixed-horizon evaluation samples and finalized accuracy summaries. Expire samples after review; preserve accepted ticket terms and financial records. Earlier requirements below for full replay/complete archives are superseded. Full historical research is intentionally limited; do not silently retain large payloads to support it. Production audit found 18 failed model-review jobs; instrument the exact timeout query and verify bounded review and retention gates before further model expansion.

Updated 9 October 2026. Read [shared context](PROJECT-CONTEXT.md) and [methodology and operating policy](../model-assessment.md).

## Release status: deployed, baseline unchanged

Application implementation `c1384e01b0251716b9c24b13523b242b5ba4cce2` and archive-read optimization `bbfbe077ce12edeaa7393b4189c3b87332d03b52` were pushed to `main`. The final [Vercel deployment](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/DjVkE9qz4vPo35sDDCfxJ6yNDEyH) was verified **Ready / Production**, with source `main / bbfbe07` and alias [sportsbook.coopergurrie.com](https://sportsbook.coopergurrie.com). This is release-time evidence, not a fresh health check in every subsequent chat.

Migration `202610090032_model_assessment.sql` is applied in production. Do not reapply it blindly. Production postflight preserved all **47 accepted tickets**. Active `score_scale=1` and `variance_scale=1` match the frozen initial baseline; improvement was not paused, but there were **zero promotion events and zero broad completed model reviews**. No candidate was forced into production.

The pipeline, configuration gates and report are deployed. A completed authenticated production review and a real production promotion/rollback have **not** yet been observed. Local passing candidate fixtures demonstrate the mechanism, not real model improvement.

## Implemented and available in the deployed application

| Component | Deployed behavior | Evidence boundary |
| --- | --- | --- |
| Pregame archive | Every successful Matchups, Player Points, Weekly Specials and Season Futures generation records immutable inputs, fair probabilities, uncertainty/distributions, source timestamps, model/config version and quote identity before returning quotes. Archive failure aborts generation and retains existing lines. | Prospective collection starts with this release; no full historical inputs were fabricated. |
| Published board archive | Existing `forecast_snapshots` retains published lines, prices and boost terms. Run IDs link new published quotes to original generated inputs. | Install-time snapshots remain separately identified; they are not complete historical as-of evidence. |
| Evaluation horizons | First generated opening and latest generation before the week's first confirmed NFL kickoff are selected per family. Other refreshes remain archived but do not inflate evaluation samples. | Opening generated forecast and opening published board are distinct views. |
| Live evaluation | Existing immutable live runs/reviews and selected progress-quartile horizons are linked into the broader review. | Experimental live betting acceptance remains disabled; live accuracy/freshness is not validated. |
| Confirmed outcomes | Append-only outcome revisions retain score evidence, starters, participation and final season results. Completed NFL/ESPN week, independent score reconciliation and weekly ticket reconciliation are required. | Manual overrides, incomplete/conflicting scores or unresolved weekly tickets defer the review. Futures tickets do not block a completed-week review. |
| Weekly review | All selected generated forecasts are evaluated, including unbet and locked markets. Report includes MAE/RMSE/bias, interval coverage, Brier/log loss/calibration bands, special distributions, pending/final futures, coverage and largest misses. | Current incomplete weeks and unsettled future events are excluded from final performance. |
| Error decomposition | Team-market error, archived best-lineup conditional error, actual-starter forecasting error and lineup-selection gaps are separate. | Starters missing from the archived forecast pool are excluded and reported; later rosters cannot reconstruct prediction inputs. |
| Corrections and reruns | Identical inputs/state reproduce the same review; corrections append new outcomes/reviews. Old report values remain immutable and readable after config changes. | No accepted-ticket snapshots or beat-projection settlement benchmarks are rewritten. |
| Candidate mechanism | One predeclared shrinkage candidate changes only team score/SD scales, with chronological replay against active and initial frozen models. | Player, live and futures pricing algorithms remain frozen. No weekly LLM source edits or deployment. |
| Controls | Versioned, audited, leased-worker promotion with database gates and active-version comparison; admin pause/resume/restore previous config; automatic rollback monitoring. | Admin cannot force a failed candidate through promotion. Real promotion/rollback is not production-validated yet. |
| Admin report | Reports → Forecasts & Model Accuracy → Model Accuracy & Special Trends includes This Week's Model Review, residual/reliability/coverage charts, expandable diagnostics, candidate comparison and version controls. | Desktop/mobile fixture preview checked; authenticated production control interaction not exercised. |
| Weekly integration | Existing lower-priority `model_review` jobs discover pregame and live archives. Review failure is isolated; existing settlement, replenishment, recap, rollover, leases and priority remain intact. | Queue execution after a qualifying real completed week remains to be observed. |

Player fair probabilities/intervals are explicitly **new shadow normal diagnostics**. Original 15% historical/provider blending and ±15% provider-projection cap remain unchanged; posted fixed -110 player prices remain unchanged. Source observation timestamps unavailable from providers remain unknown. Cached sources retain original fetch timestamps rather than being relabelled as fresh.

## Fixed promotion and rollback policy

- Evidence uses the same league across scoring/roster-compatible seasons, with at most the latest **52 completed weeks**. No cross-league pooling is implemented.
- Require at least **8 training + 12 chronological validation + 4 untouched holdout weeks**, with 120 actual-starter validation observations and 40 holdout observations. Reaching 24 calendar weeks alone does not guarantee eligibility.
- Historical folds can learn only from results available before their prediction time. Corrections unavailable at that time are conservatively excluded. The holdout candidate is frozen from training data.
- Shrink estimates with `weeks/(weeks+24)`. Configuration steps are at most **2%** relative to the active value; absolute score/SD scales remain **0.9–1.1**. Seven-day promotion cooldown.
- Seeded **6,000-draw / 99% week-block bootstrap**, positive improvement bound versus active, nonnegative bound versus initial baseline, and at least **2% practical MAE gain** in validation and holdout. Affected-family probability, team-error and interval-coverage checks must also pass. Missing replay/family coverage fails the gates.
- Insufficient or failed evidence records a hold and keeps the current configuration. The objective is forecast accuracy, never book profit, wager popularity or user losses.
- Missing required monitoring-family coverage or invalid monitoring data can trigger automatic rollback. Statistical score drift requires four completed active-version week blocks and a 99% lower bound showing more than two points MAE degradation against the initial baseline. Outages that prevent assessment cause retries rather than establishing statistical drift.
- Rollback restores the parent/baseline configuration and pauses improvement. Accepted tickets retain their original rules and prices.

These thresholds are conservative operating choices, not proven guarantees of statistical power or protection against every false promotion. See methodology for exact segment tolerances, correlated futures treatment and statistical limitations. Forecast accuracy is an estimate, not a guarantee.

## Files implemented

- `api/_lib/model-assessment.ts`: immutable hashes, metrics, horizon selection, error decomposition, seeded candidate replay and gates.
- `api/_lib/model-pipeline.ts`: confirmed outcome collection, reconciliation, corrections, report persistence, candidate promotion and monitoring/rollback. Lightweight metadata selects opening/final replay payloads; full archived raw sources remain retained.
- `api/_lib/line-model.ts`: replay can preserve original published beat-projection count targets.
- `api/generate-markets.ts`: active configuration, immutable prepublication as-of logging, fair probabilities/distributions and shadow player diagnostics.
- `api/weekly-worker.ts`: isolated broader review integration alongside live review.
- `src/components/ModelReview.tsx`, `ModelReview.css`, `Reports.tsx`: review UI and admin controls.
- `supabase/migrations/202610090032_model_assessment.sql`: six league-scoped RLS tables, immutable records, restricted RPCs, new-league baseline initialization and scheduler discovery.
- `scripts/test-model-assessment.mjs`, `scripts/test-api-runtime.mjs`, `package.json`: assessment/database fixtures and compiled runtime coverage.
- `docs/model-assessment.md`, this handoff and `PROJECT-CONTEXT.md`: methodology, operating policy and release boundary.

## Tests completed and production verification

**Passed during implementation:** `npm run test:model`, `test:live`, `test:lines`, `test:weekly`, `test:futures`, `test:reporting`, `test:refresh`, `test:starters`, `test:isolation`, `lint` and `build`. The final archive-read optimization reran `test:model` and `build` successfully. Existing advisory lint warnings and the main bundle size warning remain.

Assessment fixtures verify independently calculated numeric/probability metrics; lineup error decomposition; opening/final kickoff cutoff; refresh deduplication; incomplete/push/inactive/pending-futures treatment; seeded replay; future-result leakage rejection; bounded passing candidates; insufficient-evidence hold; pause and rollback; append-only corrected results; idempotent reruns; old-report reproduction. A mocked full `reviewModelWeek` verifies identical reruns, corrections, and incomplete/unsettled no-write behavior. Local **PGlite** tests load migrations and exercise leases, restricted promotion, controls, correction append and rollback. They do not prove hosted simultaneous-transaction behavior.

**Production smoke passed after final deployment:** homepage HTTP 200; deployed main JS/CSS and lazy Reports JS/CSS byte-match the tested build. Unauthenticated POST requests to `/api/weekly-worker`, `/api/generate-markets` and `/api/place-bet` returned HTTP 401 without function invocation errors. No tickets/jobs were created by these checks. Production SQL postflight confirmed six tables have RLS, baseline remains active, direct admin writes/forced promotion are denied, and scheduler discovery includes pregame archives.

**Preview:** actual report component with explicitly synthetic fixture data, 1440-pixel desktop and 390-pixel mobile screenshots; mobile document width 390 with no overflow. Expandable HTML details available. Preview is not a production accuracy claim; no physical devices or authenticated production controls were tested.

Release evidence and preview copies are saved under `C:/Users/coope/Documents/Codex/2026-10-09/develop-weekly-assessment-and-controlled-automatic/outputs/`: `assessment-evidence.md`, `model-review-preview.html`, `model-review-fixture.json`, `model-review-desktop.png`, `model-review-mobile.png` and methodology/handoff copies.

## Remaining validation and planned work — not completed

1. **Observe the first real qualifying review.** At release there were three legacy forecast snapshots, ten live shadow runs, no live reviews and no broad reviews. Week 5 was incomplete. Sparse archives cannot establish retrospective accuracy. Verify subsequent normal generation archives, published run links, confirmed outcome revisions, job completion and the report without regenerating old data or settling early.
2. **Accumulate sufficient compatible as-of evidence.** No statistically justified production candidate or promotion is available yet. Leave the initial baseline active until every gate passes. Do not relax gates simply to show an improvement.
3. **Validate forecast assumptions.** Joint NFL/team correlations, player availability mixtures, position-specific uncertainty, probability calibration and provider heartbeat freshness remain unproven. Source freshness gaps are disclosed; they are not solved by the archive. Further model changes need a separate validated release.
4. **Hosted operational validation.** Concurrent transactions, worker capacity/outage behavior and multi-league scale are still outstanding. Physical-device formatting and authenticated production pause/rollback UI interactions have not been exercised.
5. **Scope deliberately not implemented.** Cross-league pooling, new recency/history weighting, player/live/futures automatic tuning, validated player probability pricing and live betting activation are not part of this release. Existing player history already contributes to the baseline; avoid adding the same signal twice. Any later pooling needs explicit authorization and isolation review.
6. **Product enhancements remain optional.** Separate promotion notifications and more detailed diagnostic explanation may be considered later. Current hold/promotion/control state is available through the report/audit history; no new weekly model email was implemented.

## Instructions for the next development chat

- Start with this handoff, `PROJECT-CONTEXT.md`, methodology and handoff 06 for accepted-ticket/N+ settlement constraints. Earlier task goals are fulfilled only to the deployed scope described above; remaining validations are not claimed complete.
- Inspect current archive, review, control/event and automation-job state before changing anything. Release-time counts are not current counters. An empty report or hold with sparse data is expected, not a reason to backfill historical inputs or force promotion.
- Require final scores and source agreement; strict reconciliation may defer an entire review. Inspect recorded queue errors/retry state. Never include the current incomplete week or report unsettled futures as final results.
- Preserve all accepted tickets and published projection benchmarks. Review code does not own wallet/settlement actions. Do not invoke live betting or bulk test mail to prove the assessment works.
- Configuration rollback: use the existing admin RPC/control; restore previous version and pause, never edit/delete immutable versions. Application rollback: retain migration 032 and N+ settlement support. **Never restore a pre-N+ / Exact-only settlement worker after N+ tickets exist.**
- Load Supabase Postgres Best Practices before database changes; use Validate Data/Statistical Analysis for model claims. Both analysis skills were installed and applied in this implementation.
- Never print credentials or environment files. Preserve unrelated existing `data/`, `docs/promos-boosts-handoff.md`, delivery-recovery notes, other handoffs and `work/`. Stage only intentional changes. No other league was activated by this work.
