import type { Market } from "./markets";
import type { AccountData } from "./accounts";
import { regularSeasonResults } from "../../api/_lib/futures-settlement.ts";
import type { SeasonResult } from "../../api/_lib/futures-settlement.ts";
export interface Forecast {
  id: string;
  board_id: string;
  revision: number;
  nfl_season: number;
  market_week: number;
  board_type: string;
  captured_at: string;
  opens_at: string;
  closes_at: string;
  provenance: string;
  quotes: Market[];
}
export interface ScoreWeek {
  nfl_season: number;
  market_week: number;
  final: boolean;
  fetched_at: string;
  results: Record<
    string,
    {
      name: string;
      points: number;
      projection: number | null;
      projection_basis: string;
      matchup_id: number;
      players_points: Record<string, number>;
      player_results?: Record<string, { played: boolean; points: number }>;
      player_names?: Record<string, string>;
      starters?: string[];
      champion_roster?: number | null;
    }
  >;
}
export interface ScoreRow {
  team: string;
  week: number;
  actual: number;
  projection: number | null;
  error: number | null;
  basis: string;
  allPlay: number;
  opponent: number | null;
  final: boolean;
}
export function winQuantile(
  distribution: Record<string, number> | undefined,
  target: number,
): number | undefined {
  if (!distribution || target < 0 || target > 1) return undefined;
  const bins = Object.entries(distribution)
    .map(([n, p]) => [Number(n), p])
    .sort((a, b) => a[0] - b[0]);
  if (
    !bins.length ||
    bins.some(
      ([n, p]) => !Number.isInteger(n) || n < 0 || !Number.isFinite(p) || p < 0,
    ) ||
    Math.abs(bins.reduce((n, [, p]) => n + p, 0) - 1) > 0.001
  )
    return undefined;
  let cumulative = 0;
  for (const [n, p] of bins) {
    cumulative += p;
    if (cumulative >= target) return n;
  }
  return bins.at(-1)?.[0];
}
export function scoreRows(
  weeks: ScoreWeek[],
  forecasts: Forecast[],
): ScoreRow[] {
  return weeks.flatMap((w) =>
    Object.entries(w.results).map(([team, r]) => {
      const snapshot = deduplicateForecasts(forecasts).find(
        (f) =>
          f.board_type === "weekly" &&
          f.nfl_season === w.nfl_season &&
          f.market_week === w.market_week,
      );
      const quote =
        snapshot?.quotes.find(
          (q) => q.kind === "moneyline" && q.home_team_id === team,
        ) ??
        snapshot?.quotes.find(
          (q) => q.kind === "moneyline" && q.away_team_id === team,
        );
      const archivedProjection = quote
        ? quote.home_team_id === team
          ? quote.home_projection
          : quote.away_projection
        : null;
      const prediction =
        quote && !quote.metadata?.lineup_locked && archivedProjection != null
          ? Number(archivedProjection)
          : r.projection;
      const others = Object.entries(w.results).filter(([id]) => id !== team);
      return {
        team,
        week: w.market_week,
        actual: r.points,
        projection:
          Number.isFinite(prediction) && prediction !== null
            ? prediction
            : null,
        error:
          prediction !== null && Number.isFinite(prediction)
            ? r.points - prediction
            : null,
        basis:
          quote && !quote.metadata?.lineup_locked && archivedProjection != null
            ? "Archived opening model"
            : "Reconstructed starter projection",
        allPlay:
          others.reduce(
            (n, [, o]) =>
              n + (r.points > o.points ? 1 : r.points === o.points ? 0.5 : 0),
            0,
          ) / Math.max(1, others.length),
        opponent:
          others.find(([, o]) => o.matchup_id === r.matchup_id)?.[1].points ??
          null,
        final: w.final,
      };
    }),
  );
}
export function bettingStats(
  data: AccountData,
  team: string,
  week?: number,
  season?: number,
) {
  const tickets = (data.tickets ?? []).filter(
    (t) =>
      t.team_id === team &&
      (!week || t.market_week === week) &&
      (!season || t.nfl_season === season),
  );
  const settled = tickets.filter((t) =>
    ["WON", "LOST", "PUSH"].includes(t.status),
  );
  const stake = settled.reduce((n, t) => n + Number(t.stake), 0),
    payout = settled.reduce((n, t) => n + Number(t.actual_payout), 0);
  return {
    placed: tickets.length,
    settled: settled.length,
    stake,
    profit: payout - stake,
    roi: stake ? (payout - stake) / stake : null,
    open: tickets
      .filter((t) => t.status === "OPEN")
      .reduce((n, t) => n + Number(t.stake), 0),
  };
}
export function deduplicateForecasts(forecasts: Forecast[]) {
  const groups = new Map<string, Forecast[]>();
  for (const f of forecasts)
    groups.set(f.board_id, [...(groups.get(f.board_id) ?? []), f]);
  return [...groups.values()].flatMap((group) => {
    const sorted = [...group].sort((a, b) => a.revision - b.revision);
    // Existing boards have no original opening snapshot: never pretend a late copy was a pregame forecast.
    if (sorted[0].provenance !== "published_snapshot") return [];
    if (sorted[0].board_type === "future") return [sorted.at(-1)!];
    const preOpen = sorted.filter(
      (f) => Date.parse(f.captured_at) <= Date.parse(f.opens_at),
    );
    // The scheduled publication commits just after 8 AM. Its first published version is the opening baseline.
    return [preOpen.at(-1) ?? sorted[0]];
  });
}

// Exact assignment against archived eligibility; includes negative actual scores.
export function optimalActualLineup(
  players: { id: string; positions: string[] }[],
  slots: string[],
  points: Record<string, number>,
): number | null {
  const starting = slots.filter((s) => !["BN", "IR", "TAXI"].includes(s));
  if (
    !starting.length ||
    starting.length > 16 ||
    new Set(players.map((p) => p.id)).size !== players.length ||
    players.some((p) => !Number.isFinite(points[p.id]))
  )
    return null;
  const flex: Record<string, string[]> = {
    FLEX: ["RB", "WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    REC_FLEX: ["WR", "TE"],
    WRRB_FLEX: ["WR", "RB"],
    IDP_FLEX: ["DL", "LB", "DB"],
  };
  const states = new Map<number, number>([[0, 0]]);
  for (const p of players)
    for (const [mask, total] of [...states])
      starting.forEach((slot, i) => {
        if (
          mask & (1 << i) ||
          !p.positions.some((pos) => (flex[slot] ?? [slot]).includes(pos))
        )
          return;
        const next = mask | (1 << i),
          score = total + points[p.id];
        if (!states.has(next) || states.get(next)! < score)
          states.set(next, score);
      });
  return states.get((1 << starting.length) - 1) ?? null;
}

export function confirmedSeasonResults(
  weeks: ScoreWeek[],
  teams: { id: string; roster_id: number }[],
  regularWeeks: number,
  playoffTeams: number,
): SeasonResult {
  const result: SeasonResult = {
    champion: null,
    last: null,
    playoffRosters: null,
  };
  const champion = weeks
    .flatMap((w) =>
      Object.values(w.results).flatMap((r) =>
        Number.isInteger(r.champion_roster) ? [r.champion_roster!] : [],
      ),
    )
    .at(-1);
  if (champion !== undefined) result.champion = champion;
  const totals = teams.map((t) => ({
    roster_id: t.roster_id,
    settings: { wins: 0, ties: 0, fpts: 0 },
  }));
  for (let week = 1; week <= regularWeeks; week++) {
    const w = weeks.find((w) => w.market_week === week && w.final);
    if (!w || Object.keys(w.results).length !== teams.length) return result;
    for (const [index, t] of teams.entries()) {
      const game = w.results[t.id],
        opponents = Object.entries(w.results).filter(
          ([id, o]) => id !== t.id && o.matchup_id === game?.matchup_id,
        );
      if (
        !game ||
        opponents.length !== 1 ||
        !Number.isFinite(game.points) ||
        !Number.isFinite(opponents[0][1].points)
      )
        return result;
      totals[index].settings.wins += Number(
        game.points > opponents[0][1].points,
      );
      totals[index].settings.ties += Number(
        game.points === opponents[0][1].points,
      );
      totals[index].settings.fpts += game.points;
    }
  }
  return { ...result, ...regularSeasonResults(totals, playoffTeams) };
}
