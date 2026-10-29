# Compact model predictions and Sleeper comparison — October 28, 2026

This development unit follows handoff 15. It changes the model-evaluation writer,
not the complete archive lifecycle. Production remains unchanged. The owner asked
whether frozen candidates would consume significant storage and said projections
only need to be close to, or better than, Sleeper. Candidate settings are small;
repeated full inputs are the main cost. This question does not constitute approval
of a new prospective learning controller or a production release.

## Implemented

- New generation requests send compact numeric predictions and target IDs to
  `save_model_forecast`, with scoring/roster configuration deduplicated per league.
  Provider bodies, full player/roster objects and Monte Carlo arrays are excluded.
- Opening evidence is fixed; the latest pregame slot can be replaced before the
  earliest known game cutoff. Futures retain opening only per origin week.
  Unknown cutoffs and over-budget requests record coverage gaps. Post-cutoff
  refreshes are intentionally excluded. Valid price generation continues when
  optional evidence exceeds the shape/size contract. Authorization, invalid
  scope and database failures still fail the request.
- Generation timestamps fence delayed retries. Retained identical retries are
  idempotent, changed retained identities are rejected, and older overwritten
  intermediate runs cannot replace the newest pregame evidence.
- Admission limits: 256 live samples / 8 MiB of sample JSON per league, 256 KiB
  per sample, 64 configuration contexts per league and 8 KiB per context. These
  are JSON/admission bounds, not physical database-size or index/bloat bounds.
  At capacity, optional evidence is skipped rather than silently deleting
  unresolved records. Summary-driven expiry is a subsequent required unit.
- No new rows are written to the permanent raw `model_forecast_runs` archive,
  including old in-flight requests (which record an unsupported-format gap).
  Existing historical rows remain immutable and readable through a server-only
  union view. No historical records were converted or deleted.
- Player predictions retain their original as-of Sleeper scalar, including
  before reopening adjustments. Reviews compare matched predictions under the
  league's scoring with Sleeper input MAE. Missing baselines remain missing;
  later provider data is never substituted. Administrators can see a compact
  comparison table and scoped incomplete-capture notices.
- Existing chronological candidate gates now additionally require complete,
  sufficient matched Sleeper benchmarks and nonnegative week-block confidence
  intervals in both validation and holdout. This adds a benchmark to the existing
  controller; it does not implement prospective frozen-candidate learning.
  Player Points and Futures accurately reference their applied baseline version.
- Assessment version: `weekly-review-v3-compact-sleeper-baseline`.

## Verification and measurement

Synthetic tests cover numeric review parity against full inputs, 100 captures
remaining two slots, immutable opening, retries/collisions, cutoff gaps, row/byte/
context caps, admin/outsider/anonymous access and missing or stronger Sleeper
benchmarks blocking candidate promotion. A rolled-back hosted development probe
also confirmed two slots, original Sleeper scalar, retry ordering and no raw run.
No real production business data was loaded into development.

One read-only production measurement used a Weekly Specials run with 12 teams,
220 player inputs and 69 quotes. Original source + payload canonical JSON was
931,116 bytes; compact context + numeric payload canonical JSON was 50,965 bytes
(94.53% less). Minified compact JSON was 47,818 bytes. This is one observed content
comparison, not a worst-case bound, complete RPC envelope measurement, physical
space reclaimed, billed egress savings or proof of a storage plateau. Sanitized
predictor inputs used for the local calculation were removed after measurement.

New development-only migrations (source file → hosted ledger):

| Source version | Hosted version | Name |
|---|---|---|
| 20261029013613 | 20261029021127 | compact_model_evaluation_storage |
| 20261029021624 | 20261029021913 | compact_capture_order_fence |
| 20261029022833 | 20261029023525 | sleeper_baseline_evaluation |

Prediction/context tables and the union view are server-only. Health/coverage
tables permit authenticated SELECT subject to league-admin RLS. Supabase security
advisors show two additional informational no-policy notices for the intentionally
server-only tables (12 total); existing guarded-function and password-protection
warnings are unchanged. See the [RLS notice documentation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
This is not a declaration of a clean security audit.

## Required continuation

Replace the full published `forecast_snapshots` writer and its remaining readers;
bound live forecast capture; implement compact weekly summaries, seven-day
post-summary expiry and the agreed bounded unresolved handling; reconcile the
candidate reader/controller with short-lived evidence. Until then, admission
caps eventually stop new optional captures and the full retention contract is
unfinished. Review the Sleeper-only option against fresh measured performance;
do not claim that an adjustment already beats Sleeper or needs perfect accuracy.

Full platform/off-site restore and key custody, exact release approval enforcement,
per-user wallets, bounded account history, multi-league capability imports and
notification work remain open. No production cleanup, second-league launch,
experimental acceptance, paid upgrade or support deployment is authorized here.
Tested application source: `ff29f6997c5c5d9de632553d71ec9ec51e9699eb`;
all 35 release checks passed. Protected development deployment
`dpl_Hw4PrmpAkGoHdVPqBLbMmRJyJ5sg` is READY at
https://dev.sportsbook.coopergurrie.com. Hosted build verified the development
identity, server-key target, independent owner, closed signup, captured mail and
manual automation. All three aliases and the generated deployment hostname
returned signed-out 302 redirects to Vercel SSO; no bypass was used. Production
still serves `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`. The dated output report contains
the size comparison, release-check results and unit patch. No branch was pushed.
