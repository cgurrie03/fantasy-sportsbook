# Copy-and-Paste Prompts for New Chats

## Current follow-up: development, expanded audit and support specification

Latest scope includes handoff 12 / A25: revamp all email notifications, replace stale Thursday closing reminders with actual-window scheduling, merge redundant sends, vary factual season storylines/market spotlights, and support meaningful futures category changes using tiny weekly comparisons. Include preferences, queue migration, exact receipts, correct league links, dev captures and email-budget measurements. Do not send production mail or release templates without the owner's approval. Read handoffs 08–12, with 00-current-handoff-status.md first.

Read handoffs 08–12 and the October 28 decisions in PROJECT-CONTEXT before using any older workstream prompt. Development is owner-only with separate test data; production changes require the owner's approval for the exact tested release. Use the existing repository with a development branch and isolated database; do not buy a paid custom environment. The owner-created Supabase dev project `whlcnlacueweaqpsupqs` is verified Healthy; local `development` branch exists at `d1ea6c9` but has not been pushed. Offline dev preflight/test scripts exist; schema/fixtures, runtime isolation/mail capture, auth, Preview variables, protected dev domain and release enforcement remain incomplete. Read handoff 09's latest checkpoint before continuing. No second repository is needed.

Handoff 10 expands A01–A25 and supersedes old assumptions about email import, full archives and launch readiness. Commissioner-distributed signup, owner-approved team claims, unregistered teams remaining visible, one account across leagues and an authorized league selector are required. All supported sportsbook settings start from the same defaults and can be overridden by Cooper. If capacity remains tight, offer further ways to stay free. Handoff 11 is specification-only: automatic/manual bug reports, Add details, receipt/status and button left of `?`; **do not deploy support yet**. No conversation UI initially.

## First priority: Supabase efficiency

```text
Make Supabase usage efficient before expanding this fantasy sportsbook or enabling another league. First read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/08-supabase-efficiency.md. Inspect the latest checkout and production baseline; preserve unrelated local changes. Apply Supabase Postgres Best Practices before database work.

Inventory every Supabase call, RPC, trigger and job. Measure storage growth, response bytes, calls, query time and retries. The user requires most generated data to be temporary: stop permanent full-board/projection/model archives for each refresh. Keep current state, bounded short-lived recovery/debug payloads, selected compact prediction samples until evaluation, and small durable accuracy summaries. Implement TTL cleanup, byte caps and monitoring, revision-aware board fetching, and bounded selected-league history/report/model-review reads. Retire full historical replay features where necessary. Preserve accepted ticket terms, financial records, required deduplication keys, current pricing quality/freshness, RLS and tenant isolation. Follow handoff 08's historical cleanup/dependency/restore procedure; do not blindly delete referenced records, raise timeouts, disable safeguards or buy a larger plan as the primary fix.

Work in the reviewable sequence and satisfy the acceptance gates in handoff 08. Verify one- and two-league load using actual imported Sleeper settings and active-game peaks. Keep the shared scheduler and public inputs shared. Record deployed changes, migrations, tests, before/after measurements, recovery evidence and remaining limits. Do not claim that the existing plan or row-count estimates prove savings or launch readiness.
```

Start each chat in `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`. Copy the complete corresponding block. The project context and handoff files carry the history, so you do not need to paste the entire previous conversation.

These prompts authorize development. They do not claim a new feature is already ready for production. Outstanding product/provider decisions must be resolved before the dependent behavior is enabled.

## 1. Automatic Line Refresh and Live Betting

```text
Implement scheduled line updates and live betting for our fantasy sportsbook.

First read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/01-scheduled-lines-and-live-betting.md. Inspect the latest repository, migrations and deployment; the handoff is dated October 8, 2026. Follow applicable installed skills, especially Supabase Postgres Best Practices before database changes and React/frontend skills for UI changes.

Confirmed: automatically regenerate and publish every 15 minutes while ANY NFL game is actually in progress, and every 2 hours when none are. Add live betting during games. The Tuesday week change stays on its existing schedule. Accepted tickets must NEVER change. Runtime publishing happens in the database, without repeated Git pushes.

Reuse the existing Supabase scheduler/worker, verify unattended execution, remove hardcoded league lookups, and preserve settlement/email job priorities. Build revisioned atomic quote publication, source freshness checks, suspension of known outcomes, and server-authoritative ticket acceptance with explicit approval of changed prices. Pregame projections cannot be reused as remaining live points. Respect actual locked starters during games. Preserve Thursday pregame close/promo expiry while adding a separate live market phase. Do not reopen an admin-paused board or resend opening emails during refreshes.

Investigate a reliable documented live data provider and its latency/cost before selecting it. Ask only for necessary provider/product decisions; continue independent work while waiting. If a market cannot be priced safely, keep it disabled with a clear reason, not an invented fallback. Enable live market families individually after their checks pass.

Complete meaningful scheduling, quote-race, immutable-ticket and settlement regression tests and show desktop/mobile previews. Deploy normal application changes through the established project flow when ready; do not purchase services, place live bets or send bulk test emails. Do not enable unsafe or untested live acceptance. End with what is functional, verified deployment/job evidence, remaining decisions and an updated handoff.
```

## 2. Weekly Model Assessment and Controlled Improvement

```text
Develop weekly assessment and controlled automatic improvement of our fantasy betting model.

Read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/02-model-evaluation-and-calibration.md, then inspect the latest model, forecast archives, reports and weekly pipeline. Apply Validate Data and Statistical Analysis; if the recommended Statistical Analysis skill is not installed, inspect and plan independently, then wait before executing its dependent work. Load Supabase Postgres Best Practices before database changes.

Archive immutable as-of inputs, probabilities, model versions, published lines and final outcomes for every market family, including opening, final pregame and selected live horizons. Separate best-lineup selection error from actual-starter forecasting error. Assess all generated predictions, not just wagered ones. Do not count the current incomplete week, leak future information, double-count quote refreshes or report unsettled futures as final results.

Build a compact weekly model review with score error/bias, uncertainty and probability calibration, special-market distributions, futures trajectories, data coverage and candidate-vs-baseline results. Integrate it after confirmed results without breaking settlement, replenishment, recap or rollover.

Use a frozen baseline, chronological validation, small shrinkage-based candidate changes, sample/confidence gates, bounded parameter changes, versioned promotion, pause and rollback. Automatically keep the current model when evidence is insufficient. Never let an LLM rewrite/deploy production code after each week, and never train to maximize user losses. Forecast accuracy is an estimate, not a guarantee.

Implement the complete assessment pipeline and gated configuration mechanism, test reproducibility, idempotency, data corrections and rollback, and show the report preview. Deploy tested normal changes; do not force a new model into production without passing the gates. Preserve every accepted ticket. Finish with evidence, limitations and updated documentation.
```

## 3. Image Promos and Claimable One-Use Boosts

```text
Build the dedicated Promos & Boosts administration and user experience.

Read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/03-promos-and-boosts.md first. This supersedes the older general promo handoff. Use Frontend Design, React Best Practices, Supabase Postgres Best Practices, and React Email for changed email templates. Use Webapp Testing for the regression journey; if missing, inspect/plan and wait before its dependent work.

Place three equal image offer boxes on Home > Matchups, below the market-category menu and above the matchup lines. All offers disappear Thursday 8 PM Eastern until next week's offers are provided.

Type 1: an admin-defined fixed ticket. Clicking fills a special slip whose selections/lines cannot be edited or added to; wager is editable unless explicitly fixed. Confirm before replacing another active slip. Refreshes cannot silently rewrite advertised terms.

Type 2: a claimable one-use profit boost, optionally advertised with a code. Admins choose allowlisted eligibility criteria from dropdowns and link them to an image. Example: 50% profit boost for five Player Points selections. Once a slip qualifies, show an eligibility message, toggle on/off, and accurate original/boosted odds and payout. Claim does not consume the boost; successful acceptance consumes it exactly once. Do not boost returned stake or multiply American odds directly.

Implement admin drafts, scheduling, image validation, criteria, caps, usage history, per-league permissions, server expiry, atomic acceptance/redemption and concurrent-tab protection. Resolve minimum-vs-exact count, caps, stacking, pushed-leg eligibility and full-void restoration rules before enabling dependent behavior. Ask only where needed and keep independent work moving. Preserve existing market compatibility, ticket snapshots, refunds and email behavior.

Test fixed-slip immutability, eligibility transitions, math, expiry, retries, two-tab use, push/refund behavior and league isolation. Show polished desktop/mobile previews. Deploy tested changes through the existing project flow; do not place real user bets or send bulk test emails. End with functional status, deployment evidence and remaining decisions.
```

## 4. Fantasy Spread Teasers

```text
Develop fantasy matchup spread teasers, including fair pricing and settlement.

Read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/04-teasers.md. Research the linked official teaser examples, and apply Statistical Analysis, Validate Data, Supabase Postgres Best Practices, frontend/React skills and Webapp Testing. If a recommended skill is missing, complete independent inspection/planning and wait before its dependent work.

Confirmed: three or more DISTINCT fantasy matchups, with a small choice range around an ideal model-tested point adjustment. Investigate 6/9/12 fantasy points centered on 9 as a provisional range; select the final range from our margin distributions. Do NOT copy NFL teaser payout tables or NFL key-number assumptions. Initially support pregame spreads only, with a maximum compatible with the league's matchup count.

Add Convert to Teaser in a qualifying slip. Show original vs adjusted spreads, adjustment choice, original parlay vs teaser odds and payout; allow converting back. Price using joint score simulation and test correlations, uncertainty and monotonicity. Exclude same-game contradictions, other market types and stacked boosts/promos in v1. The server controls price, revisions and ticket acceptance.

Confirm push/void rules before enabling accepted tickets. Recommended: remove pushed/voided legs and reprice from saved rules, refund below the fallback minimum if no losing leg. Save everything needed to settle later without today's odds/model. Preserve ordinary parlays and admin void refunds.

Complete pricing research, meaningful conversion/acceptance/settlement fixtures, and desktop/mobile previews. Deploy tested normal changes only; do not enable an unvalidated teaser payout table or place live user bets. Finish with recommended adjustment/pricing, evidence, remaining decisions and the updated handoff.
```

## 5. Site Audit, Mobile Polish and Disconnected Leagues

```text
Audit and improve the fantasy sportsbook's UX, mobile formatting, operational reliability and readiness for multiple disconnected leagues.

Read docs/handoffs/PROJECT-CONTEXT.md and docs/handoffs/05-audit-mobile-and-multi-league.md. Use Web Design Guidelines (fresh source), Frontend Design, React Best Practices, Validate Data, Supabase Postgres Best Practices for database/security work, and Webapp Testing for repeatable journeys. If Webapp Testing is missing, inspect/plan and wait before its dependent work.

Review the whole user/admin journey, not only one screenshot. Validate actual mobile viewports, light/dark contrast, long team names, balance visibility, intentional line wrapping, date rows, safe areas, keyboard-open slip, scrolling, empty/loading/error states, and report exports. Desktop should retain its layout. Give file/line findings with severity and evidence; do not claim screenshots or device tests that did not actually run.

Resolve critical and high-impact issues, preview the visual changes, and add meaningful regression checks. Audit quote acceptance, idempotent debit/refund, worker errors, permissions and email/recipient isolation. Preserve functioning accessible native dialog/details patterns instead of rewriting them unnecessarily.

Prepare and implement necessary league-scoping foundations: remove hardcoded provider IDs/branding/context, isolate wallets/markets/tickets/offers/files/jobs/reports and admin roles, and test two leagues with overlapping identities. Do not expose cross-league data or enable a second live league before isolation tests pass.

Prioritize the documented feature backlog into critical, important and nice to have. Suggest better bets/features only with clear pricing, contradiction, settlement and data requirements. Implement the agreed high-priority foundation, deploy verified changes through the normal project flow, and finish with screenshots, tests, deployment status, remaining risks and a concise next-step roadmap. Do not place live bets, send bulk test emails or introduce paid services without a decision.
```
