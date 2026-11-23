import assert from "node:assert/strict";
import { selectFantasyRewards } from "../server/fantasy-rewards.ts";
function week(number, home, away) {
  return {
    week: number,
    results: [
      { rosterId: 1, opponentId: 2, points: home, spread: 20, projection: 100 },
      { rosterId: 2, opponentId: 1, points: away },
    ],
  };
}
const previous = [week(1, 115, 101), week(2, 120, 98)];
const current = week(3, 155, 150);
const qualifiers = (options) =>
  selectFantasyRewards({ current, previous, historicalHigh: 150, ...options });
const kinds = qualifiers({}).awards.map((reward) => reward.kind);
for (const kind of [
  "win3",
  "loss3",
  "topScorer",
  "closeWin",
  "upset",
  "seasonRecord",
  "leagueRecord",
  "beatProjection",
  "highLoss",
])
  assert(kinds.includes(kind));
assert.equal(
  qualifiers({ rules: { weeklyLimit: true } }).awards.find(
    (award) => award.rosterId === 1,
  ).percent,
  50,
);
assert.deepEqual(
  qualifiers({ rules: { weeklyLimit: true }, seasonClosing: true, champion: 1 })
    .awards,
  [{ rosterId: 1, kind: "champion", percent: 30 }],
);
assert(
  !qualifiers({ current: week(3, 155, 155) }).awards.some(
    (award) => award.kind === "closeWin",
  ),
);
assert(
  !qualifiers({ current: week(1, 155, 150) }).awards.some(
    (award) => award.kind === "seasonRecord",
  ),
);
console.log(
  "Fantasy reward thresholds, multiple awards, highest weekly boost, and champion rollover passed.",
);
