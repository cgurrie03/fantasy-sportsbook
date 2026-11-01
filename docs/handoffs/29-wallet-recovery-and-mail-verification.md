# Wallet recovery and financial mail — November 1, 2026

Milestone 17 / F004 remains in progress. **15 complete / 9 remaining.**
All changes described here are local, with four unapplied wallet migrations.
No hosted writes, wallet activation, real messages or GitHub push occurred.

## Completed

- Versioned financial recovery v2: 32 relations, wallet approvals/mode, staff and
  owner dependencies; only financially referenced Auth identities; UTC canonical
  checksums. v1 and its original off-site package remain compatible and unchanged.
- Disposable restoration checks all 116 FKs in the current synthetic schema,
  ledger/opening conservation, paired transfers, wager/settlement/refund evidence,
  privacy and a duplicate user-wallet refund. Rehashed semantic corruptions fail.
- Two co-owners independently redeem the same boosted and fixed offers. Another
  wallet's request cannot be replayed. Voiding/restoring one user's boost leaves
  the other's claim used; accepted odds, cash and recipients stay wallet-scoped.
- Generic financial mail delivery no longer demands a legacy membership.
  SQL insertion guards independently verify the fresh approved wallet owner.
  Scheduled participant mail and reopening announcements select a bounded fresh
  wallet audience; attention messages retain the existing admin path.
- Compiled API fixtures check pending funding, own recap/profit/replenishment,
  account standing, no peer-open-ticket attribution and no shared-team contact
  fallback. Worker audience selection preserves legacy mode and fails closed on
  RPC errors or wrong-league rows.
- Owner-only `user_finance_cutover_preflight` is read-only and development-only.
  It rejects production identity and reports operations/automation, unresolved
  mail/jobs, approved-account and verification blockers. It exposes pending funds
  and legacy liabilities without moving money or enabling anything. New outbox
  inserts take a league share lock for a future serialized cutover boundary.

The wallet fixture now loads every post-baseline development migration, including
environment identity and captured-mail constraints, rather than skipping the
first five. This adds the capture-table FK to the recovery validation count.

The November 1 full run also exposed a historical import fixture using seven
elapsed days instead of seven Eastern civil days for its week anchor. Correcting
the test's anchor preserves the application's existing DST-aware period policy;
the historical import/balance/replay checks pass again. No production period or
calendar configuration was changed.

## Remaining before hosted acceptance

1. Implement and review the explicit owner-controlled cutover action/UI, including
   concurrency/stale-review fencing. The read-only preflight is not activation.
   Keep manual/captured operations and pending opening funds; no automatic copying.
2. Final exact-source verification, fresh DEV identity/advisory review and
   rollback-only financial/ACL probes, then reviewed inactive DEV migrations and
   filtered protected deployment. Existing hosted source remains `01edd29`.
3. Verify scoped hosted behavior and the intended owner journey before marking
   milestone 17 complete. The account approval/invitation flow remains milestone 16.

Latest exact-source release evidence belongs to the clean SHA recorded in ignored
`work/release-checks/provenance.json`. Inspect its validity/results; never reuse
the previous checkpoint merely because its tests passed. Production approval,
full-platform recovery and measured capacity remain separate gates.
