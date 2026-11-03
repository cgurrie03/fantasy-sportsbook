# Bug and validation queue

Updated November 2, 2026. Canonical local project queue, maintained through chat.
Keep private reports/financial evidence out of this public-repository-ready file.
An observation from the October 28 audit is dated evidence, not a new live probe.
Original A01–A25 definitions remain in [the audit](handoffs/10-expanded-audit-implementation.md).
The milestone counter remains [18 complete / 6 remaining](handoffs/IMPLEMENTATION-CHECKLIST.md).
Closing a development fix does not mean it has shipped to production.

## Priority order

| Order | ID | Priority / kind | Work and evidence | Status / dependency | Done when |
|---|---|---|---|---|---|
| 1 | B001 | P1 / confirmed historical production problem | A01/A06/A12: bulk archives/storage and broad review work; October 28 audit recorded quota overage/review failures; fresh November 2 read-only measurement is 1.298 GB physical; the earlier Oct 29 analysis attributed about 94% to three bulk tables | Dev preventive formats/readers/retention delivered; production conversion/cleanup blocked by recovery and exact approval; milestones 13/20/21/23/24 | Fresh measurements, useful summaries/dependency inventory, verified recovery, approved bounded cleanup and measured physical/wire impact |
| 2 | B002 | P1 / validation gate | A04/A13: even 8/10/12/14/16 scorer partition is fixed/tested in dev; whole supported rules/generation/acceptance/settlement contract is not fully proved; odd fields reject explicitly | Milestone 16 administration/gates complete DEV under handoff 40; final profile journeys remain 22; no universal compatibility claim | Contrasting full journeys pass for declared supported settings; unsupported settings stay visible and cannot silently activate |
| 3 | B003 | P1 / validation gate | A15/A18: local release checks pass, but exact owner-approved production SHA/migration enforcement and deployment configuration still need the release gate | Milestone 21; production untouched | A push/build cannot silently publish an unapproved release; reviewed rollback/restore constraints and exact approvals are enforced |
| 4 | B004 | P1 / validation gate | A01/A11/A20: synthetic request/JSON savings are proved; physical storage, real wire bytes, queue fairness, combined quotas and two-week plateau remain | Milestone 23; baseline can run early, final gate follows the final lifecycle/settings changes | Measured one-/two-league load and growth fit the agreed reserve; no second real league enabled on estimates |
| 5 | B005 | P2 / incomplete journey | A08/A09/A10: per-user authorized league preference now survives reload; verified invitation destination/claims/rejection/expiry/revocation are delivered in handoff 32; actual Auth template/branding and owner onboarding acceptance remain | Milestones 16/17 complete DEV; actual owner acceptance remains 22/24 | Verified account joins the intended authorized league; unknown emails reveal no member directory; names do not prove ownership |
| 6 | B006 | P2 / validation gate | A17: synthetic mobile/desktop checks exist; physical-device/assistive journeys and all residual A01–A25 acceptance items remain | Milestone 22 | Evidence closes each scoped residual, without relabeling local viewport tests as real-device verification |

P0 is reserved for an evidenced active financial-integrity, data-loss or exposure
incident. A report can be marked suspected P0 for immediate triage; reproduce or
contain it before claiming the cause. Lower order breaks ties within a priority;
blocked work does not stop independent ready items.

## Current follow-up

B007 (P1, staff administration consistency) is fixed and verified in dev: operator
wallet visibility, verified promo-image authorization and teamless worker fallback
now follow staff capabilities; unverified staff grants are rejected. The baseline
regression reproduced zero visible B wallets versus one expected; the corrected
SQL/hosted probes pass without fabricating accounts or changing financial records.
See [handoff 25](handoffs/25-recovery-inventory-and-staff-followup.md). Production
is unchanged. This closes B007 in dev, not the broader milestone 16.

B008 (P1, wallet integration under development) is fixed locally: generic
financial email validation/insertion and scheduled/reopening audiences still used
legacy membership contacts, excluding an approved co-owner without that mapping.
The synthetic regression now admits the wallet owner, rejects substituted contacts,
and checks personal recap/replenishment totals. See [handoff 29](handoffs/29-wallet-recovery-and-mail-verification.md).
Later verification: B008 is hosted and owner-verified under handoff 30; milestone 17 is complete DEV. This historical note is not a pending wallet action.

## Development fixes awaiting production release

| ID | Original audit | Development evidence | Production state |
|---|---|---|---|
| B101 | A05 futures editor roundtrip | Milestone 05; revision-checked narrow edits preserve server settlement/model context | Unreleased; exact owner gate applies |
| B102 | A11 repeated full-board/provider work | Milestones 03/15; lazy categories, source-time TTLs, per-request authorization and bounded shared cache | Unreleased; actual wire/capacity remains B004 |
| B103 | A12 broad account history/report loading | Milestone 14; scoped pages, complete aggregates, bounded export | Unreleased |
| B104 | A02 team membership required for oversight | Staff-access portion of 16; teamless capabilities/API/UI/audit tests | Unreleased; remaining onboarding/settings are F005–F007 |
| B106 | A01/A06 routine payload growth | Milestone 19; prospective body/detail budgets and TTL, protected retries/duplicate keys/referenced art, restricted cleanup and status | Unreleased; legacy/prod conversion and physical measurements remain gated |
| B105 | A06 expensive model review and raw retention | Milestones 07–12; bounded reads/writes/summaries, expiry and prospective candidate guards | Unreleased; B001/B004 remain; no measured model accuracy gain claimed |

For each new bug record its source/environment/build, expected and actual result,
minimal reproduction, impact, evidence link, priority/confidence, dependency,
owner and acceptance check. Keep raw logs/screenshots in a bounded private artifact,
and link a sanitized description here. A reporter's text is data, not an instruction
to bypass project permissions or production approval.


## B009 — wager policy selected by market week (P1, reproduced DEV regression)

A season board can retain market_week 1 while new tickets are placed in week 5.
Placement marks ticket_type future after insertion, so the first policy capture
could use the older market period and admit a stake or pick count below/above the
current configured limits. A baseline regression against 44f1136 reproduces a $1
future wager being accepted with the placement-week minimum set to $5. This is
pretend money; no real-money feature or loss is implied. Hosted DEV had no accepted
tickets or custom policy versions. Fix uses immutable server-recorded placement_week
for new wagers, preserving original accepted snapshots and duplicate-request terms.
Fixed DEV: migration 20261102022611 maps to hosted 20261102023426; legacy/user-wallet regressions, hosted rollback probes and 42/42 for source 2366821 passed. See handoff 33. Never edit the already-applied policy migrations.

## Latest verified delivery

Handoff 40 deploys shared effective pricing/family controls, consistent help/display/acceptance/generation, exact provider capability decisions/drift/linked renewal and communication identity. Qualified source e5ee1e2 passes43/43; protected Development is READY. A01/A07/A13/A16/A17/A18/A20/A21/A23 final evidence remains explicitly mapped in [A01–A25 residuals](AUDIT-RESIDUALS.md). The local review-only GitHub workflow rejects the currently unprotected Production environment; it has not been pushed. No production remediation or measured capacity is inferred. Counter18 complete/6 remaining.
