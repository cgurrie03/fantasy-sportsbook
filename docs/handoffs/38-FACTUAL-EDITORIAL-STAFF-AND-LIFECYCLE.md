# Notification stages 4-6: factual editions, staff alerts and lifecycle

November 2, 2026. Implementation checkpoint; qualification and hosted rollout
receipts will be appended after verification. The prior deployed source remains
f7750bd until that rollout is recorded. Overall 16 complete / 8 remaining pending
qualification of milestone 18.

## Implemented behavior

- Opening editions select at most three diverse factual stories from published
  forecasts, matchup comparisons and saved championship base prices. Deterministic
  ranking penalizes repeated topics from the immediately preceding comparable
  week. No inferred injuries, streaks, elimination or draft rules. Missing forecasts
  remain missing. Public team labels do not borrow recipient contact names.
- One current and one previous compact edition per league; each is at most 64 KiB.
  Actual quote evidence, board revision, window key, cohort and season are validated
  in SQL before publication. First writer fixes the shared edition; a same-week
  refresh preserves the previous week. Gaps/season renewal discard comparisons.
- Worker attention paths now queue verified current platform owners, scoped
  operators and explicitly authorized legacy admins. Teamless staff need no wallet.
  Viewers/unconfirmed contacts are excluded. No participant ticket list, raw error,
  provider blob or account balance goes in diagnostic email. The application CTA
  provides the current detailed review behind authorization.
- Staff grouping is bounded to four newly queued alerts per user/league/ET day,
  at least 30 minutes apart with same-job/category/day deduplication. At most 128
  mutable budget rows per league; no per-day budget archive. Context <=512 bytes,
  24-hour useful window, immutable identity, seven-day terminal body retirement.
  Revocation or changed verified email prevents delivery even for frozen messages.
- Recaps use the exact weekly replenishment event, including delayed credits older
  than 24 hours. Unknown review, pending funds/results and a confirmed zero top-up
  have different copy. A frozen recap cannot silently adopt changed credit facts.
- Final week 18 recap requires the current NFL season's final week-18 result cache
  and notification calendar week 19. A single season-keyed expiring job queues
  content week 18. No financial week 19, acceptance-window change or new cash reset.
  Expired weekly promotions/watch/recaps cannot persist into the closed calendar.
- Template samples remain illustrative. A separate explicit read-only availability
  check shows actual current policy/phase/due/deadline, including disabled DEV.
  It creates no outbox row or budget credit and invents no recipient/event.
- Delivery revalidates current recipient authorization after composition, validates
  frozen sender and action URL against current league configuration, and rechecks
  routine admission immediately before capture/provider. Essential receipts retain
  accepted facts, idempotency and independence from editorial preferences/caps.

## Verification and capacity boundaries

Focused local tests cover 8/10-team consecutive editorial weeks through 18,
missing projections, byte limits, tampered evidence, concurrent-edition semantics,
season reset, staff revocation/viewer/unconfirmed exclusion/dedup/caps, exact credit
and tenant/week isolation, phase 19 final recap/phase 20 expiry, new NFL season,
phone/desktop availability/sample flows, dispatch authorization, sender/URL mismatch
and existing delayed/retry/window/lease guards. All data and providers intercepted.

Editorial documents consume <=128 KiB JSON per league, plus row/index overhead.
Staff budgets consume <=128 small mutable rows per league, plus bounded outbox
metadata/bodies subject to existing retention. These are logical admission limits,
not measured physical/wire or shared-quota capacity claims. M23 owns actual shared
measurements and the real two-week plateau; no production/bulk mail is authorized.

Local migrations: 20261102202956, 20261102210218, 20261102212622. No hosted mapping
or deployment is claimed at this implementation checkpoint. DEV remains stopped,
capture-only and protected. Production, public Git and owner key custody unchanged.

## Qualified and deployed closeout

**Milestone 18 complete DEV; 17 complete / 7 remaining.** Clean source
40f19c14473957f9ab0fde8f3323035ba42c7d65 passed **43/43** suites in 241.511 seconds.
The initial 8b58806 regression run failed three fixture/dependency checks and is
not release evidence. Corrected retention, isolation and Monday module fixtures
are part of the qualified source. No new lint warning was retained.

Hosted immutable DEV mappings: 20261102202956 -> **20261102214048**;
20261102210218 -> **20261102214053**; 20261102212622 -> **20261102214057**.
Actual stopped-DEV rollback probes passed for staff binding/dedup, scoped previews,
pending funding facts, retention and private/service-only ACLs. Two pending wallets,
zero entries/tickets/emails/new editorial or staff budget rows after rollback;
operations/automation off. Same explicitly defined five-table financial digest
before/after: **a934b2e187fa6f5ae0e8cd77b0507451**. The JSON-key definition differs
from older digest receipts; compare like definitions only.

Advisor review: 66 authenticated-definer WARN (+1 operator-gated read-only preview),
2 anon-definer WARN unchanged, 1 Auth WARN unchanged, 20 no-policy INFO (+2 private
RLS tables with no direct client/service grants). Prior metadata unchanged.

READY protected Preview **dpl_5E3QL1ZukVvEZgaAm13rYuCBoR8i** is on all three DEV
aliases. Hosted guard/API checks passed and full build logs contain no TS errors.
All four signed-out DEV URLs redirect 302 to Vercel SSO; all-deployment protection
remains enabled. Production canonical remains **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ**.
No production write, GitHub push, real mail or automation activation.

M23 progress only: read-only physical baseline at 21:37 UTC, DEV database
17,520,307 bytes / production 1,297,790,643 bytes. DEV after migrations and rollback
probes 17,708,723 bytes at 21:41 UTC. Sizes include internal/allocated/index/TOAST
pages; no free-capacity/wire/plateau conclusion. Real quotas, combined load/growth
and elapsed plateau remain separate release gates.

Ignored evidence: work/notification-batch-completion-receipt.json,
work/notification-batch-hosted-probe.sql, work/notification-batch-release.log,
work/notification-batch-capacity-baseline.json, release provenance/unapproved review
and phone/desktop editorial sample screenshots. Later documentation-only HEAD is
not the qualified/deployed app source. Current NEXT-SESSION consolidates prior
checkpoints without changing production authorization or deferred recovery custody.
