import { isWorker } from "./_lib/worker-auth.js";
import { countOptions } from "./_lib/count-options.js";
import { BASELINE, fairProbability } from "./_lib/model-assessment.js";
import { createClient } from "@supabase/supabase-js";
import {
  bestLineup,
  projectedLineup,
  matchupSpread,
  candidates,
  deviation,
  highLowProbabilities,
  weeklyScorerFields,
} from "./_lib/line-model.js";
import type { History, Projection } from "./_lib/line-model.ts";
import type { Market } from "../src/lib/markets.ts";
import {
  firstRoundOwner,
  seasonProbabilities,
  bracketProbabilities,
  seasonStrength,
} from "./_lib/futures-model.js";
import type { TradedPick, BracketGame } from "./_lib/futures-model.ts";

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
const specialOdds = (p: number, step = 25) => {
  const odds = american(Math.max(0.001, Math.min(0.999, p)));
  return (
    Math.sign(odds) * Math.max(100, Math.round(Math.abs(odds) / step) * step)
  );
};
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const url = process.env.SUPABASE_URL,
      publicKey =
        process.env.SUPABASE_ANON_KEY ??
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const worker = isWorker(request);
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (
      !url ||
      !publicKey ||
      (!worker && !token) ||
      (worker && !process.env.SUPABASE_SERVICE_ROLE_KEY)
    )
      return json({ error: "Market generation is not configured." }, 401);
    const userClient = createClient(
      url,
      worker ? process.env.SUPABASE_SERVICE_ROLE_KEY! : publicKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${worker ? process.env.SUPABASE_SERVICE_ROLE_KEY : token}`,
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    if (!worker) {
      const { data: auth } = await userClient.auth.getUser();
      if (!auth.user)
        return json({ error: "Sign in again before generating markets." }, 401);
      // Keep the membership mapping in sync with the verified email before checking admin access.
      const claim = await userClient.rpc("claim_memberships");
      if (claim.error)
        return json(
          {
            error: `Account mapping could not be verified: ${claim.error.message}`,
          },
          503,
        );
    }
    let input: {
      league_id?: string;
      week?: number;
      nfl_season?: number;
      category?: string;
      source_cycle_id?: string;
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
    if (!worker) {
      const auth = await userClient.auth.getUser();
      const { data: member, error: membershipError } = await userClient
        .from("league_memberships")
        .select("role,invited_email")
        .eq("league_id", input.league_id)
        .eq("user_id", auth.data.user!.id)
        .maybeSingle();
      if (membershipError)
        return json(
          {
            error: `Admin access could not be verified: ${membershipError.message}`,
          },
          503,
        );
      if (member?.role !== "admin")
        return json(
          { error: "Only the league admin can generate markets." },
          403,
        );
    }
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

    const configuration = await userClient
      .from("leagues")
      .select("sleeper_league_id,nfl_season")
      .eq("id", input.league_id)
      .single();
    if (
      configuration.error ||
      !configuration.data?.sleeper_league_id ||
      configuration.data.nfl_season !== input.nfl_season
    )
      return json(
        {
          error:
            "This league's season or Sleeper configuration is unavailable.",
        },
        409,
      );
    const sleeperLeagueId = configuration.data.sleeper_league_id;
    if (input.source_cycle_id) {
      if (!worker)
        return json({ error: "Source snapshots are worker-only." }, 403);
      const cycle = await userClient
        .from("line_refresh_cycles")
        .select("league_id,market_week,status,created_at")
        .eq("id", input.source_cycle_id)
        .single();
      if (
        cycle.error ||
        cycle.data.league_id !== input.league_id ||
        cycle.data.market_week !== input.week ||
        cycle.data.status !== "staging" ||
        Date.parse(cycle.data.created_at) < Date.now() - 600000
      )
        return json({ error: "Refresh source cycle expired or changed." }, 409);
    }
    const status = await userClient
      .from("line_refresh_runtime")
      .select("week_started,last_error,observed_at")
      .eq("league_id", input.league_id)
      .maybeSingle();
    if (status.data?.week_started || status.data?.last_error)
      return json(
        {
          error:
            "Pregame forecasts cannot price started games. Live pricing remains disabled until its inputs are verified.",
        },
        409,
      );
    const category = input.category ?? "Matchups";
    if (
      ![
        "Matchups",
        "Player Points",
        "Weekly Specials",
        "Season Futures",
      ].includes(category)
    )
      return json(
        { error: "Season Futures generation is not available yet." },
        409,
      );
    const control = await userClient
      .from("model_controls")
      .select("active_id")
      .eq("league_id", input.league_id)
      .single();
    if (control.error)
      throw new Error(
        "Model configuration unavailable; existing lines retained.",
      );
    const version = await userClient
      .from("model_config_versions")
      .select("id,config")
      .eq("id", control.data.active_id)
      .eq("league_id", input.league_id)
      .single();
    if (version.error) throw new Error("Active model version unavailable.");
    const config =
      category === "Matchups" || category === "Weekly Specials"
        ? version.data.config
        : BASELINE;
    const sources: Record<string, unknown> = {};
    const recordSource = (
      path: string,
      payload: any,
      cached = false,
      fetchedAt?: string,
    ) => {
      sources[path] = {
        payload,
        fetched_at: fetchedAt ?? new Date().toISOString(),
        archive_retrieved_at: new Date().toISOString(),
        cached_from_cycle: cached ? input.source_cycle_id : null,
        source_observed_at: null,
        observation_note:
          "Provider observation time unavailable; fetch time is not freshness proof.",
      };
      return payload;
    };
    const fetchData = async (path: string) => {
      if (input.source_cycle_id) {
        const cached = await userClient
          .from("line_refresh_sources")
          .select("payload,fetched_at")
          .eq("cycle_id", input.source_cycle_id)
          .eq("path", path)
          .maybeSingle();
        if (cached.error) throw new Error(cached.error.message);
        if (cached.data)
          return recordSource(
            path,
            cached.data.payload,
            true,
            cached.data.fetched_at,
          );
      }
      const response = await fetch(path, {
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok)
        throw new Error(
          `Sleeper returned ${response.status}. No replacement estimates were generated.`,
        );
      const payload = await response.json();
      if (input.source_cycle_id) {
        const saved = await userClient
          .from("line_refresh_sources")
          .upsert(
            { cycle_id: input.source_cycle_id, path, payload },
            { onConflict: "cycle_id,path", ignoreDuplicates: true },
          );
        if (saved.error) throw new Error(saved.error.message);
        const canonical = await userClient
          .from("line_refresh_sources")
          .select("payload,fetched_at")
          .eq("cycle_id", input.source_cycle_id)
          .eq("path", path)
          .single();
        if (canonical.error) throw new Error(canonical.error.message);
        return recordSource(
          path,
          canonical.data.payload,
          true,
          canonical.data.fetched_at,
        );
      }
      return recordSource(path, payload);
    };
    const sleeper = (path: string) =>
      fetchData(`https://api.sleeper.app/v1/${path}`);
    const [league, rosters, matchups, projections, historical] =
      (await Promise.all([
        sleeper(`league/${sleeperLeagueId}`),
        sleeper(`league/${sleeperLeagueId}/rosters`),
        sleeper(`league/${sleeperLeagueId}/matchups/${input.week}`),
        fetchData(
          `https://api.sleeper.com/projections/nfl/${input.nfl_season}/${input.week}?season_type=regular`,
        ),
        Promise.all(
          Array.from({ length: input.week! - 1 }, (_, i) =>
            sleeper(`league/${sleeperLeagueId}/matchups/${i + 1}`),
          ),
        ),
      ])) as [
        {
          scoring_settings: Record<string, number>;
          roster_positions: string[];
          season: string;
          settings: { playoff_week_start: number; playoff_teams: number };
        },
        {
          roster_id: number;
          settings: {
            wins: number;
            losses: number;
            ties: number;
            fpts?: number;
            fpts_decimal?: number;
          };
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
    for (const team of teams) {
      const record = rosters.find(
        (r) => r.roster_id === team.roster_id,
      )?.settings;
      if (record)
        Object.assign(team, {
          wins: record.wins,
          losses: record.losses,
          ties: record.ties,
        });
    }
    const allHistory = historical.flat();
    const pool = candidates(
      projections,
      league.scoring_settings,
      allHistory,
    ).map((p) => {
      const past = allHistory
        .flatMap((h) =>
          h.players_points?.[p.id] != null
            ? [Number(h.players_points[p.id])]
            : [],
        )
        .filter(Number.isFinite);
      const center = past.length
        ? past.reduce((a, b) => a + b, 0) / past.length
        : p.expected;
      const variance =
        past.length > 1
          ? past.reduce((s, v) => s + (v - center) ** 2, 0) / (past.length - 1)
          : (p.projection * 0.5) ** 2;
      const weight = past.length / (past.length + 8);
      return {
        ...p,
        assessment_sd: Math.sqrt(
          Math.max(
            4,
            weight * variance + (1 - weight) * (p.projection * 0.5) ** 2,
          ),
        ),
      };
    });
    const models = teams.map((team) => {
      const roster = rosters.find((r) => r.roster_id === team.roster_id);
      if (!roster)
        throw new Error(`Sleeper roster missing for ${team.team_name}.`);
      const excluded = new Set([
        ...(roster.reserve ?? []),
        ...(roster.taxi ?? []),
      ]);
      const selection = projectedLineup(
        pool.filter(
          (p) => roster.players.includes(p.id) && !excluded.has(p.id),
        ),
        league.roster_positions,
      );
      const lineup = selection.picks;
      const mean = roundHalf(
        lineup.reduce((total, player) => total + player.expected, 0),
      );
      const scores = allHistory
        .filter((h) => h.roster_id === team.roster_id)
        .map((h) => Number(h.points));
      return {
        ...team,
        eligible_players: pool
          .filter((p) => roster.players.includes(p.id) && !excluded.has(p.id))
          .map((p) => ({ id: p.id, name: p.name, positions: p.positions })),
        lineup,
        missing_slots: selection.missingSlots,
        mean: mean * config.score_scale,
        season_mean: scores.length
          ? roundHalf(
              (scores.reduce((a, b) => a + b, 0) / scores.length) * 0.6 +
                mean * 0.4,
            )
          : mean,
        sd: deviation(scores, mean) * config.variance_scale,
        unfilled_slots:
          league.roster_positions.filter(
            (p) => !["BN", "IR", "TAXI"].includes(p),
          ).length - lineup.length,
      };
    });
    const quotes: Market[] = [],
      generatedAt = new Date().toISOString();
    const assessmentRun = crypto.randomUUID();
    const rosteredIds = new Set(rosters.flatMap((r) => r.players));
    let archivedSpecials: ReturnType<typeof highLowProbabilities> | undefined;
    const archive = async () => {
      if (
        models.some((m) => ![m.mean, m.sd].every(Number.isFinite)) ||
        pool.some((p) => ![p.projection, p.expected].every(Number.isFinite))
      )
        throw new Error(
          "Forecast input contains invalid numbers; existing lines retained.",
        );
      for (const q of quotes) {
        if (q.kind === "player_points") {
          const player = pool.find((p) => p.id === q.metadata.player_id);
          q.metadata = {
            ...q.metadata,
            player_distribution: player
              ? {
                  mean: player.expected,
                  sd: player.assessment_sd,
                  method: "shadow-normal-variance-v1",
                  shrinkage_observations: 8,
                  minimum_sd: 2,
                }
              : null,
          };
        }
        q.metadata = {
          ...q.metadata,
          assessment_run_id: assessmentRun,
          config_version: version.data.id,
          model_config: config,
          fair_probability: fairProbability(
            q,
            models,
            BASELINE,
            archivedSpecials,
          ),
          uncertainty_method:
            q.kind === "player_points"
              ? "Shadow normal diagnostic; shrunk historical variance, availability mixture unvalidated"
              : "Original model distribution assumptions; uncalibrated",
          price_policy:
            "Original displayed prices archived independently; fixed -110 includes a margin. Promotions do not change fair probability.",
          price_rounding_step: q.kind.startsWith("future_")
            ? 50
            : q.kind.startsWith("weekly_")
              ? 25
              : 10,
        };
      }
      const saved = await userClient.rpc("save_model_forecast", {
        p_run: assessmentRun,
        p_league: input.league_id,
        p_season: input.nfl_season,
        p_week: input.week,
        p_category: category,
        p_version: version.data.id,
        p_sources: Object.fromEntries(
          Object.entries(sources).map(([path, value]) => {
            const source = value as { payload: any };
            return [
              path,
              path.includes("/projections/nfl/") &&
              Array.isArray(source.payload)
                ? {
                    ...source,
                    payload: source.payload.filter((p) =>
                      rosteredIds.has(p.player_id),
                    ),
                    filter_note:
                      "All rostered players retained, including bench/IR/Taxi; unrostered players cannot affect these forecasts.",
                  }
                : source,
            ];
          }),
        ),
        p_payload: {
          models,
          pool: pool.filter((p) => rosteredIds.has(p.id)),
          algorithm_version: "weekly-lineup-v3",
          assessment_version: "weekly-review-v1",
          simulation_seed: input.week,
          source_quality: {
            source_count: Object.keys(sources).length,
            unknown_observation_times: Object.values(sources).filter(
              (s: any) => !s.source_observed_at,
            ).length,
          },
          quotes,
          specials: archivedSpecials ?? null,
          model_config: config,
          generated_at: generatedAt,
        },
      });
      if (saved.error)
        throw new Error(
          "Immutable forecast archive failed; existing lines retained.",
        );
    };
    const base = {
      board_id: "generated",
      boost_pct: 0,
      featured: "" as const,
      active: true,
    };
    const metadata = {
      model_version: "weekly-lineup-v3",
      generated: true,
      generated_at: generatedAt,
      projection_method:
        "League-scored weekly projections, optimal legal lineup, capped historical adjustment",
      historical_weeks: historical.length,
      injury_source:
        "Sleeper projection feed; Out/IR/PUP/Suspended excluded. Questionable and Doubtful retain positive provider projections; active roster and bench only.",
      scoring_settings: league.scoring_settings,
      roster_positions: league.roster_positions,
    };
    if (category === "Season Futures") {
      const playoffStart = Number(league.settings.playoff_week_start);
      if (!Number.isInteger(playoffStart))
        throw new Error("The league playoff schedule is unavailable.");
      const playoffPhase = input.week! >= playoffStart;
      const futureWeeklyMeans: number[][] = [models.map((t) => t.mean)];
      const missingProjectionWeeks: number[] = [];
      // Provider weekly forecasts include the NFL schedule/byes. Bound concurrent
      // downloads and keep only rostered candidates rather than retaining feeds.
      const forecastWeeks = Array.from(
        { length: Math.max(0, playoffStart + 3 - input.week! - 1) },
        (_, i) => input.week! + i + 1,
      );
      const rostered = new Set(rosters.flatMap((r) => r.players));
      for (let start = 0; start < forecastWeeks.length; start += 3) {
        const forecasts = await Promise.all(
          forecastWeeks.slice(start, start + 3).map(async (week) => {
            try {
              const rows = (await fetchData(
                `https://api.sleeper.com/projections/nfl/${input.nfl_season}/${week}?season_type=regular`,
              )) as Projection[];
              if (!Array.isArray(rows) || !rows.some((r) => r.stats?.gp > 0))
                throw new Error("No weekly forecasts");
              const futurePool = candidates(
                rows
                  .filter((r) => rostered.has(r.player_id))
                  .map((r) => ({
                    ...r,
                    player: { ...r.player, injury_status: "" },
                  })),
                league.scoring_settings,
                allHistory,
              );
              return models.map((t) => {
                const roster = rosters.find(
                  (r) => r.roster_id === t.roster_id,
                )!;
                return bestLineup(
                  futurePool.filter(
                    (p) =>
                      roster.players.includes(p.id) &&
                      !(roster.taxi ?? []).includes(p.id),
                  ),
                  league.roster_positions,
                  true,
                ).reduce((n, p) => n + p.expected, 0);
              });
            } catch {
              missingProjectionWeeks.push(week);
              return models.map((t) => t.season_mean);
            }
          }),
        );
        futureWeeklyMeans.push(...forecasts);
      }
      const histories = models.map((t) =>
        allHistory
          .filter((h) => h.roster_id === t.roster_id)
          .map((h) => Number(h.points)),
      );
      const empiricalVariances = histories
        .filter((h) => h.length > 1)
        .map((h) => {
          const mean = h.reduce((a, b) => a + b, 0) / h.length;
          return h.reduce((n, s) => n + (s - mean) ** 2, 0) / (h.length - 1);
        });
      const leagueVariance = empiricalVariances.length
        ? empiricalVariances.reduce((a, b) => a + b, 0) /
          empiricalVariances.length
        : 900;
      const seasonTeams = models.map((t, i) => {
        const record = rosters.find(
          (r) => r.roster_id === t.roster_id,
        )!.settings;
        const past = histories[i];
        const forecasts = futureWeeklyMeans.map((week) => week[i]);
        if (t.unfilled_slots && past.length)
          forecasts[0] = past.reduce((a, b) => a + b, 0) / past.length;
        return {
          ...t,
          ...seasonStrength(past, forecasts, leagueVariance),
          points:
            Number(record.fpts ?? 0) + Number(record.fpts_decimal ?? 0) / 100,
        };
      });
      const [remaining, trades] = (await Promise.all([
        Promise.all(
          Array.from(
            { length: Math.max(0, playoffStart - input.week!) },
            (_, i) =>
              sleeper(`league/${sleeperLeagueId}/matchups/${input.week! + i}`),
          ),
        ),
        sleeper(`league/${sleeperLeagueId}/traded_picks`),
      ])) as [{ roster_id: number; matchup_id: number }[][], TradedPick[]];
      const schedule = remaining.map((week) =>
        [
          ...new Set(week.map((m) => m.matchup_id).filter((id) => id != null)),
        ].map((id) => {
          const pair = week.filter((m) => m.matchup_id === id);
          if (pair.length !== 2)
            throw new Error(
              "The remaining schedule contains an incomplete matchup.",
            );
          return { home: pair[0].roster_id, away: pair[1].roster_id };
        }),
      );
      const probabilities = seasonProbabilities(
        seasonTeams,
        schedule,
        Number(league.settings.playoff_teams),
        input.week,
      );
      const bracket = playoffPhase
        ? ((await sleeper(
            `league/${sleeperLeagueId}/winners_bracket`,
          )) as BracketGame[])
        : null;
      const playoffChampions = bracket
        ? bracketProbabilities(
            seasonTeams,
            bracket,
            input.week,
            10000,
            input.week! - playoffStart + 1,
          )
        : null;
      if (bracket?.find((g) => g.p === 1)?.w)
        return json({
          quotes: [],
          warnings: [
            "The championship has been decided. Season markets are closed.",
          ],
        });
      models.forEach((team, i) => {
        const pickOwnerRoster = firstRoundOwner(
          team.roster_id,
          input.nfl_season! + 1,
          trades,
        );
        const pickOwner = models.find((m) => m.roster_id === pickOwnerRoster);
        if (!pickOwner)
          throw new Error(`Pick owner missing for ${team.team_name}.`);
        for (const [kind, side, p] of [
          [
            "future_champion",
            team.id,
            playoffChampions?.[i] ?? probabilities[i].champion,
          ],
          ["future_playoffs", "make", probabilities[i].playoffs],
          ["future_playoffs", "miss", 1 - probabilities[i].playoffs],
          ["future_first_pick", team.id, probabilities[i].last],
          ["future_win_total", "over", probabilities[i].win_over],
          ["future_win_total", "under", 1 - probabilities[i].win_over],
        ] as const) {
          if (playoffPhase && (kind !== "future_champion" || p === 0)) continue;
          quotes.push({
            ...base,
            id: crypto.randomUUID(),
            market_key: `season-${input.nfl_season}:${kind}${["future_playoffs", "future_win_total"].includes(kind) ? ":" + team.id : ""}`,
            matchup_key: null,
            kind,
            side,
            label:
              kind === "future_first_pick"
                ? `${team.team_name} (${pickOwner.team_name})`
                : kind === "future_playoffs"
                  ? `${team.team_name} · ${side === "make" ? "Make Playoffs" : "Miss Playoffs"}`
                  : kind === "future_win_total"
                    ? `${team.team_name} ${side === "over" ? "Over" : "Under"} ${probabilities[i].win_line} wins`
                    : team.team_name,
            subject: team.team_name,
            line:
              kind === "future_win_total" ? probabilities[i].win_line : null,
            odds: Math.max(-10000, Math.min(10000, specialOdds(p, 50))),
            team_id: team.id,
            home_team_id: null,
            away_team_id: null,
            home_projection: seasonTeams[i].mean,
            away_projection: null,
            metadata: {
              ...metadata,
              projection_method:
                "Week-specific best-lineup forecasts: 60% provider weekly estimate, 40% historical scoring. Historical volatility shrinks toward league volatility; season-strength uncertainty is sampled separately.",
              model_version: "weekly-season-v3",
              expected_wins: probabilities[i].expected_wins,
              win_distribution: probabilities[i].win_distribution,
              season_mean: seasonTeams[i].mean,
              weekly_score_sd: seasonTeams[i].sd,
              strength_uncertainty: seasonTeams[i].mean_uncertainty,
              forecast_weeks: forecastWeeks,
              missing_projection_weeks: missingProjectionWeeks,
              simulated_probability: p,
              trials: 10000,
              roster_id: team.roster_id,
              playoff_teams: league.settings.playoff_teams,
              playoff_week_start: playoffStart,
              pick_draft_season: input.nfl_season! + 1,
              pick_owner_roster_id: pickOwnerRoster,
              pick_owner_team_id: pickOwner.id,
              pick_owner_name: pickOwner.team_name,
              last_place_basis: "regular_season",
              seeding_basis: "record_then_points",
            },
          });
        }
      });
      await archive();
      return json({
        quotes,
        warnings: [
          "10,000 simulations use week-specific NFL forecasts, best eligible lineups, fantasy schedule, records, points, historical volatility, and season-strength uncertainty. Future availability follows provider forecasts; injury recovery, trades and waivers remain uncertain.",
          ...(missingProjectionWeeks.length
            ? [
                `Weekly forecasts unavailable for Weeks ${missingProjectionWeeks.sort((a, b) => a - b).join(", ")}; those weeks use the historical/current strength fallback.`,
              ]
            : []),
        ],
      });
    }
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
        metadata: {
          ...metadata,
          home_lineup: home.lineup,
          away_lineup: away.lineup,
          home_eligible_players: home.eligible_players,
          away_eligible_players: away.eligible_players,
          home_missing_slots: home.missing_slots,
          away_missing_slots: away.missing_slots,
        },
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
          metadata: {
            ...context.metadata,
            ...(extra as { metadata?: Market["metadata"] }).metadata,
            lineup_locked:
              kind === "spread" ||
              kind === "moneyline" ||
              kind === "match_total"
                ? home.unfilled_slots > 0 || away.unfilled_slots > 0
                : kind === "team_total" &&
                  (teamId === home.id
                    ? home.unfilled_slots > 0
                    : away.unfilled_slots > 0),
            lock_reason: [home, away]
              .filter(
                (t) =>
                  t.unfilled_slots > 0 &&
                  (kind !== "team_total" || t.id === teamId),
              )
              .map(
                (t) =>
                  `${t.team_name}: no eligible active-roster or bench replacement with a positive projection for ${t.missing_slots.join(", ")}. Taxi and IR players are excluded.`,
              )
              .join(" "),
          },
        });
      if (category === "Matchups") {
        const spread = matchupSpread(home.mean, away.mean),
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
          add(
            "moneyline",
            side,
            team.team_name,
            null,
            specialOdds(p, 10),
            team.id,
            {
              metadata: {
                simulated_probability: p,
                model_version: "weekly-lineup-v3",
              },
            },
          );
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
      archivedSpecials = probabilities;
      const fields = weeklyScorerFields(probabilities.high, probabilities.low);
      models.forEach((team, index) => {
        for (const kind of ["weekly_high", "weekly_low"] as const) {
          if (
            !(kind === "weekly_high" ? fields.high : fields.low).includes(index)
          )
            continue;
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
            odds: specialOdds(Math.min(0.499, p)),
            team_id: team.id,
            home_team_id: null,
            away_team_id: null,
            home_projection: null,
            away_projection: null,
            metadata: { ...metadata, simulated_probability: p, trials: 6000 },
          });
        }
      });
      const topSix = ["weekly_high", "weekly_low"].flatMap((kind) =>
        quotes
          .filter((q) => q.kind === kind)
          .sort(
            (a, b) =>
              Number(b.metadata.simulated_probability) -
              Number(a.metadata.simulated_probability),
          )
          .slice(0, 6),
      );
      quotes.splice(0, quotes.length, ...topSix);
      const lock = models.some((m) => m.unfilled_slots > 0);
      const lockReason =
        "Regenerate after complete eligible lineups with positive projections are available for: " +
        models
          .filter((m) => m.unfilled_slots > 0)
          .map((m) => `${m.team_name} (${m.missing_slots.join(", ")})`)
          .join(", ") +
        ".";
      const leagueQuote = (
        kind: Market["kind"],
        side: string,
        label: string,
        p: number,
        line: number,
      ) =>
        quotes.push({
          ...base,
          id: crypto.randomUUID(),
          market_key: `week-${input.week}:${kind}`,
          matchup_key: null,
          kind,
          side,
          label,
          subject:
            kind === "weekly_count_150"
              ? "How Many Teams Will Score 150+?"
              : kind === "weekly_any_below_100"
                ? "Will Any Team Score Below 100?"
                : kind === "weekly_any_200"
                  ? "Will Any Team Score 200+?"
                  : kind === "weekly_count_projection"
                    ? "How Many Teams Will Beat Their Projection?"
                    : kind === "weekly_average"
                      ? "League Average Score"
                      : "Highest Weekly Score",
          line,
          odds: specialOdds(p),
          team_id: null,
          home_team_id: null,
          away_team_id: null,
          home_projection: null,
          away_projection: null,
          metadata: {
            ...metadata,
            simulated_probability: p,
            trials: 6000,
            expected_team_count: models.length,
            lineup_locked: lock,
            lock_reason: lock ? lockReason : undefined,
            ...(kind === "weekly_count_projection"
              ? {
                  projection_targets: Object.fromEntries(
                    models.map((m) => [m.id, m.mean]),
                  ),
                }
              : {}),
          },
        });
      // Same market key prevents combining correlated Exact / At Least choices.
      for (const option of countOptions(probabilities.counts150, 1))
        leagueQuote(
          "weekly_count_150",
          option.side,
          `${option.atLeast ? "At Least" : "Exactly"} ${option.count} ${option.count === 1 ? "Team" : "Teams"} Scoring 150+`,
          option.probability,
          option.count,
        );
      for (const [kind, p, threshold] of [
        ["weekly_any_below_100", probabilities.anyBelow100, 100],
        ["weekly_any_200", probabilities.anyAtLeast200, 200],
      ] as const) {
        leagueQuote(kind, "yes", "Yes", p, threshold);
        leagueQuote(kind, "no", "No", 1 - p, threshold);
      }
      for (const option of countOptions(probabilities.countsProjection, 0))
        leagueQuote(
          "weekly_count_projection",
          option.side,
          `${option.atLeast ? "At Least" : "Exactly"} ${option.count} ${option.count === 1 ? "Team" : "Teams"} Beating Projection`,
          option.probability,
          option.count,
        );
      for (const [kind, samples] of [
        ["weekly_average", probabilities.averageScores],
        ["weekly_highest_score", probabilities.highestScores],
      ] as const) {
        const sorted = [...samples].sort((a, b) => a - b),
          line = Math.floor(sorted[Math.floor(sorted.length / 2)]) + 0.5;
        const p = samples.filter((s) => s > line).length / samples.length;
        leagueQuote(kind, "over", `Over ${line}`, p, line);
        leagueQuote(kind, "under", `Under ${line}`, 1 - p, line);
      }
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
    await archive();
    return json({
      week: input.week,
      quotes,
      generated_at: generatedAt,
      projection_method: metadata.projection_method,
      warnings: models
        .filter((t) => t.unfilled_slots > 0)
        .map(
          (t) =>
            `${t.team_name}: no eligible active-roster or bench replacement with a positive projection for ${t.missing_slots.join(", ")}. Taxi and IR players are excluded.`,
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
