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

Migration `20261101203539_versioned_league_intake_drafts.sql` is **local and
unapplied** until exact-source tests and DEV postflight are complete. The five prior
wallet migrations are hosted and immutable. Inspect ignored receipts before assuming
this draft feature has been deployed. Production remains untouched.

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
