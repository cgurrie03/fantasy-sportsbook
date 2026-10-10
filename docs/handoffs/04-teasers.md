# Fantasy Spread Teasers

## Dropdown refinement — October 10, 2026

The point selector now uses a 46px outlined button with an SVG chevron, expanded rotation, visible keyboard focus and dialog semantics. “Teaser details” is renamed “How teasers work,” with a spread example and concise saved-price settlement explanation. Research notes are removed from that disclosure; the disabled research status stays visible. Build/API fixtures and desktop/mobile conversion/points/keyboard checks passed; lint has existing warnings only. Normal UI release pending production verification; no pricing, acceptance or settlement behavior changes.

## Slip design update — October 10, 2026

The user’s DraftKings screenshots are visual references only; NFL payout values and adjustment choices are not copied. Qualifying slips now use Parlay / Teaser tabs, a native modal points picker with 6/9/12 fantasy-point choices and total odds, and one pick list showing original spread / points / new line. The selected tab controls total odds and payout; returning to Parlay preserves original selections and prices. Research rules live under a collapsed Teaser details disclosure. Mobile hides quick-wager shortcuts in the teaser view.

Wagers start and reset as an empty value with a visible 0 placeholder. Focusing an actual zero clears it; typing 10 produces 10. Decimal stakes, fixed promo stakes, normal acceptance and revisions retain their existing behavior.

Validated desktop 1440×1000 and mobile 390×844, both themes, adjustment changes and sample payouts, one list without duplicate picks, keyboard tab arrows, picker Escape without dismissing the slip, conversion back, invalidation after removing a pick, and unpriced disabled acceptance. No external fixture requests or browser errors. Build/API fixtures, teaser pricing/settlement fixtures and ordinary-slip UX regression fixtures passed. Existing lint warnings remain. Screenshots and checks are saved in outputs/slip-redesign.

Teaser price/acceptance remain disabled in production. Local review sample prices are not launch prices. The final adjustment range and fair pricing still require this week’s results and the validation gates below. UI release **19b325a721c3d7edafeab9453e0dfc5a27ed3a38** is deployed to production. [Vercel release](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/CArrAZ7WLC3Y3ZU8k796ebPkSi6H) was Ready / Production October 10 at 6:08:12 PM Eastern (24-second build). Postflight at 6:08:16 PM Eastern byte-matched the served Home/Admin/Promo/Reports assets to the tested build and verified unsupported teaser terms still reject with 400 and protected ordinary endpoints retain 401. No authenticated bet, email or database migration occurred. This final postflight note is local; the design and verification plan were committed with the application release.


## Current research release — October 9, 2026

Read [shared context](PROJECT-CONTEXT.md) and [the completed research/validation/acceptance specification](../research/teaser-pricing.md). **This week is data collection and research. Teaser prices and acceptance remain disabled. No teaser migration or production settlement RPC was introduced.** The historical brief below is superseded by this section wherever the rules differ.

### Confirmed settlement correction

The user explicitly clarified that tickets reduced to **two or fewer valid legs can still cash**. One remaining winning leg cashes at its saved price, as do two remaining winning legs. Any losing leg loses the ticket, including loss plus push/void. Remove pushed/voided legs with no loss; unresolved legs wait. Zero remaining legs refunds the stake (stated implementation assumption). Whole-ticket admin void preserves the existing exactly-once full stake refund and retained history.

This overrides the historical recommended two-leg fallback minimum. Store every nonempty subset price, including singles: up to 63 subsets for six legs. Conditional push/void pattern pricing remains a launch gate; unconditional research subset fixtures are not approved production push prices.

### Implemented and tested

- `src/lib/teaser-eligibility.ts`: 3–6 pregame spread legs bounded by actual league matchup count, distinct matchup and team validation, one side per matchup, availability/lineup checks and all-kind/live/future/boost/promo exclusions.
- `TeaserConversion.tsx` / `.css` and `Sportsbook.tsx`: qualifying Convert to Teaser, provisional 6/9/12 selector, original/adjusted spreads, original parlay price/payout and conversion back preserving original selections. Production shows Price pending / Payout pending validation and cannot submit a teaser. Local `teaser-review.html` / `src/teaser-review.tsx` inject explicitly labeled fixture odds; that entrypoint is excluded from the production bundle.
- `api/place-bet.ts`: reject unsupported ticket terms, including teaser/adjustment/forged quote/odds/payout fields, before any auth/RPC/wallet/email request; no silent conversion into an ordinary parlay. The allowed ordinary/fixed/boost request and database paths remain intact.
- `api/_lib/teaser-research.ts`: offline joint score cover counts, Wilson Monte Carlo uncertainty, conservative 10-point contractual rounding, original-parlay payout cap, rare-event/push-mass suspension, all nonempty saved subsets and pure settlement fixtures. No production quoting/acceptance/settlement operation calls this research engine.
- `scripts/research-teasers.mjs`, `collect-teaser-scores.mjs`, `test-teasers.mjs`, `test-teasers-ux.mjs`; package commands `research:teasers`, `test:teasers`, `test:teasers:ux`. Collector is read-only, validates current period and excludes the current week. No recurring automation was created.

### Data and pricing recommendation

Read `docs/research/teaser-pricing.md` for official source links, exact methodology, caveats, pricing arithmetic, Supabase acceptance design and next-week review. Completed Weeks 1–4 provide **24 distinct matchups / 48 team scores**: signed margin mean/median 3.33/0.45, SD 45.95; absolute margin mean/median 38.57/37.70, IQR 18.46–56.00. Only 3/4/5 finished within 6/9/12 points. Four weekly blocks are not 24 independent validation periods. Actual margins are not forecast residuals or measured teaser cover gains. Week 5 incomplete results excluded; genuine extremes retained.

Five 100,000-draw scale/dependence stress scenarios use seed 19092026 and common draws across adjustments. Three-leg +9 cover probability: 19.18% independent, 24.56% positive-dependence, 17.63% mixed-dependence. Illustrative independent +6/+9/+12 odds +450/+380/+320 apply an **unapproved** 5% hold, upper Wilson bound and conservative rounding. These are local fixtures, never production offers. Monte Carlo precision is not model accuracy. No NFL table/key-number assumption was copied.

**Recommendation: retain 6/9/12 centered on 9 for research, with final range open.** Prefer combination-specific joint pricing. This week's six new matchups can inform the next center but do not independently validate stable correlations or a final payout policy. No final range was selected from insufficient data.

Collected source/digest and reproducible results: `docs/research/teaser-completed-scores-2026-w1-w4.json`, `teaser-research-2026-10-09.json`. Production read-only inspection found **zero** `model_forecast_runs` for this league; `forecast_snapshots` contains two futures snapshots and one Week 5 weekly snapshot. No complete original joint-model validation history was found.

`teaser-week5-benchmark.json` preserves six published spread pairs/projections from snapshot `d0b9c43d-caf8-4aa2-ae5e-5009a5b6322f`, captured October 8 at 4:21 PM Eastern, with October 7 at 12:03 PM Eastern generation metadata. Source chronology/lineup basis still needs verification before a backtest claim; archived variance/covariance/joint draws are absent. SQL inspection changed no sportsbook data. A private SQL Editor draft containing only read-only queries may remain. No closed-board refresh or publication occurred.

After final Week 5 scores/corrections, run `node scripts/collect-teaser-scores.mjs LEAGUE_ID 5 OUTPUT`; join by roster/matchup to the saved benchmark. Analyze forecast-margin errors, both sides' cover/push outcomes at 0/6/9/12, and compatible 3–6-leg joint hit rates with week-block uncertainty. Label newly captured post-start observations accurately. Do not create purported historical joint forecasts. Existing `save_model_forecast`/worker collection was unchanged; verify actual future captures rather than assuming collection because the schema exists.

### Validation and limits

Passed `test:teasers`: sign/cross-zero math, 3/6 and smaller-league cap, duplicate/reused teams, unsupported kinds/live/future/state/promos, independence approximation and dependency sensitivity, subset monotonicity, uncertainty/rounding, small/rare/push samples, saved one/two/all-leg cashing, zero-leg refund, loss precedence, pending/missing result/price and admin-void precedence. Compiled `test:api` guard fixtures reject forged teaser terms with zero network side effects. `build`, `lint` (zero errors; existing warnings), `test:lines`, `test:promos` and isolated ordinary `test:ux` journeys pass, including revised-price approval and existing refunds.

Local browser proof: **390×844 and 1440×1000**, dark/light, choices, fixture original/teaser comparison, preserved originals, conversion back, invalidation after removal, and unpriced acceptance disabled. Zero external requests/page errors. Visual review fixed research dialog scrolling and text contrast. `work/teasers/ux/checks.json` and screenshots hold evidence; copies are in this chat's outputs. Physical devices untested. Python lacked Playwright; the installed Node Playwright package followed Webapp Testing's networkidle/reconnaissance workflow.

These are research/conversion/pure-settlement and fail-closed rejection fixtures. They do **not** prove a hosted teaser acceptance RPC, concurrent wallet debit, production settlement/refund idempotency, or authorization for a new teaser data path.

### Remaining gates and decisions

1. Enough original pregame residual data; validated shared player/game dependence and actual discrete score/push/void distributions, model uncertainty and full compatible side/combination sweeps.
2. Final adjustment center/range; approved hold and liability/stake caps; zero-leg refund assumption. One/two-leg cashing and loss precedence are confirmed.
3. Versioned server quote operation with authoritative membership/scope/revision/expiry/phase/cutoff checks and immutable conditional fallback terms. Validate total expected return including pushes and refunds; do not use simple 1/P(all win) when push mass exists.
4. Additive Supabase migration, RLS, restricted privileged operations and short atomic acceptance/settlement/refund transactions; hosted stale/concurrency/expiry/league-isolation/idempotency fixtures. Detailed design is in `teaser-pricing.md`; **no migration applied**.
5. Saved teaser representation in history, reporting and confirmations. Apply React Email when implementing confirmations. Preserve ordinary parlays and admin refunds.

### Deployment and rollback

The tested preview/guard application commit **`31e00d4a5f92f6ec2e0c0095722df8d8c9ddcb26`** is deployed through normal Git/Vercel to production. [Vercel release](https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/6XR6T1zBEC9UbgHCyScnModUcCSf): Ready / Production, October 9 at 4:38 PM Eastern, 21-second build. Postflight at 4:38:40 PM Eastern byte-matched the production Home/Admin/Promo/Reports assets to the tested build. Teaser/adjustment/forged-quote/odds/payout requests return 400 `UNSUPPORTED_TICKET_TERMS`; ordinary anonymous placement, generation, worker and image endpoints retain 401. No authenticated bet, email or database migration occurred. Acceptance and prices remain disabled.

Production evidence is in this chat's `outputs/production-verification.json`; research, Week 5 benchmark, preview checks and desktop/mobile screenshots are also copied to outputs. This postflight documentation update is local and does not introduce another application deployment. Concurrent promo commits through `c31910e` were retained; unrelated dirty documentation/data/work files remain untouched by the release commit.

Rollback reverts this application release only. No database rollback or teaser-ticket settlement repair is necessary because no accepted teasers exist. Do not roll back unrelated promo/model releases. Removing a guard or flipping a UI flag is not a launch process.

## Historical initial brief (superseded by the current release above)

Read [shared context](PROJECT-CONTEXT.md). User confirmed three or more distinct matchups and a small adjustment range around an ideal center. Status: pricing research and implementation specification; no approved production table yet.

## Research and Recommendation

In an NFL teaser, each selected spread moves favorably by a fixed amount, while the ticket's payout decreases. DraftKings' published regular NFL table offers 6, 6.5 and 7-point choices: its example three-leg 6-point ticket pays +140, versus +120 at 7 points; four legs pay +240 versus +180. These are examples of the mechanism, **not appropriate fantasy prices to copy**. Fantasy scoring has a different margin distribution and no NFL field-goal/touchdown key-number structure. See [DraftKings' rules and example table](https://support.draftkings.com/dk/en-us/what-is-a-teaser?id=kb_article_view&sysparm_article=KB0010765).

Investigate a provisional **6–12 fantasy-point adjustment range**, with **9 points as a candidate center** and choices 6 / 9 / 12. This range is a research starting point, not a claim of fairness. Select the final center and narrow choices after simulating this league's score/margin distributions and demonstrating sensible prices. An uncertainty-scaled center is possible, but freeze the resulting adjustment and pricing version on acceptance.

Start with 3–6 distinct fantasy matchups, which covers all six matchups in the current 12-team league. Larger disconnected leagues can receive a separately validated maximum. The user's rule is “three or more,” not exactly three or four.

## Bet Slip Behavior

- Offer **Convert to Teaser** only when every pick is a compatible matchup spread, from distinct matchups, with at least three eligible legs.
- Show a compact adjustment selector, original and adjusted spread per leg, original parlay versus teaser odds, stake and potential payout. Apply the same favorable point increment to every leg.
- Example with +9 points: favorite −8.5 becomes +0.5; underdog +5.5 becomes +14.5. Crossing zero is valid; preserve which team was selected.
- Converting back restores original selections and latest valid quote review. Do not silently leave adjusted lines in a standard parlay.
- No opposite sides of the same matchup, same-game duplication, players, totals, weekly specials, futures, fixed promos or additional boosts in v1. Do not bypass existing compatibility restrictions.
- Initially offer teasers only on approved **pregame** spreads. Live teaser pricing is a separate extension and must not inherit pregame uncertainty or prices.

## Pricing

Use joint simulated fantasy score distributions to estimate the chance all adjusted spreads cover. Account for shared NFL players/games, player dependencies and matchup-level score relationships. Treat independence as a tested approximation only, not a silent default. Save raw probability, modeled correlation assumptions, pricing/margin policy, rounded contractual odds and seed/version.

More favorable lines must not produce better payout for the same legs. Validate monotonicity across adjustments and that the teaser price is less generous than the corresponding ordinary parlay. Respect standard matchup odds increments of 10, while retaining precise underlying probabilities. Measure simulation uncertainty; rare-event prices cannot be justified by a handful of simulated wins. Use sufficient effective samples or bounded conservative fallback; suspend unpriceable combinations.

A universal fixed NFL-style table may be easy to display but may misprice heterogeneous fantasy margins. Prefer combination-aware pricing initially. If eventually using a fixed table, validate against many ticket combinations and document liability caps. Include a saved two-leg fallback price even though users cannot initially create two-leg teasers, if push rules can reduce a three-leg ticket to two.

## Settlement Decision Still Needed

Recommend regular teaser behavior: a losing leg loses the ticket; with no loss, pushed/voided legs are removed and the ticket is repriced according to its **saved** pricing version. If fewer than the permitted fallback minimum remain, refund. Confirm the minimum and precedence before launch. Do not copy “push loses” from a special Super/Monster teaser without approval.

Settling a reduced teaser cannot use today's current lines or today's model. Keep an immutable conditional reduced-leg price/policy for relevant push subsets or a documented deterministic saved table. Store original/adjusted spreads, adjustment, base quote revisions, ticket type, pricing version, payout terms, and leg results. Standard admin void still refunds the whole stake exactly once.

## Implementation Sequence and Acceptance

1. Establish probabilistic spread distributions and price research with known fixtures.
2. Specify and confirm adjustment choices, maximum legs, push/void behavior and pricing caps.
3. Add a server-authoritative teaser quote endpoint/operation with expiry and revision checks.
4. Add conversion UI and the adjusted-line ticket/email representation.
5. Add settlement and reporting by ticket type; keep ordinary parlays unchanged.

Verify sign/cross-zero math, minimum/maximum count, duplicate matchups, monotonic payout, unsupported kinds, stale revisions, data lockouts, concurrent submissions, saved-price pushes, one loss plus push precedence, all-void refund and immutable accepted terms. Backtest with genuine as-of data; do not present reconstructed historical projections as a demonstrated edge. Show mobile preview and settlement fixtures before enabling.

Skills: Statistical Analysis, Validate Data, Supabase Postgres Best Practices, Frontend Design, React Best Practices, Webapp Testing; React Email when adding teaser confirmations.
