# Bounded live shadow evaluation — October 28, 2026

This unit keeps experimental live acceptance disabled. `save_live_shadow` retains
its worker-only, job-attempt, lease, cycle-age, scope and authoritative-week guards,
but no longer inserts permanent detailed live runs. Generation sends only compact
numeric evidence; provider bodies remain request-scoped, not RPC archive inputs.

Each league/week keeps at most four samples: the latest fully eligible forecast
in each progress quartile. Team/roster IDs, starter target IDs, means, uncertainty,
observed scores and matchup probabilities/lines are sufficient for the supported
review. Player scoring histories, full player forecasts, rosters and provider
bodies are excluded. Names are limited display labels. Acceptance flags are
forced false, freshness stays explicitly unverified, and no automatic live-model
promotion is enabled.

Partial team captures become explicit gaps instead of masquerading as complete
league evaluation. A single bounded per-league health record holds current status
and counters. Limits are 64 KiB/sample, 128 samples and 8 MiB live sample JSON per
league, plus one health payload of at most 64 KiB. These are admission/JSON caps,
not physical database-size limits. Missing/over-budget optional evidence cannot
enable acceptance. Old observations cannot overwrite newer samples/status.
Summary-driven expiry remains the subsequent retention task.

Admin readers use a tenant-scoped invoker view over new samples, the latest blocked
status and projected legacy quartiles. No historical rows are modified/deleted.
Review reads at most ten scoped rows and fails visibly at that budget; supported
inputs are at most four legacy plus four new quartiles and one blocked status.
The UI describes retained horizons instead of promising full revision history.
Reviews compare the exact captured starter target IDs with final starters and
exclude changed lineups. Correlated horizons are not independent trials.

Tests cover 100 refreshes retaining one quartile sample, compact/full numeric
review parity, removal of player bodies, idempotency, stale attempts/leases,
row-cap pressure, tenant/anonymous restrictions, changed-starter exclusion and
older blocked observations preserving newer successful status. A rolled-back
hosted synthetic probe confirmed one retained sample and zero raw live runs.
Supabase security advisory counts are unchanged from handoff 17.

An observed fully eligible 12-team/six-matchup legacy shadow run measured
221,629 bytes of canonical source + payload JSON versus 6,123 bytes for compact
prediction JSON (97.24% less). The read-only expression returned only counts and
bytes. This is one content comparison, not network/billing savings, physical
reclamation or a two-week plateau.

Source migration: `20261029031739_compact_live_evaluation.sql`.
Applied only to dev `whlcnlacueweaqpsupqs`, hosted ledger `20261029032528`.
Production application/database remain unchanged. All 35 release suites passed,
plus the final delayed-observation regression. Tested source
`a87fce855dc8ee86500b30dd47f13671aa879b88` is READY on protected dev deployment
`dpl_EVadC6xk2eC6erTLhXsrTi9Hy8iJ`. All three dev aliases and the generated URL
returned signed-out 302 redirects to Vercel SSO, without a bypass. Hosted build
verified separate dev identity/key/Auth/mail and manual automation. No Git push
or production release occurred. The next unit must replace historical replay
before enabling sample expiry; admission caps alone do not finish retention.
