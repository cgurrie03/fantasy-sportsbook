# Production release — November 24, 2026

The owner explicitly requested the full Production transfer. This supersedes the preparation-only restrictions in earlier checkpoints.

## Post-release header, avatar and featured-limit fix

Subsequent owner change: Playoff Race now boosts the team trying to qualify, rather than its opponent. Both moneylines still qualify when both teams are racing. This supersedes the recipient description below. Applied Production migration `playoff_race_contender_boost`; app deployment `dpl_3aUuSGsiGwBSLEfDHPyte3JdoJbM`, source `27eaa2ca54c93d02e6e9052c586722a22538c289`. Automatic and manual modes, future-week planning and commissioner help agree. A rolled-back hosted six-matchup test verified contender targeting; the real board refreshed to the contender selections. Existing percentage caps and accepted tickets are unchanged. Production build and 42 restored-backup browser checks passed.

Latest app deployment: `dpl_87diphhqRAysPm3egVja2vfkSsZG`, source `c86afb5f0933396becae37fc0865ad0fe1bae5dc`. Production migration `header_profile_and_unlimited_features` is applied. Production's missing Development banner now contributes zero height to the shared header/sidebar/sticky-tab offsets; mobile uses the same shared variables. Live desktop checks measured header top 0, bottom 82 and scrolled tabs top 82. The header avatar now resolves the authenticated manager's linked Sleeper ID, including independent co-manager identity; the live image loaded successfully.

The owner clarified that unlimited refers to the featured-matchup count, not Fantasy Rewards recipient caps. Removed the half-of-matchups automatic cap in the server and frontend planner; eligibility, category priority and one Game of the Week remain. A rolled-back hosted scenario awarded all six qualifying matchups, and the real current board had five featured matchups after refresh. No accepted tickets were changed by this configuration correction. TypeScript/Production build, API history/access regressions and 42 restored-backup browser checks passed. Private detailed evidence is in `work/production-fixes-20261124/`.

Playoff Race recipient logic is unchanged: boost the moneyline opposing a team still in the playoff race; boost both moneylines when both teams qualify. The default category profit boost is 35% and is available to league bettors, not awarded exclusively to a team's manager.

## Released

- Public app: https://sportsbook.coopergurrie.com — Vercel deployment `dpl_4N48384WXHdjjoaBHwjMK8FSy5dd`.
- Source: `886ab56fbde9c7136ebd47689a73647fe6d43a6d`, pushed to `codex/boff-handoff-implementation`. The qualified base is `85bc9a2`; two small cutover corrections follow it. `main` was not merged.
- Production Supabase: `bmvjcdgxwxqalaohpsnw`. The exact atomic schema SHA-256 `abbdf51203b0217c59f7d705a8c9009ed719339532817dc446c836b6d5a3e770` was applied through native PostgreSQL with full TLS verification. Its version is recorded in migration history.
- Dedicated Edge Function `boff-production-live-refresh`, version 1. Explicit Production target/schema settings are installed. Its token is generated in Vault, not exposed in cron or source.
- Release is active at Week 12. The new minute dispatcher is enabled; the legacy dispatcher is disabled and 42 unfinished old jobs were reviewed and retired without replay.
- Auth return routes are restricted to the Production origin. Auth SMTP display name is Boff; the existing address and credential were preserved.

## Recovery and financial reconciliation

Final pre-upgrade encrypted checkpoint: `production-2026-11-24T14-24-23-248Z-26cc7501-0a96-4062-afd4-734e9034d2da`. Ciphertext checksums and native archive header passed; no export warnings. The application restore/upgrade/runtime rehearsal passed using this fresh checkpoint, including 42 desktop/mobile browser checks. This is bounded application recovery evidence, not a full hosted Auth/Vault/Storage/provider restore.

All 90 tickets, 261 legs and accepted odds/lines/payout terms were preserved. Total cash remained 1,538.40: 1,138.40 transferred into eight verified person wallets and 400 reserved for four original pending identities. Nine open legacy futures have explicit payout routes. Nelson's co-manager identity is preserved. No season reset, new accounts or test wagers were created.

The old worker added twelve zero-amount Week 12 ledger entries before the cutover; these were included in the checkpoint. After activation the new worker correctly marked the already-reached five-win future leg won, without changing accepted terms or paying out its still-open parlay.

## Hosted verification and cutover fixes

- Real existing owner Auth session successfully loaded the Weekly Slate, accepted future ticket details, Commissioner, Platform Owner and email templates/logs.
- Non-owner commissioner access was denied in a rolled-back hosted database probe. Anonymous/member/service-role execution of the private dispatcher is denied. Anonymous public API requests return authentication errors and private/no-store headers.
- Live board: 12 teams, 282 players and 1,675 active priced selections. Board freshness and source/cache health passed. Scheduled runs return HTTP 200, including unchanged/not-due responses; eight successes and zero failures were observed in the initial active window. Sustained game-day performance is not established by this short observation.
- The cold warmup completed publication but outlasted the original ten-second pg_net wait. The dispatcher now allows 60 seconds; worker policy checks passed and subsequent responses were successful.
- Removed Production-facing Dev Credits/preview labels and replaced the About modal with accurate live-service text.
- A live probe found API/server source served as static files when the output directory was the deployment root. The Production packager now serves only `public/`, keeping `api/` and `lib/` outside CDN assets. The browser rehearsal follows that actual output root. Public postflight confirmed API source URLs enforce authentication and server library URLs no longer return JavaScript source. CSP and HSTS are present.
- Root/visual dependency audits and the original frozen 45-suite qualification remain base-release evidence. The cutover changes additionally passed TypeScript/build, worker policy and the refreshed 42-case restore/browser rehearsal; the full 45-suite runner was not rerun on the final deployment-packaging correction.

## Deliberately pending

- Routine email/push delivery remains disabled by the Production runtime and existing mail suppression. Sent-mail count stayed 323; the cutover sent no user messages. Separate delivery acceptance/activation is still required.
- New futures publication is awaiting the owner's pending question about roster readiness and the #1 pick rule. Current defaults leave readiness off and #1 pick disabled; existing accepted tickets continue to exist and be evaluated. Do not silently change the rules.
- Four original identities still require verified account linkage before reserved cash can be released. No replacement inherits that cash automatically.
- The source branch is pushed; future Git-driven Production builds still need the new candidate packaging integrated before re-enabling automatic domain assignment. Use the explicit Production packager/deployment workflow, not the old root app build.
- Initial database size was about 396 MB after expansion (about 386 MB before it). Prior historical compaction remains intact; no new historical deletion or full-vacuum was performed. Longer-term IO/storage and next rollover/game-day observation remain follow-ups.
- Supabase's old-cycle egress warning remains visible, with November 29 shown. Current usage was 1.378/5 GB. Its current billing FAQ explains that this warning can persist below quota and exceeding limits again can cause restriction without a fresh grace period. No paid plan change was made.

Detailed private execution receipts, SQL checksums, HTTP checks and rehearsal logs are in ignored `work/production-cutover-20261124/`. The secure operator connection is closed at the end of the cutover; the database password is not persisted.

Rollback must respect new person-wallet activity. Do not blindly promote the legacy financial writer or restore the pre-cutover database after new claims, bets or settlements; fence writes and reconcile subsequent records first.
