# Compact summaries and prospective candidates — October 29, 2026

Milestones 11–12 implement the development retention and candidate mechanisms.
The one-time `resume-boff-handoff-at-2-am` automation was deleted at the owner's
request. Continue in this chat without scheduled wakeups or routine confirmations.

## Retention contract

One corrected, versioned summary per league/season/week retains additive score
errors, paired Sleeper errors, interval counts, binary calibration bins, bounded
categorical/distribution diagnostics, live horizons and future-event coverage.
Admin reports read league-scoped retired summaries in bounded pages and label
their aggregate scope. Individual forecasts, largest misses and roster replay
cannot be reconstructed after expiry.

New-format transient evidence becomes eligible seven days after its latest
confirmed summary. Cleanup handles at most two periods per worker maintenance
call, skips active leases and requires the matching reviewed input hash. Pending
future evidence remains capped; escalation starts 14 days after the actual board
deadline. Other unresolved periods receive a 14-day health flag. Closed periods
reject new raw review writes, including late correction attempts. Financial
settlement and accepted terms have an independent lifecycle.

The cleanup implementation runs as a restricted, non-login role without wallet
or ticket mutation privileges. A service-only public wrapper checks the worker
identity. This wrapper is necessary because the managed development Auth schema
does not grant custom-role usage. The private implementation cannot be called
directly by service_role. Historical archives and old-format reviews are excluded;
production bulk cleanup remains milestone 13.

Development automation remains manual. Cleanup runs when the weekly worker runs;
seven days is eligibility, not a promise that an idle dev project executes it.
Budgets measure logical JSON bytes, not physical database space. No physical
storage plateau or reclaimed production space is claimed.

## Prospective candidate contract

The controller retains eight compact training weeks, a frozen training snapshot,
two candidate scales, at most 32 weekly evidence vectors and four monitoring
weeks in one bounded league state. A server timestamp freezes the candidate
before future validation predictions. Validation/holdout outcomes cannot refit it.
Context or active-version changes reset incompatible state; historical
corrections cannot trigger promotion. CAS and worker leases fence concurrent work.

Promotion retains the 2% practical score gain, 99% week-block confidence, current
and initial frozen baselines, matched Sleeper non-regression, probability/market
safety, cooldown/pause controls and at least 12 validation weeks/120 observations
plus four holdout weeks/40 observations. Eight-team leagues need additional
weeks to meet observation counts. Unsupported comparisons hold. The database
also requires the current frozen state and its evidence before promotion.

This is a tested dev mechanism, not evidence of an accuracy improvement. No real
candidate has accumulated the future weeks needed to pass. Production policy and
release still require approval of the exact source and migrations.

## Hosted development migration map

Only project `whlcnlacueweaqpsupqs` received these migrations:

| Local source prefix | Hosted version | Name |
|---|---|---|
| 20261029034008 | 20261029135014 | compact_weekly_summary_store |
| 20261029130921 | 20261029135015 | prospective_model_state |
| 20261029132335 | 20261029135057 | evaluated_sample_expiry |
| 20261029135331 | 20261029135459 | retention_auth_schema_access |
| 20261029135959 | 20261029140347 | overdue_future_evaluation_health |

The summary foundation was hardened before its first hosted application. Do not
rewrite any of these now-hosted sources; subsequent fixes require new migrations.

## Verification

The full release preflight passed 35/35 checks. An initial run exposed a teaser
test dependency on an unstarted local server; its fixture now owns an isolated
loopback Vite server with outbound requests blocked. The complete rerun passed.
Additional archive UI coverage uses intercepted synthetic data only.

PGlite suites cover summary validation/idempotency/tenant denial, frozen training,
prospective phases, pause/context/time holds, CAS/server timestamps and promotion
guards. Synthetic future evidence exercises SQL gates; it is not observed model
performance. Expiry tests cover leases, retries, unresolved future deadlines,
audit-pinned decisions, immutable legacy records and unchanged financial rows.

A rolled-back hosted synthetic transaction saved a summary and candidate state,
skipped cleanup during a live lease, retired one eligible period after release,
and rejected reopening. The cleanup role could neither delete tickets nor change
wallets; members could not assume it and service_role could not bypass the wrapper.
No synthetic probe rows were retained. Production was not modified.

Broader log/email/media retention, off-site recovery, physical capacity and exact
production release approval remain separate incomplete milestones.
