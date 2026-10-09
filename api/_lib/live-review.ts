import type { TeamForecast } from "./live-model.js";
export interface ShadowRun {
  id: string;
  captured_at: string;
  status: string;
  payload: { horizon: number; teams: TeamForecast[]; quotes: any[] };
}
export function evaluateLiveWeek(
  runs: ShadowRun[],
  outcomes: { roster_id: number; points: number; starters: string[] }[],
) {
  if (
    !outcomes.length ||
    outcomes.some(
      (r) => !Number.isFinite(r.points) || !Array.isArray(r.starters),
    )
  )
    throw new Error("Final outcomes are incomplete.");
  const selected = new Map<string, { run: ShadowRun; team: TeamForecast }>();
  for (const run of [...runs].sort(
    (a, b) =>
      a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id),
  )) {
    if (run.status !== "shadow") continue;
    for (const team of run.payload.teams)
      if (!team.reasons.length)
        selected.set(`${run.payload.horizon}:${team.roster_id}`, { run, team });
  }
  const observations: any[] = [],
    excluded: any[] = [],
    matches: any[] = [];
  for (const { run, team } of selected.values()) {
    const final = outcomes.find((r) => r.roster_id === team.roster_id);
    if (
      !final ||
      [...team.starters].sort().join(",") !==
        [...final.starters].sort().join(",")
    ) {
      excluded.push({
        run_id: run.id,
        roster_id: team.roster_id,
        reason:
          "Final starters differ from captured starters or result missing.",
      });
      continue;
    }
    observations.push({
      run_id: run.id,
      horizon: run.payload.horizon,
      roster_id: team.roster_id,
      predicted: team.mean,
      actual: final.points,
      error: team.mean - final.points,
      covered80: Math.abs(team.mean - final.points) <= 1.281551565545 * team.sd,
    });
  }
  const matchSelection = new Map<string, { run: ShadowRun; quote: any }>();
  for (const run of [...runs].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  ))
    if (run.status === "shadow")
      for (const q of run.payload.quotes)
        matchSelection.set(`${run.payload.horizon}:${q.matchup_id}`, {
          run,
          quote: q,
        });
  for (const { run, quote: q } of matchSelection.values()) {
    const h = run.payload.teams.find((t) => t.team_id === q.home_team_id),
      a = run.payload.teams.find((t) => t.team_id === q.away_team_id);
    const hf = outcomes.find((t) => t.roster_id === h?.roster_id),
      af = outcomes.find((t) => t.roster_id === a?.roster_id);
    if (
      !h ||
      !a ||
      !hf ||
      !af ||
      [h, a].some(
        (t) =>
          !observations.some(
            (o) => o.run_id === run.id && o.roster_id === t.roster_id,
          ),
      )
    )
      continue;
    if (hf.points === af.points) {
      matches.push({
        run_id: run.id,
        horizon: run.payload.horizon,
        matchup_id: q.matchup_id,
        tie: true,
      });
      continue;
    }
    const y = hf.points > af.points ? 1 : 0,
      p = Math.max(0.000001, Math.min(0.999999, q.home_fair_probability));
    matches.push({
      run_id: run.id,
      horizon: run.payload.horizon,
      matchup_id: q.matchup_id,
      tie: false,
      brier: (p - y) ** 2,
      log_loss: -(y * Math.log(p) + (1 - y) * Math.log(1 - p)),
      margin_error: q.home_mean - q.away_mean - (hf.points - af.points),
      total_error: q.total - (hf.points + af.points),
    });
  }
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const byHorizon = [0, 1, 2, 3].map((horizon) => {
    const values = observations.filter((o) => o.horizon === horizon),
      games = matches.filter((m) => m.horizon === horizon && !m.tie);
    return {
      horizon,
      team_count: values.length,
      matchup_count: games.length,
      mae: avg(values.map((v) => Math.abs(v.error))),
      rmse: values.length
        ? Math.sqrt(avg(values.map((v) => v.error ** 2))!)
        : null,
      bias: avg(values.map((v) => v.error)),
      coverage80: avg(values.map((v) => Number(v.covered80))),
      brier: avg(games.map((v) => v.brier)),
      log_loss: avg(games.map((v) => v.log_loss)),
      margin_mae: avg(games.map((v) => Math.abs(v.margin_error))),
      total_mae: avg(games.map((v) => Math.abs(v.total_error))),
    };
  });
  return {
    status: "complete",
    model_version: "live-clock-shadow-v1",
    horizons: byHorizon,
    observations,
    matches,
    excluded,
    snapshots_seen: runs.length,
    blocked_snapshots: runs.filter((r) => r.status === "blocked").length,
    change_decision:
      "No model change: experimental shadow model; insufficient independent completed weeks.",
    methodology:
      "Latest valid forecast per team/matchup in each league-game progress quartile. Horizons and teammates are correlated, not independent trials. Changed final starting lineups are excluded from forecast metrics. Tie outcomes are reported separately. No futures accuracy is inferred.",
  };
}
