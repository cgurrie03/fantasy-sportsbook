# Email review and confirmation latency — November 26, 2026

Production timing separated two waits. Recent confirmations spent 128–255 seconds waiting for the scoring worker to prepare their HTML, then approximately 299 seconds waiting for the five-minute sender. Resend accepted these messages on the first attempt. These observations concern provider acceptance, not inbox placement.

## Delivery repair

- An accepted ticket queues a private authenticated HTTP request through pg_net. Networking begins after transaction commit, so its legs are available and rolled-back wagers never send confirmations.
- The sender prepares that ticket with the same renderer used by owner previews, then uses the existing private leased delivery ledger and stable provider idempotency key.
- A separate one-minute fallback prepares up to four missing confirmations and processes a bounded delivery batch. Confirmation preparation no longer depends on Sleeper, pricing, or score refresh cadence.
- Verified email, current league access, release activation and accepted wallet ownership are checked server-side. Anonymous and authenticated browser roles cannot call the new context RPC. Development remains capture-only.
- Dispatch/preparation failures do not undo accepted wagers. Existing retry limits, provider backoff and retention remain. No historical email replay is introduced.

## Template review and changes

All ten active templates were reviewed in the owner preview at desktop and phone widths. Automated checks cover exact league capitalization, shared Public Sans typography, identity, absolute links, HTML size, and the full-format templates.

- White inline backgrounds are the default. Supporting email clients receive forest dark-mode overrides through `prefers-color-scheme`; clients that strip those rules retain the white design. Automatic recoloring by individual inboxes still needs real-device review.
- Main matchup price cells now say “25% Boost”, without changing the accepted odds or boost percentage. Offer/reward explanations keep their full labels.
- Bet Confirmation shows accepted selections, matchup identities, stake, odds and potential return, without misleading final scores or unavailable-progress messages. One direct ticket button sits in the ticket card beneath its totals; the week is included.
- Open/settled result icons, existing featured colors, league/team images, claim highlighting, and preference links are preserved.

## Verification scope

The hosted rolled-back acceptance probe queued its confirmation and then removed both ticket and HTTP request on rollback. A second rolled-back probe prepared the correct five-leg existing ticket; no email was sent by either probe. New RPC grants deny anon/authenticated callers; the security advisor reported no ERROR-level findings.

Pure tests cover valid/mismatched preparation contexts, authorization and malformed dispatch requests, provider idempotency, sanitized failures, no-send health checks, all ten templates, full-format league switcher fallbacks and AMP validity. Physical inbox rendering and actual new-bet-to-inbox timing remain external acceptance checks.

The added work is one small asynchronous request per committed wager plus a light bounded one-minute fallback. There is no new scoring polling, external sports API call or persistent progress snapshot. The existing message-body retention and queue ledger are reused.
