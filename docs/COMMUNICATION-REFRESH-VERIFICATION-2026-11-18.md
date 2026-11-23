# Communication, Refresh And Rollover Verification — November 18, 2026

**Delivery update:** After the owner supplied the temporary key through the ignored local configuration and said “ready,” Resend accepted all six messages for cooper.gurrie@gmail.com from Boff <sportsbook@coopergurrie.com>. Provider IDs/timestamps are recorded in the private local manifest. Actual inbox rendering/receipt remains for the owner to verify. This supersedes the sending-blocker notes below; routine Development mail remains capture-only.

Development frontend `dpl_DpG1sdRiWn9fBAm9BXQ6hsYZjSon` is assigned to https://dev.sportsbook.coopergurrie.com. Refresh Edge Function is version 65. Production and routine email delivery settings were not changed.

## Delivered Fixes

- Board refresh reads now time out after 30 seconds and retry with one-, two-, four-, then at most five-minute delays during outages. Success restores the normal minute cadence. Hidden tabs, placement and overlapping requests remain fenced.
- Notification eligibility reuses the existing, version-matched offer cache until its next cutoff. A missing, changed or expired cache falls back to current offer evaluation; recipient/preference rules are unchanged.
- Idle notification passes no longer read/generate VAPID keys when no devices need delivery.
- Push payloads include the relevant ticket or reward destination. The service worker navigates/focuses an existing same-origin window, or opens the destination. External destinations are rejected.
- Added Boff Home Screen manifest, PNG icons and iPhone setup instructions. This is a website installed from Safari, without an App Store download.
- Fixed storage regression setup to keep foundation migrations separate from later visual-profile migrations. This does not omit those migrations from deployment; they are separately verified against their actual schema.

## Automated Verification

- Rollover: Tuesday 5 AM Eastern boundaries, DST, early/late provider week, schedule ordering, repeated/delayed runs, bounded week advancement and incomplete upcoming matchup rejection passed. No scheduled downtime was introduced.
- Refresh: 25 backend policy checks, request/history regressions, overlap/hidden-tab/placement gates, outage backoff and recovery passed.
- Push: ticket payload/link, success receipt, 404/410 cleanup, retryable 503 and restricted endpoints passed using a mocked transport. No push was sent.
- Storage: all five local suites passed, covering receipt deduplication, retention, protected result/financial evidence, wallet isolation/recovery and native compression. No hosted financial records were altered.
- Frontend TypeScript/build passed. Local desktop/mobile history/reward regression passed.
- Hosted Chromium at 1440/390 and WebKit at 390 passed installation assets, unsigned API rejection, existing security headers, controlled API-outage backoff and no horizontal overflow. Application data for the outage scenario was intercepted; these are not physical-device delivery tests.

## Hosted Observations

- Database size: approximately 28 MB. The largest relation was sportsbook_markets at approximately 3.75 MB.
- At the initial observation, the previous 24 hours showed 1,440 successful cron invocations, 24 successful maintenance runs and one successful notification retention run. Cron success only establishes job execution; HTTP responses were inspected separately.
- The retained six-hour HTTP window contained 72 refresh responses and no HTTP/time-out errors; each reported refreshed. The current board was Week 11, had no last_error and had a valid freshness deadline.
- Current off-game cadence is hourly league/pricing refresh, with lightweight source checks every five minutes. Active-game cadence remains one minute.
- A direct unchanged-board RPC response was 1,034 bytes and contained no quote list. This excludes HTTP/Auth headers and separate offer/account data; it is not the full end-to-end response size.
- Query statistics identified publishing as the largest cumulative application write workload. These statistics are cumulative, not a current IOPS budget measurement. Blanket index creation/removal is not justified by informational advisor suggestions on small or inactive tables.
- Maintenance was current and reported no backlog in its latest bounded batch. Dashboard IO budget, sustained traffic/IO trends and capacity sign-off remain deferred.

Final baseline remained 91 tickets, 261 legs, one Auth user and zero registered push devices. No new accounts, bets or credit transactions were created.

## Email Tests And Sending Blocker

Six owner-only messages were generated from the actual Development board, wallet and owned settled tickets: New Weekly Markets, Weekly Recap and Ticket Settled, each Brief and Detailed. The league name retains its exact capitalization. A separate confirmation preview reconstructs the ticket's accepted terms without creating a new ticket.

All seven previews passed at 390 and 640 pixels (14 width checks), secure action-link checks, no horizontal overflow, and the HTML clipping-size check. Shared report tests also passed AMP validation, escaping, isolation, both detail levels and MIME fallbacks. This does not establish real inbox rendering or delivery.

The recipient is cooper.gurrie@gmail.com; the prepared sender is Boff <sportsbook@coopergurrie.com>. No messages have been sent. Development is capture-only, the connector masks the existing Resend credential, and the browser sender-dashboard attempt was stopped by its URL safety check. A secure sending method has been requested. No sending credential was retrieved, copied or added to a deployment.

Ignored local artifacts are in `work/communication-check`: live-context.json, rendered HTML/EML, browser screenshots/results, manifest.json, and the owner-only idempotent send-live.mjs runner. The runner accepts only BOFF_TEST_RESEND_API_KEY from a secure local environment and hardcodes the recipient/sender; its manifest records actual provider acceptance when available. It has not been run with a key. Never paste the key into chat.

The live balance is 130, so a claim-ready email would be misleading. There are no current-week open tickets for Monday Watch. No invitation or sign-in action was fabricated to manufacture email content. Those templates still require an applicable event or clearly labeled fixture-based device test.

## Remaining User/External Checks

- Provide an authorized sending method, then inspect actual delivered messages on the intended devices.
- On iPhone with iOS 16.4 or later: Safari → Share → Add to Home Screen; open Boff from the icon, sign in and use Communications → Set Up Push On This Device. Permission and locked-phone receipt/tap checks require the device owner.
- Observe next Tuesday's natural hosted rollover if an issue arises; simulated tests do not certify a future scheduler run.

Sources: [WebKit Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Supabase informational index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
