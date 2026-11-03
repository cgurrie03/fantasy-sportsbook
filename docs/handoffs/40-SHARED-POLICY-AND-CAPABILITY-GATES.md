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

Pending clean-source full qualification and protected Development rollout. Focused SQL/API/phone/desktop tests have passed; the final receipt will identify the qualified source and hosted migration versions. Production approval, owner backup and real capacity evidence remain outstanding.
