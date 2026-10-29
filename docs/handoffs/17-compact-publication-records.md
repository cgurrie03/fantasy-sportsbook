# Compact publication records — October 28, 2026

This unit replaces the `capture_forecast` writer with compact designated horizons.
It no longer inserts a full snapshot after every published revision. Current board
pricing, revision tokens, acceptance terms and financial records remain intact.

New samples retain bounded selection identity/display fields, numeric projections,
probabilities and necessary settlement targets. They exclude provider responses,
rosters, eligibility pools, full model/configuration and explanatory bodies.
The first publication is fixed; the latest eligible pregame publication replaces
its slot. Futures have opening/latest slots for each authoritative origin week.
Retries do not append rows or replace newer revisions. Capture runs under the
board lock and per-league admission lock, within the board-save transaction.

Limits: 256 samples / 16 MiB of live quote JSON per league, 1 MiB per sample.
Oversized, empty, ineligible or over-budget optional captures increment a compact
health record rather than block valid publication. Admission caps do not bound
physical indexes/TOAST/bloat and eventually stop optional evidence without expiry.
The summary/expiry milestone is unfinished. No historical archive is modified.

Report views select legacy fixed horizons before projecting JSON and union new
samples under admin RLS. Report metadata is bounded to 256 rows/season in pages
of 64; detail hydration is sequential in groups of two. Futures reports show
designated observations, not every historical recalculation. New compact records
do not support hindsight optimal-roster reconstruction; the UI says so rather
than retaining rosters. Legacy archives remain immutable, but unrestricted
line-movement/roster replay is deliberately retired from these read paths.

Model publication matching uses the same retained horizons. Its published counts
are fixed-horizon coverage, not evidence of every intermediate publication.
Assessment version is `weekly-review-v3-compact-sleeper-publications`; Sleeper
promotion gates from the prior unit remain enforced.

Local tests cover 100 publications retaining two records, a real board-save RPC
using only compact capture, score/settlement parity, no raw/roster bodies, futures
week slots, retries, live-phase exclusion, legacy immutability, storage pressure
and tenant/anonymous denial. A hosted dev-only rolled-back probe confirmed ten
captures become two slots (revisions 1/10) and no legacy rows. Security advisors
are unchanged from handoff 16. Full release results/deployment follow after checks.

Migration source `20261029030255_compact_published_forecasts.sql` was applied only
to development `whlcnlacueweaqpsupqs`, hosted ledger `20261029031152`.
Production remains unchanged and requires exact release approval. See
[IMPLEMENTATION-CHECKLIST.md](IMPLEMENTATION-CHECKLIST.md) for the stable counter.

A read-only expression over one observed 789-selection production publication
measured original canonical quote JSON at 8,058,050 bytes versus 614,818 bytes
under the compact field projection (92.37% less). This informed the per-row cap:
the original 512 KiB development limit would exclude this valid slate. Follow-up
source migration `20261029031348_observed_publication_sample_budget.sql` raises
only that per-row limit; league-wide admission is unchanged. This measurement
returns counts/bytes only, not raw business data, and is not physical/billed
savings or a worst-case guarantee. Summary-driven expiry remains required.
