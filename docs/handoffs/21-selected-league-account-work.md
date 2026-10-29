Superseded continuation: [handoff 22](22-account-aggregates-and-report-pages.md) completes the aggregate consumers and milestone 14 in protected dev. The older 12/12 checkpoint and usage observation below describe that earlier stage.

# Selected-league account work — October 29, 2026

Milestone 14 is in progress. Counter stays **12 complete / 12 remaining**.
The deployed dev source remains handoff 20 until the next verified upload.

The first stage splits membership claiming from ordinary refreshes and scopes
ticket/leg/promotion/event/ledger reads to the chosen league. Login and explicit
pending-membership retry can claim approved mappings; ordinary refreshes do not.
Bootstrap loads the small identity/league directory before selected history.
Each account request has an abort signal and generation guard. A league change,
newer refresh or identity reset prevents an older response publishing private
state. Failure fallback only reuses history carrying the same league scope.

Verification: full release preflight passed 36/36 checks, including a new
synthetic browser race where a delayed A response finishes after selecting B.
The selection and displayed history remain B. Loader tests verify selected
filters on all five history families, core-only bootstrap, no repeated claim,
revoked league handling, same-scope outage fallback and cancellation. Hosted
read-only metadata confirms unambiguous ticket child relationships and existing
RLS. No live account was operated and no financial records changed.

The first stage still traversed selected-league history with the old offset
reader. The second stage below replaces specific screens; other consumers still
need migration. Do not declare milestone 14 complete.

## Ticket, balance and score page readers

My Bets, All Bets and admin ticket/log screens use pages of 20. A cursor binds
the authenticated user, selected league, complete filters and initial as-of time.
Sorts preserve date/settled/return/odds ordering, nulls-last and deterministic
placement/UUID ties. Filters/search run in the database; receipt legs and
promotion terms are fetched only for the returned ticket IDs. Cursor traversal
reflects current committed settlement/filter changes; refresh restarts it. This
is not a historical database snapshot across an arbitrary series of requests.

Account and admin-user balance histories use pages of 30. Their server-side
canonical union preserves old imported wager fallback, settlement/adjustment
anchors, identical-time phase/placement/ID ordering and pending NULL balances.
The initial wallet balance is carried through the cursor so a later wallet
change cannot rewrite inferred amounts midway through the same traversal.

Score progress receives at most 20 visible open weekly ticket IDs, reads only
their exact periods and referenced player IDs, and preserves true zero scores.
The Home board asks for its current team scores with an empty player body.
These functions are SECURITY INVOKER with explicit authenticated-only grants;
existing table RLS and private wallet access remain active. Each response has
a logical byte admission bound. No accepted financial terms are changed.

Ticket/balance screens no longer start background full ticket/leg/promotion/
ledger/event traversals. Home, leaderboard, reports and approval aggregates
still use selected-league full histories and remain the next work. Do not claim
the entire account loader is bounded or milestone 14 is complete.

## Hosted development migration map

Only development `whlcnlacueweaqpsupqs` received these additions:

| Local source prefix | Hosted version | Name |
|---|---|---|
| 20261029143050 | 20261029144103 | account_history_pages |
| 20261029144244 | 20261029145612 | visible_ticket_score_progress |
| 20261029144644 | 20261029145613 | canonical_balance_history_pages |

Do not edit these now-hosted files; use a new CLI-generated migration for fixes.
The ticket league/date/ID index supports the selected-league tie order; broader
physical capacity and actual production plan measurements remain milestone 23.

## Reader verification

PGlite traverses 1,205 tickets in eight sort/direction combinations without
duplicates or missing IDs. It exercises literal search, personal scope, changed
filter/tenant/user cursors, anonymous/service denial and scoped receipt children.
Canonical balance pages match the existing calculation across all fixtures,
including imported shared-time entries and missing wallets. Visible score tests
keep a real zero and omit unrelated players/periods. Every ticket, leg, wallet,
ledger and balance-event byte is unchanged after the read tests.

Browser fixtures exercise next/previous pages, server search/exact ticket links,
mobile balance pages, receipts and delayed previous-league results. They block
external requests. On balance screens, request assertions reject background
full-history reads. The new page tests are part of `test:accounts`.

Rolled-back hosted probes executed as the authenticated dev owner, read a
synthetic ticket/leg, projected one required zero-valued player and omitted an
unrelated player. A pending wallet remained NULL in balance history. Both probe
imports/tickets were verified absent afterward. Security advisory counts remain
10 no-policy INFO, 37 authenticated-definer, two anonymous-definer and one Auth
password warning; no clean-audit claim is made. Production remains unchanged.

Next work: database totals for Home/leaderboard, exact placement receipt reads,
approval counts and bounded financial report readers/exports. Keep the stable
counter at **12 complete / 12 remaining** until those consumers are migrated and
the full scoped milestone is verified.

## Verified delivery checkpoint

The final complete release run passed **36/36 checks**. The first run had one
receipt fixture still using the old REST promotion source; the fixture was
updated for the page RPC, real saved-promotion scope was added to SQL tests,
and the complete rerun passed. Final lint/type/fixture build and browser checks
include the current source.

Application source `86756fa9e96977dec1688ad17948ebd9e9541908` was deployed as
131 filtered source/build files to `dpl_3wZbbRZqJJN1BDLqch6BJNS6Jxn7`.
It reached READY and hosted preflight verified independent dev identity/key,
owner, closed signup, captured mail and manual automation. All three stable dev
aliases and generated URL require Vercel SSO. No bypass or owner browser was
operated. Production and GitHub were not published to.

At this checkpoint the five-hour usage window is 99% consumed. The scheduled
run is deleted; no automatic continuation is configured. Continue the aggregate
consumers listed above from this committed checkpoint when usage permits. Do not
mark milestone 14 complete or change the 12/12 counter for this partial stage.
