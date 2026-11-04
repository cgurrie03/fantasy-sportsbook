# Hosted dispatcher probe and owner Auth review

November 4, 2026. Milestone22/A10/A21/A23 progress. **18 complete /6 remaining**. This is a test/evidence delivery, with no application runtime or database function/schema change. Protected DEV app remains qualified659429828b94583467c7a0c6aaae83f03cc784f2,43/43,READY dpl_H4ewLg922XmFBFTACVGap3dMXg1Y. No redeployment is necessary for the added probe/test.

## Owner email review

Owner reports the Development email preview is plain/unformatted compared with the production one-time-link email, and works functionally. Record **functional pass; styling still open**. This is not proof of exact sender/subject/body branding parity or review of every template. Product/web/email polish is F015; no template or production change was requested or performed. The previous pending preview question is answered and must not be repeated as unanswered. Existing physical iPhone functional and account-security confirmations remain complete. A separate targeted VoiceOver question is now pending; no screen-reader pass is invented.

## Actual hosted database queue evidence

A local disposable PostgreSQL fixture validates the exact probe against the installed schema, wrong-source and wrong-environment fences, receipt delivery after fixture rollback, bounded empty claims and nontransactional sequence allocation. The generated hosted probe is gated to the exact Development environment, empty/paused jobs/mail state and one verified independent owner with an existing mapped membership. Do not delete real data to satisfy its preconditions. Raw claim source MD5 **5b52abbc60e774609d50949d00b70a6b** matches local and hosted bodies before execution (this raw hash differs from the earlier whitespace-normalized83ffd3e hash).

Inside a PostgreSQL exception subtransaction, it creates two synthetic league rows, a temporary legacy owner binding to the already verified actual owner membership, and test-only approval/schedule flags. These rows are uncommitted and invisible to another session. This explicitly seeds a legacy test profile; it does not prove or authorize actual imported-league activation or capacity. No trigger is disabled, function replaced, schema object created, financial action executed, provider called or email delivered. The real calendar planner runs; its generated fixture jobs are completed before measuring the controlled settlement backlog.

Hosted outcome: A64 older jobs/B1 newer job; **B receives turn2**. After65 total backlog claims, a32-claim equal-peer backlog alternates. Across **97 claims**, SQL claim p50 **4.210ms**, p95 **4.4632ms**, maximum **12.925ms**; claim-and-mark-complete loop **441.459ms**. These are a single DBA session/transaction on a small Development database with synthetic jobs and the actual installed planner/claim function. They are not actual worker/API/provider throughput, minute-dispatch queue age, settlement completion delay, cold-start performance or production-sized capacity.

A private exception code intentionally rolls back the entire fixture subtransaction before publishing the computed receipt. Every fixture league, approval, owner binding, schedule, job and cursor is verified absent afterward. Financial five-table digest stays **a934b2e187fa6f5ae0e8cd77b0507451**, verified again in a separate query. Rollback semantics use [PostgreSQL exception subtransactions](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).

## Attempted bounded contention check and limits

Two batches request four paused empty-claim transactions each, with a deliberate100ms transaction hold to make overlap measurable. Eight distinct database backend IDs return **0 claimed jobs**. Their actual timestamps show **no overlapping transactions**. Despite concurrent client orchestration, this observed run does not establish simultaneous database or worker concurrency; do not label it a peak/parallel pass. Do not increase holds or hammer the service to manufacture overlap. No key/password/browser session was retrieved to bypass the connector limitation. True concurrent-worker and loaded/provider-outage tests remain22/23.

A separate hosted paused/role-ACL rollback probe also passes. The older ignored fair-dispatch probe was updated to compare sequence state before/after an empty claim, rather than assuming the sequence has never been used.

## Persistent effects and closeout

Postflight has exactly2 real DEV league rows, operations0, enabled automation0, jobs0, cursors0, legacy-owner rows0, launch approvals0, tickets0 and outbound messages0. The only intended logical persistence from the fixture is dispatch sequence advancement to97. [PostgreSQL nextval allocation is not rolled back](https://www.postgresql.org/docs/17/functions-sequence.html); gaps carry no accepted terms or money, and must not be reset just to restore a test assumption.

Physical database bytes are **18,347,699**, versus **18,233,011** at the previous snapshot: **+114,688B (112KiB)** of allocation after rolled-back work. Logical rollback does not prove physical reclamation. No manual vacuum, paid upgrade, permanent history table or new schedule was added. This is not a plateau measurement. Production was not queried or changed for this task. Backups remain owner-deferred.

New probe checks join the existing weekly suite; source-only tests/docs do not require requalifying/redeploying unchanged app/API code. The expanded weekly suite and lint passed (existing unrelated project warnings remain); no new43/43 source qualification is claimed. Existing qualified/deployed app source remains6594298. Ignored evidence: `work/dispatch-audit-completion-receipt.json`, `work/dispatch-database-probe.sql`, local receipt/log, paused probe SQL, `work/dispatch-audit-weekly.log` and lint log. The receipt retains per-session timestamps for overlap review. Counter stays18/6; actual worker peak/outage/rate-limit, VoiceOver/remaining assistive evidence and production/capacity/recovery gates remain open.

Probe SQL SHA-256: `4c58f4a587cb6d354cdb77c4187a70681a0d8b2c06907eb52096c79a233892b7`; paused-check SQL SHA-256: `efe39a93428daf3b48a976b5c36b01ef89bd6ff573f5f093e581154789c56a35`. Actual contention timestamps parse successfully and do not overlap; the receipt preserves them.
