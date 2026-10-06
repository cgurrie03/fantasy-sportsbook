# Approved Product Foundation

Private fake-money sportsbook for 12 friends. Sleeper league ID supplied: 1312126153980391424; verify active season before using data. Season 3 is the league's third year. Season 4 follows after the entire season ends.

## Pilot And Backlog

Wednesday pilot: email-link accounts mapped to owner-approved Sleeper teams, manual weekly markets, boosted lines, 2–10-leg tickets, balances, required confirmation emails, history and leaderboard. Target October 7, 2026, 8 AM Eastern; subject to implementation and service readiness.

Futures, pre-built Weekly Specials, Player H-H, advanced email controls and automated market generation follow. Automatic settlement should be ready before the betting week ends.

## Tickets And Settlement

- Ordinary tickets require 2–10 legs. Same-matchup spread and moneyline cannot coexist, regardless of side; enforce in builder and final acceptance.
- Over, Under and Team Totals can combine with eligible selections from that matchup. Opposite selections in one market remain mutually exclusive.
- Preserve accepted odds, stake, payout terms, market identity and placement/market weeks.
- Futures are standalone, always open unless admin disables, and never mixed with other selections.
- H-H is backlogged: all 9 non-defense/non-kicker slots, best projected eligible lineups, one matchup and H-H selections only. Remaining H-H settlement rules need approval before implementation.
- Exact spread/total results and tied moneylines Push. Recalculate from remaining accepted quotes. All legs Push means ticket Push and refund.
- Nonparticipating players: void leg. Participating players: actual points count even when injured early.
- Uncertain results remain pending, retry and notify admin. Balance-changing corrections after settlement require approval.
- Payout includes returned stake. Replenishment/admin adjustments are not betting profit.

## Balances And Weekly Schedule

Replenishment floor: max(25, 100 - original stakes in unresolved tickets). Both weekly and future pending stakes count; retain higher available balances. Warn before committing balance to futures. Flag unresolved non-future bets before Tuesday replenishment. Admin may set balance with recorded reason and before/after adjustment.

Use America/New_York, including daylight saving.

1. After Monday's final games: settle resolved weekly bets, leave unclear results pending.
2. Tuesday 7 AM: recheck and flag unresolved results.
3. Tuesday 8 AM: replenish eligible balances.
4. Tuesday–Wednesday 8 AM: generate/edit markets and featured choices.
5. Wednesday 8 AM: publish and send opening email.
6. Thursday 7 PM: reminder.
7. Thursday 8 PM: close all static weekly markets.
8. Following Tuesday 8:15 AM: results/leaderboard/balance recap after replenishment.

Wednesday 8 AM publication is automatic unless the admin pauses it. Regeneration recalculates the selected category from current data; accepted tickets retain their original selections and prices. Scheduled execution is the next implementation stage; this schedule is approved but not yet running.

## Featured Markets

GOTW: closest absolute spread where both teams are above .500; closest overall fallback, always one. Admin may override. Tank Bowl: both below .333, lowest combined wins, optional, admin handles ties. Boost potential profit by 25% on GOTW moneylines and Tank Bowl moneylines/Match Over. Do not boost returned stake. Sort matches by combined winning record, then projected points.

## Accounts, Emails And History

Approved admin: cooper.gurrie@gmail.com. All 12 Google Sheet email/team mappings were reviewed and approved October 5, 2026; Roster 8 is Nelson / nellyknowsball only. Week 3 was imported and settled: 19 tickets, 60 legs, 6 won, 13 lost. Opening balances total $1,517.40 after $400 in approved replenishments; net betting profit is -$82.60 and excludes replenishments. Sender: Goldy Fantasy Sportsbook. Required opening, reminder, confirmation and recap/results emails; retain logs. Never re-debit imported stakes or resend old confirmations.

Leaderboard: net betting profit, available balance, then bets placed; retain richer version-1 metrics. Historical season and final results must be verified before import.

## Approved Interface

Dark navy/gold default with light mode. Brand: Goldy Plays Pretend With Men / Fantasy Sportsbook. Home, My Bets, All Bets, Leaderboard. Spread / Total / Moneyline; team, owner, record, projected score. Team Totals expandable button; Player Projections full-row link. Cross out original boost odds with readable selected text.

Floating contrasting Bet Slip from one pick with minimum-two notice. Gold count badge and Bet Slip label; odds and $10 payout example while wager defaults to $0. Bottom-half expansion with outside dismissal. Group/indent selections under bold Team 1 vs. Team 2 headings with GOTW/Tank Bowl designation. Bet then type on two lines; no individual odds/grid dividers. Red remove X, Clear All text. Equal Balance Remaining/wager boxes, top odds, total payout in submit button, bold quick-wager controls and balance-derived maximum. Mobile touch scrolling with hidden scrollbar tracks.

History has expandable outcomes and week/status/sort filters; bold green Won/red Lost, green checks for winning legs, and red Xs for losing legs. Every ticket view (admin, My Bets, All Bets, and future detail views) must use the shared TicketLegDetails component, including actual score/total or win/loss margin from the recorded settlement. Compact desktop leaderboard; mobile secondary metrics in a two-column expansion with aligned row dividers. Title Case for headers, titles and controls; sentence case for explanatory text. Keep lowercase vs. and user-supplied proper names.

Sign-in: Season 3 • Week 5, Fake Football. Fake Betting., Welcome to your Fantasy Sportsbook. Use neutral Welcome before identifying the user. Week label advances Tuesdays at 8 AM Eastern using the central sportsbook period, capped at Week 18 pending season rollover. This does not itself execute settlement or replenishment jobs.

Account and Admin are accessed through the top-right profile menu; Admin is visible only to the league admin. Account shows a small connected check next to Sleeper Connected, with no virtual currency sublabel or temporary development message. Full names use the owner's approved spelling, including Ayush (Yush) Dutta and Michael Schifano (Schif). Balance history shows wagers, winning payouts, weekly replenishments and admin adjustments. Hide opening snapshots and lost settlements that do not change the balance. Use original placement times; identify imported payouts by import date without inventing an original settlement time.

Admin hub categories: Users, Tickets, Betting Logs, Lines & Markets, Promos & Boosts, Approvals, Weekly Schedule, Emails & Delivery Logs, League Settings. Enter a category before its actions. Users and read-only historical ticket/log views are implemented; ticket corrections, markets/promos, approvals queues and scheduling/email controls follow. Roster numbers remain internal identifiers and are not shown in the admin profile.
