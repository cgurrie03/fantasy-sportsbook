import assert from "node:assert/strict";
import { countOptions } from "../api/_lib/count-options.ts";
const counts = countOptions([0.1, 0.2, 0.3, 0.4], 0);
assert.equal(counts.find((q) => q.side === "1+").probability, 0.9);
assert.equal(counts.find((q) => q.side === "2+").probability, 0.7);
assert.equal(counts.find((q) => q.side === "3+").probability, 0.4);
assert(!counts.some((q) => q.side === "0+"));
assert(!countOptions([0.1, 0.9], 1).some((q) => q.count === 0));
for (const option of counts.filter((q) => q.atLeast))
  assert(
    option.probability >=
      counts.find((q) => q.side === String(option.count)).probability,
  );
import { writeFile, mkdir } from "node:fs/promises";
import {
  bestLineup,
  projectedLineup,
  matchupSpread,
  candidates,
  score,
  highLowProbabilities,
  weeklyScorerFields,
} from "../api/_lib/line-model.ts";
const fields = weeklyScorerFields(
  [0.4, 0.2, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01, 0.005, 0.005],
  [0.4, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.2, 0.005, 0.005],
);
assert.equal(fields.high.length, 6);
assert.equal(fields.low.length, 6);
assert.equal(new Set([...fields.high, ...fields.low]).size, 12);
assert(fields.high.includes(1));
assert(fields.low.includes(9));
assert.equal(
  score({ rec: 5, rec_yd: 60, rec_td: 1 }, { rec: 1, rec_yd: 0.1, rec_td: 6 }),
  17,
);
const player = (id, positions, expected) => ({
  id,
  positions,
  expected,
  name: id,
  projection: expected,
  average: null,
  injury: "",
  team: "",
  game: "",
});
const lineup = bestLineup(
  [
    player("qb", ["QB"], 20),
    player("rb", ["RB"], 12),
    player("wr", ["WR"], 19),
    player("rb2", ["RB"], 15),
  ],
  ["QB", "RB", "FLEX"],
);
assert.equal(
  lineup.reduce((n, p) => n + p.expected, 0),
  54,
);
assert.equal(new Set(lineup.map((p) => p.id)).size, 3);
assert.throws(
  () => bestLineup([player("qb", ["QB"], 20)], ["QB", "QB"]),
  /complete/,
);
const rows = [
  {
    player_id: "out",
    date: "2026-10-08",
    stats: { gp: 1, rec: 10 },
    player: { position: "WR", injury_status: "Out" },
  },
];
assert.equal(candidates(rows, { rec: 1 }, [])[0].expected, 0);
assert.equal(
  candidates(
    [
      {
        ...rows[0],
        player_id: "doubtful",
        player: { position: "WR", injury_status: "Doubtful" },
      },
    ],
    { rec: 1 },
    [],
  )[0].expected,
  10,
);
const preferred = bestLineup(
  [
    { ...player("higher-projection", ["WR"], 15), projection: 20 },
    { ...player("higher-adjustment", ["WR"], 19), projection: 18 },
    { ...player("inactive", ["WR"], 0), projection: 30 },
  ],
  ["WR"],
);
assert.equal(preferred[0].id, "higher-projection");
const replacementRoster = [
  player("bye-kicker", ["K"], 0),
  player("bench-kicker", ["K"], 7.5),
  player("bye-rb", ["RB"], 0),
  player("rb1", ["RB"], 18),
  player("bench-rb", ["RB"], 9),
  player("bench-wr", ["WR"], 14),
];
const replacements = projectedLineup(replacementRoster, [
  "RB",
  "RB",
  "FLEX",
  "K",
]);
assert.deepEqual(replacements.missingSlots, []);
assert.equal(replacements.picks.length, 4);
assert(replacements.picks.some((p) => p.id === "bench-kicker"));
assert(replacements.picks.some((p) => p.id === "bench-rb"));
const noActiveRb = projectedLineup(
  replacementRoster.filter((p) => p.id !== "bench-rb"),
  ["RB", "RB", "FLEX", "K"],
);
assert.deepEqual(noActiveRb.missingSlots, ["RB 2"]);
assert(!noActiveRb.picks.some((p) => p.expected === 0));
// Re-evaluation clears a formerly missing kicker as soon as a rostered replacement exists.
assert.deepEqual(
  projectedLineup([player("bye-kicker", ["K"], 0)], ["K"]).missingSlots,
  ["K"],
);
assert.deepEqual(projectedLineup(replacementRoster, ["K"]).missingSlots, []);
assert.equal(
  projectedLineup(
    [player("duplicate", ["RB"], 10), player("duplicate", ["RB"], 10)],
    ["RB", "RB"],
  ).picks.length,
  1,
);
assert.equal(
  candidates(
    [
      {
        ...rows[0],
        player_id: "bye",
        date: undefined,
        stats: { gp: 0, rec: 10 },
      },
    ],
    { rec: 1 },
    [],
  ).length,
  0,
);
const probabilities = highLowProbabilities([
  { mean: 200, sd: 15 },
  { mean: 80, sd: 15 },
]);
assert.ok(probabilities.high[0] > 0.95 && probabilities.low[1] > 0.95);
assert.ok(Math.abs(probabilities.high.reduce((a, b) => a + b, 0) - 1) < 1e-8);
console.log(
  "Passed league scoring, optimal flexible lineup, unique players, missing-slot rejection, injuries, and high/low probabilities.",
);
if (process.argv.includes("--live")) {
  const leagueId = "1312126153980391424",
    fetchJson = async (url) => {
      const r = await fetch(url);
      assert.ok(r.ok, `${url}: ${r.status}`);
      return r.json();
    };
  const [league, rosters, projections, history] = await Promise.all([
    fetchJson(`https://api.sleeper.app/v1/league/${leagueId}`),
    fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetchJson(
      "https://api.sleeper.com/projections/nfl/2026/5?season_type=regular",
    ),
    Promise.all(
      [1, 2, 3, 4].map((w) =>
        fetchJson(
          `https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`,
        ),
      ),
    ),
  ]);
  const pool = candidates(projections, league.scoring_settings, history.flat());
  const models = [];
  for (const roster of rosters) {
    const excluded = new Set([
      ...(roster.reserve ?? []),
      ...(roster.taxi ?? []),
    ]);
    const picks = bestLineup(
      pool.filter((p) => roster.players.includes(p.id) && !excluded.has(p.id)),
      league.roster_positions,
      true,
    );
    assert.ok(picks.length > 0);
    const mean = picks.reduce((n, p) => n + p.expected, 0);
    models.push({
      roster_id: roster.roster_id,
      mean,
      sd: Math.max(12, mean * 0.18),
      available_starters: picks.length,
    });
    console.log(
      `Roster ${roster.roster_id}: ${picks.length} available legal starters, expected ${mean.toFixed(1)}`,
    );
  }
  assert.equal(rosters.length, 12);
  console.log(
    "Active-roster and bench projection coverage audited for all 12 teams; incomplete rosters remain reported above.",
  );
  if (process.argv.includes("--report")) {
    const { deviation } = await import("../api/_lib/line-model.ts");
    models.forEach(
      (t) =>
        (t.sd = deviation(
          history
            .flat()
            .filter((h) => h.roster_id === t.roster_id)
            .map((h) => Number(h.points)),
          t.mean,
        )),
    );
    const probs = highLowProbabilities(models, 5);
    const users = await fetchJson(
      `https://api.sleeper.app/v1/league/${leagueId}/users`,
    );
    const odds = (p) =>
      Math.max(
        100,
        Math.min(
          100000,
          Math.round((100 * (1 - Math.min(0.499, p))) / Math.min(0.499, p)),
        ),
      );
    const report = {
      generated_at: new Date().toISOString(),
      season: 2026,
      week: 5,
      status: "Review Only — Not Published",
      method:
        "League-scored weekly projections; optimal legal starting lineup; capped historical adjustment; all current-season history; Sleeper injuries; 6000 independent team-score simulations",
      teams: models.map((t, i) => ({
        ...t,
        team:
          users.find(
            (u) =>
              u.user_id ===
              rosters.find((r) => r.roster_id === t.roster_id)?.owner_id,
          )?.metadata?.team_name ?? `Roster ${t.roster_id}`,
        high_scorer_odds: odds(probs.high[i]),
        low_scorer_odds: odds(probs.low[i]),
      })),
    };
    await mkdir("docs/reviews", { recursive: true });
    await writeFile(
      "docs/reviews/week-5-specials-preview.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log("Saved weekly high/low scorer preview for review.");
  }
}

assert.equal(matchupSpread(100, 100), 0.5);
assert.equal(matchupSpread(100.1, 100), -0.5);
assert.equal(matchupSpread(100, 108), 8);
const thresholdProbabilities = highLowProbabilities(
  Array.from({ length: 12 }, () => ({ mean: 160, sd: 20 })),
  5,
);
assert.ok(
  Math.abs(thresholdProbabilities.counts150.reduce((a, b) => a + b, 0) - 1) <
    1e-10,
);
assert.equal(thresholdProbabilities.counts150.length, 13);
assert.ok(
  thresholdProbabilities.anyBelow100 > 0 &&
    thresholdProbabilities.anyBelow100 < 1,
);
assert.ok(
  thresholdProbabilities.anyAtLeast200 > 0 &&
    thresholdProbabilities.anyAtLeast200 < 1,
);
