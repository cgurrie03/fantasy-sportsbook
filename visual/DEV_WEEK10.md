# Week 10 Dev Betting And History Import

Verified November 10, 2026. [Open the Week 10 Weekly Slate](https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups) and sign in with the existing dev account. The dev wallet was set to **10,000 credits**.

The live board has **156 selections** across the six current Sleeper matchups: moneylines, spreads, totals, team totals and preset alternates. Singles and compatible parlays use the database transaction, with server-checked prices, a single debit per request, compact evidence, and persistent My Bets / All Bets. Supabase Auth verifies league membership in addition to Vercel access protection.

The source worker uses current Sleeper rosters, scores, league scoring and projections. It keeps a bounded latest book and uses five-minute active-game, fifteen-minute postgame or hourly idle pricing where source coverage permits. A shared lease avoids duplicate refreshes. If the game clock is unavailable from Supabase, authenticated Vercel requests can try the alternate refresh path; stale quotes cannot be accepted. Actual in-game provider coverage has not yet been exercised for Week 10.

New dev weekly tickets are eligible for settlement after Tuesday at 7:00 AM Eastern, when the provider has advanced and all relevant NFL games are confirmed final. The worker applies the existing outcome and wallet logic. Imported legacy tickets and unresolved futures retain their original result state.

## History
The one-time production snapshot was taken 2026-11-10T22:02:58.973935+00:00. Dev imported 89 tickets, 257 legs, 179 legacy credit movements, 12 approved mappings, 12 legacy wallet balances, 8 result weeks and 197 referenced/retained quotes. Historical boards were archived and the active Week 10 dev board was preserved. The existing owner login was matched to the source membership; credentials and sessions were not copied. The independent dev balance was unchanged by import. Existing unmapped participants do not acquire a new dev login or wallet automatically.

Receipts, accepted terms and ledger entries reconciled exactly. 197 historical legs now reference shared immutable evidence. The receipt row-value benchmark for the actual import is approximately 698,469 → 452,427 bytes including shared evidence, about 35% less, excluding indexes and table allocation. Dev database allocation after import and the new board was approximately 22.53 MB. Raw forecast archives, obsolete unreferenced lines, delivery logs, and credentials were not copied. Temporary import staging is empty.

## Validation
- Local native single, duplicate, stale-revision and expired-price checks.
- Local full history rehearsal and exact evidence/ledger reconciliation.
- Hosted rollback probes for single, parlay, debit, compact receipt, payout and duplicate settlement. No probe ticket was retained.
- Browser flow with a mocked HTTP session: sign-in gate, Week 10, placement, balance and reload/My Bets.
- Deployed route and source API return 200; the book endpoint returns 401 without a signed-in user.
- Deployment dpl_HacdaPQDNML4339x7WxrZb2dhsoV is attached to the dev domain. Production deployment dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ was unchanged.

Player props, standalone weekly specials, new futures and automated offers are not enabled for live placement yet. Historical receipts for those markets remain visible. Production history is a snapshot; it is not automatically synchronized from production.

