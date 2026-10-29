# Summary/retention continuation — work in progress

Milestones 11 and 12 remain incomplete. The additive summary kernel and synthetic
tests are a foundation only: no writer, expiry job or new candidate controller is
connected to the application. Do not delete samples based on this module's existence.

The engineering proposal preserves automatic improvement with frozen candidates;
the owner asked about storage cost and acceptable Sleeper-level accuracy, not for
a more complex predictor. It does not represent explicit owner approval of a new
production controller. Candidate settings are small. Use Sleeper as the paired
as-of benchmark; hold or reject changes without sufficient evidence.

## Evaluation charter to implement before expiry

- Grain: one designated opening actual-starter team prediction, grouped by league
  week; use matched league-scored Sleeper input. Never count repeated refreshes
  or the two sides of one market as independent observations.
- Train with the existing eight-week minimum using bounded additive statistics.
  Propose one two-scale shrinkage candidate and freeze its configuration and
  server-assigned known-at time. Only later prediction times may enter validation.
- Keep the existing primary score MAE, 2% practical gain, parameter step bounds,
  99% week-block confidence, validation minimum 12 weeks/120 paired observations
  and untouched holdout minimum four weeks/40 observations. Small eight-team
  leagues wait longer to meet counts; never lower gates to manufacture success.
- Keep current and initial frozen model baselines as well as Sleeper; require
  probability/market non-regression before promotion. Score gain alone is not
  enough to change uncertainty or prices. Unsupported market comparisons hold.
- No refit or candidate selection using validation/holdout results. Reset on
  incompatible league scoring/roster context or active model changes. Preserve
  pause/rollback controls, lease fencing, idempotency and active-version CAS.
- Keep bounded per-week paired differences/coverage and small candidate settings,
  not full historical replay. Corrected outcomes must update summary versions
  idempotently without turning previous holdout outcomes into training data.
- Integrate current-week readers, database promotion guards and the UI before
  removing replay. Then activate bounded, indexed seven-day post-summary sample
  expiry, with 14-day unresolved escalation, capped delayed outcomes and coverage
  gaps. Financial ticket terms are outside model retention.

The new `evaluation-summary.ts` kernel preserves additive error sums, squared
errors, interval counts and five-bin probability/calibration sums. Weighted totals
must be merged before division; arbitrary quantiles and unrestricted retraining
are intentionally not reconstructible. Still add categorical/distribution/live/
futures summary coverage, version/context integration, safe correction persistence and
archived-summary UI before calling milestone 11 complete.

## Local persistence foundation (not hosted)

Source migration `20261029034008_compact_weekly_summary_store.sql` defines one
latest corrected 64 KiB summary per league/season/week, with admin RLS and a
worker-only save RPC. It requires a confirmed scoped weekly review carrying
`summary_context_hash`, validates bounded additive fields, fences stale job
attempts and corrections, and leaves known-at unchanged on an identical retry.
Synthetic PGlite tests passed idempotency, correction revision ordering, missing
confirmed review, unexpected body fields and role/tenant denial. It is registered
in `test:model` together with the math kernel tests.

**This migration has not been applied to hosted development or production.**
It is not yet called by `model-pipeline.ts`. Before applying/integrating, review
the complete validation contract and test empty/partial summaries, malformed
nested fields, dimension/context changes, competing reviews, positive admin
reads and the current-week outcome guard. Add the context hash to the saved
review before calling the summary RPC. The stored summary must not be interpreted
as sufficient for unsupported quantiles/categorical/futures metrics or arbitrary
model fitting. Do not activate cleanup until candidate/review readers are migrated.

## Scheduled continuation

Milestones 09 and 10 are complete in protected development; counter remains
10 complete / 14 remaining. Deployed application source is
`a87fce855dc8ee86500b30dd47f13671aa879b88`, deployment
`dpl_EVadC6xk2eC6erTLhXsrTi9Hy8iJ`; later local commits include only summary
foundation work and checkpoint documentation and have not been deployed.
The one-time thread automation `resume-boff-handoff-at-2-am` is active for
October 29, 2026 at 2:00 a.m. America/New_York, after the observed 1:56 a.m.
five-hour limit reset. Inspect current state first and avoid duplicate active
work. Continue sequentially without asking for routine confirmation; report
completed/remaining counts after verified milestones. Preserve exact production
approval, original-checkout, privacy, no-paid-upgrade and experimental-betting
constraints. Do not mistake a foundation commit for completed retention.

Use the validation-design skill's locked chronological protocol. No reported
candidate performance or accuracy advantage exists yet. All production release,
historical cleanup and complete recovery gates remain in force.
