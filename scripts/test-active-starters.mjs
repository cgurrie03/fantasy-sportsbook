import assert from "node:assert/strict";
import { activeStarters } from "../api/_lib/active-starters.ts";
import { parseScoreboard } from "../api/_lib/game-status.ts";
const players = {
  starter: { full_name: "Actual Starter", team: "WAS" },
  bench: { full_name: "Bench Player", team: "WSH" },
  finished: { full_name: "Finished Player", team: "DET" },
  out: { full_name: "Inactive Player", team: "WSH", injury_status: "Out" },
};
const games = [
  { state: "in_progress", teams: ["WSH", "JAX"] },
  { state: "final", teams: ["DET", "CHI"] },
];
assert.deepEqual(
  activeStarters(
    ["starter", "starter", "finished", "out", "0"],
    players,
    games,
  ),
  {
    playing: [{ id: "starter", name: "Actual Starter" }],
    incomplete: false,
  },
);
assert.deepEqual(
  activeStarters(["bench"], players, [
    { state: "scheduled", teams: ["WSH", "JAX"] },
  ]).playing,
  [],
);
assert.deepEqual(activeStarters(["JAC"], players, games).playing, [
  { id: "JAC", name: "JAC defense" },
]);
assert.equal(activeStarters(["unknown"], players, games).incomplete, true);
assert.throws(
  () =>
    activeStarters(["starter"], players, [{ state: "in_progress", teams: [] }]),
  /mapping/,
);
for (const status of [
  "STATUS_HALFTIME",
  "STATUS_END_PERIOD",
  "STATUS_IN_PROGRESS",
  "STATUS_FINAL_OVERTIME",
  "STATUS_DELAYED",
  "STATUS_SUSPENDED",
]) {
  const observation = parseScoreboard({
    leagues: [{ slug: "nfl" }],
    events: [
      {
        id: "one",
        date: "2026-10-09T00:00:00Z",
        status: { type: { name: status } },
        competitions: [
          {
            competitors: [
              { team: { abbreviation: "WSH" } },
              { team: { abbreviation: "JAX" } },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(
    activeStarters(["starter"], players, observation.games).playing.length,
    ["STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_IN_PROGRESS"].includes(
      status,
    )
      ? 1
      : 0,
  );
}
console.log(
  "Actual starters, bench exclusion, defense aliases, inactive players, status mapping and missing mappings pass.",
);
