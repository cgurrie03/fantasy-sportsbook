# Independent wallets — local implementation in progress

Milestone 17 / F004 is **not complete**. Counter remains **15 complete / 9
remaining**. The user asked to continue all ready steps autonomously. Continue
this implementation; do not ask again whether co-owners have separate wallets.
The owner's decision is separate wallets per user per league.

## Current local implementation

Three CLI-created migrations are local only, **not applied to hosted dev or
production**:

- `20261030012234_independent_user_wallet_foundation.sql`
- `20261030013726_independent_user_wallet_engine.sql`
- `20261030015412_independent_user_wallet_read_models.sql`

They add user/league accounts, owner-reviewed display names, immutable account
identity, append-only scoped ledger/approval evidence and optional new-ticket
wallet/display-name snapshots. Existing tickets remain unassigned legacy tickets;
no historical ownership or new membership is fabricated. Funding defaults to NULL.
Verified owner approval can initialize at zero or explicitly transfer current
legacy cash for its existing primary participant, with expected-balance CAS and
an exactly-once paired legacy debit/new credit. Open legacy liabilities reject
that initial cash transfer pending a separately reviewed migration. A co-owner
cannot claim the primary's cash. Account revisions fence revocation/restoration.

The engine has separate private legacy and user implementations behind the
existing public placement/settlement/refund/replenishment RPC names. Original
price/eligibility/settlement calculations were copied unchanged except the
account lookup, ledger destination and immutable new-ticket ownership fields.
Duplicate requests also check wallet identity, so a co-owner sharing the same
fantasy team cannot replay another person's ticket. Legacy tickets still settle
to the legacy ledger. Weekly user credits consider only that account's new
liabilities, plus existing legacy liabilities of its actual primary participant.
New credits stop replenishing the dormant legacy team wallet.

The private `user_finance_modes` table is empty by default and has no public
activation API. Local tests explicitly seed an intercepted mode fixture; they
temporarily bypass only the local synthetic league activation guard to isolate
financial behavior. No real provider, email, bet or hosted activation is involved.
**Do not apply or activate this partial implementation before the remaining
integration/recovery checks below.** These local, unapplied migrations can still
be edited; hosted migrations from earlier handoffs remain immutable.

New financial confirmation SQL guards and the service-only recipient RPC use
the accepted ticket's wallet owner and freshly verified Auth email. There is no
fallback to a shared team's primary recipient. TypeScript scope validation and
content building use the same identity and the accepted wager's recorded cash
balance; the compiled fixture rejects primary-address substitution and never
reads legacy team finances for a user-wallet confirmation.

Read models now expose a viewer's actual approved financial participant in
capabilities, wallet-scoped balance pagination, own totals, and wallet-filtered
personal ticket pages. Legacy tickets remain in league/admin history. This does
not automatically reattribute old bets to a new account. Staff without an
approved financial account still receives no participant or betting capability.

## Verified so far

`test-user-wallet-foundation.mjs` now covers independent co-owners/cross-league
accounts, pending/zero funding, paired legacy cash transfer once, stale amounts,
open-liability refusal, own financial RLS, immutable identity/ledger, independent
wagers, another account's duplicate-request denial, confirmation ownership,
refund and settlement once, own futures allowance/floor, per-account weekly
idempotency, revocation/CAS and scoped personal history/totals/balance cursors.

The compiled API fixture also passes with a new financial-confirmation case.
`test:user-wallets` is in the release plan, now 39 suites. The last full release
run was **38/38 for a477f20**, before wallet implementation; do not reuse its valid
provenance or unapproved manifest for current changed source.

## Still required before milestone completion

1. Wire viewer/profile loading, wallet header, personal account/history scopes,
   accepted bettor labels, owner per-user funding controls and staff-only views.
   Keep identities/league/request fences; don't append fake staff memberships.
2. Update admin wallet reports, internal-transfer cash-flow classification,
   exports, per-user leaderboard and weekly preview/worker wallet reads. Old
   team-level report queries must not masquerade as a co-owner's personal stats.
3. Verify boosted/fixed offers for approved co-owners and correct claim/recipient
   behavior. Complete current primary-user balance handling in generic email
   content as well; notification/preferences redesign itself remains milestone 18.
4. Extend financial recovery with a versioned format that covers new financial
   tables/audit dependencies while preserving restore of the original off-site
   v1 checkpoint. Test new ledger/FKs/privacy/refunds and old-format compatibility.
5. Add a strictly owner-controlled dev activation preflight only after all runtime
   paths are ready. Keep legacy unsettled liabilities and pending funding visible
   and fail closed. Any production adoption/funds mapping remains separately
   reviewed; no bulk ownership inference.
6. Complete matching local phone/desktop fixtures, required full checks, hosted
   dev identity/advisory/rollback tests and filtered protected dev deployment.

Local-only inspection artifacts under ignored `work/` contain source definitions
and fixture helpers, not financial exports. Do not rerun the early source generator
over the engine migration: it would overwrite later appended code. The committed
SQL is authoritative. No private recovery key was opened during this work.

## Read-only capacity baseline — October 29 ET

At 01:13 UTC October 30 (October 29 ET), development physical database size was
**16,299,699 bytes**, application relations **2,785,280 bytes**. Production physical
size was **1,289,352,883 bytes**, application relations **1,266,548,736 bytes**.
The three archive tables were 547,119,104 / 339,722,240 / 323,166,208 bytes including
TOAST/indexes. Estimated row counts are planner estimates (including unknown -1),
not exact counts. Measurements use PostgreSQL metadata, with no raw body reads.
Ignored `work/capacity-baseline-2026-10-29.json` holds the bounded top-20 inventory.
Dev's empty/unfunded fixtures are not representative two-league load. No physical
reclamation, real wire measurement or two-week plateau is claimed; F009 stays open.

## Viewer integration checkpoint

The profile loader now consumes only the authenticated viewer's approved financial
participant from capabilities and replaces legacy team balances for finance-mode
leagues with that viewer's wallet. Stored legacy membership records remain intact;
a staff-only viewer never receives an invented participant. The main member/key
uses the approved financial participant, balance pagination carries the wallet ID
in both its RPC and request key, and personal statistics use own-wallet totals.
Accepted bettor snapshots label cards/share/CSV rows rather than another
co-owner's current team mapping. All-bet filtering is labeled Team for user mode.

Targeted fixture build and phone/desktop co-owner tests pass, including no legacy
membership, own $93 history rather than the primary's $100, and a staff-only second
league without a balance or personal tools. Every browser request is intercepted.
The package's wallet test includes these browser fixtures. Remaining owner controls,
admin reports/exports/leaderboard, worker reads, generic primary balance mail,
new-format recovery and hosted activation remain required. Do not apply yet.
