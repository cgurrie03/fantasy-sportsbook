# Summary/retention continuation — work in progress

Milestones 11 and 12 remain incomplete. The additive summary kernel and synthetic
tests are a foundation only: no writer, expiry job or new candidate controller is
connected. Do not delete samples based on this module's existence.

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
futures summary coverage, version/context keys, safe correction persistence and
archived-summary UI before calling milestone 11 complete.

Use the validation-design skill's locked chronological protocol. No reported
candidate performance or accuracy advantage exists yet. All production release,
historical cleanup and complete recovery gates remain in force.
