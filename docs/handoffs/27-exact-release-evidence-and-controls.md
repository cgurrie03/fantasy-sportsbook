# Exact release evidence and publication controls

F002 / milestone 21 is in progress, not complete. Counter stays **15 complete /
9 remaining**. No production configuration, application, schema or GitHub push has
been performed. The protected dev runtime remains source `01edd29` / deployment
`dpl_3aXS7fchnfnrrMQCXXY8tJXFwsLf` from handoff 26. Owner password-manager import
was confirmed; independent restore and full-platform recovery remain open.

## Implemented local/CI evidence

`npm run test:release` now captures the starting and ending clean Git commit/tree,
the ordered immutable migration blob IDs, the exact required suite plan, result
digest and timestamps. The new suite exercises clean passing evidence and rejects
dirty/untracked files, changed commits/migrations, missing/duplicate/failed or
tampered results, a changed suite plan and stale/future-dated evidence. A run
started or finished dirty cannot qualify as a release check even if its tests pass.

The report is `work/release-checks/provenance.json`; the existing JSON results and
bounded diagnostic logs remain. A run writes invalid provenance before starting,
so an interrupted run cannot leave the previous successful receipt looking fresh.
The child test environment removes deployment/database/mail credentials and hosting
flags. CI has read-only repository permissions, no deploy step, no persisted Git
checkout credential, pinned action commit IDs and seven-day artifacts. Action SHAs
were checked against official public GitHub tag refs before pinning.

After a complete passing run, `npm run release:review` verifies evidence for the
current clean source (maximum age seven days) and exclusively creates
`work/release-reviews/<sha>/manifest.json`. It binds test and migration identities
to the fixed production project/origin, with **unapproved** status, no owner
approval, and all recovery/capacity/audit/migration/rollback/publication gates false.
Any later tracked change, including documentation, requires a new tested commit.
Do not amend a hosted migration to make its hash match a review.

These are reproducible local/CI records, not cryptographic remote attestations.
An administrator can forge local files or change the repository; an external
owner-controlled deployment boundary must enforce who can publish. The generator
does not deploy, promote, run a migration, upload evidence or grant approval.

## Automatic Git publication proposal

The connected Vercel inventory confirms production project
`prj_xQNaH7f1SPr8bgn2GV92a9MODQu8` is linked to
`cgurrie03/fantasy-sportsbook`. The read-only project summary omits branch/hook/
publication controls; absence of those fields does not prove they are disabled.

The implementation source sets `git.deploymentEnabled: false` in `vercel.json`.
This is a proposed default for future Git source, not proof that the live project
or current main branch has changed. No push is allowed while the current automatic
production route remains unverified. Filtered, explicitly targeted dev uploads
remain the existing manual path.

The simplest immediate containment is an owner-reviewed disconnection of this
production project's Git link. Exact owner action, if approved: open
[production Git settings](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/settings/git),
confirm the project is **fantasy-sportsbook** and the repository is
**cgurrie03/fantasy-sportsbook**, then select **Disconnect** under Connected Git
Repository. This is a production configuration change and requires owner action;
the available connector exposes no Git-disconnect operation. Do not delete the
project, repository, domains or running deployment. Do not reconnect until the
owner-controlled release path is configured and verified.

Disconnection removes one publication route. It does not by itself prove absence
of deploy hooks, CI tokens, direct API/CLI access or owner-admin bypasses. Inspect
these routes and actual account controls before closing milestone 21. No shared
deployment token is to be placed in an unprotected repository job or sent in chat.

## Remaining exact-release acceptance

1. Owner confirms and connector verifies Git publication containment; inventory
   deploy hooks and other release credentials/actors without retrieving secrets.
2. Use an owner-reviewed release action for an exact SHA/migration set, with a
   protected approval boundary. For this public repository, GitHub documents
   environment required reviewers as available on Free; actual permissions and
   configuration still need verification. A sole owner's workflow must not enable
   prevention of self-review if that would make every owner dispatch unapprovable.
3. Required recovery/capacity/audit and rollback evidence must be reviewed before
   any production release. CI success is not policy approval. Stage a fresh
   production-configured build of the approved source; do not publish a dev build
   containing its development database URL. Verify source/target/schema compatibility
   and read-only health before a separately approved final domain promotion.
4. Record the owner approval and deployed source, then verify postflight without
   real bets or bulk mail. Application rollback cannot undo destructive SQL.

No production staging/promotion, credential creation, paid feature, support feature,
experimental market acceptance or scheduler activation is authorized by this file.

## Sources checked October 29, 2026

- [Vercel Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel Git settings / disconnect](https://vercel.com/docs/project-configuration/git-settings)
- [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub environment administration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
