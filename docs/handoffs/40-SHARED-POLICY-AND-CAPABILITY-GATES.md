# Shared policy, provider decisions and release preparation

Development batch, November 2, 2026 ET. Qualification and hosted receipt follow below. Production remains unchanged; this document grants no release or cleanup permission.

## Shared settings and consumers

The versioned `sportsbook-policy-v1` contract provides bounded featured profit boost, matchup/special/futures rounding, futures cap and four market-family flags. Defaults preserve current approved behavior. Only the verified owner can append a reasoned, effective-period version while operations and automation are paused. CAS, ordered periods, maximum 64 revisions, published-board/accepted-ticket checks and immutable accepted policy snapshots prevent silent changes to existing terms. The editor shows current/proposed values and effective period. Wallet/pricing forms support bounded policy-only JSON transfer and shared-default reset; these change proposed values and require a separate reasoned effective save. Tenant IDs, accounts, approvals, secrets and dates cannot be transferred.

Generation, worker family admission, quote publication, acceptance, owner futures editing, displayed boost, and quick-start examples consume the contract. Fixed spread/total/player prices remain their reviewed fixed prices. Futures use the current placement period rather than the season board's week-one label. A disabled family stages an empty refresh contribution; a wholly disabled board is suspended. Quotes with obsolete policy revisions require regeneration. Existing wallet/ticket policy, featured-selection algorithm, schedule and notification controls retain their supported contracts; arbitrary algorithms/unsupported rules are not configurable.

Owner communication identity changes use a CAS hash, reason, paused operations and exact environment HTTPS origin. Sender verification remains an explicit owner/provider responsibility; saving sends no message. Branding changes invalidate imported capability approval.

## Imported provider capability workflow

Explicit preparation fetches fresh fixed-host Sleeper data with current owner authorization and baseline rechecks. A service-only observer stores one bounded current source/roster observation per league, server fetch-start time and build identity. Older responses cannot replace newer observations. The SHA-256 fingerprint binds relevant scoring, positions, roster identities/co-owners, season, rule settings, current wallet/pricing policy, schedule, branding and build. Names and weekly counters do not create false drift.

An owner must explicitly attest projection/results coverage and supported house rules for the exact hash/configuration/build within 15 minutes. Decisions contain hashes/reasons, at most 64 per league. Changed observations clear approval permanently until another explicit decision; returning to old facts does not silently restore it. Publication, new acceptance and activation require current reviewed facts, with a 24-hour observation ceiling. This is not continuous provider surveillance or automatic proof of scoring compatibility. Generation refreshes observations; a provider outage fails closed once evidence is stale.

Declared imported profile: even 8–16 NFL teams, known non-IDP lineup slots, at most 16 starters, in-season weekly families; divisions, median wins, multiweek rounds and unknown slots are rejected. Imported futures require separate compatibility work and must be explicitly disabled before approval. Existing synthetic fixtures remain on their legacy capability path. Real league activation/capacity approval remains separate.

Next-season renewal accepts a numeric provider ID only after the fixed-host provider response links its previous_league_id to the current league ([Sleeper API](https://docs.sleeper.com/)). It requires paused operations, no open tickets, unchanged roster IDs, current observation/hash and the immediately following NFL season. It closes old boards, increments the league season, resets week one and clears approval. It preserves accounts, approved claims, balances and financial entries. A fresh observation/decision is required afterward. No real imported league was activated or funded in this batch.

## Recovery and operational preparation

Financial recovery v4 adds pricing policies and provider decisions/current observation, while old v1–v3 readers remain unchanged. It is still application financial/configuration scope, not full managed-platform recovery.

The owner-run streaming encryption helper accepts an existing export and the existing PUBLIC recovery key. It refuses overwrites/private-key inputs, preserves the export, and emits ciphertext/plaintext SHA-256 and byte counts. Tests generate disposable synthetic keys; no owner private key or real export is accessed. Its manifest explicitly does not attest backup completeness or restore success.

Read-only production catalog evidence identifies 547,119,104 bytes of model runs, 339,722,240 bytes of snapshots and 323,215,360 bytes of refresh stages: 1,210,056,704 bytes combined. The current production routines still reference these archives. A non-executable cleanup plan therefore preserves summaries, unresolved/leased work, accepted terms and explicit recovery/owner gates. No historical rows were changed. Current production Storage inventory is zero buckets/objects; that is a point-in-time fact.

Capacity validation now rejects synthetic, mixed-source, missing-wire, stale, future-dated, discontinuous or over-reserve evidence. It requires 15 actual daily observations spanning 14 elapsed days, reviewed allowances/reserve, combined DEV/production physical/wire measurements and a bounded 30-day growth projection. No two-week plateau exists yet.

A local review-only GitHub workflow binds successful same-repository Project Checks, exact source/tree/migrations, an explicit sole-owner Production approval and no administrator bypass. It contains no deployment credential or migration/promotion step. Live Production environment metadata currently lacks required reviewers and permits bypass; the helper rejects that configuration. Nothing has been pushed to GitHub.

## Storage impact

Pricing history is at most 64 rows per league with overrides capped at 2 KiB each, plus small reasons/indexes. Provider state retains one source up to 32 KiB and roster list up to 16 KiB per league; decisions are capped at 64 compact hash rows. Accepted ticket policy snapshots add bounded immutable terms, up to 2 KiB per ticket. These are logical admission ceilings, not measured physical allocation forecasts. Communication identity adds no table. Markdown/CI evidence creates no application database rows; CI artifacts expire after seven days. Encrypted full exports consume roughly export size plus encryption overhead in private Drive; actual size must be measured and retention chosen after export.

## Verification receipt

Qualified clean source **e5ee1e2b495f13fa6f511810dcbed3d4ba6bc985** passed **43/43** suites in **316.690 seconds** (04:40:42–04:45:58 UTC November 3, still November 2 ET). Earlier interrupted runs are not qualification evidence. The new fixtures also cover explicit service-only observation/revoked owner, changed provider predecessor/next-season ID, policy transfer/default reset, communication identity, current-period futures prices and empty disabled-family refresh completion.

Hosted migration mapping (local → DEV):

| Local | Hosted |
|---|---|
| 20261103033708 shared_sportsbook_policy | 20261103044616 |
| 20261103035635 reviewed_provider_capabilities | 20261103044620 |
| 20261103041439 reviewed_communication_identity | 20261103044623 |

All three applied sequentially. Hosted rollback probes passed owner/CAS/effective-period/duplicate and tenant checks, current policy, unsupported-origin denial, private-table/service-only ACLs and outsider rejection. The five-table financial digest remained **a934b2e187fa6f5ae0e8cd77b0507451**. Persistent DEV: two user wallets, zero total balance, no tickets/entries/outbound messages/pricing overrides/provider observations/decisions; operations and automation remain off. No actual provider approval was invented.

Security advisors: 74 authenticated-definer warnings (eight new reviewed owner/member entry points), two unchanged anonymous-definer warnings, one unchanged Auth password-protection warning and 23 no-policy INFO (three new intentionally private RLS tables with direct grants revoked). These are reviewed deltas, not a clean-security-audit claim. References: [definer-function review](https://supabase.com/docs/guides/database/database-linter?lint=0028_authenticated_security_definer_function_executable), [private no-policy RLS tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Physical DEV size after schema/probes: **18,044,595 bytes** vs 17,708,723 before, a 335,872-byte allocated increase in this small fixture database. This does not forecast a full season.

READY protected Preview **dpl_DbHMid37bWgGwLMbfgVKexFgLQy2**, generated hostname `fantasy-sportsbook-a5zecrjti-cooper-gurrie-projects.vercel.app`, serves all three DEV aliases. Hosted environment/API checks passed and build logs contain zero TypeScript/error diagnostics. All four signed-out URLs returned 302 to Vercel SSO; all-deployment protection remains enabled. Production canonical remains **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ**, unchanged. No GitHub push occurred. The local fixture server was stopped.

Milestone **16 is complete in its declared Development scope**: staff/owner administration, effective supported settings, inactive importer, verified claims, independent wallets, explicit provider capability review/drift gates and supported renewal. Imported futures and arbitrary unsupported rule adapters remain visibly blocked; final operational/product acceptance is milestone 22. Counter: **18 complete / 6 remaining: 13, 20, 21, 22, 23, 24**. Recovery coverage, external release controls, final audit and measured capacity/production gates are not closed by these tests.

Ignored evidence: `work/remaining-batch-completion-receipt.json`, clean-source provenance/results copies, release logs, hosted rollback probe, read-only storage inventory, non-executable cleanup plan, incomplete capacity starter and unapproved exact-source review manifest. Subsequent documentation-only commits do not replace the qualified/deployed application source.
