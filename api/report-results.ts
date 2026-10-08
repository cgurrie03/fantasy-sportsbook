import { createClient } from "@supabase/supabase-js";
import { score } from "./_lib/line-model.js";
import type { Projection } from "./_lib/line-model.ts";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
async function sleeper(path: string) {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(`Sleeper report data returned ${response.status}.`);
  return response.json();
}
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || !authorization.startsWith("Bearer "))
      return json({ error: "Sign in to refresh reports." }, 401);
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const auth = await client.auth.getUser();
    if (!auth.data.user) return json({ error: "Sign in again." }, 401);
    const { league_id, week: requestedWeek } = (await request.json()) as {
      league_id: string;
      week?: number;
    };
    const member = await client
      .from("league_memberships")
      .select("role")
      .eq("league_id", league_id)
      .eq("user_id", auth.data.user.id)
      .maybeSingle();
    if (member.error || member.data?.role !== "admin")
      return json({ error: "Only the league admin can refresh reports." }, 403);
    const [leagueResponse, teamResponse, cachedResponse] = await Promise.all([
      client
        .from("leagues")
        .select("sleeper_league_id,nfl_season")
        .eq("id", league_id)
        .single(),
      client
        .from("teams")
        .select("id,roster_id,team_name")
        .eq("league_id", league_id),
      client
        .from("league_result_weeks")
        .select("market_week,nfl_season,final,fetched_at")
        .eq("league_id", league_id),
    ]);
    if (leagueResponse.error || teamResponse.error || cachedResponse.error)
      throw new Error(
        leagueResponse.error?.message ??
          teamResponse.error?.message ??
          cachedResponse.error!.message,
      );
    const league = leagueResponse.data,
      teams = teamResponse.data;
    cachedResponse.data = cachedResponse.data.filter(
      (r) => r.nfl_season === league.nfl_season,
    );
    const [settings, state] = (await Promise.all([
      sleeper(`https://api.sleeper.app/v1/league/${league.sleeper_league_id}`),
      sleeper("https://api.sleeper.app/v1/state/nfl"),
    ])) as [
      {
        scoring_settings: Record<string, number>;
        settings: { last_report: number };
      },
      { season: string; week: number },
    ];
    if (Number(state.season) !== league.nfl_season)
      throw new Error("Sleeper season does not match this league.");
    const last = Math.min(18, Math.max(1, Number(state.week)));
    const bracket =
      Number(state.week) >=
      Number(
        (settings.settings as { playoff_week_start?: number })
          .playoff_week_start ?? 15,
      )
        ? ((await sleeper(
            `https://api.sleeper.app/v1/league/${league.sleeper_league_id}/winners_bracket`,
          ).catch(() => [])) as { p?: number; w?: number }[])
        : [];
    const champion = bracket.find((g) => g.p === 1)?.w ?? null;
    if (
      requestedWeek !== undefined &&
      (!Number.isInteger(requestedWeek) ||
        requestedWeek < 1 ||
        requestedWeek > last)
    )
      return json({ error: "Invalid report week." }, 400);
    // At most two weeks per request keeps historical backfills bounded and resumable.
    const weeks = requestedWeek
      ? [requestedWeek]
      : Array.from({ length: last }, (_, i) => i + 1)
          .filter((w) => {
            const cached = cachedResponse.data.find((r) => r.market_week === w);
            return (
              !cached ||
              !cached.final ||
              Date.now() - Date.parse(cached.fetched_at) > 86400000
            );
          })
          .slice(0, 2);
    for (const week of weeks) {
      const [games, projections, stats] = (await Promise.all([
        sleeper(
          `https://api.sleeper.app/v1/league/${league.sleeper_league_id}/matchups/${week}`,
        ),
        sleeper(
          `https://api.sleeper.com/projections/nfl/${league.nfl_season}/${week}?season_type=regular`,
        ).catch(() => null),
        sleeper(
          `https://api.sleeper.com/stats/nfl/${league.nfl_season}/${week}?season_type=regular`,
        ).catch(() => null),
      ])) as [
        {
          roster_id: number;
          matchup_id: number;
          points: number;
          custom_points?: number | null;
          starters: string[];
          players_points?: Record<string, number>;
        }[],
        Projection[] | null,
        { player_id: string; stats: Record<string, number> }[] | null,
      ];
      if (
        games.length !== teams.length ||
        new Set(games.map((g) => g.roster_id)).size !== teams.length
      )
        throw new Error(`Week ${week} has incomplete league results.`);
      const projectionMap = new Map(
        (Array.isArray(projections) ? projections : []).map((p) => [
          p.player_id,
          score(p.stats, settings.scoring_settings),
        ]),
      );
      const playerResults = new Map(
        (Array.isArray(stats) ? stats : [])
          .filter((p) => typeof p.stats?.gp === "number")
          .map((p) => [
            p.player_id,
            {
              played: p.stats.gp > 0,
              points: score(p.stats, settings.scoring_settings),
            },
          ]),
      );
      const playerNames = new Map(
        (Array.isArray(projections) ? projections : []).map((p) => [
          p.player_id,
          [p.player?.first_name, p.player?.last_name].filter(Boolean).join(" "),
        ]),
      );
      const results = Object.fromEntries(
        teams.map((t) => {
          const game = games.find((g) => g.roster_id === t.roster_id)!;
          const points = game.custom_points ?? game.points;
          if (!Number.isFinite(points))
            throw new Error(
              `Week ${week} score is unavailable for ${t.team_name}.`,
            );
          const valid = game.starters?.filter((id) => id !== "0") ?? [];
          const projection =
            valid.length && valid.every((id) => projectionMap.has(id))
              ? valid.reduce((n, id) => n + projectionMap.get(id)!, 0)
              : null;
          return [
            t.id,
            {
              name: t.team_name,
              points,
              matchup_id: game.matchup_id,
              projection,
              projection_basis: "reconstructed_actual_starters",
              starters: game.starters,
              players_points: game.players_points ?? {},
              player_results: Object.fromEntries(
                Object.keys(game.players_points ?? {})
                  .filter((id) => playerResults.has(id))
                  .map((id) => [id, playerResults.get(id)]),
              ),
              player_names: Object.fromEntries(
                Object.keys(game.players_points ?? {}).map((id) => [
                  id,
                  playerNames.get(id) || id,
                ]),
              ),
              champion_roster: champion,
            },
          ];
        }),
      );
      const final =
        week < Number(state.week) &&
        week <= Number(settings.settings.last_report ?? 0);
      const saved = await client.rpc("save_report_results", {
        p_league: league_id,
        p_season: league.nfl_season,
        p_week: week,
        p_final: final,
        p_results: results,
      });
      if (saved.error) throw new Error(saved.error.message);
    }
    return json({
      refreshed: weeks,
      remaining: Math.max(
        0,
        last -
          (cachedResponse.data.length +
            weeks.filter(
              (w) => !cachedResponse.data.some((c) => c.market_week === w),
            ).length),
      ),
      note: "Report refresh changes no tickets, wallets, lines, or emails.",
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Report refresh failed.",
      },
      500,
    );
  }
}
