import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import {
  bestLineup,
  matchupSpread,
  candidates,
  score,
  highLowProbabilities,
} from "../api/_lib/line-model.ts";
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
const preferred = bestLineup(
  [
    { ...player("higher-projection", ["WR"], 15), projection: 20 },
    { ...player("higher-adjustment", ["WR"], 19), projection: 18 },
    { ...player("inactive", ["WR"], 0), projection: 30 },
  ],
  ["WR"],
);
assert.equal(preferred[0].id, "higher-projection");
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
    "Live projections and optimal lineup coverage verified for all 12 teams.",
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
