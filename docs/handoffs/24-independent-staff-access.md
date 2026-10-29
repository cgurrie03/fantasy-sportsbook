# Independent staff access — October 29, 2026

The staff-access portion of milestone 16 is implemented and verified. The whole
milestone remains open for versioned product/rules settings, draft importing,
capability review and verified invitation/team claims. Independent user wallets
remain milestone 17. Stable counter: **14 complete / 10 remaining**.

## Delivered contract

- Platform ownership is bound to a verified Auth user independently of any team
  membership. Existing protected legacy owner designations can migrate; an
  arbitrary commissioner, invite, team name or admin claim cannot appoint an owner.
- Only the database bootstrap path writes owner bindings. Unverified identities
  are rejected; deleting the last owner or silently changing its user ID is
  rejected. Auth deletion is restricted while an ownership reference exists.
- Owner-issued, league-scoped viewer/operator grants have a revision, reason,
  actor and append-only audit. Grant changes use an expected revision and a
  per-league lock; revocation affects the next server/database request. At most
  128 historical staff identities per league are admitted.
- View, administer, configure and bet are separate capabilities. Staff can view
  their authorized leagues; operators can use league operations. Only the
  platform owner changes identity, schedules, activation, model-control policy
  or approved account mappings. Betting still resolves a real participant
  membership and wallet; staff access never creates either.
- API generation, reopening, result refresh and weekly execution use fresh
  database capabilities instead of requiring a participant admin row. Worker
  service authorization and existing participant-based recipient/replenishment
  selection remain; a staff grant adds no team email recipient or credit target.
- Account loading adds a bounded access directory (128 entries / 32 KiB) within
  the existing 512 KiB combined directory budget. Teamless staff have an overview
  and appropriate admin tools, without a phantom balance, My Bets, Account or
  bet slip. Owner-only controls are disabled for operators/viewers.
- The selected league survives reload under a per-user preference, validated
  against the fresh authorized directory. A preference never grants access.
  Rendering also binds account data/capabilities to the current authenticated
  identity while bootstrap/history request fences remain in place.

The new private audit trigger has no callable anonymous/authenticated/service
EXECUTE grant. It appends only staff-grant audit records with the actual actor;
client roles cannot fabricate, edit or delete those audit rows. No new public
security-definer API was added. Existing private authorization helpers retain
their lookup boundary; configuration entry points receive owner checks while
preserving their validated bodies and newer model-promotion gates.

## Verification and database delivery

- Full release suite: **36/36 passed**, including the added staff SQL/browser
  tests and existing account, financial, model, market and worker checks.
- Phone/desktop intercepted tests: participant in A + teamless staff in B;
  viewer/operator separation; owner-only settings; reload selection; no phantom
  wallet/betting controls; actual participant balance/access preserved.
- SQL: verified owner bootstrap/last-owner protection, foreign denial, real
  participant-versus-staff distinction, visible unclaimed fantasy teams,
  rejected staff betting, owner-only changes, version conflicts, revocation,
  immutable audit, no fabricated memberships/wallets.
- Local CLI migration `20261029200917_independent_staff_capabilities.sql` maps
  to hosted development `20261029233224_independent_staff_capabilities`.
- Dev marker/project/origin were positively verified. The empty schema had no
  legacy owner designation, so a separate guarded data transaction bound the
  already confirmed independent development owner. It checked the known Auth
  identity, verified email, existing trusted admin mapping and absence of an
  unexpected owner. Exactly one owner is bound; no other identity was granted staff.
- Hosted rollback-only probes temporarily removed the owner's B participant
  mapping to verify teamless administration/configuration with betting false;
  exercised grant/revoke/audit; denied an unmapped identity. All temporary
  membership/grant/audit changes rolled back. Staff/audit tables contain zero rows.
- The wallet/ticket/ledger/adjustment byte hash remains
  `c8c75ef205dedfa6ee3271b7fbb5b11d` before and after the hosted changes/probe.
- Security advisors remain 37 authenticated-definer, two anonymous-definer,
  one Auth password WARN and 11 intentional RLS-without-policy INFO findings.
  This is not a clean-security-audit claim.

## Remaining scope and rollout boundaries

This completes the current staff-access work unit, not all of milestone 16.
Versioned house/provider rules, a reusable draft importer, capability approval,
invitation/request states and owner-approved team/co-owner claims remain. Final
co-owner admission depends on the per-user financial migration in milestone 17.
No new league was activated, no public signup was enabled, and no user-facing
support/automatic error collector was deployed. Production remains unchanged.

The new Markdown bug queue/feature roadmap are a proposed internal tracking
workflow. They do not create an application queue, public GitHub issues, paid
service, scheduled run or automatic ingestion of reports.
