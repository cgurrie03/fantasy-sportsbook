# Bounded optional maintenance before worker claims

November 4, 2026. Milestone22/A21/A23. **18 complete /6 remaining**. VoiceOver remains owner-skipped/unverified; no repeat request. Actual backups remain owner-deferred.

## Reproduced gap and correction

**B016, P2:** weekly-worker awaited both optional preclaim cleanup RPCs without AbortSignals. Returned errors were logged and ignored, but a stalled HTTP request could delay job claiming indefinitely until the platform ended the invocation. This contradicted the intent that maintenance failures must not starve authoritative settlement/replenishment. The intercepted compiled-handler baseline observes0 cleanup aborts versus4 required across two worker invocations.

A shared server helper runs the existing refresh cleanup(limit5) and evaluated-sample cleanup(limit2), sequentially as before, with independent **3000ms AbortSignal budgets**. Returned errors still reach the existing limited code-only logs; thrown failures produce a fixed MAINTENANCE_UNAVAILABLE result. Worker job claiming continues. No cleanup SQL, retirement limits, financial operation, claim/lease semantics, job priority, provider pricing or authorization changes. Routine postwork cleanup already had its own3-second bound and remains unchanged.

HTTP abort bounds the client's wait; it does not prove PostgreSQL cancels an already running cleanup statement. Server statement/transaction limits remain necessary. An aborted cleanup may already have completed, so the existing idempotent terminal/expiry predicates remain essential. No timeout increase, bypass, financial retry or wider cleanup target is introduced.

## Meaningful verification

The new fixture compiles actual API modules without preserving TypeScript and invokes two actual weekly-worker POST handlers concurrently. Every network destination is intercepted; .invalid test clients and fake credentials are the only configuration. Both cleanup endpoints stall until their AbortSignals fire. ESPN returns503, and status-observation persistence also returns503. The two handlers overlap in cleanup, all4 cleanup waits abort and both handlers still reach the claim RPC and return200 with visible cleanup/status failure. Claims return an empty synthetic queue, mail claims return empty and no table write/provider email is allowed. Separate helper checks prove fixed RPC names/limits and safe handling of rejected transports.

The fixture accelerates AbortSignal timers to40ms while asserting actual requested maintenance budgets remain3000ms. It is a deterministic resilience test, not a latency/load estimate. Initial incomplete mock routing/mail configuration errors are test-construction issues and are not qualification. Existing hosted dispatcher proof in44 remains valid; no actual hosted concurrent-worker throughput or provider outage is claimed by this local overlap check.

The test joins the existing weekly suite; stable count43 remains. No table/archive/cron, provider call, dependency or paid resource added. Two AbortSignals and a fixed error object are transient per worker invocation; there is no new persistent storage. The core API change requires clean-source qualification and protected Development deployment. Production stays behind its exact owner gates.

Ignored evidence: work/worker-outage-baseline.log, work/worker-outage-focused.log, work/worker-outage.json, plus the forthcoming clean-source qualification/deployment receipt. Actual hosted loaded-worker/cold-start/rate-limit and wire/capacity evidence remain open; do not promote a local mock pass into operational capacity acceptance.
