import assert from "node:assert/strict";
import {
  evaluatePlayoffTiming,
  firstPlayoffEvents,
  playoffTiming,
} from "../server/playoff-timing.ts";

const teams = [
  { rosterId: 1, recordUnits: 20 },
  { rosterId: 2, recordUnits: 15 },
  { rosterId: 3, recordUnits: 14 },
  { rosterId: 4, recordUnits: 10 },
  { rosterId: 5, recordUnits: 4 },
  { rosterId: 6, recordUnits: 4 },
];
const remaining = [
  { home: 1, away: 6 },
  { home: 2, away: 4 },
  { home: 3, away: 5 },
];
const weekTen = playoffTiming(teams, remaining, 2);
assert.deepEqual(weekTen, { clinched: [1], eliminated: [4, 5, 6] });
const tiedBoundary = teams.map((team) =>
  team.rosterId === 4 ? { ...team, recordUnits: 13 } : team,
);
assert(!playoffTiming(tiedBoundary, remaining, 2).eliminated.includes(4));
const official = playoffTiming(tiedBoundary, [], 2, [1, 2]);
assert.deepEqual(official, { clinched: [1, 2], eliminated: [3, 4, 5, 6] });
assert.deepEqual(
  firstPlayoffEvents([
    { week: 11, result: official },
    { week: 10, result: weekTen },
  ]),
  {
    clinch: { week: 10, rosterIds: [1] },
    elimination: { week: 10, rosterIds: [4, 5, 6] },
  },
);
assert.deepEqual(firstPlayoffEvents([{ week: 11, result: official }]).clinch, {
  week: 11,
  rosterIds: [1, 2],
});
assert.throws(
  () => playoffTiming(teams, remaining, 2, [1, 99]),
  /Invalid official/,
);
function exhaustive(teams, games, spots) {
  const counts = new Map(
    teams.map((team) => [team.rosterId, team.recordUnits]),
  );
  const guaranteed = new Set(counts.keys());
  const impossible = new Set(counts.keys());
  function finish(index) {
    if (index === games.length) {
      for (const [id, wins] of counts) {
        const other = [...counts].filter(([key]) => key !== id);
        if (other.filter(([, value]) => value >= wins).length >= spots)
          guaranteed.delete(id);
        if (other.filter(([, value]) => value > wins).length < spots)
          impossible.delete(id);
      }
      return;
    }
    const { home, away } = games[index];
    const h = counts.get(home),
      a = counts.get(away);
    for (let units = 0; units <= 2; units++) {
      counts.set(home, h + units);
      counts.set(away, a + 2 - units);
      finish(index + 1);
    }
    counts.set(home, h);
    counts.set(away, a);
  }
  finish(0);
  return { clinched: [...guaranteed], eliminated: [...impossible] };
}
const games = [
  { home: 1, away: 2 },
  { home: 3, away: 4 },
  { home: 1, away: 3 },
  { home: 2, away: 4 },
  { home: 1, away: 4 },
  { home: 2, away: 3 },
];
for (let sample = 0; sample < 81; sample++) {
  const fixture = Array.from({ length: 4 }, (_, index) => ({
    rosterId: index + 1,
    recordUnits: 2 * (Math.floor(sample / 3 ** index) % 3),
  }));
  for (const spots of [1, 2, 3]) {
    const remaining = games.slice(sample % 5);
    assert.deepEqual(
      playoffTiming(fixture, remaining, spots),
      exhaustive(fixture, remaining, spots),
    );
  }
}
console.log(
  "Playoff timing passed 243 exhaustive comparisons plus official-bracket fallback and invalid input tests.",
);

const history = [
  {
    week: 1,
    games: games.slice(0, 2),
    scores: { 1: 100, 2: 99, 3: 105, 4: 103 },
  },
  {
    week: 2,
    games: games.slice(2, 4),
    scores: { 1: 105, 2: 95, 3: 95, 4: 105 },
  },
  { week: 3, games: games.slice(4, 6) },
];
const season = {
  rosterIds: [1, 2, 3, 4],
  playoffSpots: 2,
  regularSeason: history,
  standingsMode: "head-to-head-record",
};
assert.deepEqual(evaluatePlayoffTiming(season), {
  clinch: null,
  elimination: null,
});
assert.deepEqual(
  evaluatePlayoffTiming({
    ...season,
    standingsMode: "custom",
    officialBracket: { week: 4, playoffRosterIds: [1, 4] },
  }),
  {
    clinch: { week: 4, rosterIds: [1, 4] },
    elimination: { week: 4, rosterIds: [2, 3] },
  },
);
assert.deepEqual(
  evaluatePlayoffTiming({ ...season, regularSeason: [history[0], history[2]] }),
  { clinch: null, elimination: null },
);
