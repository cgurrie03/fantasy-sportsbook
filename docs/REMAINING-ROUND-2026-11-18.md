# Remaining Round Items — November 18, 2026

November 20 runtime update: steps 1 and 2 now have implemented worker cutover tooling and restored-backup API/browser tests. See `docs/PRODUCTION-RUNTIME-PREPARATION-2026-11-20.md` for completed isolated coverage versus hosted activation/acceptance remaining at the approved cutover. No live changes.

November 20 update: Production schema expansion, person-bound pending credits and legacy futures payout routing are implemented and locally upgrade-tested against the fresh backup. See `docs/PRODUCTION-UPGRADE-REHEARSAL-2026-11-20.md`. Hosted runtime/worker activation, current-board warmup, source freeze/approval and IO/transport acceptance remain; neither live environment was modified.

November 19 migration preparation is recorded in `docs/PRODUCTION-MIGRATION-PREPARATION-2026-11-19.md`. Explicit Production targeting, private source/candidate manifests and a real-data financial staging rehearsal are complete locally. Full application schema upgrade/rehearsal, legacy-future payout routing, Production worker/job replacement and fresh recovery proof remain release blockers. No Production cutover or new Development deployment was performed. The candidate is not deployable yet.

AUD-01 through AUD-09 are implemented on Development. AUD-05 still needs observation at the next natural Tuesday 5 AM Eastern rollover. Manager terminology is now Manager / Primary Manager / Co-Manager.

Terminology deployment: `dpl_9AC4DzCGvSiobcnvBaY9fcTMTFLx`. Build, desktop/mobile intake regression and invitation API tests passed; database role output verified as Manager.

## Audit Fixes Still Open

- AUD-07/AUD-08/AUD-09 completed in `dpl_98Ysxbm63RwL3uewMjDF1kx5UrjC`. See `docs/AUD-07-08-09-DELIVERY-2026-11-18.md` for local/hosted verification.
- AUD-10/AUD-11/AUD-14/AUD-16 completed in `dpl_7F1ZG1xgNALZ7o3SGNdX7gK54bWo`. See `docs/AUD-10-11-14-16-DELIVERY-2026-11-18.md`.
- AUD-12/AUD-13 completed in `dpl_HdbGrYbxcNR4UhHSEqmtT7GtdwCg`: real commissioner activity and persistent private support inbox. See `docs/AUD-12-13-DELIVERY-2026-11-18.md`.
- AUD-15 deferred until member password rollout: evaluate/enable leaked-password protection and retest authentication/recovery before launch. Development already exposes an email/password form; no Auth settings were changed.

## Previously Requested Work And Acceptance

- Final delivered-email tests: six real-data owner messages accepted by Resend. The user subsequently removed brief emails: only the full format remains, with UI/backend compatibility verified. Inbox/device rendering of that full format, links/preferences and normal application sending-log integration remain acceptance work. Controlled test receipts are private; routine Development mail remains capture-only.
- Physical-device push registration/delivery and notification behavior. Manifest/icons, setup guidance and relevant-page destinations added and browser/transport-tested; actual device permission/receipt remains.
- Public branded landing page with finalized pricing tiers/features/refresh rates. Prior draft prices are proposals.
- Full multi-league operation: native league selection, scoped wallets/tickets/standings/settings, independent refresh, activation and owner silent viewing. Intake/discovery is implemented; this broader rollout remains deferred.
- Branding pass implemented on Development `dpl_2UaAviGuvzp6qV5WcmwNiAJEc5Nf`: sign-in/invitation/startup/loading/empty/error/access-denied and missing-page/league states. Desktop/mobile light/dark browser checks passed. Additional user visual findings remain acceptance/polish work; see `docs/BRANDING-DELIVERY-2026-11-18.md`.
- Controlled season-end, futures payout carryover, next-season reset and draft reopening tests; broader season work remains deferred.
- Live-game score/odds/settlement observation, prolonged provider-failure and traffic tests, storage/IO plateau monitoring, and model calibration.
- November 18 refresh/storage/rollover checks passed; outage backoff and cached notification offers deployed. Current 28 MB database and recent successful refreshes are observations, not dashboard IO-budget or sustained-capacity clearance. See `docs/COMMUNICATION-REFRESH-VERIFICATION-2026-11-18.md`.
- In-email league switching: AMP sender registration/compatible inbox testing/activation intentionally deferred. The authenticated web reader exists.
- Incorporate the user's additional mobile findings after the audit.

This list distinguishes missing implementation from external/device/operational acceptance; passing local fixtures is not production acceptance.
