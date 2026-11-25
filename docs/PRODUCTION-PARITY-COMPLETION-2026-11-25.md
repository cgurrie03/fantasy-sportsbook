# Production parity completion — November 25, 2026

The owner requested all five release gaps be fixed, plus a timed-credit guide and matchup context in offers.

## Completed

1. **Scheduled cleanup:** Production runs `boff-storage-maintenance` hourly at minute 17, with a 25-item batch, a top-level 15-second statement timeout and existing financial/reference guards. A rolled-back probe exposed expensive pre-limit JSON scans; moving the duplicate reference checks inside the bounded loop removed that cost. The successful live five-item batch retired five unreferenced inactive quotes, five old observation periods and five completed job diagnostics. Tickets, legs and accepted terms are retained. A singleton heartbeat now exists.
2. **Communications:** Production routine capture/push is enabled. A separate authenticated sender uses the existing Production Resend configuration and a private leased delivery ledger. It processes at most four messages per request, every five minutes, with stable provider idempotency keys, bounded attempts, a 23-hour automatic retry window and owner-visible status/attempt/error logs. It rechecks verification, current membership, preferences and invitation validity before delivery. New signup invitations are the explicit verification exception. Existing legacy outbox suppression remains installed: old messages are not replayed. Only captures created after activation enter this sender. Full ticket confirmations, weekly recaps and Monday Watch events are wired into the consolidated event path. Credit reminders retain their 24-hour/collision checks. Production sender is `Boff <sportsbook@coopergurrie.com>`.
3. **Futures:** Saved Production revision 1 matches the existing Development rule choice: Sleeper qualification, rosters ready, regular-season last place for the original dynasty team earning the #1 pick. Sleeper league format is verified by the save RPC. The live board is published with 53 active selections; decided/cut-off outcomes remain closed. Accepted ticket terms were not repriced.
4. **Membership names:** Commissioner membership uses current cached Sleeper team names, falling back to stored names only when source context is missing. Historical ticket labels remain intact. Verified live: Kyle Monangai, KIRKOOOO, 4 year tank and 5 (five) replace stale management labels; Nelson remains an independent co-manager of Diabloo.
5. **Development sync:** Both applications use the current source and safe public-root packaging. Development received the unlimited featured count, contender-targeted Playoff Race, fixed-top Game of the Week, current member names and bounded cleanup changes. Both hosted functions report the same feature-selection behavior. Worker bundles are identical (`c583d3d076cb3d895c501b67006cf422e16afeb34be57febe086601c171e0d7d`); Production version 4, Development version 67. Development remains capture-only for email and retains its Vercel preview sign-in protection.

## Additional requested improvements

- Guide has a dedicated Credit Claims section: 10 every two hours, 50 replacing that claim after 24 hours, Tuesday 5 AM Eastern eligibility, the 100 threshold measured with open non-future stakes, futures exclusion, countdown/progress and examples. Gold claim blocks and a green eligibility panel were verified in the live guide.
- Every offer leg identifies its fantasy matchup, including match totals, moneylines and spreads. Player/position context and projections remain. Verified live in The Scoreboard Sprint: Over 337.5 identifies Diabloo vs. Thank you josh allen; the other two legs identify their own matchups.

## Deployment

Final frontend/API source `47dca81c77ba0247bc90254abd1f4bab07b86488` (followed by SQL/documentation receipts):

- Production: `dpl_AtxTTQ1fMvMV8jzEqMcUiaZZ6gvm` at https://sportsbook.coopergurrie.com
- Development: `dpl_7fxBNbTDSQDFJV3CFtc9Yyqz5HnZ` at https://dev.sportsbook.coopergurrie.com

Production automatic domain assignment remains disabled until the safe packaging is integrated into Git builds. Development is an explicitly assigned preview deployment, with its existing authentication protection.

## Verification and limits

- TypeScript/build passed for both targets; other-environment backend credentials are excluded from each browser bundle.
- Final candidate restore/runtime rehearsal passed 42 role/page/width checks (member, commissioner, owner; 1440px and 390px), plus real restored SQL transaction/access checks over simulated Auth/transport.
- Communication unit tests cover missing/wrong worker authorization, non-sending health checks, stable provider idempotency, empty 204 database receipts, sanitized provider retry failures and receipt logging. Hosted rolled-back tests confirmed exclusive claims, verified-recipient delivery, unverified routine-recipient rejection and denial of the sender RPC to anon/authenticated roles. No test captures or receipts remain in Production.
- Live sending initially exposed an empty-success-response parsing error. The sender receipt parser and regression fixture were corrected; messages leased by that attempt retry with the same idempotency keys.
- Scheduled retention removes old communication bodies in bounded batches after 45 days while retaining event keys, subjects and delivery history. Expired push receipts are bounded separately. Queue admission skips already-logged captures so an older first page cannot starve new events.
- Security advisors added no ERROR-level finding or exposed callable: the new private RLS ledger has no public policies/grants. Existing unrelated advisor warnings remain.
- Production still has 90 tickets and 261 legs. Development has 91 test/history tickets and 261 legs; environments intentionally do not share wallet activity.
- No Production push devices are registered. Push sending is enabled for future opted-in subscriptions, but delivery to a physical iPhone is not verified. Email provider acceptance is not proof of inbox placement or rendering on a user's device.
- The Supabase connector temporarily failed for both projects, then recovered; all remaining hosted operations used the restored connector. No passwords or provider keys were copied into chat or source.

## Final live delivery receipt

At 9:35 AM Eastern, all eight newly generated Production New Weekly Markets messages had `sent` status and a provider receipt; the queue had no failed, pending or sending rows. The final retry returned HTTP 200 with three sent and zero failed. These are real new weekly messages from the activated service, not a replay of historical outbox rows. Inbox placement and physical-device rendering still require recipient verification. The final sender deployment had no captured error/fatal runtime logs in the checked window.

The live Guide, The Scoreboard Sprint detail popup and Commissioner Members were visually/semantically checked after deployment. Development retains Vercel authentication; unauthenticated HTTP probes reach its login gate, so they are not described as an authenticated Development smoke test. Its frontend build, backend environment exclusion, alias, worker bundle and database feature predicates were verified separately.
