# Prioritized implementation list

Updated November 1, 2026. Complements [the bug queue](BUG-QUEUE.md); these records
do not add to or replace the stable 24-milestone count. Default owner: Cooper for
policy/production decisions; Codex for the authorized development implementation.
Ready items may proceed while earlier items wait for required evidence/approval.

| Order | ID | Priority | Feature / delivery | Milestone | Status / dependencies |
|---|---|---|---|---|---|
| 1 | F001 | P1 | Full platform/off-site recovery, restore drill and owner key custody | 20 | In progress; private Drive checkpoint/restore package verified, portable key helper tested; owner confirmed password-manager import October 29 and phone access November 1; full restore drill deferred by owner; full-platform backup coverage remains |
| 2 | F002 | P1 | Exact tested-release approval and safe CI/publication workflow | 21 | In progress; exact-source evidence and unapproved review generator implemented; live publication containment/owner approval boundary remain; handoff 27 |
| 3 | F003 | P1 | Operational log/email-body/unused-media retention budgets | 19 | Done dev; handoff 26, 37/37 checks, protected deployment; unresolved mail/retries/financial audits and referenced art preserved |
| 4 | F004 | P1 | Separate per-user, per-league financial accounts/wallets, including co-owners | 17 | Done DEV; handoff 30, source efb98df passed 39/39 and is deployed protected; hosted rollback/ACL/advisory checks plus owner-verified cutovers in both leagues; funding pending, operations disabled; production adoption remains 24 |
| 5 | F005 | P1 | Versioned provider capability contract and typed shared sportsbook defaults/league overrides | 16 | In progress; independent staff/owner access and versioned intake/capability reports delivered; wallet/ticket policy v1 now has effective versions and UI/server/replenishment consumers; broader supported settings and capability approval/drift remain |
| 6 | F006 | P1 | Owner-only resumable draft league importer and reviewed capability report | 16 | Done DEV draft stage; source 6c070a8 passed 40/40, protected deployment and hosted rollback checks; real/unclaimed teams, no fabricated participant/user wallet, bounded expiry; handoff 31; operational policy approval remains F005 |
| 7 | F007 | P1 | Scoped revocable signup links, verified account requests, owner-reviewed team/co-owner claims and pending/rejected/expired states | 16 | Done DEV; handoff 32, source 44f1136 passed 42/42 and deployed protected; scoped/revocable commissioner signup links, fresh verified claims, owner approval and independent pending wallets; no staff grant |
| 8 | F008 | P1 | Remaining audit/rule/tenant/product journeys and scheduler peak/outage fairness | 22 | Remaining; declared supported configurations only; record each A01–A25 residual |
| 9 | F009 | P1 | Physical/wire shared-quota baseline, growth forecast and two-week plateau | 23 | Baseline can proceed early; final sign-off follows retained-data/feature changes; blocks another real league |
| 10 | F010 | P1 | Recovery-approved historical conversion/cleanup | 13 | Blocked on useful summaries/dependency plan, F001/F002 and exact owner approval; measure physical recovery separately from JSON deletion |
| 11 | F012 | P1 release gate | Owner-reviewed production rollout and postflight | 24 | Blocked on exact tested source/migrations, required recovery/capacity/product gates; not an automatic final push |
| 12 | F011 | P2 | Window-aware notifications/preferences, receipt lifecycle and season storylines | 18 | Stages 1–2 qualified 43/43: actual-window delivery guards plus relative lead-time scheduling, preview/reschedule/expiry and durable recipient deduplication; handoffs 35–36 track protected DEV checkpoints. Preferences/caps, evolving stories and staff alerts remain; preserve Wed–Thu acceptance plus approved reopenings |
| 13 | F013 | Optional | Owner-only in-app bug/feature board | Outside stable counter | Not selected; owner confirmed Markdown + chat; no in-app queue work is authorized by that choice |
| 14 | F014 | Deferred | Public support button/automatic error reporting described in handoff 11 | Deferred / excluded | No deployment authorization inferred from an internal queue request |

Suggested working sequence: recovery/release foundations and early capacity
baseline; routine retention and financial identity; settings/import/claims; final
audit/load/plateau and exact owner-approved release. Notification work can proceed
after its policy dependencies. Historical production cleanup stays approval-gated.

## Current development completion summary

Milestones 01–12, 14, 15, 17 and 19 are complete in their stated isolated-development
scope: independent dev/Auth/hosting; revision cache; refresh fencing/cleanup;
futures edits; financial local recovery; bounded model/publication/live evidence;
compact summaries/expiry/prospective evaluation; paged financial histories/
aggregates/exports; lazy market categories/shared provider display cache; prospective routine payload admission and expiry.

The staff-access portion of 16 adds verified independent ownership, scoped staff
grants, owner-only configuration controls, fresh API capability checks, teamless
UI and audited revocation. The rest of 16 stays open. No production rollout,
full/off-site recovery, production wallet migration or measured free-capacity
declaration is implied by these development completions.
