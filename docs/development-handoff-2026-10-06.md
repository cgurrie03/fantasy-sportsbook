# Development checkpoint — October 6, 2026

## Where October 5 ended
Accounts, approved Sleeper/email mappings, imported Week 3 settlement, balance history, ticket views, and leaderboard were implemented. Market generation supports matchups, optimized legal lineups, player points and top-six highest/lowest scorer candidates. Generation errors, admin authentication and deployed API imports were corrected. Weekly execution, settlement and replenishment foundations have local tests. Configurable schedule and branded email previews were reviewed. Last commit before this work: a9c94ae; its production push was not verified.

Scheduled automation is not active. Migrations 007/008 were still pending at that checkpoint. Email previews use illustrative data; the new templates and league-story calculations are not connected to production delivery. Existing accepted-ticket confirmation implementation is separate.

## October 6 requested deployment
- Signed-in users land on Home / Matchups.
- Mobile profile balance is visible; season/week and opening/closing dates wrap onto separate lines. Desktop structure stays unchanged.
- Incomplete best projected lineups lock both matchup moneylines and match totals plus the affected team's totals. Metadata persists until regeneration. The database rejects locked quotes; existing boards require regeneration to acquire the flags. Accepted historical tickets remain unchanged.
- Admins can void OPEN tickets with a reason and confirmation. Original stakes are refunded once; history, logs and balance ledger preserve the cancellation. VOIDED tickets do not affect leaderboard wagering statistics. Settled reversals remain an unresolved optional request.
- Migration 009 was successfully applied in production via Supabase SQL Editor. It does not activate weekly jobs or alter any existing wallet balance.

## Launch priorities
| Priority | Work | Readiness requirement |
| --- | --- | --- |
| Critical before league betting | Verify production deployment; regenerate/review all current markets, correct season/week and times, lineup locks, valid boosts, publish board | Real board must be ready and accept only available selections |
| Critical before league betting | End-to-end account, wager debit, accepted odds, ticket history, required confirmation delivery, cancellation/refund | One approved test flow; no duplicate wagers or refunds |
| Critical before league betting | Explicitly track projection/injury data freshness and coverage | Do not present stale or missing data as reliable lines |
| Critical before results are due | Connect live settlement, DNP pushes, unresolved review, replenish only eligible users, refresh leaderboard | Ready before first Monday/Tuesday wrap-up; not necessarily before Wednesday opening |
| Important for agreed low-maintenance launch | Apply weekly settings migrations, connect a free-tier-compatible scheduler, automatic generation/refresh/publish/close, pause controls, execution logs | Required to meet the agreed automated Wednesday opening; manual opening is only an explicit fallback |
| Important | Connect approved opening/reminder/attention/recap email templates, real recipients, delivery and retry logs | Review real personalized previews and approve test recipient before sends |
| Important | Aggregate league recap storylines from actual accepted bets and final scores | No fictional sample storylines in live messages |
| Important | Admin approvals for unresolved tickets, schedule status, failed-job retry and missing projection coverage | Clear actionable exceptions |
| Nice to have | Season Futures, Player H-H, prebuilt parlays, more promo tools, notification preferences | Keep backlogged until weekly cycle is reliable |
| Nice to have | Broader React performance pass, multi-league rollout and further polish | Complete after operational launch tasks |

## Recommended skills — waiting for installation
1. Vercel React Best Practices: https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices — performance and maintenance; defer the broad optimization pass until added.
2. Resend React Email: https://github.com/resend/react-email/tree/canary/skills/react-email — email layout/client compatibility and integration; defer that integration stage until added. Installing it does not require replacing working templates immediately.
Existing frontend-design, web-design-guidelines and Supabase Postgres skills remain useful. Do not add a large set of overlapping manager/auditor skills.

## Next session order
Confirm deployment and visual mobile review first. Install recommended skills. Then connect weekly settings/worker, email delivery with real data, recap aggregation, and one full no-write rehearsal before activation. Wednesday opening is October 7, 8 AM Eastern, but verify actual Sleeper season/week rather than relying on the old Week 5 label.
