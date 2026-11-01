# Owner-reviewed development wallet cutover

Milestone 17 is in progress; the stable counter is still **15 complete / 9 remaining**.
All five wallet migrations, including CLI-created
`20261101201144_owner_reviewed_development_wallet_cutover.sql`, are now hosted in
DEV and immutable. Source `efb98df` passed 39/39 and is the READY protected build.
Owner session verification is pending; opening funds and routing remain inactive.
Inspect the ignored `work/wallet-cutover-hosted-receipt.json` if present for later
hosted evidence, rather than assuming this planned rollout occurred.

## Implemented and locally verified

The Users screen exposes **Review independent wallets** only to the development
owner. The owner can prepare verified mapped primary accounts before activating
routing; their funding remains NULL. Teamless oversight never fabricates an account.
Additional participant admission still belongs to milestone 16's reviewed claims.

An explicit reason prepares an audited review expiring after five minutes. The
review binds its owner, league, account/verified identity state, legacy cash and
open liabilities. Approval requires an acknowledgement and a separate activate
action. Server-side checks reject production, nonowners, stale/expired/wrong-league
reviews, unresolved mail/jobs, active operations and automation. A once-only receipt
binds request/review/reason so an ambiguous-response retry cannot switch twice.

A shared transaction advisory lock fences all eleven public financial entry
points before they read routing or lock cash. Cutover takes the exclusive lock;
mail/job/schedule changes also join the fence. Routing activation moves no money,
starts no jobs and enables no betting. Legacy liabilities retain their ledger;
opening decisions remain separately reviewed. Funded reversal requires a reviewed
migration rather than an application rollback.

Reviews are bounded to 64 per league; participant/membership/team admission is
128 and legacy open-liability review is capped at 1,024. Review/activation receipts
reuse the append-only application administration history, already covered by v2
recovery. No new Auth secret or private-key access is needed.

Synthetic SQL and intercepted 390/1440 viewport tests pass. The SQL suite checks
wrong actor/league, stale identity state, expiry, once-only activation, pending
funds, disabled operations and entry-point fencing. Existing wallet administration
and v1/v2 recovery tests pass. The full current-source result is authoritative only
when `work/release-checks/provenance.json` is valid for that clean SHA.

## Authorized next work

Complete exact-source checks, fresh DEV identity/advisory review and rollback-only
financial/ACL probes, then apply all five reviewed migrations inactive and deploy
only to protected development. Preserve manual/captured/unfunded mode. Do not
activate as the owner through agent impersonation; owner actions use their own
signed-in Users screen. No production or GitHub source publication is authorized.

After hosted verification, continue settings/import/claims (16), notification
lifecycle (18), recovery/release foundations (20/21) and actual capacity/audit gates
(22/23). Historical cleanup (13) and production release (24) require exact owner
approval and their recovery/capacity prerequisites; they cannot be inferred from
passing development tests.
