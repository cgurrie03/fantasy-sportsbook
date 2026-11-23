# boff Visual Frontend

Protected dev review: https://dev.sportsbook.coopergurrie.com/

League slate: /1312126153980391424/matchups. Root lists the connected source league. Other league pages use /{leagueId}/{page}; owner tools are /platform. Old hash URLs migrate to paths. Vercel rewrites support direct visits/refresh.

From repository root:

```powershell
npm run dev --prefix visual
python visual/scripts/review-iteration17.py
python visual/scripts/review-iteration17-markets.py
npm run build --prefix visual
```

The current browser suite assumes the dev server is listening at http://127.0.0.1:5180. Python Playwright is required. Earlier scripts record prior review iterations and are not the current route/acceptance suite.

This is the Forest & Ivory visual frontend using archived real league identities, roster slots, player context and final scores. Tickets, balances, offers and support interactions are examples. Feedback persists only in a bounded local browser list. Preview ticket and wallet changes are browser state, not database writes. No notification/email delivery, live pricing or settlement backend is connected.

Balance history, source-shared progress, new half-point quotes, rounded premade offers, quote-update review and automatic-review layouts are represented. The actual quote engine must supply priced half-point lines, accepted immutable terms and source/finality evidence. Do not treat browser preview controls as production authorization or validated real-league operation.

The current release adds profile tabs, participant avatars, ticket filtering/sorting and draft-slip compacting. Vercel protects the dev preview; application membership authorization is still a required backend gate before participant rollout.

Iteration 7 adds inline ticket disclosures that preserve scroll, leg-local result circles and progress, a current-wins marker, consistent gold Won/neutral Open states, total matchup context, and a unified desktop browsing toolbar. Explicit sharing retains its dialog.

Iteration 8 separates parlay selection summaries from disclosed results, keeps singles/futures directly visible, and adds source-backed season comparison, explicit Sleeper links and five-second fading feedback. ATS and archived injury reports are labelled unavailable. The bounded season fixture is about 10KB and is not a database persistence design.

Iteration 9 replaces the separate season tab with a three-view rotating matchup header. Identity/record leads, followed by season statistics including seed, then recent form/availability. The header pauses for interaction or reduced motion. Result chips open source-backed score popovers, notification actions follow selections, and toasts fade during seconds four to five.

Iteration 10 adds consistent team/avatar headers, six metrics with inline ranks, illustrative injury rows and historical odds in result popovers. Actual scores remain unchanged. One labelled rivalry preview is included; it adds no automatic price boost. The help icon is a plain question mark.

Iteration 11 compacts matchup context and historical result popovers, uses ordinal seeds, makes slate cards native links with hover/focus cues, and completes the guide with Let's Go. Five new featured labels can be manually previewed; automatic eligibility and boosts remain pending the owner decision sheet.

Iteration 12 adds commissioner cutoff and assignment controls, participant rivalries, fixed bonus logic and priority selection. Non-rivalry automatic assignments use floor(matchups/2); rivalries are exempt and manual assignments can exceed the cap. Live playoff qualification evidence is not connected; automatic Playoff Race waits for that source. All configuration saves remain local browser preview state.

Iteration 13 compacts featured controls, adds actual Sleeper week-by-week fixture planning with bounded season presets, moves eligibility into a dialog, and shows all participants in one rivalry table. Auto-Populate is a one-time suggestion action: divisions, competitive history or similar standings. Nothing is auto-imported or locked into a source mode; suggestions remain editable and Clear All starts blank. Each category has a distinct icon and an explicit % Profit Boost label.

Iteration 14 makes rivalries team-based (12 teams, 36 slots in this league), migrates prior participant pairings, improves table readability, and moves the boost/cap explanation into How It Works. Matchup identity is compact; slide headers share anchors; injuries and historical totals are inline. Gold offer prices and subtle boosted-market borders clarify eligible selections.

Iteration 15 adds inset rivalry table edges and a quiet header, keeps vs/seeds on every matchup slide, adds an eight-second progress ring with pause/resume, places actual totals directly beside their lines, makes cutoff editing fit reviewed desktop viewports without scrolling, centralizes shared type roles and replaces filled notification callouts with a structured result/next-step summary.

Iteration 16 uses featured-category accents on boosted matchups, dot-separated injury details, equal-height slides and a bounded scrollable injury list. Configure Matchup Rules is a single compact desktop list. The header has a public development-environment badge. The isolated visual build declares VITE_APP_ENV=development in .env.production; a future production build must override this to VITE_APP_ENV=production. Never copy this dev marker configuration into the legacy production project. New market/UX candidates are recorded in CANDIDATE_MARKETS.md and are not enabled.

Iteration 17 adds verified 2025 champion/runner-up and scheduled rematch weeks to Configure Matchup Rules; a five-player Out/Doubtful/IR example on The 20 Year Rebuild vs Nelson is fat and phat; alternate-line and starting-position-group tabs; regular-season points-leader/top-seed futures; and conditional division winners. No close-game weekly special was added. New prices are illustrative, and missing group averages block that group instead of assuming zero. UX_IMPROVEMENTS.md explains the current limitations and the required changes for freshness, conflicts, ticket following and pins.


## Iteration 18

Real current-week source refreshing is running in dev, with five-minute active-game, fifteen-minute game-day/confirmation, and hourly idle league cadence. Source status/current scores are separate from archived illustrative prices; pricing/acceptance/settlement remain disconnected. See LIVE_REFRESH.md for storage measurements and limits.

Position Groups moved to Player Head-To-Head. Alternate lines use half-point sliders with no featured boosts. Injury order is Questionable, Doubtful, Out, IR. Optional `?review=interactions` shows tap-explained muted conflicts and a specific-prop Favorites shortlist; account persistence is not approved. `?view=live` and `?view=postseason` select connected current scores and historical bracket review. See UX_IMPROVEMENTS.md for ticket-follow recommendations and research.


## Iteration 19

Alternate Lines return to five preset paired rows at offsets -10, -5, 0, +5, +10 from the current main target. Spread columns show the corresponding team name/avatar; totals explicitly show Over and Under. Headers and buttons share a two-column grid, with Public Sans 15px panel headings at all widths. Alternate quotes remain unboosted and half-point targets. The slider is removed. See ONE_LEAGUE_STORAGE.md for measured current storage and full-season one-league estimates.


## Iteration 20

Alternate panel titles are 18px; team/Over–Under column headers are 14px on desktop and 13px on mobile, with larger avatars. Preset selection behaviour is unchanged. Dev source refresh now omits an unchanged payload from database PATCH updates while retaining truthful successful-check timestamps. Object-key ordering is normalized for comparison. Ticket compaction was audited read-only and remains future backend work; see STORAGE_EFFICIENCIES.md.
