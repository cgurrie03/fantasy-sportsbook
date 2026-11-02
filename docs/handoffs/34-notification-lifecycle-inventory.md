# Notification lifecycle inventory and next implementation slice

Milestone 18 is in progress at the inventory stage. No notification runtime,
production timing, provider delivery or template is changed by this document.
Baseline: deployed application 44f1136 plus placement-policy DB fix in handoff 33.

## Current paths

| Purpose | Current entry point and source | Existing safeguards | Remaining change |
|---|---|---|---|
| Opening edition | weekly-worker publish -> enqueue opening; mail.buildEmail reads published weekly quotes and current league identity | Shared financial audience/fresh approved account context, outbox event key, final published board at build | Actual eligibility/useful-window guard; two/three factual varied stories generated once per league edition; preferences |
| Reminder | weekly planner's Thursday reminder_time -> worker published/open-board check -> enqueue reminder | Reminder flag, publication pause at enqueue, recipient scope and positive current balance at delivery | Deadline-relative lead time, compatible eligible selections and effective minimum wager, frozen-payload/window revalidation; no futures-only justification for weekly urgency |
| Monday watch | scheduled Monday watch -> mondayEmail personal accepted-ticket/game observations | League/wallet scope and personal tickets | Relevance/preference gate; merge with actual closing reminder when coincident; no unconditional fourth routine email |
| Recap/replenishment | weekly-worker recap waits for completed replenishment job, queues previous-week recap | Personal wallet totals, accepted/confirmed ticket records, no primary-wallet fallback | Revalidate readiness at delivery; actual credited amount and pending-state copy; league movement and season phase |
| Accepted receipt | durable ticket/email_deliveries transaction -> SQL queue_confirmation -> place-bet immediate delivery or worker retry | Unique confirmation ticket key, accepted prices/stake/boost/balance, current scoped recipient validation, frozen payload/provider idempotency | Preserve essential-message independence from editorial preferences/caps; strengthen lifecycle tests without repricing receipts |
| Reopening announcement | queue_reopening_announcement -> outbox -> reopeningEmail | Approved scoped reopening/freshness at enqueue; approved/unexpired window at delivery | Recheck board suspension, eligible quotes, source freshness and exact affected window at send time, including frozen payloads |
| Owner/operator attention | worker unresolved-result/publication/failure paths | Purpose/job event keys, saved diagnostic context, delivery recipient checks | Current worker recipient lists and JS validation retain legacy-admin assumptions; add verified staff-only recipients without invented wallets/balances; grouped cooldown budget |
| Sign-in/recovery | Supabase Auth OTP and independent project redirect settings; app recovery UI | Separate DEV/production Auth, closed owner-only DEV signup, cooldown and safe origin | Per-environment/league template review; preserve safe invitation intent; never treat a link or public fantasy name as membership proof |
| Invitation | Owner creates/copies scoped seven-day link, commissioner distributes | Hash-only token storage, verified request, explicit owner review; no staff/funds grant | No automatic invitation email currently exists. Future delivery must be explicitly approved and budgeted |
| Sample previews | WeeklySchedule -> sampleEmail/renderEmail | Explicit illustrative/sample content; no delivery | Add actual-policy/season-phase previews alongside samples and label paused/unavailable state accurately |

Current generic outbox keys are season/week/purpose plus the scoped membership or
wallet ID; reopening/receipt keys include their durable event identity. New window
keys must explicitly bind league, recipient, purpose, period and relevant window/
policy version. Preserve sent history and accepted receipts. Obsolete pending
promotions should be skipped with compact reasons, never rewritten into a different
accepted/security message or retried after their usefulness has expired.

## Verified mismatches and implementation order

1. Existing default acceptance is Wed–Thu, with separately approved reopenings.
   The handoff's Monday-close example is conditional and authorizes no betting-rule
   change. Thursday urgency is valid only for an actual Thursday deadline. The UI
   and old planner use a fixed Thursday reminder; mail currently says Closes Tonight.
2. A published board at build time and balance >0 at delivery do not establish
   current actionable markets. Frozen reminder/opening payloads currently bypass
   fresh board/window validation. Start with a compact authoritative send-time
   window contract using the same freshness/reopening/outcome constraints as bets.
3. Replace only reminder scheduling with configured lead time relative to the actual
   deadline; version its keys and expire obsolete pending jobs/payloads. Preview
   before/after schedule in DEV. Keep normal acceptance windows unchanged.
4. Add per-user/per-league editorial preferences, owner defaults and a three-routine-
   message weekly budget. Preserve prior disabled flags. Merge overlapping watch/
   reminder slots; keep transactional/security messages outside editorial caps.
5. Replace openingWeekStories' fixed championship/top-three/bottom-three structure
   with bounded factual candidates, comparable current/previous edition samples,
   diverse ranked selection and deterministic novelty. Do not infer elimination,
   streaks, injuries or draft rules from missing/unsupported data. Reuse compact
   evidence where comparable; no raw provider archives or paid AI service.
6. Wire factual/phase-aware previews and staff alert scope, then test delayed jobs,
   rescheduling, DST, missing results, sender/URL privacy, retry/lease races and
   consecutive synthetic weeks. Measure provider/DB reads and combined volume
   against actual shared allowances before production approval.

## Storage and rollout constraints

Existing prospective retention retires terminal email bodies after seven days and
completed diagnostics after 30; unresolved/ambiguous deliveries and compact durable
identities remain protected. New lifecycle data must have explicit byte/row/horizon
budgets and cannot restore per-refresh archives. The proposed <=1 MB editorial
comparison target per league is a target, not a measured free-capacity claim.

DEV remains capture-only, operations/automation paused and signup owner-only.
No bulk mail or new scheduled continuation is authorized. This inventory does not
close milestone 18, 16's broader policy work, real wire/capacity evidence or production
release approval. Full notification matrix implementation and verification remain.
