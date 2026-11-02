# Versioned provider intake and resumable draft import

Milestone 16 is in progress. Wallet milestone 17 is verified in development;
**16 complete / 8 remaining**. The owner confirmed both wallet cutovers, and server
postflight showed one pending account per league, zero user-ledger entries and
operations/automation disabled. Do not repeat those owner steps.

## New local delivery

The owner-only League Settings intake prepares a versioned `sleeper-nfl-intake-v1`
contract from fixed-host league/roster/user endpoints. IDs remain strings, numeric
rules and lineup positions are bounded, duplicate/cross-league rosters are rejected,
and raw player/metadata bodies are discarded. Public fantasy owner/co-owner facts
never establish an Auth identity, sportsbook membership, staff grant or wallet.
The endpoint verifies fresh owner authorization before provider reads and reuses
a saved request before fetching again. Provider bodies and incoming requests have
explicit byte/time budgets; no caller-controlled URL can be fetched.

The capability report flags odd/unsupported scorer fields, unfamiliar/IDP positions,
large starting lineups, divisions, median/average wins, reseeding, playoff-round/
field/start settings, projection/scoring coverage and draft-order questions.
**Input-compatible means shape only**, never completed runtime support. Settings
are preserved for review; no universal Sleeper compatibility is asserted.

An owner can resume the draft, inspect its report and explicitly import an inactive
league with CAS revision and once-only terms. Real fantasy teams, public co-owners
and unclaimed rosters are preserved. Nullable provider owner IDs are stored honestly.
The import creates no Auth users, memberships, staff or user wallets; legacy team
wallet rows have NULL funding. Jobs, betting and editorial mail remain disabled.
The durable provider/rules report is copied to the league and remains viewable after
the temporary import payload is retired. A quarantine guard blocks operation
activation until the remaining supported-policy/capability workflow is delivered.

Migration `20261101203539_versioned_league_intake_drafts.sql` is **applied to DEV
and immutable**, recorded as hosted version `20261101211434`. Source `6c070a8`
passed 40/40 and is deployed READY as `dpl_8qSiLyunfdXCXMTQN7rihYyDXr4A`. The five prior
wallet migrations are hosted and immutable. Ignored receipts document the completed hosted checks. Production remains untouched.

## Capacity and retention

- At most four live drafts per owner and 64 draft/receipt rows across the platform.
- Each normalized source is at most 64 KiB, capability report 16 KiB; four live
  payloads are at most 320 KiB logically per owner. These are admission ceilings,
  not physical PostgreSQL storage measurements.
- Pending payloads expire after seven days through the existing bounded maintenance
  boundary (default 10/max 25), and admission also retires the owner's expired data.
  Imported payloads are cleared immediately. Request hashes and compact import
  identities/receipts remain. No permanent provider body archive is created.
- A league's durable provider contract is capped at 32 KiB. Team/NULL legacy-wallet
  rows grow with roster count. The existing core profile projection excludes this
  contract; owner preview/read queries are separate and bounded.
- One fresh preview makes three fixed-host reads; a request retry uses its stored
  draft. This is not measured shared-wire capacity or a two-week plateau.

## Validation and remaining milestone scope

Synthetic SQL verifies private drafts, verified-owner admission, exact retry terms,
stale CAS, once-only import, NULL/unclaimed identity handling, inactive schedules,
no fabricated participant, operation quarantine and restricted-role expiry.
Provider/API fixtures verify shape/rule contrasts, byte limits, rejected owner/URL
requests and no extra provider reads on a retry. Intercepted phone/desktop fixtures
cover owner visibility, preview, resume, acknowledgement, import and retained report.
The release plan now includes 40 suites; exact current results belong to the clean
SHA in `work/release-checks/provenance.json`, never a previous 39-suite receipt.

Still required for 16: typed shared sportsbook defaults/overrides, effective versions
consumed consistently by generation/acceptance/settlement/help; supported capability
approval/drift/renewal behavior; scoped invitations and verified primary/co-owner
claims with pending/rejected/revoked/expired states. An imported draft is deliberately
unable to operate before those steps. Do not mark the entire milestone complete.

Provider reference: [Sleeper's public API](https://docs.sleeper.com/), which documents
league, roster and public user lookup, not ownership verification or a projection SLA.

## Hosted completion and source preservation

- Protected DEV aliases now serve source `6c070a8f0b51faaea6376b69f7d85d854f85e9c9`.
  Hosted build verified independent DEV identity, closed signup, capture mail and
  manual automation. All four URLs returned signed-out 302 to Vercel SSO.
- Rollback-only import/ACL/quarantine probes passed. After rollback there are two
  existing leagues, zero intake rows and two pending user-wallet accounts. The
  before/after financial digest including user wallets is unchanged:
  `d8a3384cb5e33bf26a54c58df09c9e20`. No actual provider league was fetched/imported.
- Fresh advisor baseline: 49 authenticated-definer / 2 anon-definer / 1 Auth-password
  WARN, 12 RLS-without-policy INFO. The three new authenticated wrappers check
  verified independent ownership; no new anonymous definer endpoint was added.
- DEV metadata size after migration: 16,938,675 database bytes, 3,088,384 application
  relation bytes. Empty intake tables are not representative loaded capacity.
- Encrypted source checkpoint (403 tracked files) was stored in the owner's existing
  private Drive recovery folder using only the existing public recovery key. Cipher
  size 1,145,430 bytes; downloaded SHA-256 matched
  `a7bf8b39cbf02a3a728f3d9e760a9c5c9a4f0094f99708e08ac668e0664203a0`.
  Cipher and manifest permissions are owner-only. No private key was opened, copied
  or uploaded. The October 28 financial files remain unchanged. This extends source
  preservation only; full platform/Auth/config recovery and independent-device
  restore remain milestone 20.
- Detailed private receipts: `work/league-intake-hosted-receipt.json` and
  `work/source-checkpoint-offsite-6c070a8.json`.

A documentation-only closeout commit follows the tested/deployed source above.
The 40-suite receipt qualifies that source, not a later HEAD automatically. A next
code/migration deployment needs fresh exact-source evidence. Avoid redundant full
suites for a documentation-only status update that is not being deployed.
