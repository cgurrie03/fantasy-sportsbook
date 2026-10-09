# Sportsbook audit and proposed release — 9 October 2026

Status: implemented locally; production migration and application deployment await explicit user approval. No second league enabled, live bets placed, bulk test emails sent, or paid services added.

## Findings and changes

Severity is impact, not proof of exploitation. Paths and lines refer to the reviewed working tree.

| Severity | File / line | Evidence and disposition |
| --- | --- | --- |
| High | api/_lib/league-communications.ts:15; api/_lib/mail.ts:461 | Cached outbound payloads needed final membership, team, ticket and recipient checks. Delivery now checks the exact approved recipient and forbids cc/bcc. Immediate bet confirmation claims only its ticket rather than unrelated queued deliveries. Runtime fixture tests cover retries and payload preservation. |
| High | supabase/migrations/202610090030_league_isolation.sql:12 | Separate foreign keys did not enforce all multi-column league relationships. Added composite ticket/team/league, forecast/board, cycle/board and job/cycle constraints; market team and report JSON guards. Deliberate cross-league inserts fail in the in-memory database suite. |
| High for expansion | supabase/migrations/202610090030_league_isolation.sql:72; api/weekly-worker.ts:138 | New leagues previously lacked an explicit verified-rollout gate. Service-only operations_enabled defaults false; ticket acceptance and automated scheduling reject disabled leagues. Existing league configuration is seeded; no new league is enabled. |
| High for expansion | src/App.tsx:763 | Slip and admin component state could survive league selection. Membership-keyed remounts clear the slip and admin selection; A-admin/B-member browser and SQL tests deny B administration. |
| Important | src/App.tsx:591 | Browser retry journey exposed an empty league selection after initial account loading failed. Refresh now retains a valid selection or selects the first authorized league. Regression checks require markets after retry. |
| Important | src/components/Sportsbook.css:2054; src/components/Sportsbook.tsx:211 | Long names and a constrained slip made mobile readability/submission fragile. Team information now occupies a full mobile row above labelled quote buttons; VisualViewport height, bounded leg scrolling, safe-area offsets and reachable submit preserve the native dialog. Desktop retains the original columns. |
| Important | src/index.css:23; src/App.css:1238 | Light gold text and undefined surface-2 token weakened contrast; small layout rules could hide balance. Darker light-theme gold, surface alias, visible balance, focus/skip-link and reduced-motion rules added. Actual light/dark screenshots inspected. This is not a complete accessibility certification. |
| Important | src/lib/csv.ts:3; src/components/Reports.tsx:1226 | Spreadsheet formula-like string values were exported unguarded. CSV string cells now neutralize formula prefixes, escape delimiters and preserve numeric negatives. Filenames contain the league ID. CSV/PNG/PDF browser downloads completed. |
| Important | src/App.tsx:610; api/_lib/league-communications.ts:3 | Anonymous season/week and communication brand/URL were tied to one league. Anonymous UI is generic; authorized board/account data supplies context and communication identity comes from validated league config. Existing provider lookup was already configured: the old hardcoded-provider finding is superseded. |
| High before expansion, remaining | api/weekly-worker.ts:11 | Worker budget is 60 seconds. Lease/retry/error tests pass, but multi-league backlog, hosted multi-connection concurrency and provider outage/load testing have not run. A second live league remains disabled pending these checks. |
| Important, remaining | src/App.tsx:510; src/components/Reports.tsx:1243 | Navigation and filters remain component state rather than shareable URLs. Add routing/filter persistence separately with back/refresh tests. |

## Evidence and verification

- All 11 existing/new suites passed: isolation, weekly execution, futures, live model, line model, accounts, active starters, import, reporting, refresh, API runtime. Isolation rerun passed after the final report JSON guard.
- Production build and API compilation checks pass. Lint passes with seven advisory warnings (existing React effect/export and test-finally concerns). Build retains an approximately 506 kB main-chunk warning.
- Browser suite uses the real built application with intercepted auth, database and API fixtures. Actual 360, 390, 430, 768, 1024 and 1440 pixel viewports are measured; both themes, long names, balance visibility and document overflow are checked. Native dialog, revised-price approval, fixture acceptance/history, two-league switching and admin visibility are exercised.
- Admin report week filter and CSV/PNG/PDF exports run. Empty, suspended, slow/loading and account failure/retry states are exercised. Screenshot files and viewport-evidence.json are in the accompanying screenshots directory.
- Reduced 390x420 viewport verifies focused wager and reachable submit. No physical iOS/Android device, operating-system keyboard, landscape device, screen reader or notch hardware test ran. CSS safe areas are implemented, not physically certified.
- Export PNG visually inspected. Generated PDF downloaded successfully; no claim of full PDF pagination inspection. Exports use fixture data, not member data.
- Read-only production preflight returned: 1 league, 0 outbox recipients without matching memberships, 0 mismatched ticket links, 0 expired running jobs. This is a narrow snapshot, not proof of all data constraints or continuous worker health. Run full constraint preflight again before applying migration.
- Postgres tests use PGlite and sequential retry/void orders; they do not prove simultaneous hosted PostgreSQL contention. Existing wallet row locking and accepted quote snapshot logic are preserved.
- No offer/redemption implementation exists to exercise. Existing featured odds boosts are preserved; no claimed offer flow is asserted. No private upload/storage path exists; reports are local authorized downloads, and report-avatar only proxies permitted public Sleeper avatars. Add tenant-scoped storage policies and signed access before any private-file feature.

Web review used the fresh [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), plus Frontend Design, React Best Practices, Validate Data, Supabase Postgres Best Practices and Webapp Testing. JavaScript Playwright was used because the available Python runtime lacked Playwright.

## Prioritized roadmap

Critical: approve and deploy isolation/recipient/mobile foundations; run full production constraint preflight and smoke checks; verify worker freshness and failure recovery; hosted concurrent debit/refund/claim tests; load/capacity and verified provider/rules configuration before a second league. Keep experimental live acceptance disabled until pricing, source freshness, suspension and settlement gates pass.

Important: URL-backed navigation/report filters; operational last/next run and actionable retries; notification preferences/digests; quote/model version history; ticket search/exposure dashboard; accessible device/keyboard and screen-reader checks; private files and offers only with league-scoped schema, RLS and isolation tests. Finish approval queues and scoring/playoff/tiebreaker data verification before widening futures coverage.

Nice to have: exact-count close-games markets, winning-margin bands and weekly league-score totals. Each needs archived inputs, reproducible calibrated joint simulations, vig/limits, explicit equality/push/void settlement and a contradiction/correlation matrix. Bands must be exclusive and total partitions complete; exact-count predicates need a fixed margin threshold. Never multiply dependent probabilities as independent parlay legs. Do not add new markets before these definitions and backtests are approved.

## Proposed deployment and rollback

After approval: verify no unrelated changes enter the release, perform fresh full data preflight, apply the two reviewed transactional additive migrations, then commit/push the reviewed application through the existing main/Vercel flow. Verify deployment readiness, public rendering, authenticated read paths and worker runtime without live betting or bulk email. Abort on constraint violations rather than silently fixing financial/member data.

Migration first is required: new application email claims depend on claim_scoped_outbound_emails and league config. The old claim function remains for the previous runtime during rollout. On application failure, restore the prior Vercel application while retaining the additive guards; destructive schema rollback is not automatic. New-league enablement is a separate decision after remaining isolation/capacity checks.

## User-requested revision — owner-controlled future league process

The public line-update panel is now one compact sentence: **Live Line Updates are in development and coming soon!** Admin operational diagnostics remain available. Public users no longer poll scheduler diagnostics for this placeholder.

Additional database-only migration: `202610090031_owner_launch_constraints.sql`. A private singleton maps the platform owner to Cooper's existing verified membership. Private launch approvals reference that owner; only a matching authenticated owner can record approval, and activation of a new/disabled league requires that approval. Ordinary league admins have no creation, approval or activation grants. The owner membership cannot be reassigned to another email/account by league administration. Initial email claiming must match a confirmed account. Existing active league is preserved.

No new onboarding endpoint, creation button, activation menu or second league is introduced. The future owner-only admin process should: create a disabled league draft; verify provider/season/scoring and roster mappings; review invitations and recipients; run isolation and capacity checks; show a review summary; record owner approval; then enable operations. Implement that process in a separate approved release. Database constraints reserve this future boundary; they do not themselves prove the verification checks ran.

Email-approved memberships already support one account belonging to multiple leagues. Existing switching is preserved and tested with overlapping identities; no new switching workflow is implemented in this release. Membership claiming is scoped to approved matching emails, balances and admin roles remain league-specific, and switching resets the slip. Multi-league rollout remains disabled.

Tests added: activation without owner approval fails; B admin cannot write private approvals; attempted approval with B admin identity fails even through a privileged fixture; owner identity reassignment fails; a verified owner approval permits activation only in memory. Updated browser suite asserts the exact compact notice and refreshed screenshots. Two database migrations, then the application deploy, now comprise the proposed release. Approval remains pending.

Final revision verification: all 11 suites passed with the owner constraints loaded. The report guard rejected an old futures fixture using a made-up team key; that fixture now uses its actual seeded league team ID and the futures suite passes. Production build/lint and full measured browser journey suite pass; refreshed screenshots show the compact notice. No database migration or deployment has run.

## Approved deployment — 9 October 2026

User explicitly authorized: "Just fix that and deploy." Betting status and both date rows are now anchored to the right edge on mobile; desktop alignment is retained. The full browser suite passes with measured right-edge and text-alignment assertions at all six viewport widths in both themes. Build passes; 11 regression suites and lint passed for this release.

Production preflight: zero mismatches across ledger ticket teams, outbox recipients/ticket scope, forecasts/boards, cycles/boards, jobs/cycles, report team keys and market team references; exactly one bound platform-owner membership. Migration 030 applied successfully; migration 031 also applied successfully before application publication. No second live league is created or enabled. Deployment verification will be recorded below.
