export interface Projection {
  player_id: string;
  stats: Record<string, number>;
  date?: string;
  opponent?: string;
  team?: string;
  player: {
    first_name?: string;
    last_name?: string;
    position?: string;
    fantasy_positions?: string[];
    injury_status?: string;
    injury_notes?: string;
  };
}
export interface Candidate {
  id: string;
  name: string;
  positions: string[];
  projection: number;
  expected: number;
  average: number | null;
  injury: string;
  team: string;
  game: string;
}
export interface History {
  roster_id: number;
  points: number;
  players_points?: Record<string, number>;
}
export function score(
  stats: Record<string, number>,
  settings: Record<string, number>,
) {
  return Object.entries(settings).reduce(
    (n, [key, weight]) => n + Number(stats[key] ?? 0) * weight,
    0,
  );
}
export function candidates(
  rows: Projection[],
  settings: Record<string, number>,
  history: History[],
): Candidate[] {
  return rows
    .filter((row) => row.player && row.date && row.stats?.gp > 0)
    .map((row) => {
      const actual = history.flatMap((h) =>
        h.players_points?.[row.player_id] != null
          ? [Number(h.players_points[row.player_id])]
          : [],
      );
      const average = actual.length
        ? actual.reduce((a, b) => a + b, 0) / actual.length
        : null;
      const projection = Math.max(0, score(row.stats, settings));
      const injury = row.player.injury_status ?? "";
      // Provider projections already incorporate expected availability. Confirmed inactive players are excluded;
      // questionable players retain the provider estimate rather than receiving a second arbitrary discount.
      const inactive = /^(out|ir|pup|suspended|doubtful)$/i.test(injury);
      const adjustment =
        average == null
          ? 0
          : Math.max(
              -projection * 0.15,
              Math.min(projection * 0.15, (average - projection) * 0.15),
            );
      return {
        id: row.player_id,
        name:
          [row.player.first_name, row.player.last_name]
            .filter(Boolean)
            .join(" ") || row.player_id,
        positions: row.player.fantasy_positions ?? [row.player.position ?? ""],
        projection,
        expected: inactive ? 0 : Math.max(0, projection + adjustment),
        average,
        injury,
        team: row.team ?? "",
        game: `${row.date}${row.opponent ? ` vs. ${row.opponent}` : ""}`,
      };
    });
}
const flexible: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
};
export function bestLineup(
  players: Candidate[],
  positions: string[],
  allowEmpty = false,
): Candidate[] {
  const slots = positions.filter((p) => !["BN", "IR", "TAXI"].includes(p));
  if (slots.length > 16)
    throw new Error(
      "This league has more starting slots than the line model supports.",
    );
  // Exact assignment by slot mask: each player can occupy only one eligible slot, including flexible slots.
  const states = new Map<number, { value: number; picks: Candidate[] }>([
    [0, { value: 0, picks: [] }],
  ]);
  for (const player of players.filter((p) => p.expected > 0)) {
    for (const [mask, state] of [...states]) {
      slots.forEach((slot, index) => {
        if (
          mask & (1 << index) ||
          !player.positions.some((p) => (flexible[slot] ?? [slot]).includes(p))
        )
          return;
        const next = mask | (1 << index),
          value = state.value + player.projection;
        if (!states.has(next) || states.get(next)!.value < value)
          states.set(next, { value, picks: [...state.picks, player] });
      });
    }
  }
  const complete = states.get((1 << slots.length) - 1);
  if (!complete && allowEmpty)
    return [...states.values()].sort((a, b) => b.value - a.value)[0].picks;
  if (!complete)
    throw new Error(
      "A complete projected lineup could not be formed. Check roster eligibility, injuries, and projection coverage.",
    );
  return complete.picks;
}
export function deviation(scores: number[], projection: number) {
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const empirical = Math.sqrt(
    scores.reduce((a, b) => a + (b - mean) ** 2, 0) /
      Math.max(1, scores.length - 1),
  );
  return Math.max(
    12,
    Math.min(
      projection * 0.35,
      scores.length > 1 ? empirical : projection * 0.18,
    ),
  );
}
export function highLowProbabilities(
  teams: { mean: number; sd: number }[],
  seed = 42,
) {
  const high = teams.map(() => 1),
    low = teams.map(() => 1),
    trials = 6000;
  const counts150 = Array.from({ length: teams.length + 1 }, () => 1);
  const countsProjection = Array.from({ length: teams.length + 1 }, () => 1),
    averageScores: number[] = [],
    highestScores: number[] = [];
  let anyBelow100 = 1,
    anyAtLeast200 = 1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 1) / 4294967297;
  };
  for (let i = 0; i < trials; i++) {
    const scores = teams.map(
      (t) =>
        t.mean +
        t.sd *
          Math.sqrt(-2 * Math.log(random())) *
          Math.cos(2 * Math.PI * random()),
    );
    high[scores.indexOf(Math.max(...scores))]++;
    low[scores.indexOf(Math.min(...scores))]++;
    counts150[scores.filter((s) => s >= 150).length]++;
    countsProjection[scores.filter((s, i) => s > teams[i].mean).length]++;
    averageScores.push(scores.reduce((a, b) => a + b, 0) / teams.length);
    highestScores.push(Math.max(...scores));
    if (scores.some((s) => s < 100)) anyBelow100++;
    if (scores.some((s) => s >= 200)) anyAtLeast200++;
  }
  return {
    high: high.map((n) => n / (trials + teams.length)),
    low: low.map((n) => n / (trials + teams.length)),
    counts150: counts150.map((n) => n / (trials + teams.length + 1)),
    countsProjection: countsProjection.map(
      (n) => n / (trials + teams.length + 1),
    ),
    averageScores,
    highestScores,
    anyBelow100: anyBelow100 / (trials + 2),
    anyAtLeast200: anyAtLeast200 / (trials + 2),
  };
}

// Half-point spreads prevent an accidental pick'em from rounding a narrow projection gap.
export function matchupSpread(home: number, away: number) {
  const difference = away - home;
  const magnitude = Math.max(0.5, Math.round(Math.abs(difference) * 2) / 2);
  return difference < 0 ? -magnitude : magnitude;
}

// Maximize the combined high/low likelihood while assigning each team to only
// one six-team field. Independent top-six lists can overlap for volatile teams.
export function weeklyScorerFields(high: number[], low: number[]) {
  if (high.length !== low.length || high.length !== 12)
    throw new Error("Weekly scorer fields require 12 teams.");
  const ranked = high
    .map((_, i) => i)
    .sort((a, b) => high[b] - low[b] - (high[a] - low[a]) || a - b);
  return {
    high: ranked.slice(0, 6).sort((a, b) => high[b] - high[a] || a - b),
    low: ranked.slice(6).sort((a, b) => low[b] - low[a] || a - b),
  };
}
