import { isWorker } from "./_lib/worker-auth.js";
import { createClient } from "@supabase/supabase-js";
import { settleLeg } from "./_lib/settlement.js";
import type { FinalResults, LegInput } from "./_lib/settlement.ts";
import { score } from "./_lib/line-model.js";
import {
  settleFuture,
  regularSeasonResults,
} from "./_lib/futures-settlement.js";
import type { SeasonResult } from "./_lib/futures-settlement.ts";
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
    const worker = isWorker(request);
    const authorization = request.headers.get("authorization") ?? "";
    if (!url || !key || (!worker && !authorization.startsWith("Bearer ")))
      return json({ error: "Sign in before reviewing weekly execution." }, 401);
    const client = createClient(
      url,
      worker ? process.env.SUPABASE_SERVICE_ROLE_KEY! : key,
      {
        global: {
          headers: {
            Authorization: worker
              ? `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
              : authorization,
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    if (!worker) {
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.error)
        return json({ error: "Sign in again." }, 401);
      const claim = await client.rpc("claim_memberships");
      if (claim.error) throw new Error(claim.error.message);
    }
    const input = (await request.json()) as {
      league_id?: string;
      apply?: boolean;
      replenish?: boolean;
      overrides?: {
        id: string;
        status: "WON" | "LOST" | "PUSH";
        actual_value: number;
        evidence: string;
      }[];
    };
    if (!input.league_id) return json({ error: "League is required." }, 400);
    if (!worker) {
      const auth = await client.auth.getUser();
      const member = await client
        .from("league_memberships")
        .select("role")
        .eq("league_id", input.league_id)
        .eq("user_id", auth.data.user!.id)
        .maybeSingle();
      if (member.error) throw new Error(member.error.message);
      if (member.data?.role !== "admin")
        return json(
          { error: "Only the league admin can review weekly execution." },
          403,
        );
    }
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
      settings: {
        playoff_week_start: number;
        playoff_teams: number;
        last_report?: number;
      };
    };
    if (Number(league.season) !== season || Number(state.season) !== season)
      throw new Error(
        "Sleeper results do not match the active season; admin review required.",
      );
    if (
      input.overrides &&
      (!Array.isArray(input.overrides) ||
        input.overrides.length > 200 ||
        new Set(input.overrides.map((o) => o.id)).size !==
          input.overrides.length)
    )
      return json({ error: "Invalid result review." }, 400);
    const usedOverrides = new Set<string>();
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
        .select(
          "id,ticket_id,selection,accepted_line,settlement_context,status,actual_value,result_evidence,accepted_decimal_odds",
        )
        .in(
          "ticket_id",
          weekly.map((t) => t.id),
        );
      if (legsResponse.error) throw new Error(legsResponse.error.message);
      const legs = (legsResponse.data ?? []) as (LegInput & {
        ticket_id: string;
        selection: string;
        status: string;
        actual_value: number | null;
        result_evidence: string;
        accepted_decimal_odds: number | null;
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
        const ticketLegs = legs.filter((l) => l.ticket_id === ticket.id);
        const outcomes = ticketLegs.map((l) => {
          const outcome = { ...settleLeg(l, results), selection: l.selection };
          if (l.status !== "OPEN")
            return {
              id: l.id,
              selection: l.selection,
              status: l.status as "WON" | "LOST" | "PUSH",
              actual_value: l.actual_value,
              evidence: l.result_evidence,
            };
          const override = input.overrides?.find((o) => o.id === l.id);
          if (!override) return outcome;
          if (
            !final ||
            outcome.status !== "OPEN" ||
            !["WON", "LOST", "PUSH"].includes(override.status) ||
            !Number.isFinite(override.actual_value) ||
            !override.evidence?.trim() ||
            override.evidence.trim().length < 5 ||
            override.evidence.length > 500
          )
            throw new Error(
              "Only unresolved legs from a completed week can be reviewed; provide an actual value and a reason.",
            );
          usedOverrides.add(l.id);
          return {
            ...override,
            selection: l.selection,
            evidence: "Admin-reviewed result: " + override.evidence.trim(),
          };
        });
        const pending =
          !outcomes.length || outcomes.some((l) => l.status === "OPEN");
        const applied: unknown = null;
        preview.push({
          ticket_id: ticket.id,
          team_id: ticket.team_id,
          market_week: marketWeek,
          pending,
          final,
          stake: Number(ticket.stake),
          projected_payout: pending
            ? null
            : outcomes.some((o) => o.status === "LOST")
              ? 0
              : Math.round(
                  Number(ticket.stake) *
                    outcomes.reduce(
                      (price, o) =>
                        price *
                        (o.status === "WON"
                          ? Number(
                              ticketLegs.find((l) => l.id === o.id)
                                ?.accepted_decimal_odds ?? 0,
                            )
                          : 1),
                      1,
                    ) *
                    100,
                ) / 100,
          legs: outcomes,
          applied,
        });
      }
    }
    const seasonResults: SeasonResult = {
      champion: null,
      playoffRosters: null,
      last: null,
      names: Object.fromEntries(teams.map((t) => [t.roster_id, t.team_name])),
    };
    const futures = tickets.filter((t) => t.ticket_type === "future");
    const futureBoard = await client
      .from("sportsbook_boards")
      .select("id")
      .eq("league_id", input.league_id)
      .eq("nfl_season", season)
      .eq("board_type", "future")
      .maybeSingle();
    if (futureBoard.error) throw new Error(futureBoard.error.message);
    const regularFinal =
      state.week >= league.settings.playoff_week_start &&
      Number(league.settings.last_report) >=
        league.settings.playoff_week_start - 1;
    if (futureBoard.data && regularFinal) {
      // Reconstruct only the regular season so later playoff scores cannot alter draft order.
      const weeks = (await Promise.all(
        Array.from({ length: league.settings.playoff_week_start - 1 }, (_, i) =>
          get(`v1/league/1312126153980391424/matchups/${i + 1}`),
        ),
      )) as { roster_id: number; matchup_id: number; points: number }[][];
      const totals = teams.map((t) => ({
        roster_id: t.roster_id,
        settings: { wins: 0, ties: 0, fpts: 0 },
      }));
      let complete = true;
      for (const games of weeks) {
        if (
          games.length !== teams.length ||
          new Set(games.map((g) => g.roster_id)).size !== teams.length
        )
          complete = false;
        for (const t of totals) {
          const game = games.find((g) => g.roster_id === t.roster_id),
            opponent = games.find(
              (g) =>
                g.matchup_id === game?.matchup_id &&
                g.roster_id !== t.roster_id,
            );
          if (
            !game ||
            !opponent ||
            !Number.isFinite(game.points) ||
            !Number.isFinite(opponent.points)
          ) {
            complete = false;
            continue;
          }
          t.settings.fpts += game.points;
          t.settings.wins += Number(game.points > opponent.points);
          t.settings.ties += Number(game.points === opponent.points);
        }
      }
      if (complete)
        Object.assign(
          seasonResults,
          regularSeasonResults(totals, league.settings.playoff_teams),
        );
      const bracket = (await get(
        "v1/league/1312126153980391424/winners_bracket",
      )) as { p?: number; w?: number }[];
      const winner = bracket.find((g) => g.p === 1)?.w;
      seasonResults.champion = Number.isInteger(winner) ? winner! : null;
    }
    if (futures.length) {
      const r = await client
        .from("ticket_legs")
        .select(
          "id,ticket_id,selection,accepted_line,settlement_context,status,actual_value,result_evidence,accepted_decimal_odds",
        )
        .in(
          "ticket_id",
          futures.map((t) => t.id),
        );
      if (r.error) throw new Error(r.error.message);
      for (const ticket of futures) {
        const legs = (r.data ?? []).filter((l) => l.ticket_id === ticket.id);
        const outcomes = legs.map((l) => {
          const outcome = {
            ...settleFuture(l, seasonResults),
            selection: l.selection,
          };
          const override = input.overrides?.find((o) => o.id === l.id);
          if (!override) return outcome;
          const final =
            l.settlement_context?.kind === "future_champion"
              ? seasonResults.champion !== null
              : regularFinal;
          if (
            !final ||
            outcome.status !== "OPEN" ||
            !["WON", "LOST", "PUSH"].includes(override.status) ||
            !Number.isFinite(override.actual_value) ||
            !override.evidence?.trim() ||
            override.evidence.trim().length < 5 ||
            override.evidence.length > 500
          )
            throw new Error(
              "Only unresolved final season results can be reviewed; provide the result and evidence.",
            );
          usedOverrides.add(l.id);
          return {
            ...override,
            selection: l.selection,
            evidence:
              "Admin-reviewed season result: " + override.evidence.trim(),
          };
        });
        const pending =
          !outcomes.length || outcomes.some((o) => o.status === "OPEN");
        preview.push({
          ticket_id: ticket.id,
          team_id: ticket.team_id,
          market_week: ticket.market_week,
          ticket_type: "future",
          pending,
          final: legs.some(
            (l) => l.settlement_context?.kind === "future_champion",
          )
            ? seasonResults.champion !== null
            : regularFinal,
          stake: Number(ticket.stake),
          projected_payout: pending
            ? null
            : outcomes.some((o) => o.status === "LOST")
              ? 0
              : Math.round(
                  Number(ticket.stake) *
                    legs.reduce(
                      (price, l) => price * Number(l.accepted_decimal_odds),
                      1,
                    ) *
                    100,
                ) / 100,
          legs: outcomes,
          applied: null as unknown,
        });
      }
    }
    if (input.apply && futureBoard.data) {
      const kinds = [
        ...(seasonResults.playoffRosters ? ["future_playoffs"] : []),
        ...(seasonResults.last !== null ? ["future_first_pick"] : []),
        ...(seasonResults.champion !== null ? ["future_champion"] : []),
      ];
      if (kinds.length) {
        const r = worker
          ? await client.rpc("worker_operation", {
              p_league: input.league_id,
              p_operation: "resolve_futures",
              p_args: { kinds },
            })
          : await client.rpc("resolve_future_markets", {
              p_league: input.league_id,
              p_kinds: kinds,
            });
        if (r.error) throw new Error(r.error.message);
      }
    }
    if (input.overrides?.some((o) => !usedOverrides.has(o.id)))
      throw new Error(
        "A reviewed result no longer belongs to an unresolved ticket. Refresh the preview.",
      );
    if (input.apply)
      for (const ticket of preview) {
        if (!ticket.legs.length) continue;
        const saved = worker
          ? await client.rpc("worker_operation", {
              p_league: input.league_id,
              p_operation: "settle",
              p_args: { ticket: ticket.ticket_id, results: ticket.legs },
            })
          : await client.rpc("settle_weekly_ticket", {
              p_ticket: ticket.ticket_id,
              p_results: ticket.legs,
            });
        if (saved.error) throw new Error(saved.error.message);
        ticket.applied = saved.data;
      }
    const schedule = await client
      .from("weekly_schedule")
      .select("job_times,automation_enabled")
      .eq("league_id", input.league_id)
      .maybeSingle();
    if (schedule.error) throw new Error(schedule.error.message);
    const resetTime = String(schedule.data?.job_times?.replenishment ?? "08:00")
      .split(":")
      .map(Number);
    const eastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const day = eastern.find((p) => p.type === "weekday")?.value;
    const hour = Number(eastern.find((p) => p.type === "hour")?.value);
    const minute = Number(eastern.find((p) => p.type === "minute")?.value);
    const replenishmentDue =
      (day === "Tue" &&
        hour * 60 + minute >= resetTime[0] * 60 + resetTime[1]) ||
      ["Wed", "Thu", "Fri", "Sat", "Sun"].includes(day ?? "");
    let replenishment: unknown = null;
    if (input.apply && replenishmentDue && input.replenish !== false) {
      const saved = worker
        ? await client.rpc("worker_operation", {
            p_league: input.league_id,
            p_operation: "replenish",
            p_args: { season, week },
          })
        : await client.rpc("replenish_weekly_balances", {
            p_league: input.league_id,
            p_season: season,
            p_week: week,
          });
      if (saved.error) throw new Error(saved.error.message);
      replenishment = saved.data;
    }
    const [currentWallets, currentTickets, ledger] = await Promise.all([
      client.from("wallets").select("team_id,balance"),
      client
        .from("tickets")
        .select("team_id,market_week,status,ticket_type,nfl_season,stake")
        .eq("league_id", input.league_id),
      client
        .from("wallet_ledger")
        .select("team_id,event_key")
        .like("event_key", `weekly:replenish:${season}:${week}:%`),
    ]);
    for (const r of [currentWallets, currentTickets, ledger])
      if (r.error) throw new Error(r.error.message);
    const balances = (currentWallets.data ?? [])
      .filter((w) => teams.some((t) => t.id === w.team_id))
      .map((w) => {
        const userTickets = (currentTickets.data ?? []).filter(
          (t) => t.team_id === w.team_id,
        );
        const processed = (ledger.data ?? []).some(
          (l) => l.team_id === w.team_id,
        );
        const reason = processed
          ? "Already processed this week"
          : w.balance === null
            ? "Balance unavailable"
            : userTickets.some(
                  (t) =>
                    t.status === "OPEN" &&
                    t.ticket_type !== "future" &&
                    t.nfl_season === season &&
                    t.market_week < week,
                )
              ? "Unresolved ticket — admin review required"
              : userTickets.some(
                    (t) =>
                      t.status !== "VOIDED" &&
                      t.ticket_type !== "future" &&
                      t.nfl_season === season &&
                      t.market_week >= week,
                  )
                ? "Current-week wager already placed"
                : !replenishmentDue
                  ? "Not due until Tuesday's replenishment time"
                  : "Eligible";
        return {
          team_id: w.team_id,
          name: teams.find((t) => t.id === w.team_id)?.team_name,
          current: Number(w.balance),
          eligible: reason === "Eligible",
          reason,
          target:
            w.balance === null
              ? null
              : reason === "Eligible"
                ? Math.max(
                    25,
                    100 -
                      userTickets
                        .filter(
                          (t) =>
                            t.ticket_type === "future" && t.status === "OPEN",
                        )
                        .reduce((sum, t) => sum + Number(t.stake), 0),
                    Number(w.balance),
                  )
                : Number(w.balance),
        };
      });
    return json({
      week,
      season,
      mode: input.apply ? "applied" : "preview",
      tickets: preview,
      replenishment_due: replenishmentDue,
      replenishment,
      balances,
      note: input.apply
        ? "Results saved, eligible balances replenished, and leaderboard updated. Unresolved tickets remain open. Scheduled execution follows the saved settings."
        : "Preview does not change balances, tickets, or send emails. Scheduled execution is not active.",
    });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Weekly execution failed." },
      503,
    );
  }
}
