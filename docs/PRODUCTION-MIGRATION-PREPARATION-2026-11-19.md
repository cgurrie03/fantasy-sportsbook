# Production migration preparation — November 19, 2026

## November 20 runtime preparation update

Worker configuration and isolated application integration for steps 1 and 2 are implemented; see `docs/PRODUCTION-RUNTIME-PREPARATION-2026-11-20.md`. Actual Production APIs/browser run against the upgraded offline backup with simulated external transports. Vault setup, disabled cron staging and reviewed-board activation are operator-only helpers, unexecuted on hosted environments. The publisher now replaces obsolete legacy close times. Hosted Auth/provider/worker/IO acceptance, final checkpoint/source freeze and approval remain; routine sending stays disabled.

## November 20 upgrade implementation update

The additive Production schema and separately reviewed wallet/future routing are now implemented and pass an atomic, repeat-safe local upgrade rehearsal on the fresh backup's financial/access/job core. Pending entitlements are bound to their original people, and duplicate settlement/refund paths are tested. This supersedes earlier statements below that the schema/financial upgrade implementation is still missing. **Hosted runtime/worker/IO integration and release approval remain outstanding; nothing has been applied live.** See `docs/PRODUCTION-UPGRADE-REHEARSAL-2026-11-20.md` for the exact artifact, evidence and remaining scope.

## November 20 recovery update

The owner ran the secure launcher successfully. New native Production checkpoint:
`work/platform-backups/production-2026-11-20T14-12-34-596Z-854b7b86-aaff-41d3-8478-21e6416d1304`.
Export finished November 20 at 14:13:38 UTC (9:13 AM Eastern). Database archive is 26,002,325 encrypted bytes; role archive is 6,663 bytes. Ciphertext hashes/lengths match the manifest; the decrypted database archive hash and native archive inventory were also verified locally. No plaintext dump was written to disk. No Production changes or emails occurred.

`scripts/rehearse-native-production-backup.mjs` passed a disposable local PGlite restore of the application schema and 8,061 financial/access dependency rows across 22 exported data tables, with 11 Auth identity stubs. It checked 91 foreign keys, exact ticket/leg/ledger content and outsider access denial. Restored totals: 90 tickets, 261 legs, 192 ledger rows, 9 open futures, 225.00 outstanding stakes and 1,538.40 available credits.

Private receipts: `integrity-verification.json` and `application-restore-verification.json` beside the encrypted checkpoint. The latter explicitly records **full_platform_restore_verified:false**. Forecast/model archives remain in the full encrypted export but were excluded from the bounded local data fixture; Auth credentials/sessions, Supabase services and external configuration were not restored. This is recovery proof for the existing application financial core, **not** the new application upgrade rehearsal or a complete platform recovery test.

The earlier secure-connection request is resolved for this checkpoint; no database password was retained. Windows PowerShell launcher compatibility was fixed by retaining streaming SHA-256 verification without depending on `Get-FileHash`; the owner launched with a process-only execution-policy exception, leaving persistent system policy unchanged.

## Status

Preparation is local and read-only against hosted services. **Production has not been migrated, deployed, paused, funded, or emailed.** Development has not been redeployed by this preparation. The current candidate is explicitly **not deployable**. This document is not cutover approval.

The frontend target separation and a real-data financial staging rehearsal are complete. The **full application database upgrade and its restore/upgrade rehearsal are not complete**. A successful frontend build, foundation recovery fixture, or financial staging test must not be reported as a successful application migration.

## Verified source inventory

Captured in one read-only repeatable-read transaction at **2026-11-19 15:05:05 UTC**. Private inputs, schema catalogs, exact source hashes, plan and browser results are in ignored `work/production-migration/`; no email addresses, Auth secrets, sessions, or provider credentials were included in the inventory query. Email fingerprints and account identifiers remain private.

| Item | Observed |
| --- | --- |
| Production Supabase | `bmvjcdgxwxqalaohpsnw` |
| Main league | `13121261-5398-4391-8240-000000000003` |
| Sleeper league | `1312126153980391424` |
| Tickets / accepted legs / legacy ledger rows | 90 / 261 / 192 |
| Ticket results | 61 lost, 19 won, 1 voided, 9 open |
| Available wallet balances | 1,538.40 total virtual credits across 12 wallets |
| Outstanding stakes | 225.00, **all season futures**; no open weekly stakes |
| Accepted potential return on open futures | 2,814.89 including stakes; liability, not a balance to fund now |
| Mapped member emails | 12: 8 verified linked accounts, 1 unverified account, 3 without an Auth account |
| Mail log | 323 sent, 73 skipped; no pending/failed/sending rows in this observation |

Read-only current Sleeper ownership confirms roster 8 has primary manager Diabloo (`1134536386335371264`) and co-manager nellyknowsball (`1269136771011055616`). The existing Production membership for Nelson uses **nellyknowsball**, not the primary manager. Preserve this person-level distinction.

The latest READY Production Vercel deployment observed was `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`, source `d1ea6c98d200326156aef76f8a8a6318b743f897`, from `main`. Reverify the actual canonical-domain assignment immediately before cutover; this is a recorded rollback candidate, not proof it remains current next week.

## Completed preparation

1. Added bounded, read-only financial inventory and schema/ACL comparison queries. They export no session or password material and make no hosted schema changes.
2. Added a deterministic financial plan that rejects a wrong source, duplicate/orphan records, conflicting account links, and changed snapshots. Amounts use integer cents rather than floating-point accumulation.
3. Rehearsed local financial staging with the actual 90 tickets, 261 legs, 192 ledger records and 12 balances: complete records remained equal; reservations conserved funds; rollback removed all reservations; repeat execution did not duplicate credits. Unverified/unregistered accounts were held without creating Auth users or permitting routine mail.
4. Added explicit Development/Production build targets and strict server target checks. Production requires the Production Vercel project, Production deployment environment, exact Production Supabase URL and explicit release schema flag. A Development deployment cannot opt into Production by changing only its URL or target label.
5. Built an isolated Production-targeted frontend and matching CSP. Scanned browser JS to reject Development Supabase references/keys. Removed Development banners from Production account/application shells. Corrected email icon URLs to use each report's website origin and the existing static icon assets.
6. Produced a private content-hashed candidate manifest and source manifest covering the current round, including untracked visual source. Secrets, backups, environment files and private work artifacts are excluded. The candidate has no deployment command and remains marked `deployable: false`.
7. Passed eight isolated Production entry checks: Chromium/WebKit, desktop/mobile, light/dark; correct Production Auth URL/key; no Development badge; no horizontal overflow. All sign-in traffic was intercepted. No real sign-in email was requested.
8. Verified the existing native backup client binaries/public key and synthetic encrypted-export tests. **No fresh native backup or full restore was performed.**
9. Added explicit worker target selection with exact Supabase URL/schema fences, environment-specific CORS/email/push origins and a required Production database `release_schema` marker. Local target/push checks passed. No worker was deployed or scheduled.

## Required migration work before cutover

### MIG-01 — Full additive schema and access upgrade

Production has the older team-wallet application. Development includes person wallets and a separate visual profile. Catalog comparison found 462 added columns, 261 added functions, 88 changed functions, 40 added policies and 53 added triggers. These counts are differences to review, **not an instruction to mirror Development**.

Build a deterministic upgrade against a disposable copy of the **actual Production schema**, including its November storage fixes and notification suppression. Use dependency order: environment/private schema and roles; wallet/access foundation; visual cache/publisher and pricing; futures/rewards/claims; membership/intake; notifications/support/audit; ACL and retention checks. Reconcile the three nullable-column changes and changed/removed constraints, policies and triggers explicitly.

Do not concatenate old Development SQL files or globally replace the project reference. Many guards deliberately reject Production, and some historical scripts contain one-time seeds/imports. Extract the intended schema changes, retain strict environment checks, and exclude test users, Dev balances/tickets, fake fixtures, caches, old reward runs, queued messages and cron secrets.

Retire legacy public write paths as part of the upgrade. Existing browser tabs and immutable older Vercel deployment URLs must not continue to place tickets, reset balances or settle bets through old RPCs after cutover. Revoke obsolete API permissions and test an old client against the upgraded schema; changing navigation alone is insufficient.

### MIG-02 — Wallet ownership and outstanding futures

Preserve all 1,538.40 credits and accepted tickets. Do not reset wallets to starting balance during this midseason migration or copy Development balances. Reuse verified Production Auth UUIDs. Keep the four unverified/unregistered email mappings pending verification/invitation; reserve entitlements without fabricating accounts or duplicating funding.

All nine open tickets are `ticket_type='future'` despite `market_week=1`. They are **not stale weekly bets**. Eighteen accepted leg contexts were inspected and retained privately; each has an accepted market kind, side and roster identity. Use those immutable contexts and accepted lines/odds, not current mutable quotes, team names, or current pick ownership. Preserve first-pick basis and season rules unless an explicit commissioner rule-change workflow is used.

The real upgrade must route a legacy future's subsequent payout/void refund to its reviewed person entitlement exactly once. **Moving the old wallet balance to a person wallet is not sufficient**: an old settlement writer could otherwise pay the now-empty team wallet. Test win/loss/push/void, partial parlays, duplicate retries, unverified recipients and late corrections. Keep future stakes excluded from the claim threshold and preserve the season carryover behavior.

Current membership is not proof of the bettor on every historical receipt. Keep immutable history and legacy archive access; assign personal history only with trustworthy accepted identity or an approved attribution record. Replacement managers must not inherit another person's tickets or wallet.

### MIG-03 — Production runtime and job replacement

The worker's local environment/origin selection is now parameterized with strict target fences. The Production database identity must expose `release_schema='boff-person-wallets-2026-11'` after the corresponding reviewed upgrade. The worker's called SQL adapters still need their intended Production guards and integration rehearsal; no global SQL replacement or Production deployment has occurred.

Bind the Production worker to the correct project, league, secret/control hash and environment marker. Use a fresh Production worker token and existing supported cadence/due/lease controls. Enable one pricing/settlement scheduler only. Stop the old automatic weekly balance reset and obsolete pricing/sending jobs during the coordinated writer fence. Do not run old and new wallet writers concurrently.

Reconcile the source league's stored `active_week=5` with the current published board/provider week and Tuesday 5 AM Eastern calculation. Do not blindly reset the season or seed a Dev week. Preserve pregame benchmarks, featured assignments, roster identities and existing receipts. New awards/offers/notifications must have a release baseline that prevents replaying the entire season.

### MIG-04 — Recovery checkpoint and restore/upgrade proof

An encrypted native Production export **did succeed November 5–6**. Its manifest records Auth/application/migration schemas, empty Storage inventory at that time, and encrypted database/roles archives. It explicitly says `restore_verified: false` and `full_platform_complete: false`. Older notes claiming no export occurred are superseded.

A fresh native export and existing-schema financial restore succeeded November 20, as detailed above. The **upgrade** rehearsal and full platform/runtime/configuration coverage remain required. Recapture a final checkpoint adjacent to the actual release, because live state may change. Connected query tools cannot produce a native full-platform dump; the owner-run launcher completed the current export without retaining the password. Never put the password or service key in chat or source.

Also record Auth site/redirect/verification/SMTP settings, Vercel domains/env variable names and secure custody, deployed worker versions, scheduled jobs, private encryption-root custody, and current Storage object inventory. Do not call a database export a complete platform backup or assume a schema-only catalog can restore Auth sessions/credentials. Keep Production Auth identities in place; never overwrite them from Dev.

### MIG-05 — Source freeze, acceptance and approval

The working tree contains substantial uncommitted/untracked round work. Before deployment, review and freeze a clean exact release source with lockfiles, full schema artifact/digest and worker dependencies. The source manifest is a preparation snapshot, not a substitute for a reviewed release commit. Rerun it after any source change.

Run the real upgraded application as member, commissioner and owner, including denied/cross-league/old-client paths, wallet claims, placement, settlement, futures, rewards, invitations and email preferences. Verify current scores/odds update without reload, provider outage recovery, retention and IO behavior. Local fixtures do not prove sustained live-game capacity or inbox/device rendering. Push can stay disabled until physical-device acceptance.

Record exact target/schema/worker/source/recovery receipts and rollback boundaries, then obtain the user's final release approval next week. Pricing/landing-page work, broad multi-league rollout, AMP activation and wider season-end work remain separately deferred.

## Cutover sequence after those gates pass

1. Recheck canonical Production deployment, account mappings, open liabilities and mail state. Capture a fresh snapshot after the temporary writer fence; reject drift from the reviewed plan.
2. Pause new wagers and competing financial/scheduled writers for the bounded migration window. Keep existing history readable. Do not use the old weekly-market closure as a migration substitute.
3. Take the final encrypted checkpoint, verify receipts, and apply the rehearsed additive upgrade transaction(s). Keep routine sending disabled.
4. Transfer/reserve credits and record immutable ownership/legacy-future routing with exactly-once event keys. Reconcile every old balance, accepted receipt and outstanding stake; no balance reset or historical outcome changes.
5. Deploy the Production-specific frontend/APIs/worker/config. Verify identity markers and deny obsolete write routes. Populate one current board with mail/award replay fences in place.
6. Owner postflight: real login, member isolation, balance conservation, old/new ticket display, valid current quotes, claim eligibility, commissioner actions, email capture and link destinations. Reopen writes only when these pass.
7. Invite/verify only the unresolved accounts in a controlled batch; verified users keep their accounts. Routine mail requires verification, active league access and opt-in. Reenable Production delivery only with separate release approval and send a controlled owner message first.
8. Observe the first game window and Tuesday rollover; retain the checkpoint and evidence through the agreed recovery period.

## Rollback boundaries

Before commit/new financial writes: roll back the migration transaction and keep old writers disabled until the previous application's integrity is verified. The local staging rollback does not prove hosted DDL rollback.

After person-wallet writes begin: **do not simply promote the old frontend or restore the old database**. That could orphan or erase new tickets/claims/settlements. Fence writers, preserve new receipts, then use the rehearsed compatible rollback or forward repair. A full checkpoint restore requires an explicit accepted data-loss window and reconciliation of post-checkpoint events.

## Reproduction

From the repository root:

```powershell
node scripts/test-production-migration.mjs
node scripts/prepare-production-migration.mjs
node scripts/prepare-production-candidate.mjs
python visual/scripts/test-production-entry.py
node scripts/export-platform-backup.mjs --check
```

Inventory/catalog inputs are deliberately private and must be freshly captured using the supplied read-only SQL. These commands do not deploy, send emails, or activate Production. The backup launcher is `scripts/start-platform-backup.ps1 -Target production` and prompts locally for the connection/CA/password.
