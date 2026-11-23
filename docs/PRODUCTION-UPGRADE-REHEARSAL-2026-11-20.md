# Production schema and wallet upgrade — November 20, 2026

## Delivered locally

Later November 20 update: worker configuration/staging and actual application integration tests are implemented. See `docs/PRODUCTION-RUNTIME-PREPARATION-2026-11-20.md`. This includes a publisher fix for legacy board closing windows and supersedes earlier package evidence. Hosted activation/acceptance remains pending; nothing was deployed.

The Production-specific schema expansion and legacy wallet/futures routing are implemented and tested against the November 20 encrypted backup. **No hosted database, deployment, scheduler, account, or email was changed.**

The atomic migration is `supabase/production/migrations/20261120152909_production_release_schema_and_legacy_routing.sql`. It is intentionally outside the Development migration directory. It installs a **prepared** release; it does not transfer balances, activate betting, schedule a worker, copy Dev accounts/data, or reenable email delivery.

Assembly uses the final schema definitions with twelve explicitly reviewed environment-guard ports. It does not replay historical Development seed/import/job SQL. The Production identity marker, current verified platform-owner identity and legacy email suppression are retained. Private helper functions lose unnecessary anonymous/PUBLIC execution. Development history-import helpers, Dev dispatch and capture writers are excluded; the empty legacy capture relation remains because historic email-log readers join it.

## Financial and identity behavior

- Original tickets, legs, odds, stake, accepted lines, results and legacy receipt ownership remain unchanged.
- The owner requests a short-lived review bound to current memberships, verification, roster identities, wallet amounts and open liabilities. Changes invalidate the review; expired, cross-actor and reused reviews cannot move funds. Identical repeated review requests reuse the existing snapshot, with a bounded review budget.
- Applying the reviewed plan moves eight verified users' cash once and retains four unverified/unregistered entitlements. The aggregate remains **1,538.40 credits**: 1,138.40 in verified person wallets and 400.00 reserved in legacy wallets in this backup scenario.
- Pending credits are bound privately to the original email and Sleeper identity. A later verified original recipient can receive them once. A replacement can have a separate zero opening but cannot take the original person's reserved credits.
- Nelson remains nellyknowsball, a co-manager of Diabloo. His existing mapping moves into the co-manager relation instead of being presented as the primary manager. No fake primary-manager email or Auth account is created.
- All nine open tickets are season futures, totaling **225.00 outstanding stakes**. Their reviewed payout routes point to the original mapped bettors, not the selected teams. The routes preserve accepted receipt snapshots and do not overwrite ticket ownership fields.
- Legacy settlement/refund first records its normal receipt, then transfers that exact payment to the reviewed person wallet in the same transaction. A separate immutable trace links both ledgers and the original ticket. The legacy team wallet is not left holding an orphaned payout; retries cannot pay twice.
- Claims, personal ticket history, standings, notification eligibility and next-season futures carryover recognize the approved legacy routes. Unproved closed-ticket personal attribution is not invented; those records remain searchable league history.
- Claims and new wager writes remain fenced while the release is prepared. The old weekly reset/automation claim entry points are retired rather than allowed to reset balances after cutover.

## Old jobs and scheduling

Read-only Production inspection found one active cron dispatcher: `sportsbook-weekly-worker`, once per minute. The migration refuses to run while that dispatcher remains active. `supabase/production/pause-legacy-worker.sql` is a **future cutover action**, bound to the observed job ID/name/command hash; it was not executed.

The backup contained 44 unfinished legacy jobs. The rehearsal canceled them with their original records retained privately and an explicit owner reason. They were **not labeled successfully executed**. Active/unknown leases block cancellation, changed job state invalidates the digest, and retired jobs cannot restart or be erased through normal writers. These actions also remain unperformed on Production.

## Verification

The exact packaged SQL hash is recorded in the private rehearsal receipt and release manifest. The rehearsal restores 27 financial/access/job dependency tables, 12,939 rows, 11 Auth identity stubs and the original application schema from the encrypted native archive. The baseline check covers 91 foreign keys and exact ticket/leg/ledger content.

Passed upgrade scenarios:

1. One atomic schema transaction; controlled failure before commit restores the original schema and financial state.
2. Repeat application does not duplicate data or activate betting.
3. Wrong/active legacy scheduler is blocked; private functions deny anonymous execution; mail suppression survives.
4. Non-owner, expired, stale and consumed wallet reviews are rejected.
5. Eight transfers, four person-bound pending entitlements and nine future routes conserve cash; the migration creates no Auth accounts or rewrites original tickets.
6. Original pending user verification releases the reserved amount once; a replacement cannot inherit it.
7. Won, lost, push, void, partial-parlay and mixed won/push outcomes against copied real tickets route the correct payment once. Duplicate settlement/refund attempts do not add credits.
8. Each verified user's claim breakdown and personal history include the correct legacy future stakes. Futures remain excluded from the claim threshold.
9. Active jobs cannot be canceled; reviewed canceled jobs cannot restart; repeated job retirement is idempotent.

Every funding/outcome/identity scenario is rolled back in the disposable local database. The explicit replacement-account fixture never contacts a real Auth service or sends email.

Commands:

```powershell
node scripts/build-production-upgrade.mjs
node scripts/package-production-upgrade.mjs
node scripts/test-production-package.mjs
node scripts/rehearse-native-production-backup.mjs --upgrade
```

Private receipts are under `work/production-migration/` and alongside the November 20 encrypted checkpoint. Catalog inputs and recovery keys stay private. The packaged migration is self-contained; rebuilding it requires the private schema-source snapshots. Reassembly/source edits invalidate previous hash-bound evidence.

Final regression checks also passed for migration staging/target fences, exact financial recovery and foreign keys/RLS, refresh outage/recovery and overlap protection, push destinations/retries, and email report isolation/escaping/MIME fallbacks. These checks sent no emails. The release source manifest now includes the separate Production SQL profile and its assembly/rehearsal helpers; the regenerated 307-file manifest remains marked not ready for cutover.

## Storage and performance implications

The migration does not copy large Dev caches, forecasts, email bodies, reward runs or histories into Production. Transfer, route, pending-recipient and payment records are bounded by this cutover population. Repeated review calls reuse an unchanged snapshot and have a rate budget. Legacy payout tracing adds a few small rows per affected future, not per refresh.

Current Production metadata shows approximately 228 MB in `model_forecast_runs`, 47 MB in markets, 37 MB in forecast snapshots and 29 MB in live forecasts. Most existing storage is historical forecast data. These are physical relation sizes, not new migration payload or measured IO-budget consumption. The migration adds no indexes to those three large forecast relations. New stored generated columns affect small league/job/mail/promo tables; two new active-market indexes still require a bounded scan of the existing market table at deployment.

The local fixture deliberately excludes bulky forecast/model archive data. It therefore **does not prove hosted DDL duration, lock impact, disk IO budget, full archive runtime compatibility or sustained refresh capacity**. No production cleanup, vacuum/full rewrite, broad history deletion or compute upgrade was performed.

## Still required before release

- Hosted privilege/runtime checks and full application postflight with the Production-targeted frontend/APIs, real Auth, source refresh and updated schema. This is a database/financial workflow rehearsal, not full browser/worker integration.
- Finish the controlled Production refresh-worker activation/job replacement, fresh Production token/control cache and current-board/history-cache warmup. The old cron remains active on the live site until the approved cutover; the new one has not been scheduled.
- Validate routine Production email sending/permissions separately. Existing mail suppression remains intact; no invitations or test messages were sent by this work.
- Review/freeze the entire release source, inspect expected live IO/locks, and obtain final cutover approval. Recheck job fingerprints and take a checkpoint adjacent to that cutover.
- Wider season-end and physical-device push acceptance remain as previously deferred. The carryover SQL recognizes legacy routes, but this rehearsal does not claim the full season-end lifecycle is accepted.

The release remains **not deployable** until those gates pass. See the November 19 preparation runbook for the cutover sequence and the rollback boundary after person-wallet writes begin.
