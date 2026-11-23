// Read-only enrichment of the bounded, archived visual fixture. Never writes to a service.
import fs from "node:fs/promises";
const base = new URL("../", import.meta.url);
const load = async (p) =>
  JSON.parse(await fs.readFile(new URL(p, base), "utf8"));
async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}: ${url}`);
  return r.json();
}
const data = await load("src/data.json");
const [sourceLeague, rosters, directory, schedule, users] = await Promise.all([
  get(`https://api.sleeper.app/v1/league/${data.leagueId}`),
  get(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
  get("https://api.sleeper.app/v1/players/nfl"),
  get(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${data.week}&year=${data.season}&seasontype=2`,
  ),
  get(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
]);
data.avatar = sourceLeague.avatar;
data.regularSeasonWeeks = Number(sourceLeague.settings.playoff_week_start)-1;
data.rosterPositions = sourceLeague.roster_positions;
data.rosterSnapshot =
  "Sleeper roster/standing snapshot captured for archived Week 8 visual review";
const sources = [];
for (let first = 1; first <= data.week; first += 3) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(3, data.week - first + 1) }, (_, i) =>
      get(
        `https://api.sleeper.app/v1/league/${data.leagueId}/matchups/${first + i}`,
      ),
    ),
  );
  batch.forEach((rows, i) => sources.push({ week: first + i, rows }));
}
data.finalScores = (sources.find(s=>s.week===data.week)?.rows || []).map(r=>({roster:r.roster_id,points:r.points}));
for (const t of data.teams) {
  t.managerProfiles = t.managers.map((name) => {
    const u = users.find((u) =>
      [u.username, u.display_name].some(
        (n) => n?.toLowerCase() === name.toLowerCase(),
      ),
    );
    return { name, avatar: u?.avatar || null };
  });
  const roster = rosters.find((r) => r.roster_id === t.roster_id);
  const scores = sources
    .map(({ rows }) => {
      const r = rows.find((r) => r.roster_id === t.roster_id);
      if (!r) return null;
      const opponent = rows.find(
        (o) => o.matchup_id === r.matchup_id && o.roster_id !== r.roster_id,
      );
      return { points: r.points, against: opponent?.points ?? null };
    })
    .filter(Boolean);
  t.pointsFor = Number(
    scores.reduce((n, r) => n + Number(r.points || 0), 0).toFixed(2),
  );
  t.pointsAgainst = Number(
    scores.reduce((n, r) => n + Number(r.against || 0), 0).toFixed(2),
  );
  t.ties = scores.filter(
    (r) => r.against != null && r.points === r.against,
  ).length;
  t.games = scores.length;
  t.potentialPoints = Number(
    (
      (roster.settings?.ppts || 0) +
      (roster.settings?.ppts_decimal || 0) / 100
    ).toFixed(2),
  );
  const outcomes = scores
    .filter((r) => r.against != null)
    .map((r) =>
      r.points > r.against ? "W" : r.points < r.against ? "L" : "T",
    );
  const last = outcomes.at(-1);
  let n = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === last; i--) n++;
  t.streak = last ? `${last}${n}` : "—";
}
const wanted = new Map();
for (const roster of rosters)
  for (const id of roster.players || []) {
    const p = directory[id];
    if (p && ["QB", "RB", "WR", "TE"].includes(p.position))
      wanted.set(id, {
        id,
        name: p.full_name || `${p.first_name} ${p.last_name}`,
        position: p.position,
        nflTeam: p.team,
        roster: roster.roster_id,
        starter: (roster.starters || []).includes(id),
        lineupIndex: (roster.starters || []).indexOf(id),
        lineupSlot:
          sourceLeague.roster_positions[(roster.starters || []).indexOf(id)] ||
          null,
        seasonAverage: null,
        gamesPlayed: 0,
        headshot: `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`,
        opponent: null,
        homeAway: null,
        kickoff: null,
      });
  }
const scored = new Map(
  [...wanted.keys()].map((id) => [id, { points: 0, games: 0 }]),
);
const scoring = sourceLeague.scoring_settings;
let current = [];
for (let first = 1; first <= data.week; first += 3) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(3, data.week - first + 1) }, (_, i) =>
      get(
        `https://api.sleeper.com/stats/nfl/${data.season}/${first + i}?season_type=regular`,
      ),
    ),
  );
  batch.forEach((body, i) => {
    const week = first + i;
    const rows = Array.isArray(body) ? body : Object.values(body);
    if (week === data.week) {
      current = rows;
      return;
    }
    for (const row of rows) {
      const rec = scored.get(row.player_id);
      if (!rec || Number(row.stats?.gp || 0) <= 0) continue;
      rec.games += Number(row.stats.gp);
      rec.points += Object.entries(scoring).reduce(
        (n, [key, mult]) => n + Number(row.stats[key] || 0) * Number(mult),
        0,
      );
    }
  });
}
const aliases = { LA: "LAR", JAC: "JAX", WAS: "WSH" };
const games = new Map();
for (const event of schedule.events || []) {
  const c = event.competitions[0];
  for (const entry of c.competitors) {
    const other = c.competitors.find((x) => x.id !== entry.id);
    games.set(entry.team.abbreviation, {
      opponent: other.team.abbreviation,
      homeAway: entry.homeAway,
      kickoff: event.date,
    });
  }
}
for (const p of wanted.values()) {
  const rec = scored.get(p.id);
  p.gamesPlayed = rec.games;
  p.seasonAverage = rec.games
    ? Number((rec.points / rec.games).toFixed(1))
    : null;
  const row = current.find((r) => r.player_id === p.id);
  p.nflTeam = row?.team || p.nflTeam;
  const game = games.get(aliases[p.nflTeam] || p.nflTeam);
  if (game) Object.assign(p, game);
}
data.playerContext = {
  season: data.season,
  throughWeek: data.week - 1,
  scoring:
    "League scoring settings applied to Sleeper weekly statistics; games-played denominator excludes byes and nonparticipation.",
  gameContextWeek: data.week,
};
data.offerCutoffs = {
  earliestGame: [...games.values()].map((g) => g.kickoff).sort()[0],
  sundayGame: [...games.values()]
    .map((g) => g.kickoff)
    .filter((d) => new Date(d).getUTCDay() === 0)
    .sort()[0],
};
await fs.writeFile(
  new URL("src/data.json", base),
  JSON.stringify(data, null, 2),
);
await fs.writeFile(
  new URL("src/players.json", base),
  JSON.stringify([...wanted.values()], null, 2),
);
console.log(
  JSON.stringify({
    teams: data.teams.length,
    players: wanted.size,
    withAverages: [...wanted.values()].filter((p) => p.seasonAverage !== null)
      .length,
    leagueAvatar: !!data.avatar,
    cutoffs: data.offerCutoffs,
  }),
);
