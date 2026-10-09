import { createHash } from "node:crypto";
import {
  fetchGameStatus,
  scoreboardWindow,
  parseScoreboard,
} from "./game-status.js";
import { buildLiveForecast, LIVE_MODEL } from "./live-model.js";
import { evaluateLiveWeek } from "./live-review.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function readSource(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Live source returned ${response.status}.`);
  return (await response.json()) as any;
}
const sleeper = (path: string) =>
  readSource(`https://api.sleeper.app/v1/${path}`);
export async function collectLiveShadow(
  db: any,
  job: any,
  league: any,
  teams: any[],
) {
  let payload: any = {
      status: "blocked",
      horizon: 0,
      teams: [],
      quotes: [],
      reason: "Inputs not collected.",
    },
    sources: any = {},
    observedAt = new Date().toISOString();
  try {
    if (!/^\d+$/.test(league.sleeper_league_id ?? ""))
      throw new Error("Sleeper league configuration unavailable.");
    const [
      state,
      settings,
      matchups,
      observation,
      projections,
      stats,
      history,
    ] = await Promise.all([
      sleeper("state/nfl"),
      sleeper(`league/${league.sleeper_league_id}`),
      sleeper(`league/${league.sleeper_league_id}/matchups/${job.market_week}`),
      fetchGameStatus(),
      readSource(
        `https://api.sleeper.com/projections/nfl/${league.nfl_season}/${job.market_week}?season_type=regular`,
      ),
      readSource(
        `https://api.sleeper.com/stats/nfl/${league.nfl_season}/${job.market_week}?season_type=regular`,
      ),
      Promise.all(
        Array.from({ length: Math.min(8, job.market_week - 1) }, (_, i) =>
          sleeper(
            `league/${league.sleeper_league_id}/matchups/${job.market_week - 1 - i}`,
          ),
        ),
      ),
    ]);
    observedAt = new Date().toISOString();
    if (
      Number(state.season) !== league.nfl_season ||
      state.week !== job.market_week ||
      state.season_type !== "regular" ||
      Number(settings.season) !== league.nfl_season
    )
      throw new Error("NFL season/week no longer matches the live cycle.");
    if (observation.reason) throw new Error(observation.reason);
    if (
      !Array.isArray(matchups) ||
      !Array.isArray(projections) ||
      !Array.isArray(stats) ||
      history.some((h) => !Array.isArray(h))
    )
      throw new Error("Live source data has an invalid shape.");
    const [start, end] = scoreboardWindow(new Date()).split("-");
    const games = observation.games.filter((g) => {
      const day = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(new Date(g.starts_at))
        .replaceAll("-", "");
      return day >= start && day <= end;
    });
    if (!games.length || games.some((g) => g.teams.length !== 2))
      throw new Error("Current week NFL game mapping is incomplete.");
    const ids = new Set(matchups.flatMap((m) => m.starters ?? []));
    sources = {
      state,
      scoring: settings.scoring_settings,
      roster_positions: settings.roster_positions,
      matchups: matchups.map((m) => ({
        roster_id: m.roster_id,
        matchup_id: m.matchup_id,
        starters: m.starters,
        starters_points: m.starters_points,
        points: m.points,
        custom_points: m.custom_points,
      })),
      games,
      projections: projections.filter((p) => ids.has(p.player_id)),
      stats: stats.filter((p) => ids.has(p.player_id)),
      history: history.map((w) =>
        w.map((r: any) => ({
          roster_id: r.roster_id,
          players_points: Object.fromEntries(
            Object.entries(r.players_points ?? {}).filter(([id]) =>
              ids.has(id),
            ),
          ),
        })),
      ),
    };
    payload = buildLiveForecast({
      games,
      rosters: matchups,
      projections,
      stats,
      history,
      scoring: settings.scoring_settings,
      teams,
      fetched_at: observedAt,
      slots: settings.roster_positions.filter(
        (p: string) => !["BN", "IR", "TAXI"].includes(p),
      ).length,
    });
    const timestamps = sources.stats
      .map((s: any) => s.updated_at)
      .filter(Number.isFinite);
    payload.source_quality = {
      fetch_finished_at: observedAt,
      newest_stat_at: timestamps.length
        ? new Date(Math.max(...timestamps)).toISOString()
        : null,
      oldest_stat_at: timestamps.length
        ? new Date(Math.min(...timestamps)).toISOString()
        : null,
      live_freshness_verified: false,
      reason:
        "Per-record timestamps are last stat changes; feed heartbeat/latency not verified.",
    };
  } catch (error) {
    payload.reason =
      error instanceof Error ? error.message : "Live data unavailable.";
  }
  const saved = await db.rpc("save_live_shadow", {
    p_job: job.id,
    p_attempt: job.attempts,
    p_snapshot: {
      model_version: LIVE_MODEL.version,
      model_config: LIVE_MODEL,
      observed_at: observedAt,
      source_hash: hash(sources),
      sources,
      payload,
    },
  });
  if (saved.error) throw new Error(saved.error.message);
  return {
    snapshot_id: saved.data,
    status: payload.status,
    priced_matchups: payload.quotes.length,
    reason: payload.reason ?? null,
  };
}
export async function reviewLiveWeek(db: any, job: any, league: any) {
  const [state, matchups, forecasts] = await Promise.all([
    sleeper("state/nfl"),
    sleeper(`league/${league.sleeper_league_id}/matchups/${job.market_week}`),
    db
      .from("live_forecast_runs")
      .select("id,captured_at,status,payload")
      .eq("league_id", job.league_id)
      .eq("nfl_season", league.nfl_season)
      .eq("market_week", job.market_week)
      .order("captured_at")
      .limit(3000),
  ]);
  if (forecasts.error) throw new Error(forecasts.error.message);
  if (!(
    Number(state.season) > league.nfl_season ||
    (Number(state.season) === league.nfl_season &&
      (Number(state.week) > job.market_week ||
        (job.market_week === 18 && state.season_type === "post")))
  ))
    return { pending: true, reason: "NFL week is not final." };
  const finalGames = await readSource(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${job.market_week}&year=${league.nfl_season}&seasontype=2`,
  );
  const finalObservation = parseScoreboard(finalGames);
  if (
    finalGames.week?.number !== job.market_week ||
    finalObservation.season_year !== league.nfl_season ||
    !finalObservation.games.length ||
    finalObservation.games.some((g: any) => g.state !== "final")
  )
    return {
      pending: true,
      reason: "Previous-week NFL games are not all confirmed final.",
    };
  if (
    !Array.isArray(matchups) ||
    !matchups.length ||
    matchups.some(
      (m) =>
        !Number.isInteger(m.roster_id) ||
        typeof m.points !== "number" ||
        !Number.isFinite(m.points) ||
        !Array.isArray(m.starters),
    )
  )
    throw new Error("Final weekly results incomplete.");
  if (forecasts.data.length === 3000)
    throw new Error("Review snapshot limit reached; pagination required.");
  const outcomes = matchups
    .map((m) => ({
      roster_id: m.roster_id,
      points: m.points,
      starters: m.starters,
    }))
    .sort((a, b) => a.roster_id - b.roster_id);
  const teams = await db
    .from("teams")
    .select("roster_id")
    .eq("league_id", job.league_id);
  if (
    teams.error ||
    teams.data.some(
      (t: any) => !outcomes.some((o) => o.roster_id === t.roster_id),
    )
  )
    throw new Error("Final team coverage is incomplete.");
  const report = evaluateLiveWeek(forecasts.data, outcomes);
  const stored = await db.rpc("save_live_model_review", {
    p_job: job.id,
    p_attempt: job.attempts,
    p_outcome_hash: hash(outcomes),
    p_forecast_hash: hash(forecasts.data.map((r: any) => r.id)),
    p_outcomes: outcomes,
    p_report: report,
  });
  if (stored.error) throw new Error(stored.error.message);
  return {
    review_id: stored.data,
    status: "complete",
    snapshots: forecasts.data.length,
    change_decision: report.change_decision,
  };
}
