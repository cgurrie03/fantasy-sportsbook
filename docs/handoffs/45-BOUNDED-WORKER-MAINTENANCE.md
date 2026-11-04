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

## Qualified Development delivery

Clean source **301a17701c7b53d38b70ef856bb0504dd62545ec** passed **43/43** in **411.969 seconds**, November4 21:57:37–22:04:29 UTC. This qualification also includes the previously added dispatcher-probe regression from44. An initial build-gated attempt caught the new helper missing from the explicit compiled-API fixture list; the list was corrected, focused build passed, and the failed attempt is not qualification. No application/runtime edit occurred after the successful qualification.

READY protected Preview **dpl_EqWHS4ncLyR8y5XF7hCmsME1ViTk**, generated host `fantasy-sportsbook-an23r9xet-cooper-gurrie-projects.vercel.app`, serves all three DEV aliases. Hosted target/independent owner/closed-signup/capture/manual guards and compiled API tests passed without TypeScript/error build events. Only DEV Preview BOFF_BUILD_SHA updated; alias assignment was sequential after READY. All three DEV aliases and generated host return signed-out302 to vercel.com; all-deployment SSO remains enabled.

Production READY **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ** is unchanged. No GitHub push, schema migration, active-league flag change, hosted worker invocation, real mail, financial transaction, backup or schedule occurred. No new financial digest or physical capacity measurement is claimed; last hosted dispatch/digest/sequence/physical observations remain44. A client abort does not prove server SQL cancellation.

B016 is fixed, qualified and hosted in Development. **18 complete /6 remaining**;22 retains actual hosted loaded-worker/cold-start/outage/rate-limit and remaining product acceptance. VoiceOver is explicitly owner-skipped/unverified, not a pending action. Auth works functionally; visual/email styling remainsF015. Backups stay deferred.

Ignored evidence: `work/worker-maintenance-completion-receipt.json`, `work/worker-qualified-{provenance,results}-301a177.json`, `work/worker-maintenance-release.log`, failed build-gated log, focused build/outage logs and `work/release-reviews/301a17701c7b53d38b70ef856bb0504dd62545ec/manifest.json` (unapproved; no production permission). Later documentation-only HEAD is not the qualified/deployed app source. AbortSignal semantics: [Supabase request cancellation](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal).
