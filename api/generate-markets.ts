import { createClient } from "@supabase/supabase-js";
import {
  bestLineup,
  candidates,
  deviation,
  highLowProbabilities,
} from "./_lib/line-model.js";
import type { History, Projection } from "./_lib/line-model.ts";
import type { Market } from "../src/lib/markets.ts";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const roundHalf = (value: number) => Math.round(value * 2) / 2;
const american = (probability: number) =>
  Math.round(
    probability >= 0.5
      ? (-100 * probability) / (1 - probability)
      : (100 * (1 - probability)) / probability,
  );
const SLEEPER_LEAGUE_ID = "1312126153980391424";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const url = process.env.SUPABASE_URL,
      serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (!url || !serviceKey || !token)
      return json({ error: "Market generation is not configured." }, 401);
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userClient = createClient(
      url,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: auth } = await userClient.auth.getUser();
    if (!auth.user)
      return json({ error: "Sign in again before generating markets." }, 401);
    // Keep the membership mapping in sync with the verified email before checking admin access.
    await userClient.rpc("claim_memberships");
    let input: {
      league_id?: string;
      week?: number;
      nfl_season?: number;
      category?: string;
    };
    try {
      input = (await request.json()) as typeof input;
    } catch {
      return json({ error: "Invalid generation request." }, 400);
    }
    if (
      !input.league_id ||
      !Number.isInteger(input.week) ||
      input.week! < 1 ||
      input.week! > 18 ||
      !Number.isInteger(input.nfl_season)
    )
      return json(
        { error: "League, week (1–18), and season are required." },
        400,
      );
    const { data: memberById } = await client
      .from("league_memberships")
      .select("role,invited_email")
      .eq("league_id", input.league_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const { data: memberByEmail } =
      auth.user.email && !memberById
        ? await client
            .from("league_memberships")
            .select("role,invited_email")
            .eq("league_id", input.league_id)
            .ilike("invited_email", auth.user.email)
            .maybeSingle()
        : { data: null };
    const member = memberById ?? memberByEmail;
    if (member?.role !== "admin")
      return json(
        { error: "Only the league admin can generate markets." },
        403,
      );
    const { data: teams, error: teamError } = await userClient
      .from("teams")
      .select("id,roster_id,team_name,wins,losses,ties")
      .eq("league_id", input.league_id)
      .order("roster_id");
    if (teamError)
      return json(
        { error: `League teams could not be loaded: ${teamError.message}` },
        400,
      );
    if (!teams?.length)
      return json(
        { error: "League teams could not be loaded for this league." },
        400,
      );

    const category = input.category ?? "Matchups";
    if (!["Matchups", "Player Points", "Weekly Specials"].includes(category))
      return json(
        { error: "Season Futures generation is not available yet." },
        409,
      );
    const fetchData = async (path: string) => {
      const response = await fetch(path, {
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok)
        throw new Error(
          `Sleeper returned ${response.status}. No replacement estimates were generated.`,
        );
      return response.json();
    };
    const sleeper = (path: string) =>
      fetchData(`https://api.sleeper.app/v1/${path}`);
    const [league, rosters, matchups, projections, historical] =
      (await Promise.all([
        sleeper(`league/${SLEEPER_LEAGUE_ID}`),
        sleeper(`league/${SLEEPER_LEAGUE_ID}/rosters`),
        sleeper(`league/${SLEEPER_LEAGUE_ID}/matchups/${input.week}`),
        fetchData(
          `https://api.sleeper.com/projections/nfl/${input.nfl_season}/${input.week}?season_type=regular`,
        ),
        Promise.all(
          Array.from({ length: input.week! - 1 }, (_, i) =>
            sleeper(`league/${SLEEPER_LEAGUE_ID}/matchups/${i + 1}`),
          ),
        ),
      ])) as [
        {
          scoring_settings: Record<string, number>;
          roster_positions: string[];
          season: string;
        },
        {
          roster_id: number;
          players: string[];
          reserve?: string[];
          taxi?: string[];
        }[],
        { roster_id: number; matchup_id: number }[],
        Projection[],
        History[][],
      ];
    if (Number(league.season) !== input.nfl_season)
      throw new Error("The selected season does not match the Sleeper league.");
    if (!Array.isArray(projections) || !projections.length)
      throw new Error(
        "Weekly projections are unavailable. No placeholder lines were generated.",
      );
    const allHistory = historical.flat();
    const pool = candidates(projections, league.scoring_settings, allHistory);
    const models = teams.map((team) => {
      const roster = rosters.find((r) => r.roster_id === team.roster_id);
      if (!roster)
        throw new Error(`Sleeper roster missing for ${team.team_name}.`);
      const excluded = new Set([
        ...(roster.reserve ?? []),
        ...(roster.taxi ?? []),
      ]);
      const lineup = bestLineup(
        pool.filter(
          (p) => roster.players.includes(p.id) && !excluded.has(p.id),
        ),
        league.roster_positions,
        true,
      );
      if (!lineup.length)
        throw new Error(
          `No available projected starters for ${team.team_name}.`,
        );
      const mean = roundHalf(
        lineup.reduce((total, player) => total + player.expected, 0),
      );
      const scores = allHistory
        .filter((h) => h.roster_id === team.roster_id)
        .map((h) => Number(h.points));
      return {
        ...team,
        lineup,
        mean,
        sd: deviation(scores, mean),
        unfilled_slots:
          league.roster_positions.filter((p) => p !== "BN").length -
          lineup.length,
      };
    });
    const quotes: Market[] = [],
      generatedAt = new Date().toISOString();
    const base = {
      board_id: "generated",
      boost_pct: 0,
      featured: "" as const,
      active: true,
    };
    const metadata = {
      generated: true,
      generated_at: generatedAt,
      projection_method:
        "League-scored weekly projections, optimal legal lineup, capped historical adjustment",
      historical_weeks: historical.length,
      injury_source:
        "Sleeper projection feed; Out/IR/PUP/Suspended/Doubtful excluded",
      scoring_settings: league.scoring_settings,
    };
    const pairings = [
      ...new Set(matchups.map((m) => m.matchup_id).filter((id) => id != null)),
    ].map((id) => matchups.filter((m) => m.matchup_id === id));
    if (
      pairings.length !== teams.length / 2 ||
      pairings.some((pair) => pair.length !== 2)
    )
      throw new Error("The full weekly matchup schedule is unavailable.");
    for (const pair of pairings) {
      const home = models.find((t) => t.roster_id === pair[0].roster_id)!,
        away = models.find((t) => t.roster_id === pair[1].roster_id)!;
      const key = `sleeper-${input.week}-${Math.min(home.roster_id, away.roster_id)}-${Math.max(home.roster_id, away.roster_id)}`;
      const context = {
        ...base,
        matchup_key: key,
        home_team_id: home.id,
        away_team_id: away.id,
        home_projection: home.mean,
        away_projection: away.mean,
        metadata,
      };
      const add = (
        kind: Market["kind"],
        side: string,
        subject: string,
        line: number | null,
        odds: number,
        teamId: string | null,
        extra = {},
      ) =>
        quotes.push({
          ...context,
          id: crypto.randomUUID(),
          market_key: `${key}:${kind}${kind === "team_total" ? `:${teamId}` : ""}`,
          kind,
          side,
          subject,
          line,
          odds,
          team_id: teamId,
          label:
            line == null
              ? subject
              : `${subject} ${kind === "spread" ? `${line > 0 ? "+" : ""}${line}` : `${side === "over" ? "Over" : "Under"} ${line}`}`,
          ...extra,
        });
      if (category === "Matchups") {
        const spread = roundHalf(away.mean - home.mean),
          total = roundHalf(home.mean + away.mean);
        const probability = Math.min(
          0.95,
          Math.max(
            0.05,
            1 /
              (1 +
                Math.exp(
                  (-(home.mean - away.mean) * 1.7) /
                    Math.hypot(home.sd, away.sd),
                )),
          ),
        );
        for (const [team, side, line, p] of [
          [home, "home", spread, probability],
          [away, "away", -spread, 1 - probability],
        ] as const) {
          add("spread", side, team.team_name, line, -110, team.id);
          add("moneyline", side, team.team_name, null, american(p), team.id);
          for (const direction of ["over", "under"])
            add(
              "team_total",
              direction,
              team.team_name,
              team.mean,
              -110,
              team.id,
            );
        }
        for (const side of ["over", "under"])
          add("match_total", side, "Match Total", total, -110, null);
      } else if (category === "Player Points") {
        const top = [
          ...home.lineup.map((p) => ({ ...p, owner: home })),
          ...away.lineup.map((p) => ({ ...p, owner: away })),
        ]
          .filter(
            (p) =>
              !p.positions.some((pos) => ["K", "DEF", "DST"].includes(pos)),
          )
          .sort((a, b) => b.expected - a.expected)
          .slice(0, 12);
        for (const player of top)
          for (const side of ["over", "under"])
            add(
              "player_points",
              side,
              player.name,
              roundHalf(player.expected),
              -110,
              player.owner.id,
              {
                market_key: `${key}:player_points:${player.id}`,
                metadata: {
                  ...metadata,
                  player_id: player.id,
                  position: player.positions[0],
                  nfl_team: player.team,
                  season_average:
                    player.average == null
                      ? undefined
                      : roundHalf(player.average),
                  projection: roundHalf(player.projection),
                  expected_points: roundHalf(player.expected),
                  injury_status: player.injury,
                  game_info: player.game,
                },
              },
            );
      }
    }
    if (category === "Weekly Specials") {
      const probabilities = highLowProbabilities(
        models.map((t) => ({ mean: t.mean, sd: t.sd })),
        input.week,
      );
      models.forEach((team, index) => {
        for (const kind of ["weekly_high", "weekly_low"] as const) {
          const p =
            kind === "weekly_high"
              ? probabilities.high[index]
              : probabilities.low[index];
          quotes.push({
            ...base,
            id: crypto.randomUUID(),
            market_key: `week-${input.week}:${kind}`,
            matchup_key: null,
            kind,
            side: team.id,
            label: team.team_name,
            subject: team.team_name,
            line: null,
            odds: Math.max(100, Math.min(100000, american(Math.min(0.499, p)))),
            team_id: team.id,
            home_team_id: null,
            away_team_id: null,
            home_projection: null,
            away_projection: null,
            metadata: { ...metadata, simulated_probability: p, trials: 6000 },
          });
        }
      });
    }
    if (category === "Weekly Specials") {
      const topSix = ["weekly_high", "weekly_low"].flatMap((kind) =>
        quotes.filter((q) => q.kind === kind)
          .sort((a, b) => Number(b.metadata.simulated_probability) - Number(a.metadata.simulated_probability))
          .slice(0, 6),
      );
      quotes.splice(0, quotes.length, ...topSix);
    }
    if (category === "Matchups") {
      const groups = [...new Set(quotes.map((q) => q.matchup_key))].map((key) =>
        quotes.filter((q) => q.matchup_key === key),
      );
      const rate = (id: string | null) => {
        const t = models.find((t) => t.id === id);
        return t
          ? (t.wins + 0.5 * t.ties) / Math.max(1, t.wins + t.losses + t.ties)
          : 0;
      };
      const closest = [...groups].sort(
        (a, b) =>
          Math.abs(a.find((q) => q.kind === "spread")!.line!) -
          Math.abs(b.find((q) => q.kind === "spread")!.line!),
      );
      const game =
        closest.find(
          (g) => rate(g[0].home_team_id) > 0.5 && rate(g[0].away_team_id) > 0.5,
        ) ?? closest[0];
      const tank = groups
        .filter(
          (g) =>
            rate(g[0].home_team_id) < 1 / 3 && rate(g[0].away_team_id) < 1 / 3,
        )
        .sort((a, b) =>
          [a, b]
            .map((g) =>
              models
                .filter(
                  (t) =>
                    t.id === g[0].home_team_id || t.id === g[0].away_team_id,
                )
                .reduce((n, t) => n + t.wins, 0),
            )
            .reduce((a, b) => a - b),
        )[0];
      quotes.forEach((q) => {
        q.featured =
          q.matchup_key === game?.[0].matchup_key
            ? "Game of the Week"
            : q.matchup_key === tank?.[0].matchup_key
              ? "Tank Bowl"
              : "";
        q.boost_pct =
          (q.featured === "Game of the Week" && q.kind === "moneyline") ||
          (q.featured === "Tank Bowl" &&
            (q.kind === "moneyline" ||
              (q.kind === "match_total" && q.side === "over")))
            ? 25
            : 0;
      });
    }
    if (!quotes.length)
      throw new Error(
        "No markets were generated; existing markets were retained.",
      );
    return json({
      week: input.week,
      quotes,
      generated_at: generatedAt,
      projection_method: metadata.projection_method,
      warnings: models
        .filter((t) => t.unfilled_slots > 0)
        .map(
          (t) =>
            `${t.team_name}: ${t.unfilled_slots} starting slot(s) have no active weekly projection and contribute zero points.`,
        ),
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Market generation failed.",
      },
      502,
    );
  }
}
