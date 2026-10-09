# Sportsbook audit release handoff — current status, 9 October 2026

This section is authoritative. The history below records earlier proposals and intermediate releases; its old pending-approval statements are superseded. User approved deployment with "okay deploy". Application release `0fba7f7f17d183b8a552cb28a2397a7e5de20d82` is verified **Ready / Production** at https://sportsbook.coopergurrie.com/. Vercel: https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/HdwEV6xXC5Wq3zeD5CPjBXvZZmHc (11:11:44 AM EDT). Subsequent documentation-only commits may rebuild this same application; recheck latest Vercel source before starting new work.

## Deployed and functional

- Mobile long-name formatting, visible balance, safe-area layout, light-theme contrast, native dialog resizing/scrolling, account retry, and right-aligned betting status/date rows. Desktop columns retained; native dialog/details patterns retained.
- Compact public notice with trend icon: "Live line updates are in development and coming soon". Duplicate technical placeholder removed; genuine outage warnings and betting locks retained.
- Eligibility appears once, beside each Futures/Weekly Specials title. Weekly copy: "Eligible for Singles and Parlays"; futures retain Singles-only, Playoff Parlays-only and Win-Total Parlays restrictions. Redundant descriptions removed; #1 Pick retains its last-place explanation.
- Red/green down/up arrows appear directly beside displayed odds, expire after five seconds and carry accessible direction labels. Price-displaying quotes track displayed price changes.
- CSV formula-prefix protection and league-specific export filenames; authorized local CSV/PNG/PDF exports.
- League-configured branding/communications and send-time recipient, membership and ticket checks, including cached retry payloads. Bet-confirmation delivery claims only its own ticket.
- Production migrations **030 and 031 already applied**: composite league constraints, market/report guards, service-scoped outbox claims, default-off new league operations and a private owner-bound launch-approval boundary. Existing league remains active. Do not reapply or renumber these migrations.
- Existing approved-email memberships support more than one league; existing switch clears slip/admin state and preserves league-specific balance/roles. No new onboarding or switching workflow was added.

## Deployed code, awaiting normal board regeneration

Both "How Many Teams Will Score 150+?" and "How Many Teams Will Beat Their Projection?" now render **Exactly N** and **At Least N+** quote buttons. New generation creates N+ quotes using the inclusive probability tail of the same simulation as Exact pricing. Existing published boards were NOT regenerated in this chat: if N+ is absent, its button is disabled as Coming soon. Normal admin/worker regeneration must produce/publish these prices; an application deploy alone does not add database market rows. Actual production authenticated acceptance/settlement of an N+ bet was not exercised.

- Sides are `String(N)` for Exact and `${N}+` for At Least; both share the original market_key. Existing unique(board_id,market_key,side) and upsert behavior require no new migration.
- Client/server reject combining Exact and At Least choices (or different counts from the same market) in a Parlay. Users remove their existing pick before choosing another.
- Settlement uses immutable accepted side/line, expected league team count and saved projection targets. Exactly requires equality; At Least includes equality and larger counts. 150 counts; a tied projection does not. Incomplete results remain OPEN. Historical numeric-side Exact bets are preserved.
- Zero is Exact-only for projection count; At Least zero is not priced because it always wins. The 150+ card retains its existing minimum count of one. Maximum N+ and Exact N describe the same outcome and cannot be combined.
- Short visual labels retain full scoring/projection context in accessible quote names and stored ticket labels.

## Completed checks and evidence

Latest release: `npm run build` (TypeScript and compiled API runtime), `npm run lint`, `test:lines`, `test:weekly`, `test:futures`, `test:isolation`, and `node scripts/test-ux.cjs` passed. Earlier foundation release passed all 11 regression suites; those earlier results are not a claim that every suite was rerun for the final copy/count change. Lint has seven existing advisory warnings; main bundle remains approximately 506 kB.

- Count tests cover inclusive-tail pricing, monotonic probabilities, Exact/At Least equality and above/below settlement, saved targets, malformed selections and no guaranteed 0+ quote.
- In-memory Postgres acceptance rejects correlated selections, persists N+ side/line, and preserves accepted snapshots/wallets during repricing. Isolation tests use two disconnected leagues with overlapping identities/roster IDs and cover roles, wallets, markets, debit/refund, reports, recipients, cached payloads and jobs.
- Built-app Chromium fixture journeys measure 360/390/430/768/1024/1440 pixels in light/dark themes. Futures/count choices receive extra 360/390/1440 checks. Long names, balance, right-aligned dates, title eligibility, no clipping/overflow, selection rejection, timed arrows, native dialog, quote-reapproval, history, exports and empty/loading/error/suspended states pass.
- Keyboard-space check uses a reduced 390x420 viewport; **no actual OS keyboard, physical phone, landscape device, screen-reader certification or authenticated live member journey was tested**. PNG inspected; PDF downloaded, not fully pagination-inspected.
- Production GET returned 200 and byte-identical tested JS/CSS (`index-DjqXJi0N.js`, `index-CP7cShl8.css`). Worker/bet/generation unauthenticated smoke calls returned 401 without invoking jobs, bets or email. This does not prove authenticated production generation or worker capacity. Public sign-in rendered successfully in the browser.
- Evidence directory: `C:/Users/coope/Documents/Codex/2026-10-08/audit-and-improve-the-fantasy-sportsbook/outputs/screenshots/`. `deployment-ready-count-options.png` is production Vercel evidence; `odds-arrow-390.png`, futures/specials/home/slip screenshots and viewport-evidence.json use intercepted test data.

## Still planned / remaining issues

**Critical before another live league:** hosted simultaneous debit/refund/outbox-claim tests, worker backlog/capacity and source-outage recovery checks, verified provider/scoring/playoff settings, owner-reviewed rollout. PGlite sequential tests do not establish hosted contention safety. Last recorded worker health snapshot was 0 failed/expired jobs and last completion 2026-10-09 13:28 UTC; it was not refreshed in this deployment and is not continuous health evidence.

**Not implemented:** owner-only league creation/launch admin menu and end-to-end onboarding process; new league switch design; second live league activation; private uploads/storage; offers/redemption. Database owner/activation constraints are deployed foundations, not a functioning admin launch flow. Do not enable another league before isolation/capacity gates and explicit rollout approval.

**Live pricing remains experimental and unavailable for betting.** Shadow histories/reviews exist from earlier work; do not enable acceptance based on the coming-soon notice or these arrows. Source freshness, observed starters, validated remaining-points pricing, calibrated joint pricing and settlement gates still apply.

**Important next:** user's deployed formatting review on devices; screen-reader/OS-keyboard checks; URL-backed navigation/report filters; operational last/next run and retries; notification preferences; exposure/search and model history. Any private-file or offer flow needs league-scoped schema/RLS/tests before launch.

**Nice to have:** close-game counts, margin bands and league-score totals only after fixed definitions, calibrated archived inputs, explicit pricing/vig/limits, equality/push/void rules, contradiction/correlation checks and backtests. Do not treat dependent selections as independent Parlay legs.

## Next-chat instructions and rollback

Start with PROJECT-CONTEXT.md, this current summary and relevant handoff 01. Checkout is `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`, working branch `stage-1-accounts`, deployment via explicit normal `git push origin HEAD:main`. Keep unrelated modified `docs/promos-boosts-handoff.md`, untracked data/other handoffs/recovery notes and work/ out of commits. Never expose environment/credential values. Use local intercepted fixtures for betting/mail tests; no live bets, bulk emails or paid services were authorized or performed.

Latest changed files: `MarketTitle.tsx`, `WeeklyCountPicker.tsx`, `SeasonFutures.tsx`, `Sportsbook.tsx`, `Sportsbook.css`, `LineMovement.tsx`, `api/generate-markets.ts`, `api/_lib/count-options.ts`, `api/_lib/settlement.ts`, and API/line/weekly/futures/UX test scripts. No new SQL migration for count markets.

Rollback requires care: **once N+ tickets are accepted, do not restore a pre-N+ settlement worker**, which would treat those sides as Exact and could pay incorrectly. Retain or backport the N+ settlement handler, pause affected settlement/generation if needed, and review accepted snapshots. Retain additive league/owner database guards. Before N+ tickets exist, the previous Vercel application `0e86e66` is the prior app baseline. Existing Exact tickets must remain immutable.

---

## Historical audit and rollout notes (superseded statuses)
# Sportsbook audit and proposed release — 9 October 2026

Historical initial status (superseded by current summary): implemented locally; production migration and application deployment awaited explicit user approval. No second league enabled, live bets placed, bulk test emails sent, or paid services added.

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

### Production verification

Application commit 1e906c66294f25f850d5ad54daeafeba271ac7b6 was Vercel Ready/Production, deployment https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/66H7rpALe8vxxE5dhTT9xkEfzYz5. The custom domain returned HTTP 200 and byte-for-byte matching tested JS/CSS assets. Worker, bet placement and generation endpoints returned HTTP 401 for unauthenticated smoke requests; no live bets/jobs/email were triggered. Public sign-in renders the generic identity. Both migrations applied successfully; postflight confirmed 1 active league, 1 owner record, 0 new launch approvals, and no authenticated access to mail claims or launch approvals.

Final static-shell cleanup removes the remaining Goldy tab title/favicon and opts into viewport-fit=cover for the safe-area styles. No second league, creation menu or activation flow was implemented. Physical-device keyboard/formatting review remains with the user; hosted concurrency/capacity checks remain prerequisites for another live league. Rollback: restore the previous Vercel application, retaining additive schema guards. Automatic review rejected raw Git-credential extraction for status verification; authenticated Vercel UI verification and direct production asset/API smoke checks succeeded instead.

Final production shell commit: ad28c9572b8f76da12fefedbc9ed82f62939ef26, Vercel Ready/Production at https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/HZm7L1zWp9QXpkvgSQpfbbU8sKoD. Custom-domain smoke verification passed for generic title/favicon, viewport-fit, exact application JS/CSS, and three protected API HTTP 401 responses. Browser rendering confirmed Fantasy Sportsbook sign-in. Read-only worker snapshot: 0 expired running leases, 0 failed jobs, last completed 2026-10-09 13:28:00.921 UTC. This is a point-in-time health observation, not multi-league capacity proof. Final screenshots saved in this chat's outputs/screenshots, including deployment-ready.png, production-sign-in.png and measured mobile/desktop fixture journeys. No live betting, bulk test emails or second league enablement occurred. Final next steps: user's physical-device formatting review; hosted concurrent wallet/outbox and capacity/outage checks; separately approve the future owner-only onboarding menu/process.

### Follow-up: compact notice and futures eligibility

Public notice now reads exactly "Live line updates are in development and coming soon", preceded by a decorative trend icon. The duplicate technical live-pricing suspension sentence is omitted from the public board; backend betting locks and other source-outage reasons remain intact, and admin diagnostics remain available. Futures header no longer lists singles/parlay rules. Each bet row now shows its eligible ticket type right-aligned beneath its odds: Singles only; Playoff parlays only; Singles or win-total parlays. Unbroken long team names wrap before the odds column on desktop and mobile.

Files: LineRefreshStatus.tsx, Sportsbook.tsx, SeasonFutures.tsx, Sportsbook.css, test-ux.cjs. No database, pricing, acceptance or settlement behavior changes. Build/API runtime and lint pass; repeatable fixture tests verify exact notice/icon, duplicate-message removal, real outage warning and disabled prices, eligibility labels/right alignment, and no name/odds overlap at 360/390/1440 in both themes. Screenshots futures-{width}-{theme}.png and home-{width}-{theme}.png are refreshed; no live bets or emails sent. Production publication follows the existing approved main/Vercel flow; verify Ready and exact assets after push. Rollback is the prior Vercel application deployment; existing schema guards remain.

Follow-up deployment verified: 0e86e669c4bca4c81c8f7828c3e47df0c283ff9b is Ready/Production at https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/EoaAmfkuL5CtorvFMEg6r8VGonka. The custom domain serves byte-for-byte matching final JS/CSS assets; protected APIs return HTTP 401 without authentication. Full browser suite passes, including six widths/both themes plus futures at 360/390/1440, exact copy/icon, hidden development-only duplicate, visible real source-outage reason/disabled betting, and no long-name/odds overlap. No migration was applied in this follow-up. Final deployment screenshot: deployment-ready-notice.png. UX screenshots use intercepted test data; no authenticated live member journey was claimed.

### Follow-up: eligibility beside titles and inline movement arrows

Eligibility moved from individual quote rows to the right of each futures market title, once per card. All Weekly Specials titles now show Singles or parlays, matching existing server rules. A shared MarketTitle component provides the title/badge layout. Green/red movements now render as up/down arrows directly beside displayed odds; markets displaying odds track changes in that price rather than the exact-count selection number. Markets displaying only a spread/total line retain line-value tracking. Five-second expiry, scope reset and accessible direction labels remain intact. No database, pricing/acceptance or settlement rule changes.

Changed: MarketTitle.tsx, SeasonFutures.tsx, WeeklyCountPicker.tsx, Sportsbook.tsx, LineMovement.tsx, Sportsbook.css, test-ux.cjs. Build/API runtime and lint pass. Browser fixtures measure six standard viewport widths in both themes, plus title-right eligibility in futures and all eight specials at 360/390/1440; timed same-count odds refresh proves adjacent up/down arrows and five-second expiry. Screenshot previews use test data. Deploy through the previously approved main/Vercel flow; retain schema guards if rolling application back.

Current follow-up application commit 6909094 is committed locally, not pushed or deployed. Build, lint and the complete browser suite passed. Automatic approval review rejected the main-branch production push because it required explicit approval for this release; no alternate deployment mechanism was attempted. Await user approval to push this title-eligibility/inline-arrow correction. Existing production remains 0e86e66. Preview evidence: futures-390-light.png, specials-1440-dark.png and odds-arrow-390.png; all use intercepted test data.

### Follow-up: one-line descriptions

Before deployment, market descriptions were shortened to a single line. Weekly Specials eligibility now reads "Eligible for Singles and Parlays" to the right of each title. Futures retain their actual restrictions with capitalized Singles/Parlays labels. Description and eligibility text uses nowrap without truncation. Browser regression checks confirm a single text line and no clipping for every description/eligibility at 360, 390 and 1440 pixels; the full six-width, light/dark journey suite passes. Build/API runtime and lint pass (seven existing lint warnings; existing bundle-size warning). Refreshed fixture screenshots include odds-arrow-390.png, futures-390-light.png and specials-1440-dark.png. No live bets/emails or database changes. This revision and the title/arrow correction remain local pending deployment approval; production remains 0e86e66.

### Follow-up: Exact and At Least count markets (pending deployment)

Both team-count cards now show two prices for the selected count: Exactly N and At Least N+. Generation prices the latter from the inclusive tail of the same smoothed simulation used for Exact quotes. Both choices share the original market_key and have distinct sides (N / N+), preserving quote upsert identity and rejecting correlated selections in a Parlay on both client and server. At least zero is not offered because it is guaranteed; projection zero remains Exact only. Settlement uses the saved side, accepted line, league team count and saved projection targets; score 150 qualifies, tied projection does not. Historical numeric-side Exact bets retain their settlement semantics.

Redundant descriptions removed from weekly specials and simple futures; #1 Pick retains its last-place explanation. Full accessible quote names retain the scoring/projection context while visual buttons use short Exactly / At Least labels. Existing published boards need normal admin/worker regeneration to receive new priced N+ quotes; until then that button is disabled as Coming soon. No live board was regenerated, database migration applied, bet placed or email sent.

Build/API runtime, lint (existing seven warnings), count-distribution tests, settlement/worker tests, in-memory acceptance/futures tests and two-league isolation tests pass. Database acceptance verifies N+ side and accepted line persist, Exact/N+ combination is rejected, and repricing preserves accepted snapshots and wallets. Full browser fixture suite passes six widths in both themes, including the two choices at 360/390/1440, rejection of combining them, explicit choice selection, unchanged native dialog/report journeys and adjacent timed movement arrows. Preview: odds-arrow-390.png. Production remains 0e86e66; this release requires user approval before the normal main/Vercel deployment.
