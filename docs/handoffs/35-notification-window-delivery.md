# Notification window delivery — milestone 18, stage 1

November 2, 2026 ET. This stage is verified and deployed to protected DEV; evidence
is recorded below. Counter remains
**16 complete / 8 remaining**. Milestone 18 stays in progress.

## Behavior

Opening, reminder and approved reopening promotions now bind a compact authoritative
weekly-window contract when queued. Delivery verifies that contract before rendering
and again immediately before dispatch, including retries with frozen content.
Closed/paused/stale/suspended/unapproved windows, changed policy or deadlines and
expired notifications are retired without contacting the provider. Previously
attempted ambiguous deliveries remain `needs_review`. Unbound legacy promotions
cannot silently adopt a new window. Transactional receipts retain their lifecycle.

The operator/service-only RPC finds the last actual compatible weekly ticket:
a supported single or two compatible selections, with individual event cutoffs.
Opposite outcomes alone and a futures-only board cannot justify urgency. Approved
reopenings retain their existing manual review and recipient gates. Opening keys
also bind content revision; routine reminder keys tolerate ordinary price refreshes.
Reminder wallets must meet the effective placement-period minimum wager.

Reminder copy uses the actual available weekly deadline, with individual locks and
current-price caveats. The championship card describes saved championship prices
without asserting those futures are open. No acceptance-window rule changes.

## Budgets and limits

Nullable `outbound_emails.notification_context` has a 2,048-byte JSON limit. It adds
at most that logical amount per bound promotional row plus PostgreSQL overhead;
ordinary receipts add no context. Existing seven-day terminal body retirement
clears it with the payload. Unresolved/review rows retain evidence. The RPC refuses
more than 4,096 active quotes, uses existing board/market indexes and returns one
small contract rather than market arrays. There is one queue-time window lookup per
league and two delivery-time lookups per promotion. Actual shared quota/wire/load
measurement is still milestone 23; byte bounds do not establish free capacity.

## Verification and rollout

New SQL regression covers authorization/tenant scope, revocation, market exclusions,
compatible ticket deadlines, runtime freshness, live review gates, changed windows,
4,096/4,097 quote admission, context immutability and restricted-role cleanup.
Compiled API regressions cover fresh/frozen delivery, closure while composing,
final dispatch checks, unknown prior attempts, minimum wager and lookup outages.
The complete release plan now contains 43 suites.

Local migration: `20261102031919_notification_window_delivery.sql`. Hosted prior
migrations remain immutable. Rollout is DEV-only, capture-only and manual; no
production migration, real email, funding, GitHub push or schedule activation.
Before any eventual production rollout pause workers, apply the additive migration,
deploy matching code and review obsolete pending promotions; no blind retry of old
promotional bodies. Receipts and accepted bets must remain intact.

## Remaining notification stages

Replace fixed Thursday reminders with configured lead time relative to actual
deadlines and preview rescheduling/expiry. Add per-user/per-league preferences,
routine caps, factual evolving story selection, scoped staff alerts and full
consecutive-week/DST/race tests. This stage does not claim those features or a
completed milestone 18.

## Qualified DEV checkpoint

- Source **`bb3f29fdb50f23650281813cb176ff98890cdbd2`**, clean before/after,
  **43/43** release suites in **275.112 seconds**. Exact-source review prepared
  as **unapproved**. Later documentation-only commits are not that qualified SHA.
- Local migration `20261102031919` -> hosted **`20261102140501`**. It is now
  immutable. Hosted rollback probes verify the real paused RPC and ACL, quote
  cutoff helper, outbox immutability and restricted-role seven-day cleanup.
  The existing live-activation gate rejected a positive-window fixture; it was
  preserved. Positive actionable/compatible-window tests passed locally. No
  fabricated launch approval or disabled trigger was used for hosted testing.
- Persistent before/after state: two leagues, two pending user wallets, zero
  tickets/entries/emails, operations off. Financial digest for this receipt's
  five-table definition: **`5bae6ca0b50de30a40ee058fa53d9173`**, unchanged.
  This definition includes legacy wallets/ledger plus user wallets/entries/tickets;
  do not compare it with earlier differently defined digests.
- Advisor review: **59** authenticated-definer WARN (one added operator/service
  window RPC with tested authorization), **2** anonymous-definer WARN, **1** Auth
  WARN and **15** RLS/no-policy INFO. Existing finding metadata unchanged. The new
  definer is required for authorized access to private policy; no anonymous grant.
- Protected Preview **`dpl_CMVWprDiuoYJzWKSRgUohpv4KWKZ`**, READY, source bb3f29f,
  [DEV](https://dev.sportsbook.coopergurrie.com). Hosted build guard confirmed
  independent owner, closed signup, capture mail and manual automation. Three DEV
  aliases resolve to this build; all aliases plus generated URL redirect signed-out
  requests to Vercel sign-in. SSO remains enabled for all deployments.
- Production canonical deployment remains READY
  **`dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`**. No production change, real mail, funds
  or GitHub push. Temporary localhost fixture server was stopped.
- Ignored evidence: `work/notification-window-completion-receipt.json`,
  `work/notification-window-hosted-probe.sql`, `work/notification-release.log`,
  `work/release-checks/provenance.json` and exact-source review directory.
