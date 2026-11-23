# BOFF rebuild: owner decisions

November 8, 2026 • Updated with owner functional decisions 1–9

This records the owner's requested product changes. Production remains unchanged. Develop in the existing isolated Development environment, using the owner's real Sleeper football leagues. These decisions supersede conflicting proposals in earlier foundation documents. BOFF is the working product name; the final name/identity remains open.

## Access and the product identity: A

| Reference | Recorded decision |
| --- | --- |
| A01 | Cover every mapped participant, including co-managers, without the platform owner collecting emails. Research participant discovery from Sleeper. Commissioners can supply emails if required. |
| A02 | League access requires a completed team mapping. Remove the generic Membership Pending destination from the target experience; resolve joining/mapping before entering a league. |
| A03 | Add an Open Sleeper Team action to Account. Use one recognizable, consistent Sleeper-link icon and accessible label across the product. Verify the actual team-link behavior on phone and desktop before choosing a URL format. |
| A05 | Make the top-left league identity the switcher. It must work by tap/click and keyboard; hover may be an additional desktop affordance. Explore BOFF above the current league name. Only show connected, accessible leagues. |
| A07 | Fresh design, typography, spacing, and responsive behavior. Current colors are not a requirement. |
| A09 | Remove the public demo from the rebuild. A later demo is a separate future decision. |
| A10 | Remove the portfolio return link from the rebuild. |
| A* | Treat the site as a recognizable product used by many leagues. Optimize navigation and information density for the screen; prevent clipped content, oversized fixed areas, and awkward scrolling. Research and apply proper design principles during rebranding. |

### Email and participant research

[Sleeper explicitly states](https://support.sleeper.com/en/articles/4031220-can-i-email-my-leaguemates) that email/phone information is private and unavailable even to league commissioners. Some Sleeper accounts have neither. There is no documented public email-import route.

The [public API](https://docs.sleeper.com/) provides league users and rosters. Use stable user IDs and roster owner/co-owner associations to discover participants, not just primary managers. A league user without a team association does not automatically qualify for access. Check completeness of actual co-owner data rather than assuming one user per roster.

Owner-selected joining flow (available from the external/sign-in page):

1. Commissioner begins league signup from the external/sign-in page and enters the Sleeper league ID. BOFF populates team names/pictures and a per-team list of manager/co-manager names or usernames from source data.
2. Commissioner enters participant emails and/or shares a signup link so participants can select their team and complete mapping. The commissioner does not need to use only one route. BOFF does not automatically post invitations.
3. Each participant verifies their email and completes the selected mapping route. Each owner and co-manager is a separate participant; selecting a team does not alone grant access.
4. Before activation, the commissioner reviews and approves the completed mappings. Activation can proceed while other managers/co-managers remain unmapped. Each later participant gains access only after their mapping is approved. A typed public Sleeper username alone does not prove ownership.
5. Sign-in goes directly to an already mapped league. If someone has no mapped league, show the join/invitation path or a clear explanation; do not show an indefinite Membership Pending screen or grant access prematurely.

The platform owner should not participate in routine membership setup. The commissioner needs a compact coverage view so missing co-managers/emails are visible without retaining extra Sleeper profile history. Each participant has their own balance, including co-managers. Team counts come from Sleeper rosters; the eligible participant pool comes from source manager/co-manager relationships and approved BOFF mappings. Betting ranks represent participants: a 12-team league can have 14 people. All source teams remain visible in matchups and the leaderboard experience, including teams with no registered bettor. Proposed presentation: team identity/group plus mapped participant rows, with Not joined placeholders where needed. Unregistered people have no fabricated balance, betting rank, or activity. No team or participant count is hardcoded.

### Minimal member information

Recommended direct collection is a verified email and a preferred display name (prefilled from Sleeper and editable). The team selection/mapping route is required, but team names, pictures, user IDs, usernames, roster IDs, and primary/co-manager associations should be imported rather than retyped. Commissioner approval establishes the permitted league/team association; source identity alone is not account verification.

System-generated records include the BOFF account ID, per-league membership and team association, approval state/time, and independent per-league wallet reference. Store these compactly once per relevant identity/membership. Email changes require reverification; name changes should not break mappings because stable IDs are used.

Communication preferences must be adjustable by each user through their profile, both after signup and later. Include clear per-type choices for optional weekly recaps, offers, opening notices, reminders, and ticket-watch messages, with visible defaults and saved settings applied at send time. Explain which account-access or essential transaction notices are required separately from optional messages; the exact required-notice classification is a product implementation detail to review. Keep preferences scoped clearly: optional league communications may differ by league, while account-access notices belong to the account. Do not require communication-preference setup to complete joining. Do not add required phone, postal address, birthday, profile-photo upload, or extensive profile questions to this free-credit product. These are recommendations for minimal onboarding, not a new questionnaire for the owner.

## Markets, prediction quality, and rules: B, C, D, M

- Before games, project the strongest legal eligible lineup from the roster rather than submitted starters, so temporary midweek bye/injury slots do not unnecessarily lock team markets. Explain this basis in the projection question-mark help. Respect slot eligibility and current reserve/taxi/injury/bye rules; confirm the policy for unfillable rosters separately from missing provider information. During games, use actual started Sleeper slots/participants and earned points, plus expected remaining production for those actual starters still playing, while optimizing remaining unlocked lineup slots. Do not retroactively substitute a bench player's completed score or reuse a player across slots. Preserve source slot/game-lock state and reflect late schedule changes explicitly.
- Confirmed fallback for genuinely unfillable slots: use the mean of the top three available free-agent/waiver players' projected points for that week who can legally fill the slot, scored under this league's settings. Example: missing healthy/startable RB coverage uses the top-three eligible available RB projections, assuming the manager will acquire one. Determine availability against all teams' owned/reserve/taxi players and applicable pickup/game-lock rules; do not use another manager's player or a completed bench score. Apply only after optimizing the team's own roster, and distinguish unknown source data from a confirmed roster shortage. Explain the pickup assumption in projection help. This is a forecast estimate, not an actual roster acquisition or a named player eligible for player props. Settlement uses actual Sleeper lineup/results. If fewer than three valid available projections exist, expose the reduced coverage and define the edge policy during implementation rather than fabricate source players.
- Spread/total-style markets should adjust their line to maintain roughly -110 base odds. Moneylines and other fixed-outcome markets adjust odds as probability changes. Accepted ticket terms remain frozen. Current production Week 9 base spread/match-total/team-total rows were inspected and are already -110; an apparently different displayed quote may reflect a boost or another display path. No base odds were changed.
- Pull source league/player/score information from Sleeper where usable. Store only required current data, immutable accepted terms, compact results/balance explanations, and essential short-lived working data.
- Rework UI, readability, efficiency, and storage across all matchup, player, weekly-special, and futures markets.
- Re-examine singles/parlay eligibility, conflicts, and correlated combinations as one consistent product ruleset. Current restrictions are a starting inventory, not automatically the final rules.
- Automate Game of the Week, Tank Bowl, and other permitted featured-matchup boosts from platform-defined options; commissioner overrides remain possible within those options.
- Improve spread/total and other prediction quality periodically. Accuracy cannot be guaranteed or reduced to matching observed outcomes after the fact. Use timestamped pre-outcome predictions and finalized results to measure errors and calibration.
- Keep only enough numeric evaluation evidence to compare a proposed model with the current one: compact forecast/actual pairs for a bounded period or additive summaries, plus a small version/change record. Do not retain every spread/total revision, full roster snapshot per quote, or every simulation run.
- Validate new models on later real league weeks and promote only with evidence. Faster refresh alone does not prove better prediction quality.
- M services should be automatic, accurate, and storage-efficient. Reuse compact data across features rather than creating new archives for each feature.

## Bet slip and ticket sharing: E and F

- Rework all bet-slip UI and interactions, with particular attention to phone screens, software keyboards, safe areas, scroll, visible selections, wager entry, and confirmation.
- Reduce large fixed/blocky panels that cover underlying content. The slip should occupy only the space its current task needs.
- Make sharing a deliberate part of the ticket experience. Explore a compact post-placement summary with accepted selections, ticket identity, accepted odds, stake, potential return, and Share / View ticket / Done actions.
- Keep sharing available from ticket details/history as well. If draft sharing is included, clearly distinguish an unplaced selection set from an accepted ticket; it must never imply a bet has been placed.
- Use professional sportsbook references for visual hierarchy, selection grouping, share action placement, and receipt formatting. Avoid a separate awkward export experience.
- Generate images/text on demand from compact ticket data; do not store a permanent image for every ticket. Preserve private account data outside the shared receipt.
- Apply storage and transfer improvements across My Bets, All Bets, filters, progress, sharing, and leaderboards: paged summaries, details on demand, shared current score observations, compact season totals.

Research references: [DraftKings' bet slip and receipt flow](https://support.draftkings.com/dk/en-us/what-is-a-bet-slip?id=kb_article_view&sysparm_article=KB0010510) treats confirmation as a continuation of the slip. [FanDuel's product announcement](https://www.fanduel.com/about/news/fanduel-debuts-community-feed-across-all-sports-just-in-time-for-world-cup) supports sharing picks as part of the product experience. These support interaction choices; a complete visual screenshot comparison is still required during design. They do not authorize adding a social feed, cash-out, or automatic messaging to BOFF.

## Highest-priority change: the live weekly system, H

The old Thursday-wide cutoff and manually approved Sunday reopening are superseded as the target product behavior. Build toward a dynamically repriced game week. Tick-by-tick live pricing is not required: the owner accepts 5–15-minute refresh increments during active games, subject to measured API/storage/compute impact, and less frequent work while no games are active. Use the event schedule to wake promptly at game starts instead of waiting for a long idle poll.

All times below use America/New_York, following the existing project convention and the owner's timezone. The user supplied the times; the timezone is the working interpretation.

| Time/state | Target behavior |
| --- | --- |
| Wednesday 6 a.m. through Tuesday 1 a.m. | Open betting week. Reprice eligible unresolved outcomes at an appropriate cadence: 5–15 minutes during active games, less often while idle. No blanket Thursday cutoff. |
| Tuesday 1 a.m. | Close the outgoing betting week to new selections and begin transition. Closing intake does not force missing or disputed results to settle. |
| Tuesday 1 a.m. through Wednesday 6 a.m. | Show Bets loading / preparing next week on the weekly board while managers adjust lineups and the platform refreshes source inputs. Futures remain available when valid and can reprice from the outgoing week. |
| Tuesday 7 a.m. | Settle outgoing weekly bets, then replenish each eligible participant exactly once after settlement. Automatically reconcile unclear results; unresolved/complex cases are flagged to the platform admin with evidence. Do not force a result to meet the clock. |
| Tuesday 8 a.m. | Send the weekly communication using confirmed results and completed replenishments, with an honest indication of unresolved cases where relevant. |
| Wednesday 6 a.m. | Open the new week's verified board automatically. If required data is unavailable, show a clear delayed-preparation state and next check rather than opening stale prices or pretending the board is ready. |

Account, existing tickets, balances, and result explanations should remain usable during preparation; this is a proposed UI implementation of the loading state. Season futures remain available during this weekly reset when their inputs/quotes are valid, and can adjust from outgoing-week results. Preserve existing accepted futures.

### What live pricing must establish

1. Conditional predictions must combine points already earned with a defensible estimate of remaining points and uncertainty. Team markets must track actual eligible starters, remaining players/games, lineup changes, injuries where data supports them, and league scoring.
2. Player propositions and head-to-head selections must update based on named participants and remaining opportunities. Completed/resolved outcomes stop accepting new picks; a resolved result cannot remain available at obsolete odds.
3. Verify provider score update cadence, source timestamps/heartbeat, game-state coverage, latency, and outage behavior. A recently fetched response may contain old provider information. Sleeper's documented public API does not establish a live-betting latency guarantee.
4. The current clock-based shadow model is explicitly uncalibrated and lacks validated opportunity/injury-change feeds. It is a research component, not a production-ready live pricing engine. Do not simply enable its current acceptance path.
5. If Sleeper alone does not provide sufficient live information, identify the precise missing inputs and options before promising uninterrupted live prices. Keep the target; verify the dependency.
6. Brief affected-market pauses during repricing, stale/ambiguous inputs, or corrections are distinct from a scheduled whole-week cutoff. [FanDuel documents this behavior](https://support.fanduel.com/s/article/What-does-the-lock-mean-on-FanDuel). Explain pauses clearly and recover automatically.
7. Freeze accepted terms, reject/reconfirm changed quotes, prevent duplicate acceptance and credit movements, and recheck source/version freshness at actual submission.
8. Decide cadence by active game state and changed inputs. Share sport/week feeds and reuse one calculation across all outcomes affected by the same inputs. Do not multiply full provider requests or append archives per member/league/poll.
9. Prove Thursday/Sunday/Monday progression, Tuesday transition, Wednesday opening, DST, late/rescheduled games, score corrections, and failed-refresh recovery with real league data and controlled failure supplements.

This is a major functional workstream and the highest priority, not a minor schedule edit. Implement cadence according to measured source change/freshness and actual game state; 5-minute updates are not automatically better than 15-minute updates if source data is unchanged. Previous storage scenarios remain provisional because real live-input sizes, rates, and temporary working space have not been measured. No background automation or production schedule was changed by recording this target.

## Communications: I

- Align every communication with actual platform state and the live weekly schedule. Remove obsolete Thursday closing/reminder language and any claim that betting closes when it remains available.
- Use professional consistent branding, short useful content, current accepted/published information, and relevant league context.
- Vary substantive weekly material from actual events, matchups, results, offer availability, and remaining selections. Do not merely rotate wording or fabricate storylines.
- Trigger opening messages only after a verified opening, confirmation only after accepted placement, and offer reminders only while relevant. Group transient operational issues before notifying a commissioner.
- Avoid redundancy, excess notices, and storing a full duplicate message body indefinitely. Render from shared weekly facts; retain compact delivery/duplicate-prevention records.

## Roles and controls: J

| Role | Target control |
| --- | --- |
| Platform owner/admin | Cross-league monitoring, actual runtime/price freshness, data health, storage/growth, compact operational status, defaults and permitted feature/boost options. Mostly oversight and exceptions, not weekly curation. |
| League commissioner | Complete signup, review/approve mappings before activation, manage participants/emails/team mappings, choose a featured matchup from permitted options, and view league identity/betting logs. No credit adjustments and no input on ticket outcomes. Scope actions to that league. |
| Member/co-manager | Access only mapped leagues/teams, make selections with permitted credits, view applicable history, and use product preferences. Sleeper association alone does not grant platform administration. |

Disputed results first enter automated evidence reconciliation/research: retry source results, align the accepted participant/week/rules, apply actual league scoring, and check participation and relevant finalized facts. Official supplementary information can assist, but cannot silently replace a Sleeper league score/override or accepted contract. Keep only a compact source/time/evidence summary. Only unresolved, contradictory, or complex cases escalate to the platform owner with accepted terms, source scores, proposed interpretation, and uncertainty. This is a defined background process to build, not an assumption that this chat independently monitors tickets. Commissioners cannot choose results or modify credits.

Separate these interfaces and permitted actions. Existing admin controls should not simply be copied wholesale into a commissioner screen. A commissioner may also be an ordinary member, and one person can have different roles in different leagues. How much league-identity editing commissioners receive is not yet specified; viewing is requested.

## Automated offers: K

- Replace manual promo creation with a small automatic offer set per league/week.
- Generate 2–3 themed prebuilt boosted parlays, with 3–5 compatible legs each. Themes include underdogs winning, teams ending losing streaks, or favorites covering. Use actual league records and current probabilities; do not invent a streak or force a theme when insufficient eligible picks exist.
- Confirmed mix: two prebuilt parlays plus one claimable boost. The claimable boost targets a defined ticket type, such as a 4+ leg player head-to-head parlay. Each offer is once per participant, with distinct claimed and used indicators. A successful claim is not a successful bet redemption.
- Confirmed: preset parlay base combined price must be **at least +500 before the boost**, derived from valid underlying selection prices. Add a profit boost of 25–75%; working interpretation is multiples of five (25, 30, 35, …, 75). Show original odds crossed out and new odds prominently; percentage need not be prominently displayed. If repricing drops an unaccepted offer below +500, replace or withdraw it under the automated offer rules instead of forcing a +500 label. Accepted tickets keep their original valid terms.
- Confirmed pushed-leg rule: retain the originally accepted profit-boost percentage when a validly accepted ticket loses legs to pushes, even if the remaining ticket falls below the original qualifying leg count or +500 threshold. Recalculate the base from the remaining accepted leg prices, then apply the original boost to profit. A surviving losing leg still loses; all-push tickets refund only the stake, with no artificial boosted profit. Keep these facts compact and visible in the result explanation.
- K03 presets become part of the K01 generator rather than a separate weekly manual task.
- Remove the custom image upload/crop/storage requirement. Use basic reusable designed cards showing title/theme, legs, original/boosted odds, clear eligibility, expiry, and add-to-slip/claim action.
- Offer deadlines depend on their actual selections and event window: Thursday-related offers expire before the relevant Thursday kickoff, Sunday offers before the earliest relevant Sunday kickoff, and any earlier included participant/game takes precedence. An offer's expiry is separate from ordinary live-market availability.
- Support real calendar-event themes, such as Thanksgiving players/games, when source schedule and eligible league participants actually qualify. Use reusable event templates rather than unique uploaded artwork.
- Recheck price, lineup, availability, compatibility/correlation, and time conditions before publishing and before acceptance. Accepted promo terms remain fixed; unpublished/unaccepted offers can reprice or be replaced automatically under a defined rule.
- If three valid 3–5-leg offers cannot be formed, publish fewer or use a permitted fallback; do not generate invalid combinations merely to fill slots.
- Keep small offer definitions, quote/version references, expiry, and redemption facts. No copied full player/roster objects, permanent image files, or full offer history per refresh.

Reference: [FanDuel's profit-boost instructions](https://support.fanduel.com/s/article/Profit-Boosts-with-FanDuel) demonstrate claiming a boost and showing qualification/boosted potential winnings inside the slip. [FanDuel's prebuilt Super Bowl parlay example](https://www.fanduel.com/research/3-same-game-parlays-to-target-for-the-super-bowl) demonstrates event-themed grouped selections. These are interaction/content references, not a complete visual audit or a reason to add same-game combinations without appropriate joint pricing.

## Remove reports: L

Remove **all L01–L17 report screens, charts, report filters, and CSV/PNG/PDF report exports from the rebuild**. They can be reconsidered individually later.

This retires report-only historical roster/forecast snapshots, full replay archives, and report-specific export storage requirements. It does not mean reports are the sole cause of current storage, or that all underlying data can be deleted: existing picks, balances, settlement facts, member leaderboard summaries, required commissioner betting logs, and compact admin monitoring still have independent uses. The user explicitly retains those product needs. Keep minimal internal model-quality measurements for B/M accuracy work without rebuilding the L dashboard under another name.

Current-season tickets remain visible in My Bets and All Bets, using the same compact underlying records. Compare storage at different retention lengths before choosing older-season detail policy. [Ticket retention estimates](ticket-retention-estimates.md) include 12/14/16-participant scenarios and one/five/ten-league scaling; they are assumptions to verify, not measured compact storage.

Before database implementation, trace and replace report/archive dependencies with the minimal records needed by remaining features. No current production data was deleted.

## Implementation priorities

1. Real-league weekly/live functional contract and necessary data/provider verification, including quote freshness, acceptance, finality, reset, and Wednesday readiness.
2. Participant onboarding and team/co-manager mapping without platform-owner intervention; commissioner/platform roles.
3. A fresh product identity and responsive navigation/slip/receipt studies using actual league content and professional references.
4. Compact shared source/pricing/result storage and minimal evaluation metrics; measure one/five/ten-league scenarios with live-cycle workload.
5. Automated featured matchups/offers and state-aware professional communications integrated with the weekly cycle.
6. Validate the resulting Development product with real leagues before production promotion.

Design applies throughout the functional work. The order does not mean an unusable UI should wait until the backend is complete. Other sports, ads, subscriptions, the public demo, portfolio links, manual promo imagery, and report dashboards are outside the current rebuild scope.

## Small remaining choices, to resolve when needed

The three activation/lineup/promo clarifications are resolved: activation may proceed with incomplete participants while access remains mapping-gated; in-game forecasts follow actual started slots and optimize remaining unlocked slots; preset parlays require at least +500 pre-boost.

Other concrete implementation decisions can follow with examples: final project name/design, game-idle refresh interval, exact per-offer percentage/stake limit, seasonal credit initialization, tie/push/boost behavior, fixed reference for beat-projection markets, and older-season ticket retention. The owner has approved individual balances, dual email-entry/signup-link routes, futures during reset, Tuesday 7 a.m. settlement/refill, Tuesday 8 a.m. recap, and two preset offers plus one claimable boost.

[The proposed betting-rule matrix](betting-rules-matrix.md) records singles/parlays for all 21 market families.

These do not prevent recording the direction or continuing data/design research. Ask short, concrete product questions at the point they affect implementation.

## Predevelopment validation and visual direction review

The November 8 read-only validation found 12 real teams/13 associated managers including one co-manager, complete 11-player eligible roster assignments for all teams, and matching team-score arithmetic across 96 team-weeks. Five team-weeks contain missing player-stat rows despite matching totals, so participation cannot be inferred from zero. Observed projection caching and changing score responses support separate score/projection cadences, not a live-feed SLA. The seven-team playoff format and actual reseeding semantics still need futures acceptance verification.

[Predevelopment validation](predevelopment-validation.md) distinguishes verified source/logic checks from predictive calibration, real account journeys, long-run storage, and other evidence that requires implementation/observation.

Three independent private [design studies](boff-design-studies.html) and a [design specification/research review](design-research.md) are ready: Atlantic, Signal, Club. No visual direction has been approved. Signal is the current recommendation for readability. Research and token choices explicitly target generic layout defaults, coherent type/spacing, real league content, and mobile usability. They do not claim an objective detector for an AI-generated appearance. A private design study does not restore the removed public demo to product scope.

The roster-shortage and pushed-leg questions are resolved: use the top-three eligible available free-agent projection average for a genuinely unfillable slot, and keep the accepted boost after pushed legs. The visual direction remains open; no palette has been approved. Do not implement unresolved design choices as owner-approved decisions.
