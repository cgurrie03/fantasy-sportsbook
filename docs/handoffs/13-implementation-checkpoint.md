# Implementation checkpoint — October 28, 2026

Work is incomplete. This checkpoint records local implementation and isolated hosted development setup, not production release approval.

## Hosted continuation

- Supabase and Vercel integrations are connected. User completed independent development Auth, closed signup, Preview-only server-key entry and Spaceship DNS setup. Verified development owner UUID: `d320882c-8a06-443b-a2a9-2e29a0d29cdd`.
- Development Vercel project: `prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts`, `fantasy-sportsbook-dev`; SSO protection covers all deployment URLs. Canonical DNS `dev.sportsbook.coopergurrie.com` resolves through the exact Vercel CNAME and reports no misconfiguration. No bypass/share link is used.
- Hosted development database uses a schema-only baseline derived from the 54 historical migrations in a disposable local database. Compared 404 columns, 242 constraints, 34 policies, 32 triggers, one view and 83 functions against the deployed baseline. Reviewed function-body differences were whitespace/comments only, preserving SQL literals. Restored all 41 application tables empty; no production records, auth users or scheduler imported.
- Managed development migration ledger: `20261028200646 reviewed_application_schema_baseline`, `20261028200819 development_environment_identity`, `20261028200821 development_captured_mail`, `20261028200822 revision_aware_board_manifest`, `20261028200823 revision_checked_futures_edits`, `20261028200824 bounded_terminal_refresh_cleanup`, `20261028201203 explicit_application_api_privileges`. Source 055–059 map to those named development migrations. **Do not run root historical migrations with db push against development.**
- Explicit ACL reconciliation removes Supabase's extra default API grants before reapplying intended application grants. Schema restore regression emulates those defaults. Anonymous membership claiming/table reads are denied; authenticated claiming and service-only capture retain intended access. The public environment marker and period helper are intentional anonymous APIs.
- Development fixtures contain separate synthetic 8/10-team leagues, owner admin/member role differences, null balances, disabled operations and disabled automation. They are repeatable and refuse a non-development marker. They still exercise the legacy team-wallet schema, not the outstanding independent-user-wallet requirement.
- Development builds verify the database marker, independent confirmed owner and closed signup using the supplied server key; secrets are never logged. UI identifies Development and source SHA. Live email provider credentials are absent; mail capture/manual worker mode are enforced.
- Production database remains read-only. Production Vercel's existing Supabase public variables were restricted to Production scope so future previews cannot inherit them; no production rebuild occurred.
- Vercel reports the existing GitHub repository as public, contrary to the handoff description. Owner explicitly confirmed it should stay public. Development deployment uses filtered application/build files in the protected project; handoff documents and local artifacts are excluded from that upload. No source push has occurred.
- Dependencies updated to DOMPurify 3.4.17 and Vite 8.3.5; npm audit reports zero vulnerabilities. Added local schema-dump tooling. A full financial backup/restore drill, measured production savings and remaining product work are still open.

## Source and boundaries

- Starting application and remote main: `d1ea6c98d200326156aef76f8a8a6318b743f897`, rechecked with `git ls-remote`.
- Implementation branch: `codex/boff-handoff-implementation`.
- Separate working checkout: `C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook`.
- Original checkout and its unrelated uncommitted documents, data and work remain untouched. The managed-worktree tool could not attach that source directory to this chat, so the separate checkout was created with Git's native worktree command.
- No push, production deployment/database mutation, real bet, test campaign, paid service, support implementation or experimental betting activation. Development migrations and synthetic setup are recorded above.
- At the owner's direction, provider setup information was recovered from prior chats; do not operate their desktop/browser.

## Confirmed decisions recovered or added

Prior chat “Remove incomplete lineup bet lock” confirms: one repository; owner-only development with independent test identities/data; approval for every production release; Cooper configures leagues; commissioner distributes signup link; verified users request approved team mapping; teams exist before signup; receipt/status support without conversations; support remains undeployed.

New explicit decision in “Complete handoff instructions”: **each user gets their own wallet even when co-owning the same team**. This means one bettor account/wallet per approved user per league, with fantasy team association separate from bettor identity. Historical team wallets, accepted tickets and pending credits must remain attributable to their existing bettor. Do not duplicate an existing balance into new co-owner wallets or merge accepted positions. A new co-owner requires an explicitly approved opening balance. The financial migration and corresponding acceptance/refund/replenishment/promo/mail/RLS/UI work remain open; the current financial regression suites still test the legacy team-wallet model.

The prior chat explicitly states the current schedule is Wednesday–Thursday plus approved reopenings. Monday-close notification rules apply only to a league/window whose authoritative acceptance policy actually has that deadline. No acceptance policy was changed.

## Implemented locally

### Environment isolation foundation (partial A18)

- `api/_lib/environment-policy.ts` pins dev/prod project/origin identities. Missing environment, wrong deployment scope, mixed frontend/server URL, unsafe development mail/automation and legacy JWT project mismatches fail closed.
- All eight Supabase-using server entry points use `createServerClient` rather than constructing clients directly. It verifies the independent database marker before returning a client; dev user clients must authenticate as the configured independent dev owner. The local synthetic-test path refuses hosted deployments and real Supabase targets.
- Migration **055** adds a private singleton environment marker and a public non-secret identity RPC. It deliberately inserts no marker row. Schema installation and operator verification must precede setting its identity.
- Browser client checks build/runtime origin and project identity, verifies the DB marker before requests, namespaces its auth storage and limits development OTP requests to the configured owner. App session handling rejects another dev identity. These application checks do not replace hosted protection, auth configuration or RLS verification.
- Vite build checks frontend/server agreement and rejects exposed server-secret variable names. `docs/development.env.example` and the preflight now include owner and browser settings.
- Development workers require the independent worker secret plus `x-boff-manual-run: true`. Their internal generation/execution requests retain that marker. No cron was enabled.

### Central captured development mail (partial A18)

- `deliverEmails` resolves the environment at its central send boundary. Dev uses `capture_development_email`, never Resend. Production delivery requires explicit mode and the production identity.
- Migration **056** adds terminal `captured` status and a private capture table. A service-only RPC verifies the dev marker, outbox claim and exact recipient; capture and terminal state commit together. Retries do not duplicate a capture, and captured messages are never labeled sent or assigned a provider delivery ID.
- Captures are capped at 20 records of at most 128 KiB JSON each. Rows older than seven days are removed when capture maintenance runs. With dev cron intentionally off, physical expiry while idle is not guaranteed; no unbounded accumulation is possible. Hosted periodic maintenance and preview access remain open. Auth-provider emails need their own independent configuration.

### Revision-aware member boards (partial A11)

- Migration **057** adds an authorized tiny manifest that reads board metadata and period, without loading quote payloads. Board content versions invalidate on actual insert/update/delete statements, including resolutions that do not increment acceptance revision.
- `src/lib/board-cache.ts` deduplicates concurrent requests, retains at most four leagues for the active account, checks manifest authorization on every access and downloads quote bodies only after a changed board/revision/content version. Availability metadata updates independently. Errors/revocation discard cached bodies; account change and signout clear them.
- Sportsbook polling uses that path; its existing hidden-tab pause/resume is retained. Starter polling now also pauses in hidden tabs and checks immediately on visibility return. Server-authoritative wager checks remain intact.
- This still loads weekly and future categories together initially. Lazy categories, cross-viewer provider coalescing, hosted wire-byte/query measurements and broader history/report reductions remain open.

### Other concrete fixes

- A04 partial: scorer fields support even 8/10/12/14/16-team sets, partition deterministically without overlap and reject invalid probabilities. Odd fields require a reviewed policy. Generation no longer truncates 14/16-team fields to six. This is not proof that every league rule or full-market/settlement configuration is supported.
- A05: migration **058** provides a narrow existing-futures price/status RPC. It preserves server-owned settlement/model metadata, validates scope/prices/duplicate edits and fences stale revisions. A separate revision-checked full-generation RPC handles recalculation. The editor uses these instead of saving the compact member DTO as a complete board.
- A08 partial: delayed core/history responses preserve a still-authorized selected league instead of assigning the first league again. Broader history pagination, stable deep links and account-refresh race coverage remain open.
- A01 partial: migration **059** cleans only completed terminal refresh payloads beyond a one-hour recovery window, with batches of 5 cycles (hard maximum 25), cycle locks/skip-locked behavior, retryable-job exclusion and a compact private cleanup heartbeat. It preserves cycle/job identifiers and all financial records. Late payload writes synchronize with the cycle lock and reject finished cycles. The old unbounded age-only deletion of active source data is removed. Worker maintenance errors do not intentionally block settlement. Historical deletion is not authorized before restoration evidence and exact release approval.
- A15 partial: repaired the Monday harness's missing dependency compilation and eight-template expectation. Added `npm run test:release` and expanded CI coverage to environment/cache/cleanup, isolation, model, promo, receipt and teaser checks. Logs are bounded and CI retention is seven days. CI does not grant release approval.
- `.gitattributes` preserves LF for SQL files because migration anchors depend on it. Existing migration contents must remain byte-identical to Git HEAD; no historical SQL semantics were changed.

## Verification

Run `npm run test:release`. This builds intercepted browser fixtures, not a deployable environment. The fixture build uses a synthetic key and dev identity, never a production project/key. All browser network traffic is intercepted. The standalone environment checks reject 26 unsafe configurations.

The expanded release command passed **34/34 suites locally**. Detailed outcomes are in `work/release-checks/results.json`. Final review then added independent weekly/future failure handling, a direct no-provider test at the central mail boundary, and UUID-normalized duplicate/season guards for futures edits. A final fixture build/API-runtime check, board-cache suite, full UI fixture suite, lint and futures-edit SQL test were rerun for those changes. Targeted tests cover wrong targets/keys/markers, owner/worker isolation, actual PostgreSQL capture/retention behavior, unchanged polling, content invalidation, revoked access, concurrent client deduplication, stale futures edits and legacy transaction regression. Lint passes with existing repository warnings.

Hosted schema comparison and schema-only clean restore are complete. A financial export/restore drill, physical-storage reclamation, real wire-byte measurement, concurrent Postgres session load test, physical-device test, two-week plateau and second-league launch remain open. Synthetic payload counts do not prove billed bandwidth savings. Historical SQL replay runs only in disposable local tests; `supabase/development/baseline-schema.sql` is the seed-free hosted artifact.

## Required next work and blockers

1. Integration access, schema-only installation, independent Auth and protected development configuration are established; complete hosted build and owner sign-in verification. Never request server keys in chat.
2. Establish secure financial export/restore coverage and enforce exact production release approval. Never apply the old seed/import migration sequence to either hosted environment.
3. Verify canonical development alias protection and complete authenticated browser/API checks without operating the owner's desktop. Runtime checks alone do not make every release gate complete.
4. Finish the main storage fix: replace permanent raw model/forecast/live archives and their readers with bounded fixed-horizon samples and summaries; checkpoint model reviews; implement byte/row budgets and retention across every temporary store. No default archive writes were removed yet, because readers and evaluation contracts must move together. Do not report Supabase overages resolved.
5. Complete account/history/report bounded reads and provider/cache/work-queue measurements.
6. Implement independent bettor wallets, staff-only oversight, owner-led imports/capabilities, typed versioned policy overrides, signup claims and complete authorized league switching.
7. Implement notification inventory, actual-window scheduling, preferences/volume, accurate receipts/credit and factual evolving storylines with compact weekly references. No notification schedule/template revamp is deployed by this checkpoint.
8. Keep support specification-only until its development workstream is explicitly started; never deploy it incidentally. Keep ordinary experimental live betting/teasers disabled. Resolve season carryover/house rules/final name when their implementation needs those decisions.
9. Meet measured capacity, restore, isolation and performance gates, then request exact tested SHA/migration approval before any production release.

## Rollout and rollback constraints

Migrations 055–059 are applied only in development with the managed ledger mapping above; production adoption remains subject to exact approval. The client/API changes depend on those RPCs, so deploy neither half alone. Production needs an explicit verified production marker and required environment variables before switching to guarded runtime code. Do not promote a dev-built bundle with its compiled dev URL to production; rebuild approved source with production configuration.

The new columns/functions/captured statuses are additive. A pre-change app must not claim a captured development email was sent. Once cleanup removes payloads, app rollback cannot recreate them; prove restore coverage and reader independence first. Do not remove accepted-ticket support or restore an app that drops settlement identities. No branch push is appropriate until preview configuration and privacy are verified.
