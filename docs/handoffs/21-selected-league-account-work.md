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

This stage still traverses selected-league history with the old offset reader.
Do not call it bounded history or declare milestone 14 complete. Next: tested
keyset ticket/receipt pages; canonical ledger pages preserving imported balance
anchors; database totals for report/leaderboard summaries; screen-specific reads;
visible-ticket progress only; current-scope query/byte and access evidence.

Any new migration in this stage remains local until its tests, identity and
hosted development verification are recorded. Production remains unchanged.
