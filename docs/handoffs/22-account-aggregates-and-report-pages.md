# Account aggregates and financial report pages — October 29, 2026

This completes the remaining development implementation for milestone 14 after
handoff 21. The stable counter changes only after the deployment/postflight
record below is appended. Production historical cleanup remains milestone 13
and still requires its recovery and exact owner approval gates.

## Read contract

| Consumer | Read scope / admission |
|---|---|
| Bootstrap / refresh | Approved identity claiming only on login or explicit pending-mapping retry; explicit directory columns; at most 128 leagues and 512 rows in each team/membership/wallet family, 512 KiB combined logical JSON |
| Home / member balance notes | One selected-league aggregate; complete settled/open/future stake totals, no ticket history |
| Leaderboard | Existing database leaderboard only while its tab is visible; complete aggregate open/settled stakes replace client history sums |
| My Bets / All Bets / staff ticket views | Twenty scoped tickets with database search/filter/sort; receipt children only for returned ticket IDs |
| Staff betting logs | Twenty tickets without receipt legs/promotion bodies |
| Account / staff user detail | Thirty canonical balance changes, preserving imported wager fallback and running-balance anchors |
| Placement receipt | Exact accepted ticket ID and personal team scope, rather than reloading all account history |
| Approval inbox | Complete database count of open weekly tickets |
| Report 8 | Complete selected-league/season/market-week aggregates, filtered by member for display |
| Report 9 | Forty recorded wallet ledger/adjustment entries, with full-scope cash totals; account-wide across all seasons |
| Report 10 | Forty aggregate selection labels, complete appearance counts and the full-scope top twelve chart |
| Report 11 | Twenty open tickets without receipt bodies, plus complete stake totals in one stable database statement |
| Financial CSV | Explicit foreground page traversal; no partial download; 20,000-row / 10 MiB / 60-second client budgets and bounded page requests |
| Ticket progress | At most twenty visible open weekly ticket IDs; only matching periods and referenced players; board requests contain team scores without unrelated player bodies |
| Other reports | No account-history reload; score/forecast reads only for relevant reports; job/email reads only on their own log screens |

The generic raw financial-history path was removed from `loadAccounts`, including
its offset reader. Local read-only previews retain their supplied fixture arrays;
live views use scoped RPCs. Directory budgets fail explicitly instead of silently
returning a partial oversized directory. Client refresh generations and league/
identity fences remain in place. A small client revision advances after a
completed account refresh, so partial directory/aggregate updates do not repeatedly
restart ticket-page reads. It is not a database history/version token.

## Semantics and limits

Stored accepted tickets, legs, promotion terms, wallet balances, ledger entries
and adjustments are unchanged. Voids remain included in placed counts and
excluded from settled ROI/wagered stakes. Missing balances remain unknown.

Wallet activity now includes recorded administrative balance adjustments as
well as ledger entries. Its season/week controls are disabled because untagged
cash changes have no reliable NFL season. Opening entries are excluded from
cash-flow sums. Imported wagers without ledger records remain visible in the
canonical Balance History. Other financial reports retain NFL season and market
week filters; historical seasons come from bounded metadata, not full history.

Pagination binds user, league and filters, with stable tie ordering and an initial
record cutoff. This is not a historical MVCC snapshot across arbitrary client
requests. Changed selection results invalidate an in-progress cursor. CSV
traversal rejects changed totals/revisions, repeated cursors, incomplete pages,
changed filters, cancellation and oversized output before creating a download.
PDF/PNG show the current detail page and complete filtered summaries; CSV asks
for all matching rows within its stated resource budget.

All added database functions are SECURITY INVOKER. Financial report RPCs require
the league admin role; ordinary account pages retain their member/own-wallet
authorization. RLS remains active and anonymous/service execution is revoked.
Cursor scope hashes are consistency checks, not a substitute for server
authorization or cryptographic signatures.

Database aggregates still compute over retained facts. Synthetic read tests,
logical byte bounds and a selective index plan do not establish production wire
usage, physical storage savings, free-tier capacity or a two-week plateau. Those
remain milestone 23. No production application/schema change, GitHub push, paid
upgrade, experimental acceptance or support deployment occurred.

## Hosted development migration map

Project `whlcnlacueweaqpsupqs` only:

| Local prefix | Hosted version | Name |
|---|---|---|
| 20261029182631 | 20261029185924 | account_betting_totals |
| 20261029182654 | 20261029185926 | account_ticket_period_filters |
| 20261029183835 | 20261029185927 | account_financial_report_pages |

These sources are now hosted and must not be edited. Use new CLI-generated
migrations for follow-up fixes. The period-filter migration preserves the old
ticket-page interface while adding exact ticket/season/week filters and an
option to omit unused receipt bodies. The selected-league/season/week index was
selected by EXPLAIN for the selective synthetic multi-season case.

## Verification

The complete release suite passed 36/36 checks. Additional database cases cover
1,205-ticket traversal across eight orderings, real saved boost terms, historical
seasons, full-scope aggregates and report pages, canonical balance parity,
selection-result revision rejection, peer/admin/anonymous/service boundaries and
byte-for-byte unchanged financial records. A selective synthetic season query
used `tickets_league_season_week_idx`; this is not a production load benchmark.
One synthetic serialized response measured 17,297 bytes for twenty tickets,
versus 1,022,367 bytes for the complete 1,205-ticket projection. These are logical
JSON measurements, not compressed production wire bytes or physical storage.

Browser fixtures exercise historical season changes, summary totals on later
pages, period filters, complete CSV retrieval and no other-league rows. Request
assertions reject raw account histories, unrelated score/forecast archives,
provider refresh and unrelated job/email reads on financial screens. Export
tests reject incomplete/changed/repeated pages, oversized data and cancellation.
All browser traffic is intercepted; no real bets, messages or owner session were
operated.

Authenticated hosted probes returned eight team summaries and exercised two
temporary synthetic tickets: settled profit 2, open stake 3, one open ticket,
one recorded adjustment and two selection labels. Unneeded receipt bodies were
omitted. Probe tickets, adjustments and import metadata were verified absent
after rollback. Anonymous aggregate and service wallet-report execution were
denied. Security advisories remain at ten no-policy INFO, 37 authenticated-definer,
two anonymous-definer and one Auth password warning; no clean-audit claim is made.

The scheduled run remains deleted. Continue sequentially in this chat; do not
recreate an automation without a new owner request.
