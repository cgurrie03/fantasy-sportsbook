import {advanceProspective,prospectiveComparison} from "./prospective-model.js";
import {summarizeEvaluation} from "./evaluation-summary.js";
import { readAssessmentRows } from "./assessment-reads.js";
import { score } from "./line-model.js";
import { parseScoreboard } from "./game-status.js";
import { regularSeasonResults, settleFuture } from "./futures-settlement.js";
import {
  assessWeek,
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
export async function reviewModelWeek(db: any, job: any, league: any) {
  const readStarted=new Date().toISOString();
  const checkpoint=await db.rpc("evaluation_review_checkpoint",{p_job:job.id,p_attempt:job.attempts});
  if(checkpoint.error)throw new Error(checkpoint.error.message);
  if(checkpoint.data?.retired_at)return {status:"complete",summary_only:true,reason:"Row-level correction window closed; compact summary retained."};
  const [
    state,
    settings,
    rosters,
    games,
    stats,
    teamsResult,
    runMetadata,
    futureRuns,
    published,
    prospective,
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
    readAssessmentRows(
      db,
      "sportsbook_evaluation_runs",
      job.league_id,
      "id,league_id,nfl_season,market_week,category,captured_at,phase,provenance,model_version,model_config",
      {season:league.nfl_season,week:job.market_week,pageSize:2},
    ),
    readAssessmentRows(
      db,
      "sportsbook_model_future_openings",
      job.league_id,
      "id,market_week,nfl_season,captured_at,category,quotes",
      { season: league.nfl_season, pageSize: 2 },
    ),
    readAssessmentRows(db, "sportsbook_model_publications", job.league_id,
      "id,market_week,quotes,captured_at",
      { season: league.nfl_season, week: job.market_week, pageSize: 2 }),
    db.from("model_prospective_state").select("state,revision").eq("league_id",job.league_id).maybeSingle(),
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
  for (const r of [teamsResult, controlResult, openTickets, prospective])
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
  const cutoffByPeriod=new Map([[league.nfl_season*100+job.market_week,cutoff]]);
  const ids: string[] = [];
  for (const [period, limit] of cutoffByPeriod) {
    const meta = runMetadata
      .filter(
        (r) =>
          r.nfl_season * 100 + r.market_week === period &&
          r.phase === "pregame" &&
          r.provenance === "as_of" &&
          r.captured_at < limit,
      )
      .sort(
        (a, b) =>
          a.captured_at.localeCompare(b.captured_at) ||
          a.id.localeCompare(b.id),
      );
    for (const category of [
      "Matchups",
      "Player Points",
      "Weekly Specials",
      "Season Futures",
    ]) {
      const group = meta.filter((r) => r.category === category);
      if (group.length) ids.push(group[0].id, group.at(-1).id);
    }
  }
  const unique = [...new Set(ids)],
    runs: any[] = [];
  // Only this completed week's designated records are hydrated, two at a time.
  // Candidate state no longer depends on historical payload replay.
  for (let start = 0; start < unique.length; start += 2) {
    const page = await db
        .from("sportsbook_evaluation_runs")
        .select(
          "id,league_id,nfl_season,market_week,category,captured_at,phase,provenance,model_version,model_config,payload",
        )
        .eq("league_id", job.league_id)
        .in("id", unique.slice(start, start + 2));
    if (page.error) throw new Error(page.error.message);
    runs.push(...page.data);
  }
  const weekRuns = runs.filter(
    (r) =>
      r.nfl_season === league.nfl_season && r.market_week === job.market_week,
  );
  const report:any = assessWeek(
    weekRuns,
    published.filter((p) => p.market_week === job.market_week),
    outcome,
    cutoff,
  );
  report.coverage.runs = runMetadata.filter(
    (r) =>
      r.nfl_season === league.nfl_season && r.market_week === job.market_week,
  ).length;
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
  const futureRows = futureRuns
    .filter(
      (r) =>
        r.nfl_season === league.nfl_season && r.category === "Season Futures",
    )
    .flatMap((r) =>
      (r.quotes ?? r.payload.quotes).map((q: any) => {
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
  // Designated opening forecasts only; refreshes are not independent trials.
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
      note: "Fixed opening forecasts by origin week; complete refresh history is not retained by this review. Origin weeks forecast the same season events and are correlated, not independent trials.",
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
  report.summary_context_hash=digest({scoring:settings.scoring_settings,positions:settings.roster_positions});
  report.retention_format="transient-evaluation-v1";
  const summary=summarizeEvaluation(report);
  const period=league.nfl_season*100+job.market_week;
  const previous=prospective.data?{...prospective.data.state,revision:prospective.data.revision}:null;
  const next=advanceProspective(previous,{active_id:control.active_id,context_hash:report.summary_context_hash,period,
    current:version.data.config,report,runs:weekRuns,outcome,team_count:teamsResult.data.length});
  const transition=await db.rpc("save_prospective_state",{p_job:job.id,p_attempt:job.attempts,p_active:control.active_id,
    p_revision:previous?.revision??0,p_context:report.summary_context_hash,
    p_hash:digest({period,context:report.summary_context_hash,active:control.active_id,scores:report.scores,markets:report.markets,run_ids:weekRuns.map(r=>r.id)}),p_state:next});
  if(transition.error)throw new Error(transition.error.message);
  const candidateState=transition.data;
  const comparison=prospectiveComparison(candidateState,version.data.config,control.paused,period);
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
    outcome:{teams:outcome.teams,players:outcome.players,rosters:outcome.rosters,season_results:outcome.season_results},
    run_ids: weekRuns.map((r) => r.id),
    published: published
      .filter((p) => p.market_week === job.market_week)
      .map((p) => p.id),
    active: control.active_id,
    paused: control.paused,
    comparison,
  });
  const targetIds=new Set<string>();
  for(const run of weekRuns){
    for(const p of run.payload.pool??[])targetIds.add(p.id);
    for(const model of run.payload.models??[])for(const p of model.lineup??[])targetIds.add(p.id);
    for(const q of run.payload.quotes??[])for(const k of ["player_id","opponent_player_id"])if(q.metadata?.[k])targetIds.add(q.metadata[k]);
  }
  const compactOutcome={...outcome,retention_format:"transient-evaluation-v1",
    players:Object.fromEntries(Object.entries(outcome.players).filter(([id])=>targetIds.has(id))),
    rosters:outcome.rosters.map((r:any)=>({roster_id:r.roster_id,points:r.points,starters:r.starters})),
    sources:{settings:{scoring_settings:settings.scoring_settings,roster_positions:settings.roster_positions},fetch_note:"Confirmed corrected final numeric results."}};
  const saved = await db.rpc("save_model_assessment", {
    p_job: job.id,
    p_attempt: job.attempts,
    p_hash: key,
    p_outcome: compactOutcome,
    p_report: report,
    p_comparison: comparison,
  });
  if (saved.error) throw new Error(saved.error.message);
  const storedSummary=await db.rpc("save_evaluation_summary",{p_job:job.id,p_attempt:job.attempts,
    p_context:report.summary_context_hash,p_hash:key,p_started:readStarted,p_summary:summary});
  if(storedSummary.error)throw new Error(storedSummary.error.message);
  let change = "hold";
  if (control.active_id !== control.baseline_id) {
    const deltas=candidateState.monitor.map((w:any)=>w.delta);
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
