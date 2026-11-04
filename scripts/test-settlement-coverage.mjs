import assert from "node:assert/strict";
import { settleLeg } from "../api/_lib/settlement.ts";
const leg = {
  id: "synthetic-high",
  accepted_line: null,
  settlement_context: {
    kind: "weekly_high",
    side: "a",
    team_id: "a",
    home_team_id: null,
    away_team_id: null,
    metadata: { expected_team_count: 8 },
  },
};
const partial = {
  final: true,
  teams: { a: { name: "A", points: 150 }, b: { name: "B", points: 100 } },
  players: {},
};
assert.equal(
  settleLeg(leg, partial).status,
  "OPEN",
  "a final flag must not turn incomplete league scores into a high-scorer result",
);
const teams = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [
    i ? "t" + i : "a",
    { name: "Team " + i, points: i ? 100 - i : 150 },
  ]),
);
assert.equal(settleLeg(leg, { ...partial, teams }).status, "WON");
assert.equal(
  settleLeg(
    {
      ...leg,
      settlement_context: { ...leg.settlement_context, kind: "weekly_low" },
    },
    { ...partial, teams },
  ).status,
  "LOST",
);
teams.t1.points = 150;
assert.equal(settleLeg(leg, { ...partial, teams }).status, "PUSH");
for (const invalid of [null, 0, 2.5, 33, "8"])
  assert.equal(
    settleLeg(
      {
        ...leg,
        settlement_context: {
          ...leg.settlement_context,
          metadata: { expected_team_count: invalid },
        },
      },
      { ...partial, teams },
    ).status,
    "OPEN",
  );
assert.equal(
  settleLeg(leg, {
    ...partial,
    teams: { ...teams, t1: { name: "Unknown", points: NaN } },
  }).status,
  "OPEN",
);
console.log(
  "New scorer terms require the exact complete league field; partial/invalid scores remain open, valid winners/losers and ties settle accurately.",
);
