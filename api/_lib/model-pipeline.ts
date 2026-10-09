import { score } from "./line-model.js";
import { parseScoreboard } from "./game-status.js";
import { regularSeasonResults, settleFuture } from "./futures-settlement.js";
import {
  assessWeek,
  compareCandidate,
  digest,
  ASSESSMENT_VERSION,
  numeric,
  blockInterval,
  probability,
} from "./model-assessment.js";
async function source(url: string) {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Assessment source returned ${r.status}.`);
  return (await r.json()) as any;
}
const sleeper = (path: string) => source(`https://api.sleeper.app/v1/${path}`);
async function all(db: any, table: string, league: string, season?: number) {
  const rows: any[] = [];
  for (let offset = 0; offset < 30000; offset += 500) {
    let query = db.from(table).select("*").eq("league_id", league);
    if (season !== undefined) query = query.eq("nfl_season", season);
    const r = await query
      .order(table === "model_weekly_reviews" ? "created_at" : "captured_at")
      .order("id")
      .range(offset, offset + 499);
    if (r.error) throw new Error(r.error.message);
    rows.push(...r.data);
    if (r.data.length < 500) return rows;
  }
  throw new Error(
    "Assessment pagination safety limit reached; review deferred.",
  );
}
export async function reviewModelWeek(db: any, job: any, league: any) {
  const [
    state,
    settings,
    rosters,
    games,
    stats,
    teamsResult,
    runs,
    published,
    reviews,
    controlResult,
    openTickets,
  ] = await Promise.all([
    sleeper("state/nfl"),
    sleeper(`league/${league.sleeper_league_id}`),
    sleeper(`league/${league.sleeper_league_id}/matchups/${job.market_week}`),
    source(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${job.market_week}&year=${league.nfl_season}&seasontype=2`,
    ),
    source(
      `https://api.sleeper.com/stats/nfl/${league.nfl_season}/${job.market_week}?season_type=regular`,
    ),
    db
      .from("teams")
      .select("id,roster_id,team_name")
      .eq("league_id", job.league_id),
    all(db, "model_forecast_runs", job.league_id),
    all(db, "forecast_snapshots", job.league_id, league.nfl_season),
    all(db, "model_weekly_reviews", job.league_id),
    db
      .from("model_controls")
      .select("*")
      .eq("league_id", job.league_id)
      .single(),
    db
      .from("tickets")
      .select("id")
      .eq("league_id", job.league_id)
      .eq("nfl_season", league.nfl_season)
      .eq("market_week", job.market_week)
      .neq("ticket_type", "future")
      .eq("status", "OPEN"),
  ]);
  for (const r of [teamsResult, controlResult, openTickets])
    if (r.error) throw new Error(r.error.message);
  const observation = parseScoreboard(games);
  if (Number(settings.season) !== league.nfl_season)
    throw new Error(
      "Assessment scoring settings do not match the archived league season.",
    );
  const completed =
    Number(state.season) > league.nfl_season ||
    (Number(state.season) === league.nfl_season &&
      (state.week > job.market_week ||
        (job.market_week === 18 && state.season_type === "post")));
  if (
    !completed ||
    games.week?.number !== job.market_week ||
    observation.season_year !== league.nfl_season ||
    !observation.games.length ||
    observation.games.some((g: any) => g.state !== "final")
  )
    return {
      pending: true,
      reason: "Completed week and confirmed final NFL games required.",
    };
  if (openTickets.data.length)
    return {
      pending: true,
      reason: "Weekly settlement reconciliation pending.",
    };
  if (
    !Array.isArray(rosters) ||
    !Array.isArray(stats) ||
    rosters.length !== teamsResult.data.length ||
    rosters.some(
      (r: any) =>
        !Number.isFinite(r.points) ||
        !Array.isArray(r.starters) ||
        !r.players_points,
    )
  )
    throw new Error("Final roster/player coverage incomplete.");
  const players = Object.fromEntries(
    stats
      .filter((p: any) => typeof p.stats?.gp === "number")
      .map((p: any) => [
        p.player_id,
        {
          played: p.stats.gp > 0,
          points: score(p.stats, settings.scoring_settings),
        },
      ]),
  );
  const teams = Object.fromEntries(
    teamsResult.data.map((t: any) => {
      const r = rosters.find((r: any) => r.roster_id === t.roster_id);
      if (!r) throw new Error("Final team mapping missing.");
      if (r.custom_points != null)
        throw new Error(
          "Manual team score override needs separate assessment reconciliation.",
        );
      for (const id of r.starters.filter((id: string) => id !== "0")) {
        if (
          !players[id] ||
          !Number.isFinite(r.players_points[id]) ||
          Math.abs(players[id].points - r.players_points[id]) > 0.11
        )
          throw new Error("Independent player scoring reconciliation failed.");
      }
      const total = r.starters
        .filter((id: string) => id !== "0")
        .reduce((s: number, id: string) => s + r.players_points[id], 0);
      if (Math.abs(total - r.points) > 0.11)
        throw new Error("Starter sum differs from final team points.");
      return [t.id, { name: t.team_name, points: r.points }];
    }),
  );
  const seasonResults: any = {
    champion: null,
    playoffRosters: null,
    last: null,
  };
  const playoffStart = Number(settings.settings.playoff_week_start);
  if (
    Number.isInteger(playoffStart) &&
    Number(state.season) === league.nfl_season &&
    Number(state.week) >= playoffStart &&
    Number(settings.settings.last_report) >= playoffStart - 1
  ) {
    const history = await Promise.all(
      Array.from({ length: playoffStart - 1 }, (_, i) =>
        sleeper(`league/${league.sleeper_league_id}/matchups/${i + 1}`),
      ),
    );
    const totals = teamsResult.data.map((t: any) => ({
      roster_id: t.roster_id,
      wins: 0,
      losses: 0,
      ties: 0,
      points: 0,
    }));
    for (const week of history)
      for (const t of totals) {
        const row = week.find((r: any) => r.roster_id === t.roster_id),
          other = week.find(
            (r: any) =>
              r.matchup_id === row?.matchup_id && r.roster_id !== t.roster_id,
          );
        if (
          !row ||
          !other ||
          ![row.points, other.points].every(Number.isFinite)
        )
          throw new Error("Regular-season outcomes incomplete.");
        t.points += row.points;
        if (row.points > other.points) t.wins++;
        else if (row.points < other.points) t.losses++;
        else t.ties++;
      }
    Object.assign(
      seasonResults,
      regularSeasonResults(
        totals.map((t: any) => ({
          roster_id: t.roster_id,
          settings: { wins: t.wins, ties: t.ties, fpts: t.points },
        })),
        Number(settings.settings.playoff_teams),
      ),
    );
    const bracket = await sleeper(
      `league/${league.sleeper_league_id}/winners_bracket`,
    );
    const champion = bracket.find((g: any) => g.p === 1)?.w;
    seasonResults.champion = Number.isInteger(champion) ? champion : null;
  }
  const cutoff = observation.games.map((g: any) => g.starts_at).sort()[0];
  const outcome = {
    final: true,
    completed_period: true,
    confirmed_games_final: true,
    teams,
    players,
    rosters,
    season_results: seasonResults,
    sources: {
      state,
      settings,
      games,
      stats,
      fetch_note: "Current corrected final results; not prediction inputs.",
    },
  };
  const weekRuns = runs.filter(
    (r) =>
      r.nfl_season === league.nfl_season && r.market_week === job.market_week,
  );
  const report = assessWeek(
    weekRuns,
    published.filter((p) => p.market_week === job.market_week),
    outcome,
    cutoff,
  );
  const live = await db
    .from("live_model_reviews")
    .select("id,report")
    .eq("league_id", job.league_id)
    .eq("nfl_season", league.nfl_season)
    .eq("market_week", job.market_week)
    .order("created_at", { ascending: false })
    .limit(1);
  if (live.error) throw new Error(live.error.message);
  Object.assign(report, {
    live_horizons: live.data[0]?.report.horizons ?? [],
    live_review_id: live.data[0]?.id ?? null,
  });
  const futureRows = runs
    .filter(
      (r) =>
        r.nfl_season === league.nfl_season && r.category === "Season Futures",
    )
    .flatMap((r) =>
      r.payload.quotes.map((q: any) => {
        const result = settleFuture(
          { id: q.id, accepted_line: q.line, settlement_context: q },
          seasonResults,
        );
        return {
          week: r.market_week,
          run_id: r.id,
          captured_at: r.captured_at,
          kind: q.kind,
          market_key: q.market_key,
          side: q.side,
          p: q.metadata.fair_probability,
          expected_wins: q.metadata.expected_wins,
          win_distribution: q.metadata.win_distribution,
          actual_value: result.actual_value,
          status: result.status,
          y: result.status === "WON" ? 1 : result.status === "LOST" ? 0 : null,
        };
      }),
    );
  // Trajectories retain all times; final scores select one opening forecast per origin-week/event.
  const futureSelected = new Map<string, any>();
  for (const r of futureRows.sort((a: any, b: any) =>
    a.captured_at.localeCompare(b.captured_at),
  )) {
    const key = `${r.week}:${r.market_key}:${r.side}`;
    if (!futureSelected.has(key)) futureSelected.set(key, r);
  }
  Object.assign(report, {
    futures: {
      trajectories: futureRows,
      opening_by_origin_week: [...futureSelected.values()],
      scores: probability([...futureSelected.values()]),
      win_errors: numeric(
        [...futureSelected.values()]
          .filter(
            (r) =>
              r.kind === "future_win_total" &&
              r.side === "over" &&
              r.y !== null &&
              Number.isFinite(r.expected_wins),
          )
          .map((r) => ({ predicted: r.expected_wins, actual: r.actual_value })),
      ),
      note: "Origin weeks forecast the same season events; these are correlated trajectories, not independent trials.",
    },
  });
  const control = controlResult.data,
    version = await db
      .from("model_config_versions")
      .select("*")
      .eq("id", control.active_id)
      .eq("league_id", job.league_id)
      .single();
  if (version.error) throw new Error(version.error.message);
  const latest = new Map<number, any>();
  for (const review of reviews)
    latest.set(review.nfl_season * 100 + review.market_week, review);
  const evidence: any[] = [];
  for (const [period, review] of latest) {
    if (period >= league.nfl_season * 100 + job.market_week) continue;
    const out = await db
      .from("model_outcome_revisions")
      .select("outcome")
      .eq("id", review.outcome_id)
      .eq("league_id", job.league_id)
      .single();
    if (out.error) throw new Error(out.error.message);
    if (
      digest(out.data.outcome.sources.settings.scoring_settings) !==
        digest(settings.scoring_settings) ||
      digest(out.data.outcome.sources.settings.roster_positions) !==
        digest(settings.roster_positions)
    )
      continue;
    evidence.push({
      period,
      week: review.market_week,
      report: review.report,
      outcome: out.data.outcome,
      runs: runs.filter(
        (r) =>
          r.nfl_season === review.nfl_season &&
          r.market_week === review.market_week,
      ),
      known_at: review.created_at,
      prediction_at:
        runs
          .filter(
            (r) =>
              r.nfl_season === review.nfl_season &&
              r.market_week === review.market_week,
          )
          .map((r) => r.captured_at)
          .sort()[0] ?? "",
    });
  }
  evidence.push({
    period: league.nfl_season * 100 + job.market_week,
    week: job.market_week,
    report,
    outcome,
    runs: weekRuns,
    known_at: new Date().toISOString(),
    prediction_at: weekRuns.map((r) => r.captured_at).sort()[0] ?? "",
  });
  const comparison = compareCandidate(
    evidence,
    version.data.config,
    control.paused,
  );
  if (
    version.data.parent_id &&
    Date.parse(version.data.created_at) > Date.now() - 7 * 86400000
  ) {
    comparison.passed = false;
    comparison.reasons.push("Seven-day promotion cooldown remains active.");
    comparison.decision =
      "Assessment completed; current model retained during cooldown.";
  }
  const key = digest({
    assessment: ASSESSMENT_VERSION,
    outcome,
    run_ids: weekRuns.map((r) => r.id),
    published: published
      .filter((p) => p.market_week === job.market_week)
      .map((p) => p.id),
    active: control.active_id,
    paused: control.paused,
    comparison,
  });
  const saved = await db.rpc("save_model_assessment", {
    p_job: job.id,
    p_attempt: job.attempts,
    p_hash: key,
    p_outcome: outcome,
    p_report: report,
    p_comparison: comparison,
  });
  if (saved.error) throw new Error(saved.error.message);
  let change = "hold";
  if (control.active_id !== control.baseline_id) {
    const deltas = evidence.slice(-4).flatMap((w) => {
      const rows = w.report.scores.filter(
        (r: any) =>
          r.view === "actual_starters" &&
          r.horizon === "opening" &&
          r.model_version === control.active_id,
      );
      if (!rows.length) return [];
      const frozen = rows.map((r: any) => ({
        ...r,
        predicted: r.predicted / r.model_config.score_scale,
      }));
      return [numeric(rows).mae! - numeric(frozen).mae!];
    });
    if (
      report.coverage.missing_families.length ||
      !deltas.every(Number.isFinite) ||
      (deltas.length >= 4 &&
        blockInterval(deltas).low !== null &&
        blockInterval(deltas).low! > 2)
    ) {
      const rollback = await db.rpc("control_model", {
        p_league: job.league_id,
        p_action: "auto_rollback",
        p_reason:
          "Coverage failure or material degradation after promotion; automatic improvement paused.",
        p_review: saved.data,
        p_expected: control.active_id,
      });
      if (rollback.error) throw new Error(rollback.error.message);
      change = "auto_rollback";
    }
  }
  if (change === "hold" && comparison.passed) {
    const promoted = await db.rpc("control_model", {
      p_league: job.league_id,
      p_action: "promote",
      p_reason:
        "Predeclared chronological, holdout, confidence and regression gates passed.",
      p_review: saved.data,
      p_expected: control.active_id,
    });
    if (promoted.error) throw new Error(promoted.error.message);
    change = "promote";
  }
  return {
    review_id: saved.data,
    status: "complete",
    change,
    decision: comparison.decision,
  };
}
