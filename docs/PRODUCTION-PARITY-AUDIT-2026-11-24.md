# Production parity audit — November 24, 2026

## Result

Production has the Development application feature set, with explicit differences and release gates below. This is not an unconditional parity or security sign-off.

## Verified live

- Canonical Production domain was serving the new application. Authenticated owner navigation exercised Weekly Slate, all four market categories, My Bets, Futures, Profile/Communications, Commissioner Members/Featured Matchups/Fantasy Rewards/League Feed/Rivalries, and Platform Owner email templates/log filters.
- Weekly Specials scoring leaders are ordered shortest to longest odds. Player markets show Season Average, projected points, opponent and kickoff. Offers are compact and open from the slate; a separate Offers navigation entry is absent.
- Commissioner has independent primary/co-manager rows, Add Member, pending verification actions, reward categories and recipient caps, injury/taxi/matchup feed controls, and readable rivalry columns.
- Owner email catalog has the consolidated ten types and league/member/status log filters. The preview is labeled Sample Data; it is not evidence of delivery or a real settled result.
- Sleeper state, all twelve records, Week 12 matchup pairings and scores agreed with Production. All current scores were zero before games. Current projections agreed between Development and Production. Opening projections differ between environments because their opening snapshots were captured at different times; these must not be overwritten to manufacture parity.
- Production had 1,675 active selections across sixteen families, including 116 player head-to-head selections; no null/invalid American odds in that board. This checks publication and numeric validity, not statistical calibration of every probability.
- Rechecked at 3:40 PM Eastern: board observed at 3:00 PM, valid until 4:05 PM, no source error, expected sixty-minute idle cadence. Last hour: sixty successful dispatcher executions, zero failures. Dispatcher success includes not-due checks; it does not mean sixty full quote rebuilds.
- Original ninety tickets and 261 legs remain. This audit placed no real bets, claimed no credits, changed no membership/league rules, and sent no messages.

## Corrected during this audit

- Header/profile image: the manager's Sleeper account avatar is an orange default; the custom team picture is a separate Sleeper field. Header and Account now use the linked primary manager's team picture. Co-managers keep their own account avatar. Account previously showed initials because Boff display name and Sleeper username differed.
- Published featured badges now use the actual boost percentage from the quote instead of the category default. Production's current 25% policy cap previously produced badges claiming 35%. Planning/configuration still shows category defaults where there is no published assignment.
- Removed the Development-only description from Production's email sending log.

## Remaining actions, priority order

1. **Scheduled storage maintenance is not enabled in Production.** The maintenance function is installed; Development runs it hourly, but Production has only the new live-refresh dispatcher active. Review the Production-specific cleanup function and schedule a bounded job with retained financial/history safeguards. Do not copy the Development-only schedule file unchanged. No historical cleanup/deletion was executed during the audit.
2. **Routine email/push delivery is intentionally disabled.** The Production runtime and legacy mail suppression remain fenced. Templates, preferences and logs existing does not establish delivery. Complete delivery activation/acceptance separately, including verified-recipient rules and physical-device push.
3. **New futures are not published.** Readiness is off and the #1-pick market is disabled pending the owner's rules decision. Existing accepted future tickets remain visible/evaluated. The closed board currently exposes fewer categories than Development; do not call this full operational parity.
4. **Membership management has historical team names.** Slate/live roster names are current, while some linked-person rows use the original teams table name (for example Puka's rehab facility versus Kyle Monangai). Use refreshed Sleeper team context for current-season management, preserving historical ticket labels.
5. **Development is behind Production's latest fixes.** Development domain still points at its older deployment and server feature selection uses the old cap/Playoff Race recipient. Production has the unlimited count, contender boost and fixed-top Game of the Week rules. Synchronize Development through its own deployment/migrations; do not revert Production to make them match.
6. **Long-open tabs retain old application code.** A reload loaded the new avatar and current feature rules. Quote deltas update data but do not replace running JavaScript after a deployment. Consider a non-disruptive update notice; never force a reload during ticket placement.
7. **Commissioner percentage policy needs clarity.** Published badges now show the real 25% cap, but configuration defaults can still advertise 35% categories. Decide whether to raise the league policy cap or explain the effective capped percentage next to configured values.
8. **Git-driven deployment integration remains pending.** Production currently uses the safe explicit candidate/public-root packaging workflow. Do not enable the old automatic root-app build or promote a legacy financial writer.

## Storage, performance and security limits

- Database measured about 396.5 MB; largest retained archive model_forecast_runs was 228.4 MB. The tiny live caches are bounded; routine refreshes are not writing full historical snapshots every minute. Disk size is not a measurement of Disk IO budget. Sustained game-day IO/egress requires monitoring.
- Security advisor returned no ERROR-level findings; it still reports mutable-search-path helpers, public extension, callable security-definer functions, and leaked-password protection warnings. These require contextual review; a read-only audit is not proof that all callables are safe. Existing access boundaries also passed isolated role tests.
- Development browser required sign-in, so no authenticated side-by-side Development visual sign-off was possible in this session. Deployment/database comparisons were performed directly instead.
- Live desktop navigation produced no captured browser console errors. Requested mobile viewport override did not take effect in the connected live browser (it remained 1280px), so live mobile appearance is not signed off. Isolated candidate browser checks use real 1440px/390px widths with three simulated roles and real restored SQL; Auth, images and external providers are simulated/blocked. These complement, rather than replace, physical-device testing.
- No account credentials, authentication sessions, financial records or private email bodies are included in this report.


## Release and final verification

Audit fixes deployed to Production as `dpl_2kfjEFe9kgCnpkfWUKUzgXm7mWxV`, source `5f5022f`. Canonical domain assignment and new frontend assets verified. Authenticated live browser confirmed the header and Profile Account image both load the custom Sleeper upload, and all four published feature badges display 25%. Header bottom was 82px and the page heading began below it at 118px. Anonymous API/source-path probes returned 401 JSON and private/no-store; server library URLs returned SPA HTML, not server JavaScript.

TypeScript/Production build passed. Final restored-backup regression completed at 3:40 PM Eastern: 42 browser checks across member, commissioner and owner roles at 1440px/390px passed, along with application upgrade, ticket/claim/reward transaction and access-boundary checks. Hosted external transports are not covered by this isolated suite. No Production schema or league-setting mutations were made in this audit.

## November 25 completion

The five requested gaps and follow-up guide/offer changes are implemented. See `docs/PRODUCTION-PARITY-COMPLETION-2026-11-25.md` for deployments, migrations, activation controls, live checks and physical-device limits. This supersedes the November 24 pending statuses for scheduled cleanup, routine delivery activation, new futures readiness, management names and Development synchronization.
