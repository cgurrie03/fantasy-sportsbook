# Approved weekly execution

Use America/New_York for every operation, including daylight saving changes. These are website background jobs, not Codex reminders. Scheduling is not activated yet.

| Time, Eastern | Operation | Email |
| --- | --- | --- |
| Tuesday 12:30 AM (configurable) | Check final results and settle resolved weekly tickets. Unclear results remain open. | None |
| Tuesday 7 AM | Recheck results; raise an admin approval item for any unresolved non-future ticket. | Admin attention notice only when needed |
| Tuesday 8 AM | Apply eligible weekly replenishments once; advance the fantasy week. | None |
| Tuesday 8:30 AM (configurable) | Generate matchups, top 12 player points per matchup, and six high/low scorer favorites. Choose featured matches automatically. | None |
| Wednesday 7:30 AM (configurable) | Refresh projections, injuries, and all categories. | None |
| Wednesday 8 AM | Publish automatically unless paused; if generation fails or the board is invalid, retain the prior data and flag it. | Opening email, only after successful publication |
| Thursday 7 PM | Recheck the board is open and not paused; recipients must have an available balance above $0. | Reminder |
| Thursday 8 PM | Close static weekly betting. Futures remain independent. | None |
| Following Tuesday 8:15 AM | Compile settled results, leaderboard, and the balance after replenishment. | Recap |
| Every accepted ticket | Preserve accepted odds and picks. | Required confirmation |

## Implementation order

1. Shared generation service for manual recalculation and background use; store model timestamp and inputs. Keep category replacement atomic and retain accepted ticket snapshots.
2. Persistent schedule settings, pause controls, job run history, and per-week execution keys. A retry must not pay a ticket, replenish a balance, publish, or email twice. Keep pending non-future tickets visible before replenishment.
3. Automated settlement and replenishment using the approved rules, with dry-run previews before live activation. Confirm the exceptional $25 future-stake allowance before implementing future balances.
4. Email outbox with branded HTML templates, delivery/retry logs, and per-message idempotency. No imported ticket confirmations are sent again.
5. Scheduled worker with a due-job dispatcher; all decisions use Eastern local times. Select a scheduler that supports the required frequency on the approved free tiers; confirm current provider limits before selecting it. Do not assume Vercel Hobby can run an hourly cron.
6. Admin Weekly Schedule and Emails screens: edit send times, enable/disable notification types, pause publication, view the next run and failures, retry a failed job, and preview email content.

## Acceptance before activation

- Dry-run a full week, including Monday settlement, Tuesday replenishment, Wednesday publication, and Thursday closing.
- Repeat each operation to prove no duplicate wallet changes or emails.
- Check daylight saving and season/week rollover.
- Verify failure does not publish stale or incomplete generated markets.
- Review sample opening, reminder, confirmation, and recap emails before sending to the league.

Only required ticket confirmations currently have an email implementation. The other scheduled operations and email controls require this next stage.

## First execution implementation

Migration `202610050007_weekly_execution.sql` adds admin-readable schedule preferences and execution history, idempotent ticket settlement, and per-week replenishment. It defaults automation to disabled. `Weekly Schedule` now edits publication pause and email preferences and calls a no-write preview endpoint.

The execution endpoint checks the verified admin membership. It waits for Sleeper's season/week state to advance before accepting weekly results, fetches all league scores (including teams outside the six displayed scorer favorites), and resolves against accepted ticket snapshots. Player participation must be explicit in the stats feed; absent evidence remains pending. Confirmed non-participation pushes the leg. Tied high/low winning outcomes push, while non-winners lose. Replenishment defers users with unresolved prior tickets, unsupported futures, or current-week tickets placed before that week's replenishment.

These functions have been tested locally; the migration has not been applied to production. No scheduler is attached, no league-wide email has been sent, and no live ticket or balance has been changed. Next: apply the reviewed migration, deploy, verify the preview against live data, then connect the due-job dispatcher and branded email outbox before activation.

## Email review rules

Scheduled rows show an exact day/time; the newly proposed settlement time is Tuesday 12:30 AM, initial generation Tuesday 8:30 AM, and refresh Wednesday 7:30 AM. These remain configurable and are not activated. Confirmations and sign-in links are event-triggered and immediate, rather than delayed to a weekly clock time.

Opening emails show the actual featured matchups and a few published lines; omit Tank Bowl when no matchup is designated. Reminders go only to members with available cash above zero, evaluated at send time. Confirmations group accepted legs beneath matchup headers, indent selections, and show a leg-count circle. Never substitute regenerated odds for accepted odds.

Recaps lead with league stories, then compact individualized stats. Worst beat is the narrowest losing spread/total margin among wagered lines; biggest upset is the winning underdog moneyline with the longest accepted base odds; most bet line counts distinct tickets containing that exact accepted selection and line; biggest winner ranks weekly net betting profit excluding top-ups and adjustments. Show ties honestly and omit stories without qualifying evidence. Ticket-stake totals on a popular parlay leg are labeled total ticket stakes, not separately allocated stakes. Preview stories are fictional; live statistics aggregation is not yet connected.
