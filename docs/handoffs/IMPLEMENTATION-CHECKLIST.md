# BOFF implementation counter

This stable 24-milestone checklist groups the handoff into reviewable delivery
units. It is not a count of individual code changes or the 25 audit findings.
"Complete" means the stated scoped unit is verified in isolated development;
production rollout and broader related work remain separate milestones. Partially
implemented milestones remain in the remaining count. Deferred support is excluded.

Current counter: **14 complete / 10 remaining**. Milestone 16 is in progress: independent staff access is verified; settings/import/claims remain. Production historical cleanup (13) remains approval-gated.

| ID | Milestone | Status | Evidence / scope |
|---|---|---|---|
| 01 | Independent development schema, Auth and runtime identity guards | Complete | Handoffs 13–14; independent owner, closed signup, captured mail/manual automation |
| 02 | Protected development hosting and owner sign-in | Complete | Handoff 14; canonical hostname, SSO and both synthetic leagues verified |
| 03 | Revision-aware shared member board cache | Complete | Handoff 13; cache authorization, deduplication and visibility checks; lazy categories remain 15 |
| 04 | Terminal refresh working-payload cleanup and fencing | Complete | Handoff 13; bounded dev lifecycle and recovery tests; production cleanup remains 13/24 |
| 05 | Revision-checked futures editing | Complete | Handoff 13; narrow editor preserves server-owned settlement/model context |
| 06 | Encrypted financial snapshot and local restore drill | Complete | Handoff 15; application financial scope only; full/off-site recovery remains 20 |
| 07 | Narrow, bounded worker review reads | Complete | Handoff 15; selected publication fields, future openings and latest review periods |
| 08 | Compact model-evaluation writer and Sleeper benchmark | Complete | Handoff 16; fixed numeric horizons and admission budgets; expiry/controller remain 11/12 |
| 09 | Compact publication writer and fixed-horizon report readers | Complete | Handoff 17; protected dev, fixed horizons, bounded metadata/details and retired roster replay; no historical deletion |
| 10 | Bounded experimental live-forecast capture and readers | Complete | Handoff 18; four compact quartiles, bounded status, role/lease fences and numeric parity; acceptance stays disabled |
| 11 | Compact finalized summaries, seven-day expiry and bounded unresolved work | Complete | Handoff 20; dev worker cleanup, 14-day health, leases, summary views and financial isolation; legacy/prod cleanup remains 13 |
| 12 | Candidate evaluation compatible with short-lived evidence | Complete | Handoff 20; dev frozen prospective state and promotion guards, no measured performance gain or production policy approval |
| 13 | Recovery-approved historical bulk conversion/cleanup | Remaining | Dependency inventory, useful summaries, exact owner-approved production plan and physical measurements |
| 14 | Selected-league account histories with stable pagination/aggregates | Complete | Handoffs 21–22; scoped RPC pages, complete database aggregates, bounded exports, visible score fields, identity/league/request fences; no legacy financial-history loader |
| 15 | Lazy board categories and shared provider request coalescing | Complete | Handoff 23; category/slip-aware reads and RLS index, hidden pause/resume, shared bounded starter/provider cache with fresh authorization and original source TTLs; synthetic JSON/request evidence, actual wire/physical capacity remains 23 |
| 16 | Staff roles, versioned settings, imports and approved team claims | In progress | Handoff 24 completes independent staff/owner capabilities, API/UI and grant audit; versioned policy, draft import/capability review and invitation/claims remain; final co-owner admission depends on 17 |
| 17 | Separate per-user, per-league wallets | Remaining | Preserve balances/history; no duplicate co-owner credits |
| 18 | Notification lifecycle and season storylines | Remaining | Actual windows, preferences, receipts and bounded communication volume |
| 19 | Routine log, email-body and unused media retention budgets | Remaining | Durable deduplication, retry preservation and bounded cleanup |
| 20 | Full platform/off-site recovery and owner key custody | Remaining | Financial-only local drill is insufficient |
| 21 | Enforced exact-release owner approval workflow | Remaining | Resolve automatic main publication before any push; tested SHA/migration gate |
| 22 | Remaining product/audit and multi-league operation verification | Remaining | Track A01–A25 residuals, supported settings, tenant negatives, peaks/outages/season changes; no incidental experimental launch |
| 23 | Measured shared-quota capacity and two-week plateau | Remaining | Physical vs JSON size, wire bytes, one-/two-league load and season forecast |
| 24 | Owner-approved production release and postflight | Remaining | Exact tested source/migrations, restore/rollback constraints, owner review; second-league launch requires its own capacity approval |

The counter changes only after a milestone's scoped verification is complete.
Do not mark summary/expiry, full recovery or production readiness complete merely
because writes have admission caps or a development deployment is healthy.
