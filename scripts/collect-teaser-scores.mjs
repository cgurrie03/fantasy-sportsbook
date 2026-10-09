// Explicit read-only collection of completed weeks. No scheduler, odds publication or bets.
import fs from "node:fs";
import path from "node:path";
const [leagueId, throughText, output = "work/teasers/completed-scores.json"] =
  process.argv.slice(2);
const through = Number(throughText);
if (
  !/^\d+$/.test(leagueId || "") ||
  !Number.isInteger(through) ||
  through < 1 ||
  through > 18
)
  throw Error(
    "Usage: node scripts/collect-teaser-scores.mjs SLEEPER_LEAGUE LAST_COMPLETED_WEEK [OUTPUT]",
  );
const get = async (suffix) => {
  const response = await fetch("https://api.sleeper.app/v1/" + suffix, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Sleeper returned " + response.status);
  return response.json();
};
const [league, state] = await Promise.all([
  get("league/" + leagueId),
  get("state/nfl"),
]);
if (
  ![Number(league.season), Number(state.season), Number(state.week)].every(
    Number.isInteger,
  )
)
  throw Error("League/current period unavailable.");
if (
  Number(league.season) > Number(state.season) ||
  (Number(league.season) === Number(state.season) &&
    through >= Number(state.week))
)
  throw Error("Current/incomplete weeks must not enter the completed sample.");
const weeks = [];
for (let week = 1; week <= through; week++) {
  const data = await get(`league/${leagueId}/matchups/${week}`);
  const teams = data.map((t) => ({
    id: String(t.roster_id),
    matchup: t.matchup_id,
    points: t.custom_points ?? t.points,
  }));
  if (
    teams.length !== league.total_rosters ||
    new Set(teams.map((t) => t.id)).size !== teams.length ||
    teams.some((t) => !Number.isFinite(t.points)) ||
    [...Map.groupBy(teams, (t) => t.matchup).values()].some(
      (pair) => pair.length !== 2,
    )
  )
    throw Error("Incomplete or invalid matchups in week " + week);
  weeks.push({ week, teams });
}
const snapshot = {
  captured_at: new Date().toISOString(),
  league: leagueId,
  season: Number(league.season),
  source: "Sleeper matchup endpoint; explicitly requested completed weeks only",
  completionBasis:
    "Weeks preceding current Sleeper NFL week; final corrections require reconciliation",
  scoring_settings: league.scoring_settings,
  weeks,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(snapshot, null, 2));
console.log(
  JSON.stringify({
    output,
    weeks: weeks.length,
    matchups: weeks.reduce((n, w) => n + w.teams.length / 2, 0),
  }),
);
