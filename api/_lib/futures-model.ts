export interface SeasonTeam {
  id: string;
  roster_id: number;
  wins: number;
  ties: number;
  points: number;
  mean: number;
  sd: number;
}
export interface SeasonGame {
  home: number;
  away: number;
}

// A seeded simulation makes a repeated review reproducible for unchanged inputs.
export function seasonProbabilities(
  teams: SeasonTeam[],
  schedule: SeasonGame[][],
  playoffTeams: number,
  seed = 1,
  trials = 10000,
) {
  if (!teams.length || playoffTeams < 2 || playoffTeams > teams.length)
    throw new Error("Invalid playoff field.");
  const index = new Map(teams.map((t, i) => [t.roster_id, i]));
  if (
    schedule.some((week) => {
      const ids = week.flatMap((g) => [g.home, g.away]);
      return (
        ids.length !== teams.length ||
        new Set(ids).size !== teams.length ||
        ids.some((id) => !index.has(id))
      );
    })
  )
    throw new Error("The remaining regular-season schedule is incomplete.");
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state + 1) / 4294967297;
  };
  const score = (i: number) =>
    Math.max(
      0,
      teams[i].mean +
        teams[i].sd *
          Math.sqrt(-2 * Math.log(random())) *
          Math.cos(2 * Math.PI * random()),
    );
  const counts = teams.map(() => ({ champion: 0, playoffs: 0, last: 0 }));
  const capacity = 2 ** Math.ceil(Math.log2(playoffTeams));
  let slots = [1, 2];
  for (let n = 4; n <= capacity; n *= 2)
    slots = slots.flatMap((rank) => [rank, n + 1 - rank]);
  for (let trial = 0; trial < trials; trial++) {
    const wins = teams.map((t) => t.wins + t.ties / 2),
      points = teams.map((t) => t.points);
    for (const week of schedule) {
      const scores = teams.map((_, i) => score(i));
      for (const game of week) {
        const a = index.get(game.home)!,
          b = index.get(game.away)!;
        wins[scores[a] >= scores[b] ? a : b]++;
      }
      scores.forEach((s, i) => (points[i] += s));
    }
    const ranked = teams
      .map((_, i) => i)
      .sort(
        (a, b) =>
          wins[b] - wins[a] ||
          points[b] - points[a] ||
          teams[a].roster_id - teams[b].roster_id,
      );
    ranked.slice(0, playoffTeams).forEach((i) => counts[i].playoffs++);
    counts[ranked.at(-1)!].last++;
    let bracket: (number | null)[] = slots.map((rank) =>
      rank <= playoffTeams ? ranked[rank - 1] : null,
    );
    while (bracket.length > 1) {
      const next: (number | null)[] = [];
      for (let j = 0; j < bracket.length; j += 2) {
        const a = bracket[j],
          b = bracket[j + 1];
        next.push(
          a === null ? b : b === null ? a : score(a) >= score(b) ? a : b,
        );
      }
      bracket = next;
    }
    counts[bracket[0]!].champion++;
  }
  return counts.map((c) => ({
    champion: c.champion / trials,
    playoffs: c.playoffs / trials,
    last: c.last / trials,
  }));
}

export interface TradedPick {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
}
export interface BracketGame {
  m: number;
  r: number;
  p?: number;
  t1?: number | null;
  t2?: number | null;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
  w?: number | null;
  l?: number | null;
}
export function bracketProbabilities(
  teams: SeasonTeam[],
  games: BracketGame[],
  seed = 1,
  trials = 10000,
) {
  const final = games.find((g) => g.p === 1);
  if (!final)
    throw new Error(
      "The championship bracket is not available yet. Existing futures are retained.",
    );
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state + 1) / 4294967297;
  };
  const score = (roster: number) => {
    const t = teams.find((t) => t.roster_id === roster);
    if (!t) throw new Error("A playoff team is missing.");
    return Math.max(
      0,
      t.mean +
        t.sd *
          Math.sqrt(-2 * Math.log(random())) *
          Math.cos(2 * Math.PI * random()),
    );
  };
  const counts = teams.map(() => 0);
  for (let trial = 0; trial < trials; trial++) {
    const cache = new Map<number, { w: number; l: number }>(),
      visiting = new Set<number>();
    const resolve = (id: number): { w: number; l: number } => {
      if (cache.has(id)) return cache.get(id)!;
      if (visiting.has(id)) throw new Error("Invalid playoff bracket.");
      visiting.add(id);
      const g = games.find((g) => g.m === id);
      if (!g) throw new Error("Playoff bracket is incomplete.");
      if (Number.isInteger(g.w) && Number.isInteger(g.l)) {
        const result = { w: g.w!, l: g.l! };
        cache.set(id, result);
        visiting.delete(id);
        return result;
      }
      const participant = (
        direct: number | null | undefined,
        from: BracketGame["t1_from"],
      ) => {
        if (Number.isInteger(direct)) return direct!;
        if (from?.w) return resolve(from.w).w;
        if (from?.l) return resolve(from.l).l;
        throw new Error("Playoff participant is unavailable.");
      };
      const a = participant(g.t1, g.t1_from),
        b = participant(g.t2, g.t2_from),
        aWins = score(a) >= score(b),
        result = { w: aWins ? a : b, l: aWins ? b : a };
      cache.set(id, result);
      visiting.delete(id);
      return result;
    };
    const champion = resolve(final.m).w,
      index = teams.findIndex((t) => t.roster_id === champion);
    if (index < 0) throw new Error("Championship winner is unavailable.");
    counts[index]++;
  }
  return counts.map((count) => count / trials);
}
export function firstRoundOwner(
  rosterId: number,
  draftSeason: number,
  trades: TradedPick[],
) {
  const matches = trades.filter(
    (p) =>
      Number(p.season) === draftSeason &&
      p.round === 1 &&
      p.roster_id === rosterId,
  );
  if (matches.length > 1)
    throw new Error("Conflicting first-round pick ownership from Sleeper.");
  return matches[0]?.owner_id ?? rosterId;
}
