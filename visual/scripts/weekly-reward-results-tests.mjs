import assert from "node:assert/strict";
import { prepareWeeklyRewards } from "../server/weekly-reward-results.ts";

const input = {
  refreshWeek: 4,
  teams: [
    { id: "a", roster_id: 1 },
    { id: "b", roster_id: 2 },
  ],
  weeks: [
    {
      market_week: 2,
      final: true,
      results: {
        a: { points: 135, matchup_id: 1 },
        b: { points: 120, matchup_id: 1 },
      },
    },
    {
      market_week: 3,
      final: true,
      results: {
        a: { points: 139, matchup_id: 2, projection: 108 },
        b: { points: 135, matchup_id: 2 },
      },
    },
  ],
  lines: [{ market_week: 3, team_id: "a", line: 20 }],
};
const result = prepareWeeklyRewards(input);
assert.equal(result.week, 3);
assert(
  result.awards.some((award) => award.kind === "upset" && award.rosterId === 1),
);
assert(
  result.awards.some(
    (award) => award.kind === "closeWin" && award.rosterId === 1,
  ),
);
assert(result.awards.some((award) => award.kind === "seasonRecord"));
assert.equal(prepareWeeklyRewards({ ...input, refreshWeek: 5 }), null);
assert.equal(
  prepareWeeklyRewards({
    ...input,
    weeks: input.weeks.map((week) => ({ ...week, final: false })),
  }),
  null,
);
const noLine = prepareWeeklyRewards({ ...input, lines: [] });
assert(!noLine.awards.some((award) => award.kind === "upset"));
assert.deepEqual(
  prepareWeeklyRewards({ ...input, rules: { weeklyLimit: true } })
    .awards.filter((award) => award.rosterId === 1)
    .map((award) => award.kind),
  ["seasonRecord"],
);
console.log(
  "Weekly refresh inputs, verified results, published spread evidence, and award cap passed.",
);
