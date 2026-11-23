# Featured Matchup Rules — Current Owner Decisions

This supersedes the iteration 11 recommendation sheet. Implemented in the visual preview; shared persistence, role enforcement and live evidence ingestion remain backend work.

## Allocation

Priority: Championship Rematch → Playoff Race → Rivalry → Revenge Game → Upset Watch → Streak Breaker → Tank Bowl → Game Of The Week.

- No category has a reserved weekly slot. Select eligible games in priority order.
- Automatic non-rivalry bonuses: at most floor(actual weekly matchups / 2). For example: 4 games → 2; 5 games → 2; 6 games → 3; 7 games → 3.
- Rivalries are exempt. A full slate of rivalries can all be featured.
- One bonus per matchup; priority resolves overlap. No stacking.
- Game Of The Week is at most one highest-rated remaining game, not a forced reservation. Other qualifying categories can fill their available quota places in priority order.
- Commissioners can add, remove or reassign individual bonuses and exceed the automatic cap. Removing one does not silently backfill another.

## Fixed Rules and Editable Default Cutoffs

| Priority | Category | Eligibility / Default Cutoffs | Fixed Market and Profit Boost |
|---|---|---|---|
| 1 | Championship Rematch | Verified previous season's finalists meet. | Both moneylines, 50% |
| 2 | Playoff Race / Playoff Spoiler | Last 4 regular-season weeks; within 1 win of the final playoff place; verified qualification still undecided. Both racing: boost both. One racing: boost only its opponent as spoiler. | Eligible moneyline(s), 35% |
| 3 | Rivalry | Saved reciprocal team pairing connects the opposing fantasy teams. At most 3 rival teams per team. Commissioner can explicitly Auto-Populate from divisions, completed matchup history or similar standings, then edit all suggestions. Blank is the default. No automatic weekly cap for rivalry games. | Both moneylines, 35% |
| 4 | Revenge Game | Most recent earlier meeting this season; previous loss by no more than 10 points. Requires a known earlier result and identifies the previous loser. | Previous loser's moneyline, 35% |
| 5 | Upset Watch | Week 4 onward by default; lower-seeded moneyline underdog outside the top 50% faces an opponent in the top 25%; pre-scoring projection gap at most 10%. Never use actual scored points to choose this label. | Underdog moneyline, 35% |
| 6 | Streak Breaker | A winning streak of at least 5 completed matchups. The opponent gets the bonus. If both qualify, both opposing moneylines qualify. | Opponent's moneyline, 25% |
| 7 | Tank Bowl | First week after halfway through the regular season; combined weighted win percentage, rounded to one decimal, at most 33.3%. | Match-total Over only, 25% |
| 8 | Game Of The Week | Highest available fixed weighted rating: record 50%, points for 25%, competitiveness 15%, total 10%. | Both moneylines, 25% |

Closest Matchup, High-Scoring Matchup and Winning Streak Clash are removed. Streak Breaker is the replacement for the last one.

Commissioners can adjust the numeric cutoffs and category automatic enablement. They cannot edit percentage boosts, market targeting logic, priority, the cap formula, or the three-rival maximum in the UI. Manual assignments can override automatic cutoff eligibility; source-dependent targets still require the relevant fact (for example, a Revenge Game needs a previous loser). Manual playoff context explicitly declares both racers or which team is racing; the spoiler mapping remains fixed.

## Source and Retention

The sample league has 13 participants on 12 fantasy teams. Rivalry configuration uses the 12 team identities, independent of the number of managers; legacy participant pairs migrate through roster mapping and collapse into team pairs. It has no divisions, so no rivalry pairs are invented. Prior championship finalists were mapped from the previous league by owner identity, with only the resulting two roster IDs retained. Public sources: https://docs.sleeper.com/#getting-rosters-in-a-league and the related league/users/bracket endpoints.

Automatic playoff stories wait for verified racing/clinched/eliminated status. That live evidence source is not connected in this frontend. Real weekly evaluation must use validated league-specific standings, playoff format, tiebreaks and completed results as of the evaluation time; the archived Week 8 fixture is a visual sample, not a prospective pregame audit.

Store only league/season-scoped cutoffs, enablement, reciprocal team-ID pairs and one explicit assignment/context preset per scheduled fixture. Retain bounded season presets, not versions; season rollover needs a backend retention policy. Auto-Populate runs only on commissioner request, never overwriting edits in the background. No per-refresh quote logs or new historical player/roster snapshots are added. Actual shared storage schema/overhead still needs backend validation; a full 14-week, six-game preset configuration is tested below 12 KB. The actual 84-fixture schedule is about 1 KB and contains pair IDs only.

## Visual Language

Restrained brass, bronze, clay, sage and lavender backgrounds with dark forest text/icons. Category names and explicit fixed percentages carry meaning in addition to colour. Both theme variants meet 4.5:1 badge text contrast. Current accepted tickets and premade offer base prices do not reprice when commissioner settings change.
