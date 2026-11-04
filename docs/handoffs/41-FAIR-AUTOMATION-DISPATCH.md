# Fair automation dispatch and outage fences

November 4, 2026. Milestone22/A21/A23 development work. Counter remains18 complete/6 remaining. The owner explicitly deferred the actual backup and asked to continue development; no backup prompt, export or private-key access is part of this task.

## Reproduced behavior and resulting change

The controlled disposable database used the actual installed claim function, a fixed queue and a calendar-enqueue stub confined to that local fixture. LeagueA had64 older settlement jobs; leagueB had1 newer settlement job. B was claimed65th. The old scheduled-job predicate also lacked a scheduled_for<=now boundary, so a future scheduled job could be selected if already present in the queue.

The new service-only claim function preserves operation priority first. Within the same priority, it chooses the league least recently given a turn, then that league's oldest job/event key. One mutable private record per league stores the last dispatch order/time. A private monotonically increasing sequence gives deterministic turns even if the wall clock moves or consecutive claims share a timestamp. It stores no claim history, provider payload or financial facts.

The existing global advisory transaction lock covers selection, job lease/attempt update and cursor update. A failed/rolled-back claim rolls back both job and cursor table changes; the sequence may retain unused gaps, which are harmless and carry no accepted terms. Service/browser roles cannot directly read or edit the private table/sequence. The public RPC signature and returned job shape are unchanged.

Future scheduled jobs now wait until their scheduled time. Existing expiry cleanup, legacy attempt ceiling, scheduled-window retry behavior, per-league pricing-writer exclusion, publication dependencies, paused-league guards and five-minute leases remain. The algorithm gives turns within each priority, not a guarantee that model work runs ahead of unresolved critical money work. It adds no parallel execution, cron, paid resource, operation activation or mailing.

## Verification and capacity limits

The revised fixture claims B second. A separate64-claim equal-backlog burst alternates leagues. Tests cover critical-work precedence, future/expired windows, failure backoff and expired-lease recovery, exhausted unscheduled attempts, per-league writer exclusion, publication dependencies, paused leagues, service-only access/direct-private denial and rollback atomicity. The test is included in the existing weekly suite; the stable43-suite count is unchanged.

Local PGlite loop timings are diagnostic only: before/after loops process different numbers of claims and are not a throughput benchmark. These are synthetic queues, not measured hosted one-minute dispatch delay, actual provider outages, billing/egress or two-week capacity evidence. Actual peak/outage/load/device/security checks remain milestone22/23.

Storage adds one small overwritten row per league plus one bigint sequence and a primary-key index. Physical allocation/autovacuum behavior must be measured; fixed logical row count does not prove a physical plateau. No new financial recovery format is needed for this disposable dispatch cursor. Full native platform backup would include its schema/sequence; financial-only recovery can safely restart scheduling turns without rewriting accepted transactions.

## Delivery receipt

Qualified clean source **1e6d1b85139af6a8820eb6539229bb7fa5374b6f** passed **43/43** suites in **319.178 seconds** on November4 (15:30:53–15:36:12 UTC). This qualification also includes the previously prepared native-backup tooling's synthetic tests; no actual export occurred.

Local migration **20261104152355** maps to hosted DEV **20261104153625** (`fair_automation_dispatch`). Before replacement, the hosted claim body matched the reproduced pre-change local schema. Afterward, normalized source MD5 **83ffd3ebaaacc277c76cb792b1a0f908** exactly matched the committed new function. Hosted rollback probes passed: service-only execution/direct-private-table-and-sequence denial, explicit nonserver rejection, paused empty-queue claim0, no cursor rows/jobs/sequence consumption and no activation/mail.

Five-table financial digest remained **a934b2e187fa6f5ae0e8cd77b0507451**. Persistent DEV has0 jobs/cursor rows/tickets/wallet entries/outbound messages,0 wallet balance,0 active operations and0 enabled automation. Physical DEV size18,093,747 bytes vs18,044,595 before (+49,152 allocated bytes, including catalogs/index/sequence for this empty fixture). This is not a loaded-season forecast or observed plateau.

Security advisors: existing74 authenticated-definer,2 anonymous-definer and1 Auth warnings unchanged; no new warnings. No-policy INFO23→24 adds only the intentional private RLS/no-direct-grant dispatch table ([linter reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Performance INFO:60 unindexed foreign keys unchanged; unused-index observation25→24 after read probes, with no index deleted. Do not interpret unused-index counts on a paused tiny DEV database as grounds for removing indexes.

No frontend/API runtime source changed relative to deployed e5ee1e2. This compatible database-only update keeps the existing READY protected Development app **dpl_DbHMid37bWgGwLMbfgVKexFgLQy2**; all-deployment SSO remains enabled. Production canonical **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ** remains unchanged. No GitHub push, paid resource, activation or production change occurred. The local fixture server was stopped.

Rollback preparation retains the old claim definition at ignored `work/dispatch-hosted-before.sql`. A reviewed function-only rollback can leave the empty private cursor/sequence unused; no accepted term or balance needs conversion. Do not automatically drop records or reintroduce the known fairness/time bug. Production rollback/approval remains separate.

Ignored evidence: `work/fair-dispatch-completion-receipt.json`, qualified provenance/results, full/focused logs, before/after synthetic queue receipts, pre-change function definitions, hosted rollback probe and unapproved exact-source review manifest. Later documentation-only commits are not the qualified source.

Milestone22 progresses; **18 complete / 6 remaining**. Actual device/Auth/security/whole-profile and measured hosted peak/outage/capacity acceptance remain. The owner deferred actual backup on November4; keep the tools prepared without asking them to repeat certificate/password work.
