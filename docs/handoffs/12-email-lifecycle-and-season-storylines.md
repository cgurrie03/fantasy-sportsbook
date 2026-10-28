# Email lifecycle, improved schedule and evolving league storylines

October 28, 2026. Requested addition to the implementation handoff. Implement and preview in isolated development first. No production schedule, template or email delivery is changed by this document; every production release requires owner approval. Read 08 for temporary storage, 09 for environment/release isolation, and 10 for league configuration and access.

## Goal and precedence

Revamp **all email notifications** to follow the current product processes and each league's actual state. Stop using the same three headlines/content slots every week. Emails should help members understand their league, available markets, meaningful changes, accepted tickets and results.

The owner's example is explicit: if weekly betting stays available until Monday night, there is no reason for a Thursday closing reminder. Remove calendar-driven Thursday urgency from that lifecycle. Older handoff instructions to preserve a Thursday reminder/cutoff are historical, not authorization to keep obsolete communication behavior.

First verify the actual runtime acceptance lifecycle: published/open windows, market-specific event locks, special reopening windows, admin pauses, freshness and final weekly deadlines. The earlier implementation contains pregame/reopening distinctions, so **do not assume every market is continuously bettable until Monday** or change acceptance rules merely to match an email. Resolve any mismatch in the underlying process explicitly. Schedule and wording must come from the same league/window policy used by the site and server acceptance.

## Complete inventory before changing jobs

Inventory opening/digest, reminder, reopening, Monday watch, accepted-bet confirmation, recap/results/replenishment, admin attention, and auth/signup/invitation/recovery communications. Include scheduler enqueueing, job priorities, outbox uniqueness, retry/frozen payload behavior, recipient validation, current preferences, sender identity and deep links. An unused old template must not remain active through a second enqueue path.

Relevant starting points: `api/_lib/mail.ts`, `email-templates.ts`, `monday-watch.ts`, `reopening-email.ts`, `league-communications.ts`, worker/execution endpoints, current scheduling migrations, auth templates and `scripts/test-monday-watch.mjs`. `mail.ts` currently has a static “Betting Closes Tonight” reminder and calls `openingWeekStories`; delivery checks available balance for reminders but that alone does not prove the linked bets remain eligible.

Create a per-notification matrix: purpose, trigger, source of truth, recipients, required data, send/skip conditions, latest valid send time, deduplication key, preference category and retention. Confirm every current path has an intentional replacement or a documented unchanged role.

## Improved default schedule

These are proposed implementation defaults, owner-configurable per league and previewed against its actual window. Eastern is the current default display/scheduling zone; use IANA zones and DST-safe timestamps. Relative events are authoritative, not fixed weekday labels.

| Message | Default trigger and timing | What it says / guard |
| --- | --- | --- |
| Weekly league edition | Wednesday 6 PM Eastern, once the new week's fresh board is genuinely published/eligible. If readiness is later, send after readiness; do not send a stale missed edition after its usefulness expires. | Two or three strongest current stories, a rotating market spotlight, valid featured games/promos and a league-scoped link. Replace the old separate routine opening announcement with this edition; do not send both. |
| Final actionable reminder | 90 minutes before the actual final weekly betting opportunity, if meaningful eligible weekly markets remain. For a Monday-night close this is Monday, not Thursday. | Show the exact deadline and only actionable markets. If useful, combine with relevant Monday ticket-watch information rather than sending two overlapping emails. A futures board still being open does not justify claiming weekly betting remains open. |
| Weekly results and replenishment | Tuesday recap slot, proposed 10 AM Eastern, after required results/settlement and replenishment are confirmed. If delayed, defer the recap until ready within its useful window. | Confirmed results, league movement, personal settled-ticket summary and actual credited replenishment. If policy permits a partial recap, clearly label pending results/credit; never claim money was credited before it was. Avoid a separate routine replenishment email. |
| Bet receipt | Immediately after durable successful acceptance, once per accepted ticket | Original saved selections, price/boost/stake/return terms and correct league. No receipt for a failed/retried acceptance; idempotency is essential. |
| Material operational change | Event-driven; only affected recipients, with cooldown | A genuine changed/approved betting window, major correction or necessary action. Routine quote refreshes, restored transient freshness and minor odds movement do not each create an email. |
| Owner operational alert | New actionable failure or persistent threshold breach, grouped/rate-limited | League, failed operation, impact and admin link. Staff-only oversight is an eligible recipient; it must not receive fictional personal betting balances/recaps. |
| Auth / signup / invitation / recovery | User action or approved invitation event | Product/environment identity, intended league/role and safe destination. These are functional messages, not sports editorial templates. |

No scheduled Thursday closing reminder exists under a Monday-close policy. A genuine Thursday-specific market deadline or approved expiring offer may warrant targeted copy only if enabled/relevant; it must identify the specific deadline and not imply the entire sportsbook closes.

If the board is paused, stale, closed, already decided or lacks eligible selections, skip misleading promotion and show an accurate state where necessary. No “last chance” for settled/locked outcomes. Future date/time changes invalidate pending reminders; reschedule them from the updated authoritative window. Reopening announcements must describe precisely what reopened and until when, not imply all live markets are enabled.

Default routine volume: at most three league emails per member per week (edition, actionable reminder, recap). Monday watch replaces/merges with that slot; an optional watch-only message requires relevance and preference, rather than becoming an unconditional fourth send. Collapse coincident messages, apply quiet hours where possible, and drop expired reminders instead of sending them the next morning. Transactional receipts and necessary security/action messages have separate controls and must not be suppressed by an editorial cap.

For users in multiple leagues, keep every section and action clearly league-scoped. Default to separate league messages with per-league preferences and a recipient-level frequency budget; consider one explicitly enabled multi-league digest later. Never include another league's data because an email address happens to match. Forecast combined auth/transactional/editorial volume against the actual shared email allowance; coalesce optional content before service limits endanger essential delivery.

## Story selection: different substance, not only different wording

Build a structured candidate set from current authorized markets, compact comparable prior-week data, standings, confirmed results and saved tickets. Each candidate carries the underlying facts, reference times, league/season/week/category, sample quality, score, exclusions and an evidence key. Select a diverse two/three-card edition. More available data must not mean more email sections.

Story families should include:

- **Championship fall/rise:** largest meaningful drop or gain in champion probability/price within that category. Distinguish price movement from actual elimination.
- **First-pick movement:** a new leader or meaningful rise in the applicable #1-pick market; state that this is draft/last-place probability, not a championship favorite. “Unexpected” requires a documented contrasting baseline, not an invented narrative. Respect the league's actual draft/lottery/traded-pick rules.
- **Playoff race:** last qualifying position, a meaningful probability swing, tightly grouped contenders or a confirmed clinch/elimination where rules/results establish it.
- **Matchup tension:** close projected spread, a rematch/rivalry supported by compact results, a legitimately unbeaten streak or a significant result. Do not invent injuries, rivalries or motivations.
- **Game of the Week / Tank Bowl:** rotate these into editions when relevant, with actual designation, eligible boost terms and current selections. Do not force both every week.
- **Market discovery:** rotate team totals, winning margins, milestones, player points, head-to-head and supported weekly specials. Feature a real eligible selection and one short explanation of that market. Never highlight sample/research teasers or disabled ordinary live betting as available products.
- **Member results:** a verified notable win, close result or league leaderboard change, subject to visibility/privacy rules and saved ticket facts. No invented winnings or guaranteed-return language.
- **Personal relevance:** optionally highlight the recipient's own team's matchup or open ticket watch. A private ticket/balance story is generated only for its authorized recipient.

Score candidates for significance, freshness, completeness, season relevance, recipient usefulness and novelty. Apply family/team/category cooldowns, proposed two editions for the same lead unless a materially new event warrants it. Avoid featuring the same team in all cards. Keep a small last-sent story-key history and rotate the spotlight category. If only one meaningful story exists, send one; if no meaningful data exists, use a short factual market guide or omit the optional edition. Do not invent stories to fill three slots.

## Futures movement: exact comparisons with tiny retained data

Compare matching league, season, category, team/outcome, rules and price policy at defined weekly horizons. Use comparable unboosted fair model probabilities where reliable; otherwise label movement as quoted odds/implied probability rather than asserting calibrated championship chances. Champion and #1-pick markets are different distributions. Only normalize a complete mutually exclusive outcome set where appropriate; playoff-qualification probabilities across teams must not be normalized to sum to one.

Measure changes in probability percentage points or a defined comparable price/rank metric, not raw American-odds subtraction. A plus/minus sign crossing makes raw differences misleading. Default story threshold might be three percentage points; validate that against actual model noise and make it a typed owner setting. Suppress differences caused by missing outcomes, changed scoring/rules/models or incomplete/freshness-mismatched samples. Explain a model/policy change separately instead of calling it team performance.

Example fixture wording (not a claim about actual teams): “Team A's championship estimate fell from 24% to 13% since last week's edition, the largest drop in the category.” Another: “Team B moved to the top of the #1-pick market.” Use “unexpected” only with a defensible earlier baseline; do not claim a certain result from a forecast.

Store **one compact weekly editorial comparison per eligible outcome**, upserted at the chosen edition horizon. Retain current/previous weekly samples, optionally one small season-opening reference for season-long comparisons, and bounded recent sent-story keys. Fields: outcome/category IDs, comparable probability/unboosted odds/rank, timestamps, season/week and model/rules version. No raw provider responses, full quote metadata or snapshot per refresh. Generate summary facts once per league edition, not by scanning archives for every recipient. Candidate diagnostics expire; sent-email content follows short outbox retention with durable compact deduplication/status.

Measure this feature's physical footprint and provider/database reads in handoff 08's budget. Proposed initial editorial comparison/selection-state target ≤1 MB per league, verified with real row/index overhead. If references exceed it, bound horizons/segments; do not restore permanent detailed archives just for storytelling. Existing fixed-horizon quality samples can be reused where authorized/comparable, avoiding another copy.

## Templates should evolve through the season

Derive phases from the imported league's regular-season end, playoff start/rounds and final result, not hardcoded week numbers or seven playoff entrants.

| Phase | Editorial emphasis |
| --- | --- |
| Opening / early season | Introduce unfamiliar markets, roster/team identities and early changes without exaggerating small samples. |
| Middle regular season | Meaningful standings/strength movement, rematches, performance trends and varied market spotlights. |
| Playoff run-in | Actual bubble/qualification rules, narrowing races, champion changes and applicable first-pick stories. |
| Fantasy playoffs | Bracket/round matchups, confirmed advancement and remaining enabled markets. Distinguish fantasy playoffs from the NFL postseason. |
| Final / offseason | Verified final results, season recap and account/balance/renewal information. Suppress weekly “bet now” content when no supported markets exist. |

Use composable templates: factual lead + optional cards + personal account block + accurate action/expiry. Add several concise phrasing variants per story type, selected deterministically by edition key; novelty comes chiefly from different facts. Keep a recognizable layout while changing section emphasis. Use plain-text parity, accessible HTML, readable mobile typography and dark-mode-safe colors. Escape team names/notes and validate all links; don't inject untrusted provider text as HTML. No paid generative-AI service or automatic external content fetch is needed to vary headlines.

Show current odds “as of” their snapshot time and say prices may change; receipt prices remain the accepted saved terms. Every button identifies a league-scoped valid destination. Owner previews actual examples for each league/season phase, including missing-data and zero-story cases. Reusable product branding and per-league identity stay separate; the proposed BOFF name is not silently finalized here.

## Queue safety, preferences and rollout

Define preference categories for routine editions/reminders/recaps versus essential transactional/account messages. Make member controls clear; owner changes league defaults without fabricating another member's consent/settings. Verify existing preferences before migration; do not silently turn previously disabled editorial mail back on.

Idempotency includes league + recipient + season/week + purpose + relevant window/edition version. Multiple workers, schedule edits, pause/resume and retries must not duplicate messages. Existing queued Thursday jobs/payloads need a migration plan: preserve sent history/deduplication, mark obsolete pending reminders skipped and enqueue only currently valid replacements. Frozen queued payloads may contain old deadlines; validate deadline, board availability, recipient scope and template/policy version again at send time. Never rewrite accepted receipts while refreshing editorial content.

Implement schedule policy, schema/configuration, queue logic, templates, preferences and admin preview together. Shared defaults with owner-only per-league overrides govern timezone, reminder lead time, editorial cadence, enabled story families, novelty/thresholds and optional market spotlights. Rate-limit operational alerts and retain enough compact state for reliable delivery, without unlimited bodies/logs. Dev captures mail; no real-member bulk tests or production sending during implementation.

## Implementation and acceptance checklist

1. Inventory current paths, verify actual acceptance windows, document proposed notification matrix and reconcile all stale Thursday copy/jobs. Do not loosen betting safety to fit messaging.
2. Implement typed shared/default league notification policy and migration of pending obsolete schedules, with versioned idempotency and send-time revalidation.
3. Implement bounded weekly comparison samples, factual candidate generation, novelty/ranking and season-phase selection. Compare metrics against independent fixtures.
4. Build evolving templates/previews plus preferences and owner-only controls; retain exact receipt/account semantics. Repair and expand email harnesses/CI.
5. Verify in dev: Monday-close policy produces no Thursday closing reminder; actual earlier/specific-market deadlines are described accurately; stale/paused/closed boards cannot generate false urgency; postponements, DST, late jobs and partial results behave correctly.
6. Verify one/two-league membership, staff-only oversight, no unregistered team email, privacy/deep-link scope, idempotent retries, preference enforcement, merged Monday watch, and confirmed replenishment values.
7. Exercise several consecutive synthetic weeks and season phases. Confirm different factual leads/markets, largest category changes selected correctly, no narrative from incomplete data and no same-three-headlines cycle. Test missing baselines, price-sign crossings, non-exclusive playoff probabilities and rules/version changes.
8. Measure database size/retention, extra reads, shared email budget and delivery behavior. Preview HTML/plain text on mobile and common mail clients. Present the exact schedule/templates/migrations and tested commit for owner approval; release with reversible queue/config changes and read-only postflight. Do not send a real mass campaign as a test.

Completion evidence must include the full notification matrix, before/after schedule, season-phase screenshots/examples, factual story fixtures, queue/preference/isolation tests, retention/volume measurements and deployed version after approval. Until then, this is a planned revamp, not a new active notification schedule.
