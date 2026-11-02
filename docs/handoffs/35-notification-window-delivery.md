# Notification window delivery — milestone 18, stage 1

November 2, 2026 ET. This stage is implemented locally; qualification and protected
DEV rollout receipts are recorded below after verification. Counter remains
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
