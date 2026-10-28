# Fantasy Spread Teasers — Development Handoff

Updated October 10, 2026, after the user accepted the dropdown refinement. This is the authoritative teaser status. Earlier conversion-button designs and the proposed minimum-two-leg refund rule are superseded. Read [shared project context](PROJECT-CONTEXT.md) and [pricing research and planned server/database design](../research/teaser-pricing.md).

## Status at handoff

**The teaser preview UI and request rejection guard are deployed and functional. Production teaser pricing, ticket acceptance and settlement are not implemented or enabled.** This week is for collecting results and research. The user accepted the current UI “for now.” Do not treat that approval as authorization to launch teaser bets or a payout table.

| Capability | Deployed and functional | Still planned / limited |
| --- | --- | --- |
| Qualifying slip | Parlay / Teaser tabs; conversion back preserves original selections and ordinary prices | No accepted teaser tickets |
| Point adjustment | Provisional 6 / 9 / 12 fantasy points, default 9; native modal picker | Final range must be selected from validated fantasy margin/error distributions |
| Pick display | One list; original spread, favorable adjustment and new line; matchup subtitle | Accepted-ticket history/report/email representation is not implemented |
| Odds and payout | Ordinary parlay odds/payout work; teaser shows “Price pending” and “Pending validation” in production | Joint server quoting and approved payout terms are not implemented |
| Wager input | Empty initial/reset value with visible 0 placeholder; zero clears on focus; typing starts empty | No teaser wallet debit |
| Server safety | Unsupported teaser/adjustment/forged quote/odds/payout request fields reject before downstream operations | Authoritative teaser quote, acceptance and saved-term settlement operations are not implemented |
| Settlement | Existing ordinary-ticket paths and full-ticket admin void refunds preserved; offline teaser fixtures pass | No teaser migration, production settlement RPC or hosted acceptance/settlement validation |

## Implemented UI and eligibility

- Only compatible pregame matchup spreads qualify. At least **3 distinct matchups**, maximum **min(6, league matchup count)**. One side per matchup; repeated teams, same-game contradictions, unavailable/locked markets, other market types, live/future selections and stacked promos/boosts are excluded.
- Parlay / Teaser tabs replace the old Convert to Teaser button and duplicated comparison section. Switching tabs shows the relevant total odds and payout while keeping the original picks intact. Do not restore the old cluttered layout or add Singles/Round Robins merely because they appear in the visual reference.
- The points selector is a **46px outlined button**, with a proper SVG chevron, expanded rotation, visible keyboard focus, reduced-motion handling and dialog semantics. It opens a native bottom sheet with radio choices, choice odds/pending labels and Done. Escape closes the picker without dismissing the bet slip. Tab arrows/Home/End are supported.
- The teaser list shows original signed spreads, points added, and new lines once. Example: −8.5 plus 9 becomes +0.5; +5.5 becomes +14.5. The selected team never changes.
- “Teaser details” is now **“How teasers work.”** It is a collapsed explanation with the spread example and push/void/loss rules. Research notes were removed from that disclosure; “Research preview · Betting unavailable” stays visible.
- Mobile teaser view hides quick-wager shortcuts. Ordinary slips retain their normal controls. Eligible boost suggestions are hidden while viewing the teaser preview.
- Wager starts/resets as an empty string with placeholder 0. Focusing an actual zero clears it; entering 10 produces 10 rather than 010. Decimal amounts, fixed promo stakes and ordinary acceptance/revision checks retain their existing paths.
- DraftKings screenshots are **visual references only**. Do not copy NFL prices, adjustment ranges, key-number assumptions or special Monster/Super settlement rules.

## Files and execution paths

| File | Purpose |
| --- | --- |
| src/components/Sportsbook.tsx | Shared picks, adjustment state, selected-tab odds/payout, zero-placeholder wager, disabled teaser submission, ordinary/promo paths |
| src/components/TeaserConversion.tsx / .css | Tabs, outlined selector, native points sheet, responsive teaser columns and disclosure styling |
| src/lib/teaser-eligibility.ts | Eligibility and favorable spread adjustment math |
| api/place-bet.ts | Reject unsupported teaser/client-priced terms; preserve ordinary/fixed/boost requests |
| api/_lib/teaser-research.ts | Offline joint simulation pricing, uncertainty, saved subset terms and pure settlement research helpers |
| src/teaser-review.tsx / teaser-review.html | Local-only fixture review entrypoint; excluded from production build entrypoints |
| scripts/test-teasers.mjs | Eligibility, pricing/dependence/uncertainty/monotonicity and pure settlement fixtures |
| scripts/test-teasers-ux.mjs | Local browser conversion, picker, keyboard, lines, wager and disabled-price checks |
| scripts/research-teasers.mjs / collect-teaser-scores.mjs | Reproducible research and read-only completed-score collection |

**Local review prices +450 / +380 / +320 are sample fixtures, not production quotes or approved payouts.** They are injected only through the local review entrypoint. Production has no teaser quote request, accepted ticket, settlement operation or fixture-price table. Never make the UI's sample prices authoritative.

## Tests completed and what they prove

### Latest dropdown release, October 10

- npm run build: TypeScript, compiled API runtime fixtures and production bundle passed.
- npm run lint: zero errors; existing warnings remain in unrelated/previously existing effect/export/finally code. Existing large-bundle warning remains.
- npm run test:teasers:ux: **390×844 mobile and 1440×1000 desktop**, both dark/light themes. Point choices update lines and sample payouts; exactly one pick list; switching back restores original labels/prices; removal invalidates the teaser; missing prices keep acceptance disabled; wager starts blank and typing/refocusing zero behaves correctly.
- Keyboard tab switching and picker Escape passed. Picker close keeps the parent slip open. No external fixture requests or browser page errors. Screenshots visually inspected. No physical-device test was performed.
- Production postflight byte-matched Home/Admin/Promo/Reports assets to the tested build. Unsupported teaser terms returned 400 UNSUPPORTED_TICKET_TERMS; protected anonymous ordinary placement, generation, worker and promo-image endpoints retained 401.

### Prior research/slip releases retained

- npm run test:teasers passed eligibility boundaries, smaller-league maximum, duplicate/reused-team and unsupported-market exclusions; sign/cross-zero math; independence approximation and dependence sensitivity; uncertainty, conservative rounding, rare/push sample suspension; subset and adjustment monotonicity.
- Saved one/two/all-leg cashing, zero-leg refund, loss plus push precedence, unresolved/missing results or prices, and admin-void precedence passed as **pure settlement fixtures**.
- Compiled API guard fixtures rejected forged teaser terms with zero network side effects.
- Ordinary npm run test:ux regression journeys passed, including revised-price approval, fixture ticket/history, native dialogs, account/league/admin scope, report exports and unavailable/error states. Latest ordinary regression run was during the October 10 tab-layout release; no ordinary acceptance behavior was changed by the subsequent selector/help refinement.
- Research release also passed test:lines and test:promos, including existing refund paths.

**Limits:** these checks do not prove hosted teaser acceptance, concurrent wallet debits, hosted settlement/refund idempotency, teaser league isolation or an approved price policy. Those operations do not yet exist. No live user bet, authenticated test bet, test email or teaser database migration was performed.

## Deployment evidence

Production: https://sportsbook.coopergurrie.com. Working branch: stage-1-accounts; deployment branch: main.

| Release | Commit | Verified status |
| --- | --- | --- |
| Latest selector/help refinement | cd8a551b657fbafe825acfc1fd2a4801d5da12da | Pushed to main; production assets and anonymous guards verified October 10, **6:13:23 PM Eastern** |
| Tabs / one-list layout / wager placeholder | 19b325a721c3d7edafeab9453e0dfc5a27ed3a38 | [Vercel Ready / Production](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/CArrAZ7WLC3Y3ZU8k796ebPkSi6H), October 10, 6:08:12 PM Eastern; 24-second build; assets/guards verified at 6:08:16 PM |
| Research preview / server rejection guard | 31e00d4a5f92f6ec2e0c0095722df8d8c9ddcb26 | [Vercel Ready / Production](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/6XR6T1zBEC9UbgHCyScnModUcCSf), October 9, 4:38 PM Eastern; assets/guards verified at 4:38:40 PM |

Latest production verification is stored in this chat's outputs/dropdown-refinement/production-verification.json. Screenshots and checks are under outputs/dropdown-refinement; earlier layout proof under outputs/slip-redesign; research/benchmark evidence in outputs root. Absolute output root:

C:/Users/coope/Documents/Codex/2026-10-09/develop-fantasy-matchup-spread-teasers-including-2/outputs

This handoff-only update does not create a new application deployment. Recheck remote/main and current Vercel source before later work; this is the last verified release, not a promise that no other chat has deployed since.

## Confirmed settlement rules and remaining decision

The user explicitly rejected a fallback minimum that would refund one/two remaining legs: **one or two valid winning legs can still cash.** A losing leg loses the ticket, even alongside pushes/voids. With no loss, remove pushed/voided legs and recalculate payout from immutable saved terms. Unresolved legs wait. Full-ticket admin void preserves the existing exactly-once full stake refund and retained history.

**Zero remaining legs refund the stake is still a stated assumption requiring confirmation before launch.** Do not mark it as explicitly user-confirmed just because it appears in preview text. The historical “refund below two legs” recommendation is superseded and must not return.

Save every nonempty reduced subset, including singles (up to 63 subsets at six legs), or an approved equivalent deterministic saved policy. Conditional push/void pattern pricing remains a launch gate: unconditional research subset fixtures are not approved production push prices. Settlement must not depend on today's odds, lines or model.

## Research evidence and recommendation

[Detailed research](../research/teaser-pricing.md) contains official source links, arithmetic, methodology, caveats and the planned Supabase design. **Retain 6/9/12 centered on 9 for research; final range remains open. Prefer combination-specific joint simulation pricing.** No NFL payout table or key-number model is appropriate here.

- Completed Weeks 1–4: **24 matchups / 48 team scores**, signed margin mean/median 3.33/0.45, SD 45.95; absolute margin mean/median 38.57/37.70, IQR 18.46–56.00. Only 3/4/5 finished within 6/9/12. Actual margins are not forecast residuals or measured teaser cover gains; four weekly blocks are not 24 independent validation periods.
- Five 100,000-draw scale/dependence stress scenarios use seed 19092026 and common draws across adjustments. Three-leg +9 cover probability varies from 19.18% independent to 24.56% positive dependence and 17.63% mixed dependence. Sample odds use an **unapproved 5% hold**, upper Wilson bound and conservative rounding. Monte Carlo precision does not establish model accuracy.
- Collected source/digest and results: docs/research/teaser-completed-scores-2026-w1-w4.json and teaser-research-2026-10-09.json. Incomplete Week 5 scores were excluded; genuine extremes retained.
- Read-only production inspection at the research release found **zero model_forecast_runs** for this league. forecast_snapshots had two futures snapshots and one Week 5 weekly snapshot. Schema existence is not evidence of usable model capture history.
- docs/research/teaser-week5-benchmark.json preserves six published spread pairs/projections from snapshot d0b9c43d-caf8-4aa2-ae5e-5009a5b6322f, captured October 8 at 4:21 PM Eastern, with October 7 at 12:03 PM generation metadata. Chronology/lineup basis still needs verification before calling this a genuine pregame backtest; archived variance/covariance/joint draws are absent.

## Remaining issues and next development steps

1. **Collect finalized Week 5 data first.** After final scores/corrections, run node scripts/collect-teaser-scores.mjs LEAGUE_ID 5 OUTPUT and join by roster/matchup to the saved benchmark. Check collector arguments before execution. Do not refresh/reopen a closed board, publish research prices or fabricate historical joint forecasts. Analyze forecast margin error, both sides' cover/push outcomes at 0/6/9/12 and compatible 3–6-leg joint hit rates with week-block uncertainty. Label post-start captures accurately.
2. **Validate and choose the final adjustment/pricing policy.** Establish enough original pregame residuals, shared player/game dependence, discrete push/void distributions, model uncertainty and compatible side/combination sweeps. Approve final center/range, hold, stake/liability caps and zero-leg behavior. Validate monotonicity and expected return including reduced payouts/refunds; simple 1/P(all win) is insufficient when push mass exists.
3. **Implement authoritative server quoting only after validation.** Membership/league/board scope, expiry, phase/cutoff, quote revisions, compatible market kinds, distinct matchups and promo exclusion must be revalidated on the server. Save adjustment, original/adjusted lines, exact contractual odds/payouts, model/data/pricing/rule versions, simulation assumptions/seed, and conditional fallback terms. Never trust browser-provided odds or payout.
4. **Implement the planned additive database path.** Load Supabase Postgres Best Practices first. Use RLS, restricted privileged operations and short atomic acceptance/settlement/refund transactions. No teaser migration has been applied. Validate hosted stale/expiry/cutoff, league isolation, concurrent submissions, exactly-once debit/refund and saved-term settlement. Preserve ordinary parlays, promos and admin refunds.
5. **Complete accepted-ticket UX and operations.** Teaser history/reporting/confirmation representation and any admin workflow are still planned. Apply React Email when building confirmations. Review desktop/mobile with actual server quotes and saved ticket terms before enablement.

## Next-chat operating notes

- All requested skills were available and applied: Statistical Analysis, Validate Data, Supabase Postgres Best Practices, Frontend Design, React Best Practices and Webapp Testing. Use them again where relevant. Bundled Python lacked Playwright; the installed Node Playwright package followed the local reconnaissance/networkidle workflow.
- Local review: npm run dev -- --host 127.0.0.1 --port 5188 --strictPort, then /teaser-review.html; ?unpriced=1 exercises pending-price behavior. test:teasers:ux defaults to localhost:5188 and blocks external requests. TEASER_UX_OUTPUT selects an evidence folder. The local server was stopped at handoff.
- Preserve unrelated dirty handoffs 02/03, shared context, promo/research notes, untracked data/ and work/. Some shared-context edits predate this chat. Do not stage the entire checkout or discard another workstream's changes.
- User authorized tested normal deployments, **not** live user bets or an unvalidated teaser payout table. No recurring collection automation was created. A private SQL Editor draft with read-only inspection queries may remain; no sportsbook rows were changed by that inspection.
- Rollback should revert only the relevant application change and preserve other releases. No teaser database rollback or accepted-teaser repair is needed because this work created no teaser schema or accepted tickets. Do not remove the unsupported-term guard as a shortcut to launch.
