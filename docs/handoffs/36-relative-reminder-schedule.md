# Relative reminder scheduling — milestone 18, stage 2

November 2, 2026 ET. Final qualification and protected DEV rollout evidence is
recorded below. **16 complete / 8 remaining**.

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

## Qualified checkpoint

- Exact clean source **`5094bcf4075368fcacaae06bd80108480d49d5fb`** passed **43/43**
  suites in **298.574 seconds**, including expanded SQL/API/phone/desktop cases.
  An earlier run exposed an obsolete source-inspection assertion, corrected to
  inspect the delegated calendar function. That failed run is not qualification.
  The exact-source release review is **unapproved**. Later documentation commits
  do not claim their newer HEAD was tested or deployed.
- Hosted migration map: local **20261102141500 -> 20261102142937**, local
  **20261102143414 -> 20261102143651**. Both are now immutable. The second is an
  additive reentry fix; the first hosted migration was preserved.
- Hosted rollback probes passed owner-only save, operator preview/outsider denial,
  invalid lead rejection, preserved inactive flags and saved clock/cutoff settings,
  both DST transitions and no queued work from the paused DEV planner/queue. SQL
  metadata verifies unattempted/unfrozen reentry conditions. Positive actionable
  planner/recipient/reentry behavior was tested in isolated local PostgreSQL;
  no hosted activation guard was bypassed to manufacture a positive window.
- DEV before/after remains two leagues, two pending user wallets, zero entries,
  tickets or emails, operations/automation both off. The same five-table financial
  digest as handoff 35 remains **`5bae6ca0b50de30a40ee058fa53d9173`**.
- Advisor metadata: 61 authenticated-definer WARN (two new scoped preview/config
  functions with tested operator/owner checks), two anonymous-definer WARN, one Auth
  WARN and 15 RLS/no-policy INFO. All prior findings are unchanged; no anonymous
  grants were added. Reentry migration adds no new advisory finding.
- Ignored evidence: `work/relative-reminder-completion-receipt.json`,
  `work/relative-reminder-hosted-probe.sql`, `work/relative-release.log`,
  `work/release-checks/provenance.json`, exact-source review directory and
  `work/ux-evidence/reminder-timing-{390,1280}.png`.
- READY protected Preview **`dpl_2d4xNabScbz8PM8nzGnDgnHs1awb`** serves
  [Development](https://dev.sportsbook.coopergurrie.com) from source 5094bcf.
  Hosted build guard confirmed independent owner, closed signup, capture-only mail
  and manual automation. All three DEV aliases plus the generated deployment URL
  redirect signed-out requests to Vercel sign-in; protection remains enabled for
  all deployments. Production canonical stays READY
  **`dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`**. No real messages, funding, activation,
  production change or GitHub push. Temporary localhost fixture server stopped.
