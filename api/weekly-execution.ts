import { createClient } from "@supabase/supabase-js";
import { settleLeg } from "./_lib/settlement.js";
import type { FinalResults, LegInput } from "./_lib/settlement.ts";
import { score } from "./_lib/line-model.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const authorization = request.headers.get("authorization") ?? "";
    if (!url || !key || !authorization.startsWith("Bearer "))
      return json({ error: "Sign in before reviewing weekly execution." }, 401);
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await client.auth.getUser();
    if (!auth.data.user || auth.error)
      return json({ error: "Sign in again." }, 401);
    const claim = await client.rpc("claim_memberships");
    if (claim.error) throw new Error(claim.error.message);
    const input = (await request.json()) as {
      league_id?: string;
      apply?: boolean;
    };
    if (!input.league_id) return json({ error: "League is required." }, 400);
    const member = await client
      .from("league_memberships")
      .select("role")
      .eq("league_id", input.league_id)
      .eq("user_id", auth.data.user.id)
      .maybeSingle();
    if (member.error) throw new Error(member.error.message);
    if (member.data?.role !== "admin")
      return json(
        { error: "Only the league admin can review weekly execution." },
        403,
      );
    const period = await client.rpc("sportsbook_period", {
      p_league: input.league_id,
    });
    if (period.error || !period.data?.[0])
      throw new Error(period.error?.message ?? "League period unavailable.");
    const { week, nfl_season: season } = period.data[0] as {
      week: number;
      nfl_season: number;
    };
    const [teamsResponse, ticketsResponse, walletsResponse] = await Promise.all(
      [
        client
          .from("teams")
          .select("id,roster_id,team_name")
          .eq("league_id", input.league_id),
        client
          .from("tickets")
          .select("id,team_id,market_week,nfl_season,ticket_type,stake")
          .eq("league_id", input.league_id)
          .eq("status", "OPEN")
          .eq("nfl_season", season),
        client.from("wallets").select("team_id,balance"),
      ],
    );
    for (const r of [teamsResponse, ticketsResponse, walletsResponse])
      if (r.error) throw new Error(r.error.message);
    const teams = teamsResponse.data ?? [],
      tickets = ticketsResponse.data ?? [];
    const get = async (path: string) => {
      const r = await fetch(`https://api.sleeper.com/${path}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`Sleeper results returned ${r.status}.`);
      return r.json();
    };
    const state = (await get("v1/state/nfl")) as {
      season: string;
      week: number;
    };
    const league = (await get("v1/league/1312126153980391424")) as {
      scoring_settings: Record<string, number>;
      season: string;
    };
    if (Number(league.season) !== season || Number(state.season) !== season)
      throw new Error(
        "Sleeper results do not match the active season; admin review required.",
      );
    const preview = [];
    for (const marketWeek of [
      ...new Set(
        tickets
          .filter((t) => t.ticket_type !== "future")
          .map((t) => t.market_week),
      ),
    ]) {
      const final = state.week > marketWeek;
      const weekly = tickets.filter(
        (t) => t.market_week === marketWeek && t.ticket_type !== "future",
      );
      const legsResponse = await client
        .from("ticket_legs")
        .select("id,ticket_id,accepted_line,settlement_context")
        .in(
          "ticket_id",
          weekly.map((t) => t.id),
        );
      if (legsResponse.error) throw new Error(legsResponse.error.message);
      const legs = (legsResponse.data ?? []) as (LegInput & {
        ticket_id: string;
      })[];
      const results: FinalResults = { final, teams: {}, players: {} };
      if (final) {
        const matchups = (await get(
          `v1/league/1312126153980391424/matchups/${marketWeek}`,
        )) as { roster_id: number; points: number }[];
        for (const team of teams) {
          const result = matchups.find((m) => m.roster_id === team.roster_id);
          if (!result || !Number.isFinite(result.points))
            throw new Error(`Final scores missing for ${team.team_name}.`);
          results.teams[team.id] = {
            name: team.team_name,
            points: result.points,
          };
        }
        if (legs.some((l) => l.settlement_context?.kind === "player_points")) {
          const stats = (await get(
            `stats/nfl/${season}/${marketWeek}?season_type=regular`,
          )) as { player_id: string; stats: Record<string, number> }[];
          if (!Array.isArray(stats))
            throw new Error("Player results unavailable.");
          for (const row of stats)
            if (typeof row.stats?.gp === "number")
              results.players[row.player_id] = {
                played: row.stats.gp > 0,
                points: score(row.stats, league.scoring_settings),
              };
        }
      }
      for (const ticket of weekly) {
        const outcomes = legs
          .filter((l) => l.ticket_id === ticket.id)
          .map((l) => settleLeg(l, results));
        const pending =
          !outcomes.length || outcomes.some((l) => l.status === "OPEN");
        let applied: unknown = null;
        if (input.apply && !pending) {
          const saved = await client.rpc("settle_weekly_ticket", {
            p_ticket: ticket.id,
            p_results: outcomes,
          });
          if (saved.error) throw new Error(saved.error.message);
          applied = saved.data;
        }
        preview.push({
          ticket_id: ticket.id,
          team_id: ticket.team_id,
          market_week: marketWeek,
          pending,
          legs: outcomes,
          applied,
        });
      }
    }
    const eastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const day = eastern.find((p) => p.type === "weekday")?.value;
    const hour = Number(eastern.find((p) => p.type === "hour")?.value);
    const replenishmentDue =
      (day === "Tue" && hour >= 8) ||
      ["Wed", "Thu", "Fri", "Sat", "Sun"].includes(day ?? "");
    let replenishment: unknown = null;
    if (input.apply && replenishmentDue) {
      const saved = await client.rpc("replenish_weekly_balances", {
        p_league: input.league_id,
        p_season: season,
        p_week: week,
      });
      if (saved.error) throw new Error(saved.error.message);
      replenishment = saved.data;
    }
    return json({
      week,
      season,
      mode: input.apply ? "applied" : "preview",
      tickets: preview,
      replenishment_due: replenishmentDue,
      replenishment,
      balances: (walletsResponse.data ?? [])
        .filter((w) => teams.some((t) => t.id === w.team_id))
        .map((w) => ({
          team_id: w.team_id,
          current: Number(w.balance),
          eligible:
            w.balance !== null &&
            !tickets.some(
              (t) =>
                t.team_id === w.team_id &&
                (t.ticket_type === "future" || t.market_week < week),
            ),
          target: w.balance === null ? null : Math.max(100, Number(w.balance)),
        })),
      note: "Preview does not change balances, tickets, or send emails. Scheduled execution is not active.",
    });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Weekly execution failed." },
      503,
    );
  }
}
