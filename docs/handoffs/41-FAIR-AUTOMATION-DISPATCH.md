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

Pending clean-source qualification and isolated Development migration/rollback postflight. No production action authorized or performed. No frontend/API runtime source changed; this is a compatible database scheduler update, so a new frontend deployment is unnecessary. Existing protected Development app remains on its documented source.
