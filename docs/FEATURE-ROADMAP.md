# Prioritized implementation list

Updated October 29, 2026. Complements [the bug queue](BUG-QUEUE.md); these records
do not add to or replace the stable 24-milestone count. Default owner: Cooper for
policy/production decisions; Codex for the authorized development implementation.
Ready items may proceed while earlier items wait for required evidence/approval.

| Order | ID | Priority | Feature / delivery | Milestone | Status / dependencies |
|---|---|---|---|---|---|
| 1 | F001 | P1 | Full platform/off-site recovery, restore drill and owner key custody | 20 | In progress; private Drive checkpoint/restore package verified, portable key helper tested; owner password-manager import and full-platform coverage/drill remain |
| 2 | F002 | P1 | Exact tested-release approval and safe CI/publication workflow | 21 | Remaining; required before any production release or cleanup |
| 3 | F003 | P1 | Operational log/email-body/unused-media retention budgets | 19 | Done dev; handoff 26, 37/37 checks, protected deployment; unresolved mail/retries/financial audits and referenced art preserved |
| 4 | F004 | P1 | Separate per-user, per-league financial accounts/wallets, including co-owners | 17 | Remaining; preserve original balances/accepted terms and never copy another owner's funds; retries credit once per account |
| 5 | F005 | P1 | Versioned provider capability contract and typed shared sportsbook defaults/league overrides | 16 | In progress; independent staff/owner access is delivered, policy versioning/effective dates/runtime consumers remain |
| 6 | F006 | P1 | Owner-only resumable draft league importer and reviewed capability report | 16 | Remaining; real teams exist before signup, no fabricated owner participant/wallet, jobs/mail/publication off; depends on F005 |
| 7 | F007 | P1 | Scoped revocable signup links, verified account requests, owner-reviewed team/co-owner claims and pending/rejected/expired states | 16 | Remaining; depends on F004/F006; commissioner distribution gives no admin grant |
| 8 | F008 | P1 | Remaining audit/rule/tenant/product journeys and scheduler peak/outage fairness | 22 | Remaining; declared supported configurations only; record each A01–A25 residual |
| 9 | F009 | P1 | Physical/wire shared-quota baseline, growth forecast and two-week plateau | 23 | Baseline can proceed early; final sign-off follows retained-data/feature changes; blocks another real league |
| 10 | F010 | P1 | Recovery-approved historical conversion/cleanup | 13 | Blocked on useful summaries/dependency plan, F001/F002 and exact owner approval; measure physical recovery separately from JSON deletion |
| 11 | F012 | P1 release gate | Owner-reviewed production rollout and postflight | 24 | Blocked on exact tested source/migrations, required recovery/capacity/product gates; not an automatic final push |
| 12 | F011 | P2 | Window-aware notifications/preferences, receipt lifecycle and season storylines | 18 | Remaining; derive from approved policy, preserve Wed–Thu acceptance plus approved reopenings |
| 13 | F013 | Optional | Owner-only in-app bug/feature board | Outside stable counter | Not selected; owner confirmed Markdown + chat; no in-app queue work is authorized by that choice |
| 14 | F014 | Deferred | Public support button/automatic error reporting described in handoff 11 | Deferred / excluded | No deployment authorization inferred from an internal queue request |

Suggested working sequence: recovery/release foundations and early capacity
baseline; routine retention and financial identity; settings/import/claims; final
audit/load/plateau and exact owner-approved release. Notification work can proceed
after its policy dependencies. Historical production cleanup stays approval-gated.

## Current development completion summary

Milestones 01–12, 14, 15 and 19 are complete in their stated isolated-development
scope: independent dev/Auth/hosting; revision cache; refresh fencing/cleanup;
futures edits; financial local recovery; bounded model/publication/live evidence;
compact summaries/expiry/prospective evaluation; paged financial histories/
aggregates/exports; lazy market categories/shared provider display cache; prospective routine payload admission and expiry.

The staff-access portion of 16 adds verified independent ownership, scoped staff
grants, owner-only configuration controls, fresh API capability checks, teamless
UI and audited revocation. The rest of 16 stays open. No production rollout,
full/off-site recovery, per-user wallet migration or measured free-capacity
declaration is implied by these development completions.
