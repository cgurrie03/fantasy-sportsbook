# Approved weekly execution

Use America/New_York for every operation, including daylight saving changes. These are website background jobs, not Codex reminders. Scheduling is not activated yet.

| Time, Eastern | Operation | Email |
| --- | --- | --- |
| After Monday games finish | Check final results and settle resolved weekly tickets. Unclear results remain open. | None |
| Tuesday 7 AM | Recheck results; raise an admin approval item for any unresolved non-future ticket. | Admin attention notice only when needed |
| Tuesday 8 AM | Apply eligible weekly replenishments once; advance the fantasy week. | None |
| Tuesday after replenishment | Generate matchups, top 12 player points per matchup, and six high/low scorer favorites. Choose featured matches automatically. | None |
| Wednesday before 8 AM | Refresh projections, injuries, and all categories. | None |
| Wednesday 8 AM | Publish automatically unless paused; if generation fails or the board is invalid, retain the prior data and flag it. | Opening email, only after successful publication |
| Thursday 7 PM | Recheck the board is open and not paused. | Reminder |
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
