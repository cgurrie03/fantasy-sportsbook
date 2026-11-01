# Bug and validation queue

Updated November 1, 2026. Canonical local project queue, maintained through chat.
Keep private reports/financial evidence out of this public-repository-ready file.
An observation from the October 28 audit is dated evidence, not a new live probe.
Original A01–A25 definitions remain in [the audit](handoffs/10-expanded-audit-implementation.md).
The milestone counter remains [15 complete / 9 remaining](handoffs/IMPLEMENTATION-CHECKLIST.md).
Closing a development fix does not mean it has shipped to production.

## Priority order

| Order | ID | Priority / kind | Work and evidence | Status / dependency | Done when |
|---|---|---|---|---|---|
| 1 | B001 | P1 / confirmed historical production problem | A01/A06/A12: bulk archives/storage and broad review work; October 28 audit recorded quota overage/review failures; fresh Oct 29 read-only measurement is 1.289 GB physical, with about 94% in the same three bulk tables | Dev preventive formats/readers/retention delivered; production conversion/cleanup blocked by recovery and exact approval; milestones 13/20/21/23/24 | Fresh measurements, useful summaries/dependency inventory, verified recovery, approved bounded cleanup and measured physical/wire impact |
| 2 | B002 | P1 / validation gate | A04/A13: even 8/10/12/14/16 scorer partition is fixed/tested in dev; whole supported rules/generation/acceptance/settlement contract is not fully proved; odd fields reject explicitly | Milestones 16/22; no universal compatibility claim | Contrasting full journeys pass for declared supported settings; unsupported settings stay visible and cannot silently activate |
| 3 | B003 | P1 / validation gate | A15/A18: local release checks pass, but exact owner-approved production SHA/migration enforcement and deployment configuration still need the release gate | Milestone 21; production untouched | A push/build cannot silently publish an unapproved release; reviewed rollback/restore constraints and exact approvals are enforced |
| 4 | B004 | P1 / validation gate | A01/A11/A20: synthetic request/JSON savings are proved; physical storage, real wire bytes, queue fairness, combined quotas and two-week plateau remain | Milestone 23; baseline can run early, final gate follows the final lifecycle/settings changes | Measured one-/two-league load and growth fit the agreed reserve; no second real league enabled on estimates |
| 5 | B005 | P2 / incomplete journey | A08/A09/A10: per-user authorized league preference now survives reload; invitation destination, verified claims, rejection/expiry/revocation and safe auth branding still need the complete onboarding flow | Milestone 16; co-owner approval also depends on 17 | Verified account joins the intended authorized league; unknown emails reveal no member directory; names do not prove ownership |
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
This fix is not hosted yet; milestone 17 remains in progress.

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
