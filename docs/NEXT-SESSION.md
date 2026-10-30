# BOFF — consolidated next-session handoff

Prepared October 30, 2026 ET at the owner's request, with weekly usage 96% used.
Resume implementation from this file and the canonical queues. Do not restart the
original audit, repeat completed owner steps, or treat this document as permission
to bypass the user's production-review requirements.

## Workspace and boundaries

- Active checkout: `C:\Users\coope\Documents\Codex\2026-10-28\co\work\fantasy-sportsbook`.
- Branch: `codex/boff-handoff-implementation`. Use this directory explicitly.
- The original dirty checkout under `2026-10-05\i` remains untouched.
- Repository stays public. **No GitHub push is authorized.**
- Development changes and intercepted local/headless tests are authorized. Do not
  operate the owner's browser/computer UI or retrieve server/recovery credentials.
- Production app/schema/data changes require an exact owner-reviewed plan/source/
  migration set. Production metadata/capacity reads are authorized.
- No paid upgrade, new paid project/branch, support deployment, live/teaser launch,
  actual production bets, bulk mail or new scheduled continuation is authorized.
- The earlier 2 a.m. automation was canceled. Do not recreate it.
- User wants autonomous progress with completion notices, not confirmation after
  each unit. No subagents unless explicitly requested. Ask only genuine blockers.
- Every approved user has their **own wallet per league**, including co-owners.
  Preserve actual Wed–Thu acceptance plus approved reopenings; no Monday-close
  policy was adopted. Queue choice is **project Markdown + chat**, not an app board.

## Stable counter: 15 complete / 9 remaining

Complete in their stated isolated-development scope: **01–12, 14, 15, 19**.

| Remaining | State / next gate |
|---|---|
| 13 Historical cleanup | Recovery, useful summaries, dependency plan and exact production approval; no cleanup performed |
| 16 Settings/import/claims | Staff/independent-owner access delivered; versioned settings, supported-provider contract, draft import and verified invitations/claims remain |
| 17 Per-user wallets | Current active task; substantial local implementation below; **not complete or hosted** |
| 18 Notifications/storylines | Actual-window preferences, receipt lifecycle and bounded communications remain |
| 20 Full recovery | Financial checkpoint/key import done; independent-device drill and full-platform coverage remain |
| 21 Exact release enforcement | Source evidence and Git containment done; external protected publication boundary/other routes remain |
| 22 Residual audit/journeys | A01–A25 residuals, declared supported rules, tenant/device/peak/outage tests |
| 23 Capacity | Physical baseline captured; actual wire/shared quotas, forecast and two-week plateau remain |
| 24 Production release | Exact approved source/migrations, all gates, postflight; not automatically authorized by passing CI |

Canonical priorities: [bugs](BUG-QUEUE.md), [features](FEATURE-ROADMAP.md),
[counter](handoffs/IMPLEMENTATION-CHECKLIST.md). Support remains deferred/excluded.

## Hosted state — unchanged by local wallet work

- DEV Supabase: `whlcnlacueweaqpsupqs`; PROD read-only: `bmvjcdgxwxqalaohpsnw`.
- DEV verified owner: `d320882c-8a06-443b-a2a9-2e29a0d29cdd`.
- Synthetic A: `504bcaf3-0d46-90aa-6fa5-7c4ef1a88cd6`; synthetic B:
  `8ced0f01-e845-697c-ea32-05ced48b210e`.
- DEV operations remain manual/captured, unfunded fixtures, owner-only independent
  Auth and closed signup. Verify `application_environment_identity()` before writes.
- Last deployed DEV source: `01edd29e92fb24094d08b59a5bac25e88d5f0164`.
  READY deployment `dpl_3aXS7fchnfnrrMQCXXY8tJXFwsLf`, canonical
  `https://dev.sportsbook.coopergurrie.com`. Its generated URL and project aliases
  were signed-out 302 to Vercel SSO. No bypass or owner browser session was used.
- Production Vercel project: `prj_xQNaH7f1SPr8bgn2GV92a9MODQu8`; DEV:
  `prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts`; team:
  `team_Rs5IbC6savmEQLFb1VacjiTc`.
- **Owner completed Disconnect** for production's Git link. Connector inventory
  confirmed the sportsbook is no longer linked; unrelated landing project remains.
  Production deployment is still READY `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ` with the
  same domains. This specific owner configuration action is not an app release.
- Last hosted financial postflight: 18 wallets, zero tickets/ledger. Canonical
  wallets/tickets/ledger digest `d0274d9641a5954673be2e62be23cb59` before/after
  rollback probes. No live financial/provider action ran.

Hosted routine retention migrations: local `20261030002655` -> hosted
`20261030003728`; local `20261030003807` -> hosted `20261030003830`. Earlier hosted
migrations are immutable. Their WARN baseline was 37 authenticated-definer /
2 anon-definer / 1 Auth-password; RLS-no-policy INFO dropped to 10. Wallet changes
will require a fresh advisory review; do not reuse these counts after applying them.

## Completed this continuation

1. Release evidence now binds a clean starting/ending Git SHA/tree, immutable
   migration blob IDs, required suite plan, result digest and timestamps.
   Interrupted/dirty/changed/stale/tampered runs fail review preparation.
2. `npm run release:review` creates an exclusive **unapproved** exact-source
   manifest with recovery/capacity/audit/migration/rollback/publication gates false.
   It does not publish or grant approval. CI is read-only, has no deploy step,
   pins action commits, persists no checkout credential, and retains artifacts
   seven days. `vercel.json` disables future Git deployments in this source.
3. Exact source `a477f204786d29f49bb174b3497fdd5fd50f34d1` passed 38/38; its valid
   historical review is under ignored `work/release-reviews/<sha>/manifest.json`.
   **Later wallet changes invalidate it for current source.**
4. Current wallet engine/read/UI/report/owner-control work is locally implemented
   and targeted tests pass. The release plan now has 39 suites. Final checkpoint
   results and tested SHA are in ignored `work/release-checks/provenance.json` and
   `results.json`, with a sanitized copy in the session output folder. Inspect
   these rather than assuming the final run passed.

## Current wallet implementation — LOCAL ONLY

These four CLI-created migrations have **not been applied to hosted development
or production**. They can still be edited; do not apply the partial implementation.

1. `20261030012234_independent_user_wallet_foundation.sql`
2. `20261030013726_independent_user_wallet_engine.sql`
3. `20261030015412_independent_user_wallet_read_models.sql`
4. `20261030132624_independent_user_wallet_operations_reports.sql`

Implemented behavior:

- Separate `user_wallets` / append-only `user_wallet_entries` and private approval
  evidence. Verified owner approves user/team identity and display name. Funding
  starts NULL. No fantasy membership is fabricated and no legacy ticket is
  reattributed. New tickets capture immutable wallet and accepted bettor name.
- Owner initializes at zero or transfers exactly the primary's reviewed legacy
  cash with a CAS amount and paired debit/credit receipt. No co-owner money copy.
  Primary cash/open liabilities prevent an unsafe zero opening; open liabilities
  also block cash transfer until reviewed settlement. Funding requires active
  financial routing. Account revocation preserves money/history and uses revision CAS.
- Private legacy/user implementations preserve original price/eligibility math
  behind existing placement/settlement/refund/replenishment RPCs. Another account's
  duplicate request is denied even on the same fantasy team. Refunds, payouts and
  weekly credits are once per wallet; only its own futures reduce the allowance.
  Legacy tickets continue on the legacy ledger. Legacy balance edits are blocked
  after cutover; funded mode reversal requires a separate reviewed migration.
- Capabilities expose only the viewer's approved participant. Staff-only views get
  no phantom wallet. Profile/header, personal totals, history/cursors and accepted
  bettor labels use wallet identity. Legacy history remains league/admin history,
  not automatically somebody's personal history.
- Reports include user-ledger identity and neutralize internal transfers in cash
  flow. New standings have separate co-owner keys, public betting statistics and
  private cash masking; ranking no longer uses another person's private balance.
- Weekly preview RPC is selected-league/bounded and per-wallet, with correct own
  liabilities and processed flags. Pending cash is shown as pending, not $0.
- Lazy owner controls prepare verified mapped primary accounts, require explicit
  reviewed opening decisions, allow scoped CAS adjustments and revocation. Only
  the owner initializes funds. Operators can adjust initialized approved accounts
  under their existing financial capability; all RPCs independently authorize.
- Confirmation recipients and accepted balances come from the ticket's wallet,
  never the team's primary contact. Generic financial mail snapshots its model,
  gets fresh recipient context, uses own cash/recap/replenishment/Monday tickets,
  and holds incomplete approvals. Existing legacy behavior remains compatible.

Key tests: `test-user-wallet-foundation.mjs`, `test-user-wallets-ux.cjs`,
`test-user-wallet-admin-ux.cjs`, compiled API fixture. Tests use synthetic PGlite
and intercepted localhost browsers only. Fake activation/provider guards are
explicit local fixture setup, not a hosted activation. Local preview uses port
5185; if stopped, build fixture then launch `npm run preview -- --host 127.0.0.1
--port 5185` as a hidden/headless helper. Never use the owner's browser.

## Exact next work — finish milestone 17

1. **Recovery format coverage is the main blocker.** Current
   `scripts/financial-recovery.mjs` supports only original v1 / 23 relations.
   Add a versioned v2 covering user wallets/entries/private approvals/mode and
   necessary staff/owner dependencies, while preserving restore of original v1.
   Test counts/checksums, all FKs, wallet ledger conservation, paired transfers,
   wager/settlement/refund receipts, privacy and duplicate refunds. Never read a
   real private key to run tests; use fresh synthetic keys/data.
2. Complete dedicated boosted/fixed offer tests for two approved co-owners; normal
   placement/refund/settlement/futures paths already have positive tests. Verify
   generic financial mail and worker/preview regression fixtures, including pending
   opening funds, correct own stats and no shared-team recipient fallback.
3. Add the **owner-only development cutover preflight** after runtime/recovery
   readiness. There is currently no public activation API and the private mode
   table starts empty. Block cutover on pending/ambiguous old mail; don't rewrite
   saved payloads/provider retry evidence. Don't enable betting/automation to
   switch financial identity. Preserve legacy unsettled liabilities explicitly.
4. Run the required checks on the exact final clean commit; inspect genuine
   failures and advisor changes. New source invalidates old release provenance.
5. Only then apply all reviewed migrations to DEV with identity preflight,
   rollback-only financial/ACL probes and fresh postflight. Keep operations/mail
   manual/captured; no real bet/provider smoke action. Follow filtered deployment
   procedure from earlier handoffs, verify READY/source SHA and SSO on all aliases.
6. Mark 17 complete only after its scoped final verification. Then continue the
   highest-priority ready queue work. Do not increment a milestone for each commit.

Do not rerun ignored `work/generate-user-wallet-engine.py` over the current SQL:
it was an early source-copy helper and would erase later appended integration.
The committed migrations are authoritative. UTF-8 reads/writes are required on
Windows. Use `rg <directory> --glob ...`, not wildcard filenames in Windows paths.

## Recovery owner steps — already completed versus open

Owner selected private Drive plus separate password-manager recovery material.
Encrypted October 28 financial checkpoint and minimal restore ZIP were uploaded
and downloaded again with matching hashes and owner-only permissions (~1.05 MB).
The ZIP contains encrypted financial data plus public restore source/metadata;
its container itself is not encrypted. It is **not full-platform recovery** and
does not cover later production transactions.

Owner ran the corrected built-in `powershell.exe` helper and replied **imported**.
Public export metadata matched the expected fingerprint/ciphertext and reported
local portable-key decrypt verification. Owner import attestation is recorded
separately; do not ask for import again or overwrite the original export receipt.
Independent-device restore and full-platform/Auth/configuration coverage remain
open. `docs/financial-recovery-custody.md` contains the owner instructions.

**Never open/copy/print real `private.asc`, `portable-private-key.asc`,
`passphrase.dpapi`, passwords or server keys through agent tools.** Private Drive
IDs/hashes and attestation metadata are in ignored `work/recovery-offsite-receipt.json`
and the original recovery directory. Public metadata receipts may be checked.
Keys stay separately in the password manager, never beside backups in Drive/Git.

## Capacity / release limitations

October 29 ET read-only baseline: DEV physical 16,299,699 bytes; production physical
1,289,352,883 bytes. The same three archive tables dominate production. Metadata
inventory is ignored `work/capacity-baseline-2026-10-29.json`; estimates of row
counts are not exact counts. No body scan, cleanup, space reclamation, real-wire
measurement, two-week plateau or second-real-league approval is implied.

Owner Git disconnection removes the automatic repository route, but milestone 21
still needs an actual protected owner-controlled publication path and other
credential/hook routes checked. Passing tests/local manifests cannot impersonate
owner approval. No credential was requested or retrieved for CI. All production
funds/ownership mapping, cleanup and rollout remain exact-review gated.
