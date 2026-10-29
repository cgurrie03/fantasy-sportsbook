Current continuation: [handoff 20](20-summary-retention-and-frozen-candidates.md) records compact summary retention and prospective candidate integration in development. The 2 a.m. scheduled run was canceled on October 29. The remaining historical notes below describe earlier checkpoints.

# Current handoff status — October 28, 2026

## Implementation continuation — October 28

See [13-implementation-checkpoint.md](13-implementation-checkpoint.md) for the implementation branch, verification and hosted gates. Development now has a reviewed schema-only baseline, migrations 055–059, explicit API privileges and small synthetic fixtures. No production application/database release or support deployment has occurred. The original dirty checkout is preserved.

The protected development application is now deployed. See [14-hosted-development-checkpoint.md](14-hosted-development-checkpoint.md) for the hosting checkpoint and successful owner sign-in verification. The full handoff is still in progress.

Owner sign-in and both synthetic leagues are verified. The next unit adds a
tested encrypted financial recovery checkpoint and narrower worker review reads;
see [15-recovery-and-review-reads.md](15-recovery-and-review-reads.md). Raw archive
writes and full-platform recovery remain open; no production cleanup occurred.

The next development unit replaces raw model-evaluation refresh writes with
bounded opening/latest-pregame numeric evidence and adds an explicit as-of
Sleeper benchmark. See [16-compact-model-predictions.md](16-compact-model-predictions.md).
Published-board archives, compact summaries and expiry remain unfinished; no
production storage reduction or complete prospective learning controller is claimed.

Handoff [17-compact-publication-records.md](17-compact-publication-records.md)
also replaces new full published archives with bounded report horizons in dev.
Handoff [18-compact-live-evaluation.md](18-compact-live-evaluation.md) also bounds
experimental live evidence. The stable [implementation counter](IMPLEMENTATION-CHECKLIST.md)
is 10 complete / 14 remaining; this counts scoped development milestones, not
production rollout. Compact summaries/expiry and compatible candidate evaluation
are next; production release and historical cleanup still require exact approval.

New explicit owner decision: **each approved user has their own wallet, including co-owners of the same fantasy team.** Wallets remain separate between leagues. This supersedes the unresolved shared-team-wallet question below. The existing team-keyed financial schema has not yet been migrated; do not represent the legacy wallet tests as verification of independent user wallets.

Prior chat confirmed the current acceptance lifecycle is Wednesday–Thursday plus explicitly approved reopenings. Handoff 12's Monday-close example is conditional, not a change to acceptance rules.

**Ready for implementation handoff. Not a declaration that development hosting, efficiency fixes or second-league launch are complete.** This file and handoffs 08–12 take precedence over dated rollout instructions in the original handoffs.

## What the next developer receives

- A dated production audit with 17 original findings and expanded directions for A01–A25, including clearly labeled additional investigations and the notification revamp.
- Storage/egress measurements, code evidence, synthetic reproductions and test results. These are not a two-league production load test or an exhaustive penetration test.
- Confirmed product decisions, a temporary-data retention contract, capacity targets and measurable acceptance gates.
- An isolated-development architecture/release plan, local environment preflight/tests, and a detailed support specification that must remain undeployed.
- A verified owner-created Supabase development project and local development branch.

## Repository and infrastructure checkpoint

Repository: `cgurrie03/fantasy-sportsbook`; local checkout `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`. Last application baseline verified in this audit: `d1ea6c98d200326156aef76f8a8a6318b743f897`. Active checkout branch is `codex/sportsbook-reopening-audit-review`; local `development` points to that baseline. It has not been pushed. Do not switch/reset the dirty checkout without preserving its unrelated changes.

Production Supabase reference: `bmvjcdgxwxqalaohpsnw`. Development: `whlcnlacueweaqpsupqs`, `fantasy-sportsbook-dev`, verified Healthy/Free/Nano, us-east-1. These must never be interchanged. No second GitHub repository is required. Supabase GitHub integration is optional and remains disconnected until a safe migration path exists.

New handoffs and standalone preflight scripts are local/uncommitted. Other pre-existing dirty documents/work files are present. Do not assume the new handoff or development branch is available from a fresh GitHub clone. Use the supplied handoff bundle or the current local checkout; later commit only reviewed intended changes. No support feature or production optimization has been deployed by this handoff work.

## Required implementation work, in order

1. **Recheck current state and establish recovery.** Inspect latest remote/deployment and schema, reconcile migration tracking, confirm export/restore coverage. Do not replay old seed/import migrations into either live environment.
2. **Finish isolated development.** Reviewed clean schema and small synthetic two-league fixtures, independent auth/mail, runtime environment guards, branch-scoped Preview variables, owner-only protected dev hostname and enforced owner approval for production. Offline preflight flags alone do not enforce runtime safety. Keep optional continuous dev cron off to protect shared usage.
3. **Address Supabase first.** Stop permanent full refresh/model archives; expire temporary payloads; replace reports with compact samples/summaries; fetch only changed boards; bound history/model-review reads. Test new writes/readers before historical conversion/removal. Measure physical size separately from deleted rows, and include dev traffic in shared egress.
4. **Build multi-league foundations.** Staff without a fantasy team, versioned default policy/league overrides, owner-led settings importer/capabilities, commissioner-distributed signup, approved team claims and stable authorized league switching. Teams must appear even without registered managers.
5. **Resolve product blockers and verify operation.** Generic specials, futures editing, consistent help/rules, CI coverage, queue fairness and negative tenant tests. Test active-game peaks, missed jobs, duplicate execution, provider outages and season changes in dev. Document supported and unsupported league settings truthfully.
   Revamp all notifications using handoff 12: actual-window schedule, no obsolete Thursday closing reminder under a Monday-close policy, varying season storylines/market spotlights, compact weekly odds references, accurate receipts/credit, preferences and bounded volume. Reconcile old queued messages and historical schedule instructions; do not change betting acceptance rules merely to fit copy.
6. **Review readiness with the owner.** Actual storage plateau/egress forecast, two-league performance, restore drill and exact tested release approval. No second-league activation based solely on a spreadsheet estimate or a healthy empty database.

Support remains specification-only. It is not a dependency for starting the urgent efficiency work and must not be deployed without a later explicit release approval. Existing experimental live betting/teaser limitations remain; do not enable them incidentally.

## Product decisions still needed during implementation

These do not prevent handing off the work, but must not become silent assumptions:

- Co-owner rights: who can claim/access a shared team and whether bettors share the team's wallet.
- Precise policy boundaries and effective times for replenishment, balances, limits and overrides; accepted terms must stay fixed.
- Season rollover: balance carryover/reset, historical league access, changed Sleeper league IDs and changed managers.
- Any league house rule that Sleeper does not expose, especially tiebreak/draft/consolation outcomes. Ask during that league's capability review.
- Which optional features to defer if measured free capacity remains insufficient. Offer further optimization options; no automatic paid upgrade.
- Final product name. BOFF is proposed; no public rename is approved by the audit.

Commissioner signup-link distribution does not grant commissioner configuration rights. Email addresses are collected by verified signup or known approved mappings; the public Sleeper API is not an email source. A team-name selection alone cannot grant membership.

## Release completion evidence

Require: tested SHA/migration set; owner approval; dev/prod target identity; migration/restore/rollback constraints; essential flow and isolation results; measured usage impact; deployed version and read-only postflight. Report every incomplete gate explicitly. Passing the standalone preflight does not prove hosted isolation or production readiness.

## Start prompt

```text
Continue the fantasy sportsbook implementation in C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook. Read docs/handoffs/00-current-handoff-status.md, PROJECT-CONTEXT.md and handoffs 08–12 before changing anything. Preserve unrelated dirty files and inspect the latest remote/deployment. Finish isolated owner-only development and recoverable schema, then prioritize Supabase temporary retention, bandwidth and bounded reads before new features or a second league. Implement the expanded findings and all-notification revamp in dev, including actual-window scheduling and evolving factual season storylines with tiny weekly odds references. Use the existing repository; the dev Supabase project exists and local development branch is unpushed. Do not point dev at production, replay historical seeds, delete accepted financial records, upgrade paid services, enable experimental betting or deploy support. Every production release requires owner approval for its exact tested source/migrations. Update evidence and handoffs after each verified milestone.
```
