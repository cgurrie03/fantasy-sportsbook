# New wagers use placement-period policy

B009 is fixed in isolated DEV. The stable counter remains **16 complete / 8 remaining**;
this closes a configuration regression, not all remaining milestone 16 work.

## Reproduction and correction

A future board may keep market_week 1 while an account places a new wager in week 5.
The placement functions insert the ticket before marking ticket_type future. The
previous insert trigger could therefore select week-one defaults, admitting a $1
wager despite a configured week-five minimum of $5 (and missing a reduced pick limit).
The baseline regression against the preceding schema reproduces the missing rejection.

Additive migration `20261102022611_wager_policy_placement_period.sql` captures
policy by the server-recorded placement_week for every new wager. It preserves
accepted snapshots, historical import behavior, routing locks and immutable audit
terms. Previously applied migrations are unchanged. No accepted rows are rewritten.

Actual public placement RPC regressions cover per-user and legacy team wallets,
contrasting league minimums, a three-pick season parlay exceeding the current
maximum, unchanged balances after failed placement, correct captured week/version,
and successful placement. A later policy change rejects a fresh below-minimum
wager while an identical accepted request retry retains its original terms without
another debit. Voiding that old-policy ticket returns the original pretend stake.

## Qualification and hosted verification

- Clean source `23668212a4459a665c882ee179de801d1bf87c67`: **42/42**, valid provenance,
  368.167 seconds using the two-job runner. The exact-source review is unapproved
  for production. The baseline red run is a regression reproduction, not qualification.
- Local migration maps to hosted DEV version **20261102023426** and is immutable.
- Hosted rollback probe exercised the actual capture function on temporary,
  ticket-shaped rows, including the initial parlay type, old market week, current
  placement week, future type transition, future effective policy and snapshot
  immutability. The real tickets trigger was verified enabled and bound to it.
  No real ticket was inserted and no hosted operations gate or wallet was enabled.
- Persistent state and financial digest stayed identical: two leagues, two pending
  wallets, zero tickets/entries/custom policy versions, operations/automation off;
  digest `277b6de5223808d846be3136c7f9c3c6`. No affected hosted wagers existed.
- Advisor counts **and finding metadata** unchanged: 58 authenticated-definer warnings,
  two anonymous-definer warnings, one existing Auth warning and 15 no-policy INFO.
- Application files are byte-for-byte unchanged from deployed source `44f1136`;
  the protected DEV app remains `dpl_VyWiGNuK9qVR4NhSW766i8JWzDEN`. No redundant
  frontend deployment, production change, GitHub push, funding or mail was performed.
- Ignored receipts/logs: `work/placement-policy-completion-receipt.json`,
  `work/policy-placement-baseline.log`, `work/placement-period-release.log`, final
  release provenance/results and the unapproved review under the qualified SHA.

## Owner recovery clarification

The owner confirmed phone access to both private Drive backups and the password-
manager key attachment/password. This completes an independent access/custody check,
not a decrypt/restore. The full computer-based drill is deferred by owner for this
pretend-money project. Do not request another device, repeat key import or reopen
the completed phone check. Full-platform backup coverage remains unfinished.

Next ready work is the remaining shared settings/provider contract and notification
lifecycle. Handoff 34 records the source-level notification inventory; it is planning
and baseline evidence, not a deployed notification change.
