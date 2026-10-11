import { score } from "./line-model.js";
import { fetchGameStatus } from "./game-status.js";
import type { LegInput } from "./settlement.ts";
async function source(path: string): Promise<any> {
  const r = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Ticket scores returned ${r.status}.`);
  return r.json();
}
export async function refreshTicketProgress(
  db: any,
  league: any,
  observation?: any,
) {
  const games = observation ?? (await fetchGameStatus());
  if (games.reason) throw new Error(games.reason);
  const cadence = games.games.some((g: any) => g.state === "in_progress")
    ? 15
    : 120;
  const tickets = await db
    .from("tickets")
    .select("market_week,nfl_season")
    .eq("league_id", league.id)
    .eq("status", "OPEN")
    .neq("ticket_type", "future");
  if (tickets.error) throw new Error(tickets.error.message);
  const weeks = [
    ...new Set(
      (tickets.data ?? [])
        .filter((t: any) => t.nfl_season === league.nfl_season)
        .map((t: any) => t.market_week),
    ),
  ] as number[];
  if (!weeks.length) return;
  const prior = await db
    .from("ticket_score_observations")
    .select("market_week,fetched_at")
    .eq("league_id", league.id)
    .eq("nfl_season", league.nfl_season);
  if (prior.error) throw new Error(prior.error.message);
  const due = weeks.filter(
    (w) =>
      !prior.data.some(
        (p: any) =>
          p.market_week === w &&
          Date.parse(p.fetched_at) > Date.now() - cadence * 60000,
      ),
  );
  if (!due.length) return;
  const [settings, teams] = await Promise.all([
    source(`https://api.sleeper.app/v1/league/${league.sleeper_league_id}`),
    db.from("teams").select("id,roster_id").eq("league_id", league.id),
  ]);
  if (teams.error) throw new Error(teams.error.message);
  if (Number(settings.season) !== league.nfl_season)
    throw new Error("Ticket score season mismatch.");
  for (const week of due) {
    const [matchups, stats] = await Promise.all([
      source(
        `https://api.sleeper.app/v1/league/${league.sleeper_league_id}/matchups/${week}`,
      ),
      source(
        `https://api.sleeper.com/stats/nfl/${league.nfl_season}/${week}?season_type=regular`,
      ),
    ]);
    if (!Array.isArray(matchups) || !Array.isArray(stats))
      throw new Error("Ticket scores unavailable.");
    const points: Record<string, number> = {},
      players: Record<string, number> = {};
    for (const team of teams.data) {
      const row = matchups.find((m: any) => m.roster_id === team.roster_id);
      if (row && Number.isFinite(row.points)) points[team.id] = row.points;
    }
    for (const row of stats)
      if (row.stats?.gp > 0) {
        const value = score(row.stats, settings.scoring_settings);
        if (Number.isFinite(value)) players[row.player_id] = value;
      }
    const result = await db.from("ticket_score_observations").upsert(
      {
        league_id: league.id,
        nfl_season: league.nfl_season,
        market_week: week,
        fetched_at: new Date().toISOString(),
        cadence_minutes: cadence,
        payload: {
          teams: points,
          players,
          provider_observed_at: null,
          observation_note:
            "Source observation time is unavailable; checked time shows when scores were fetched.",
        },
      },
      { onConflict: "league_id,nfl_season,market_week" },
    );
    if (result.error) throw new Error(result.error.message);
  }
}
export function legProgress(
  leg: LegInput,
  payload: { teams: Record<string, number>; players: Record<string, number> },
) {
  const c = leg.settlement_context;
  if (!c) return null;
  const team = c.team_id ? payload.teams[c.team_id] : undefined,
    home = c.home_team_id ? payload.teams[c.home_team_id] : undefined,
    away = c.away_team_id ? payload.teams[c.away_team_id] : undefined;
  const line = leg.accepted_line == null ? null : Number(leg.accepted_line),
    fmt = (v: number) => v.toFixed(1);
  if (["player_points", "player_milestone"].includes(c.kind)) {
    const v = payload.players[c.metadata?.player_id ?? ""];
    return Number.isFinite(v)
      ? `Current points: ${fmt(v)} · Accepted target: ${line}`
      : null;
  }
  if (c.kind === "player_h2h") {
    const a =
        payload.players[
          (c.side === "home"
            ? c.metadata?.player_id
            : c.metadata?.opponent_player_id) ?? ""
        ],
      b =
        payload.players[
          (c.side === "home"
            ? c.metadata?.opponent_player_id
            : c.metadata?.player_id) ?? ""
        ];
    return Number.isFinite(a) || Number.isFinite(b)
      ? `Selected player: ${Number.isFinite(a) ? fmt(a) : "awaiting play"} · Opponent: ${Number.isFinite(b) ? fmt(b) : "awaiting play"}`
      : null;
  }
  if (["team_total", "team_milestone"].includes(c.kind))
    return Number.isFinite(team)
      ? `Current team score: ${fmt(team!)} · Accepted target: ${line}`
      : null;
  if (c.kind === "match_total")
    return Number.isFinite(home) && Number.isFinite(away)
      ? `Current combined score: ${fmt(home! + away!)} · Accepted total: ${line}`
      : null;
  if (
    ["moneyline", "spread", "winning_margin"].includes(c.kind) &&
    Number.isFinite(home) &&
    Number.isFinite(away)
  ) {
    const margin = c.team_id === c.home_team_id ? home! - away! : away! - home!;
    return `Current score: ${fmt(home!)}–${fmt(away!)}${c.kind === "spread" ? ` · Adjusted margin: ${fmt(margin + (line ?? 0))}` : ""}`;
  }
  return null;
}
