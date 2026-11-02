# Relative reminder scheduling — milestone 18, stage 2

November 2, 2026 ET. Implemented locally; final qualification and protected DEV
rollout receipts are appended after verification. **16 complete / 8 remaining**.

Reminders use a configurable **5–1,440 elapsed minutes** before the actual last
compatible weekly opportunity, default **60**. The earliest due time is the board
opening. Fixed Thursday reminder planning is removed; all other calendar/financial/
market jobs and actual acceptance rules are preserved. The old reminder clock
column remains for compatibility but is no longer used to plan reminders.

The planner queues only due, actionable windows; catches up after an outage while
the opportunity remains open; and retires obsolete jobs/unattempted promotions.
Window keys bind the lead-time contract. Workers reject obsolete job keys, the
service-only queue rechecks the current contract under a league schedule lock,
and delivery rechecks both the due time and current availability. Turning off
automation stops reminder delivery. Existing disabled flags remain disabled.

A durable per-league/season/week recipient check suppresses further reminders
after a sent/captured or ambiguous prior attempt, including after terminal context
retirement. Unattempted obsolete messages may be replaced with new identities;
frozen bodies are never rewritten. Co-owner recipients stay independent. Existing
transactional receipts and manual reopening announcement behavior remain intact.

The owner can save the lead in the existing schedule screen. Operators can preview
saved/proposed times against current weekly availability, including when automation
is off; unavailable windows are explicit. Preview is read-only and shows actual ET
dates. Invalid input disables saving/preview, and delayed responses cannot replace
a changed input or selected league. This is not an automation activation.

## Storage / execution budget

One bounded integer per schedule; no new table, external service or cadence.
Existing <=2,048-byte outbox context gains a few small schedule fields and keeps
the seven-day terminal retirement. Durable job/outbox identities use existing
tables; one identity per actual window/lead and recipient where needed, not per
tick. A partial reminder period index supports duplicate checks. PostgreSQL index/
row overhead and actual shared quota/wire capacity still need milestone 23.
Each active league inspects at most its 18 current-season weekly boards; closed/
unpublished boards fail before quote scans. Obsolete-row retirement is limited to
500 per board/pass. No old history is deleted and no provider archive is added.

## Verification

SQL tests exercise the real planner/outbox RPC: early rejection, due/deadline,
idempotent retries, old fixed jobs, changed lead retirement/replacement, owner/
tenant boundaries, read-only preview, co-owner scope, durable suppression after
context cleanup, ambiguous-attempt review, closure after outage and both ET DST
transitions. API tests cover early/legacy-relative frozen messages. Intercepted
phone/desktop UI tests cover real Monday dates, preview/save, inactive automation,
unavailable windows, invalid input and delayed-response fencing. Existing transition
regressions pass. The full release plan remains **43 suites**, with the new UI
regression included in `test:notifications`.

Local migrations: `20261102141500_relative_reminder_schedule.sql` plus
`20261102143414_reminder_schedule_revision.sql`. The additive second migration
allows returning to an identical never-attempted schedule without stranding it;
attempted/frozen bodies cannot be resurrected. Do not edit migrations after hosting.
Production rollout still requires owner review of exact source and
migrations, paused workers and review of obsolete pending reminders. No production
release, real mail, funding, GitHub push or new scheduled continuation is authorized.

Next notification work: per-user/per-league preferences, routine caps/collision
handling, factual evolving story selection, scoped staff alerts and the remaining
full lifecycle/journey matrix. Milestone 18 is still in progress.
