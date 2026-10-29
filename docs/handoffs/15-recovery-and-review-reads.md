# Recovery and model-review reads — October 28, 2026

This is the next reviewed development unit after the protected hosting setup.
Production application and database changes still require exact release approval.

## Recovery evidence

- An application financial snapshot was encrypted inside one read-only Postgres
  transaction before leaving production. Plaintext size: 11,078,903 bytes;
  encrypted compressed file: 494,361 bytes. No Auth credentials or application
  secrets were retrieved. Keys remain in the ignored local working directory.
- Decrypted in memory and restored into disposable local PGlite: 67 tickets,
  183 legs, 12 wallets, 130 ledger entries, 12 memberships, 90 referenced market
  quotes, five board identities and one reopening approval. All 23 exported
  relations matched canonical checksums and row counts. All 82 foreign keys
  passed, including circular board/reopening references. A restored open ticket
  was refunded twice locally, producing exactly one ledger credit and the correct
  wallet balance. Anonymous and unrelated
  authenticated users could not read financial records.
- Source document SHA-256:
  `6495e9590a62e21ef71e47e17e5535d741e6707efa9064b6f3dc7f9c74e7becd`.
  Ciphertext SHA-256:
  `1f4f5d21e0bcc8451459f990de0f966fd99aab4dc6fc9e4484d3599ba291c92f`.
- This is not a full platform backup. Auth credentials, complete current unbet
  markets, generated archives, transient work, platform settings and Storage
  objects are outside its scope. Private-key custody currently depends on the
  same Windows account/profile; owner-controlled off-site escrow and a complete
  platform restore remain open gates. See `docs/financial-recovery.md`.
- A synthetic regression verifies exact restoration and rejects altered schema
  or missing FK dependencies. No real production data enters CI or hosted dev.

## Model-review read changes

- New invoker views are callable only by the server role. Anonymous and normal
  authenticated users have no view access. Original admin UI tables and RLS are
  unchanged. Supabase advisors show no additional findings after the migration;
  existing guarded-RPC/no-policy notices and Auth password-protection warning
  remain baseline findings, not a clean-security declaration.
- Publication matching reads only the exact league/season/week and required
  selection key, side, line and assessment-run reference. It fetches two snapshot
  projections per page, excluding complete market metadata and source inputs.
- Futures model review uses one opening forecast per origin week with only
  settlement/probability fields. It no longer downloads every futures refresh.
  Its report explicitly labels fixed opening horizons and correlated origins.
  Complete intraweek trajectories are intentionally retired in this review.
- Replay history selects the latest corrected report per period and at most 51
  prior periods. Creation-time ties use the highest ID, preserving the prior
  deterministic selection. It no longer reads every historical review revision.
- Assessment version is `weekly-review-v2-fixed-horizons`, included in the
  immutable assessment input hash, so a rerun does not silently reuse a v1 report
  whose future-trajectory contract differs. Old reports remain preserved.
- All review page readers require explicit columns. Heavy selected model payloads
  are loaded sequentially in groups of two rather than concurrent groups of 20.
  Tests retain scoring, settlement, chronological and promotion/rollback gates.

## Measurement and limits

A read-only production expression equivalent to the publication projection,
for the latest failed-review week, compared 19 snapshots: 146,346,694 bytes of
original quote JSON versus 2,508,858 bytes of projected JSON (98.29% less).
This measures uncompressed JSON content for that read path, not actual transport
bytes, billing savings, database execution time or physical storage reclamation.
Production does not use these new views until an approved release.

The raw archive writers still append full payloads. The model pipeline still
loads bounded-count metadata across historical periods and selected full replay
payloads; checkpointed review and compact evaluation samples remain open. Browser
report futures and account histories still need bounded replacement readers.
Do not report archive growth, the Supabase quota overage, second-league capacity
or the entire efficiency handoff resolved by this unit. No historical rows were
removed. No production cleanup is authorized by the existence of this snapshot.

## Deployment record

Development migration source: `20261028210237_bounded_model_review_reads.sql`;
managed development version: `20261029005824 bounded_model_review_reads`.
It adds three worker-only views and no destructive changes.

- Application source: `045aef967f3feb99a7aeee089f4a3c700817426d`.
- Ready Preview deployment: `dpl_2HC9mVM9wvYbQU3B94atSruquxed`.
- Canonical URL: https://dev.sportsbook.coopergurrie.com
- Generated URL: `fantasy-sportsbook-g67mvrefo-cooper-gurrie-projects.vercel.app`.
- Canonical, generated and both stable dev aliases returned 302 to Vercel SSO
  while signed out after assignment. No bypass/share link was created.
- Hosted build verified the development database, key, owner, closed signup,
  mail capture/manual automation and compiled API runtime. No TypeScript errors.
- All 35 maintained suites passed after sequentially rerunning UI checks. The
  initial UI attempt collided with a separate local rebuild; the original result
  and successful rechecks are preserved. The last version-only change passed
  additional model, API runtime and server TypeScript checks. Production dependency
  audit reports zero vulnerabilities.
- No new hosted authenticated worker/model-review execution is claimed. Dev
  operations remain disabled, no production data was copied there, and provider
  protection was not bypassed. Fixtures exercise the new SQL projections and
  full review pipeline locally; hosted checks verify schema grants/build/privacy.
- Production still serves `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`; no production app
  deployment, database migration, cleanup, real bet, campaign or paid upgrade.
- No branch push. Original dirty checkout remains preserved.

Production rollback can keep the old application; do not deploy the new worker
against a database lacking these views. The added views are compatible with the
previous dev app, and reverting source does not require dropping them.

Baseline advisory references: [private server tables without public policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[anonymous guarded functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated guarded functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[Auth password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
