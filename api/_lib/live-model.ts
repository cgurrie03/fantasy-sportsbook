import { score, matchupSpread } from "./line-model.js";
import type { Projection } from "./line-model.js";
import type { GameState } from "./game-status.js";
export const LIVE_MODEL = {
  version: "live-clock-shadow-v1",
  prior_minutes: 30,
  min_sd: 4,
  mode: "shadow",
  limitations: [
    "Elapsed-clock rate model is uncalibrated.",
    "No snap/opportunity or injury-change feed.",
    "Joint game correlations and overtime are not validated.",
    "Scoring timestamps do not establish feed heartbeat freshness.",
  ],
};
export type LiveGame = {
  id: string;
  starts_at: string;
  state: GameState;
  teams: string[];
  period: number | null;
  clock_seconds: number | null;
};
export type LiveRoster = {
  roster_id: number;
  matchup_id: number | null;
  starters: string[];
  starters_points: number[];
  points: number;
  custom_points?: number | null;
};
export type PlayerForecast = {
  id: string;
  observed: number;
  remaining: number;
  mean: number;
  sd: number;
  state: GameState;
  game_id: string;
  elapsed: number;
  source_updated_at: number | null;
  prior: number | null;
};
export type TeamForecast = {
  roster_id: number;
  team_id: string;
  name: string;
  matchup_id: number | null;
  starters: string[];
  mean: number;
  sd: number;
  observed: number;
  players: PlayerForecast[];
  reasons: string[];
};
const aliases: Record<string, string> = { WAS: "WSH", JAC: "JAX", LA: "LAR" };
const nflTeam = (v: string) => aliases[v] ?? v;
export function sameGameDate(priorDate: string | undefined, startsAt: string) {
  if (!priorDate || !Number.isFinite(Date.parse(priorDate))) return false;
  const gameDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startsAt));
  return /^\d{4}-\d{2}-\d{2}$/.test(priorDate)
    ? priorDate === gameDay
    : Math.abs(Date.parse(priorDate) - Date.parse(startsAt)) <= 12 * 3600000;
}
export function elapsedMinutes(game: LiveGame) {
  if (game.state === "scheduled") return 0;
  if (game.state === "final") return 60;
  if (
    game.state !== "in_progress" ||
    game.period == null ||
    game.clock_seconds == null ||
    game.period < 1 ||
    game.period > 4 ||
    game.clock_seconds < 0 ||
    game.clock_seconds > 900
  )
    throw new Error(
      "Game clock/state is unavailable or overtime is unsupported.",
    );
  return ((game.period - 1) * 900 + 900 - game.clock_seconds) / 60;
}
export function remainingForecast(
  observed: number,
  prior: number,
  elapsed: number,
  history: number[],
) {
  if (
    ![observed, prior, elapsed, ...history].every(Number.isFinite) ||
    elapsed < 0 ||
    elapsed > 60 ||
    prior < 0
  )
    throw new Error("Invalid live scoring input.");
  const remainingMinutes = 60 - elapsed;
  if (!remainingMinutes) return { mean: observed, remaining: 0, sd: 0 };
  // Prior is a per-minute rate; NEVER add the full pregame forecast to current points.
  // This stationary-rate approximation is logged for evaluation, not accepted betting.
  const rate =
    ((LIVE_MODEL.prior_minutes * prior) / 60 + observed) /
    (LIVE_MODEL.prior_minutes + elapsed);
  const remaining = rate * remainingMinutes;
  const center = history.length
    ? history.reduce((a, b) => a + b, 0) / history.length
    : prior;
  const variance =
    history.length > 1
      ? history.reduce((a, b) => a + (b - center) ** 2, 0) /
        (history.length - 1)
      : (prior * 0.5) ** 2;
  const sd = Math.sqrt(
    (Math.max(LIVE_MODEL.min_sd ** 2, variance) * remainingMinutes) / 60,
  );
  return { mean: observed + remaining, remaining, sd };
}
function cdf(z: number) {
  const x = Math.abs(z),
    t = 1 / (1 + 0.2316419 * x);
  const p =
    1 -
    (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) *
      t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? p : 1 - p;
}
function odds(p: number) {
  const bounded = Math.max(0.01, Math.min(0.99, p));
  const raw =
    bounded >= 0.5
      ? (-100 * bounded) / (1 - bounded)
      : (100 * (1 - bounded)) / bounded;
  return Math.round(raw / 10) * 10;
}
export function matchupForecasts(teams: TeamForecast[]) {
  const quotes: any[] = [];
  for (const id of new Set(
    teams.map((t) => t.matchup_id).filter((v) => v != null),
  )) {
    const pair = teams.filter((t) => t.matchup_id === id);
    if (pair.length !== 2 || pair.some((t) => t.reasons.length)) continue;
    const [home, away] = pair,
      variance = home.sd ** 2 + away.sd ** 2;
    // Completed/determined events are archived as outcomes, never priceable quotes.
    if (variance <= 0) continue;
    const probability = cdf((home.mean - away.mean) / Math.sqrt(variance));
    quotes.push({
      matchup_id: id,
      home_team_id: home.team_id,
      away_team_id: away.team_id,
      home_mean: home.mean,
      away_mean: away.mean,
      spread: matchupSpread(home.mean, away.mean),
      total: Math.round((home.mean + away.mean) * 2) / 2,
      home_fair_probability: probability,
      away_fair_probability: 1 - probability,
      home_odds: odds(probability),
      away_odds: odds(1 - probability),
      shadow: true,
      acceptance_enabled: false,
      promotion_pct: 0,
    });
  }
  return quotes;
}
export function buildLiveForecast(input: {
  games: LiveGame[];
  rosters: LiveRoster[];
  projections: Projection[];
  stats: any[];
  history: { players_points?: Record<string, number> }[][];
  scoring: Record<string, number>;
  teams: { id: string; roster_id: number; team_name: string }[];
  fetched_at: string;
  slots: number;
}) {
  const teams: TeamForecast[] = [];
  for (const team of input.teams) {
    const roster = input.rosters.find((r) => r.roster_id === team.roster_id);
    const result: TeamForecast = {
      roster_id: team.roster_id,
      team_id: team.id,
      name: team.team_name,
      matchup_id: roster?.matchup_id ?? null,
      starters: roster?.starters ?? [],
      mean: 0,
      sd: 0,
      observed: 0,
      players: [],
      reasons: [],
    };
    teams.push(result);
    if (
      !roster ||
      !Array.isArray(roster.starters) ||
      !Array.isArray(roster.starters_points) ||
      roster.starters.length !== input.slots ||
      roster.starters_points.length !== roster.starters.length ||
      new Set(roster.starters.filter((id) => id !== "0")).size !==
        roster.starters.filter((id) => id !== "0").length ||
      roster.custom_points != null
    ) {
      result.reasons.push(
        "Actual starting lineup is incomplete, duplicated, or has a manual score override.",
      );
      continue;
    }
    for (const [i, id] of roster.starters.entries()) {
      try {
        if (id === "0") throw new Error("Empty starting slot.");
        const prior = input.projections.find((p) => p.player_id === id);
        const actual = input.stats.find((p) => p.player_id === id);
        const nfl =
          prior?.team ?? actual?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null);
        if (!nfl) throw new Error("Player-to-NFL-team mapping unavailable.");
        const matches = input.games.filter((g) =>
          g.teams.some((t) => nflTeam(t) === nflTeam(nfl)),
        );
        if (matches.length !== 1)
          throw new Error(
            "Player game is missing or ambiguous (including bye).",
          );
        const game = matches[0],
          elapsed = elapsedMinutes(game),
          observed = roster.starters_points[i];
        if (typeof observed !== "number" || !Number.isFinite(observed))
          throw new Error("Observed starter score missing.");
        if (game.state === "scheduled" && observed !== 0)
          throw new Error("Pregame player has nonzero observed points.");
        if (game.state !== "scheduled") {
          if (
            !actual ||
            !Number.isFinite(actual.updated_at) ||
            actual.updated_at > Date.parse(input.fetched_at) + 30000 ||
            !actual.stats ||
            Math.abs(score(actual.stats, input.scoring) - observed) > 0.1
          )
            throw new Error(
              "Scoring source missing or disagrees with actual starter points.",
            );
        }
        if (
          game.state !== "final" &&
          (!prior || !sameGameDate(prior.date, game.starts_at) || !prior.stats)
        )
          throw new Error(
            "Pregame rate prior does not match the player's game.",
          );
        const priorPoints =
          game.state === "final"
            ? 0
            : Math.max(0, score(prior!.stats, input.scoring));
        const past = input.history.flatMap((week) =>
          week.flatMap((r) =>
            typeof r.players_points?.[id] === "number"
              ? [r.players_points[id]]
              : [],
          ),
        );
        const estimate = remainingForecast(
          observed,
          priorPoints,
          elapsed,
          past,
        );
        result.players.push({
          id,
          observed,
          ...estimate,
          state: game.state,
          game_id: game.id,
          elapsed,
          prior: game.state === "final" ? null : priorPoints,
          source_updated_at: actual?.updated_at ?? null,
        });
      } catch (error) {
        result.reasons.push(
          `${id}: ${error instanceof Error ? error.message : "Missing player inputs."}`,
        );
      }
    }
    result.observed = result.players.reduce((a, p) => a + p.observed, 0);
    result.mean = result.players.reduce((a, p) => a + p.mean, 0);
    result.sd = Math.sqrt(result.players.reduce((a, p) => a + p.sd ** 2, 0));
    if (
      !Number.isFinite(roster.points) ||
      Math.abs(roster.points - result.observed) > 0.15
    )
      result.reasons.push("Team score and summed starter scores disagree.");
  }
  const quotes = matchupForecasts(teams);
  const progress = input.games.length
    ? input.games.reduce((a, g) => {
        try {
          return a + elapsedMinutes(g) / 60;
        } catch {
          return a;
        }
      }, 0) / input.games.length
    : 0;
  return {
    teams,
    quotes,
    horizon: Math.min(3, Math.floor(progress * 4)),
    status: quotes.length ? "shadow" : "blocked",
    limitations: LIVE_MODEL.limitations,
    families: {
      matchups: "shadow only",
      players: "disabled: not validated",
      specials: "disabled: not validated",
      futures: "disabled: not validated",
    },
  };
}
