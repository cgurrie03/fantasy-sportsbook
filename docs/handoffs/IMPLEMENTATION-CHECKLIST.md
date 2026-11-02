# BOFF implementation counter

This stable 24-milestone checklist groups the handoff into reviewable delivery
units. It is not a count of individual code changes or the 25 audit findings.
"Complete" means the stated scoped unit is verified in isolated development;
production rollout and broader related work remain separate milestones. Partially
implemented milestones remain in the remaining count. Deferred support is excluded.

Current counter: **17 complete / 7 remaining**. Milestone 16 is in progress: independent staff access and inactive draft intake/import are verified; handoff 32 adds verified invitations/claims and wallet/ticket policy v1; broader supported settings and provider approval/drift remain. Production historical cleanup (13) remains approval-gated.

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
| 16 | Staff roles, versioned settings, imports and approved team claims | In progress | Handoff 24 completes independent staff/owner capabilities, API/UI and grant audit; handoff 31 adds versioned intake/capability reports and resumable inactive import; handoff 32 adds verified claims and effective financial policy; handoff 39 adds owner-only provider-rule comparison (43/43 on 05381e8, protected DEV); broader shared settings and durable approval/drift/renewal gates remain; wallet dependency 17 is complete DEV |
| 17 | Separate per-user, per-league wallets | Complete | Handoff 30; 39/39 for efb98df, protected DEV deployment, hosted ACL/rollback checks; owner verified both league cutovers; funding pending and operations disabled |
| 18 | Notification lifecycle and season storylines | Complete | Handoffs 34-38; factual bounded shared editions, verified staff alerts/caps, exact recap credit/final week closeout and phase-aware availability. 43/43 on 40f19c1; hosted rollback/ACL checks and protected READY DEV. Actual wire/shared-capacity evidence and production mail remain 23/24 |
| 19 | Routine log, email-body and unused media retention budgets | Complete | Handoff 26; prospective admission caps, terminal body/detail TTLs, referenced-art protection, isolated bounded worker cleanup and selected-league status; legacy/prod conversion and measured physical plateau remain separate |
| 20 | Full platform/off-site recovery and owner key custody | Remaining | Financial-only coverage remains incomplete; password-manager import and phone access confirmed, full restore drill deferred by owner |
| 21 | Enforced exact-release owner approval workflow | In progress | Handoff 27 adds exact clean SHA/tree/migration evidence and unapproved review preparation; live publication containment and protected owner approval remain |
| 22 | Remaining product/audit and multi-league operation verification | Remaining | Track A01–A25 residuals, supported settings, tenant negatives, peaks/outages/season changes; no incidental experimental launch |
| 23 | Measured shared-quota capacity and two-week plateau | Remaining | Physical vs JSON size, wire bytes, one-/two-league load and season forecast |
| 24 | Owner-approved production release and postflight | Remaining | Exact tested source/migrations, restore/rollback constraints, owner review; second-league launch requires its own capacity approval |

The counter changes only after a milestone's scoped verification is complete.
Do not mark summary/expiry, full recovery or production readiness complete merely
because writes have admission caps or a development deployment is healthy.
