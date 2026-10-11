import { createHash } from "node:crypto";
import { highLowProbabilities } from "./line-model.js";
import { settleLeg } from "./settlement.js";
import { settleFuture } from "./futures-settlement.js";

export const ASSESSMENT_VERSION = "weekly-review-v1";
export interface Config {
  score_scale: number;
  variance_scale: number;
}
export const BASELINE: Config = Object.freeze({
  score_scale: 1,
  variance_scale: 1,
});
// These are conservative operational limits, not claims of statistical power.
export const GATES = Object.freeze({
  train_weeks: 8,
  validation_weeks: 12,
  holdout_weeks: 4,
  min_observations: 120,
  min_holdout_observations: 40,
  min_relative_gain: 0.02,
  max_segment_regression: 0.01,
  max_step: 0.02,
  shrinkage_weeks: 24,
  confidence: 0.99,
  seed: 74291,
});
export const digest = (v: unknown): string =>
  createHash("sha256").update(stable(v)).digest("hex");
export function stable(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export function validConfig(c: Config, prior: Config = BASELINE) {
  return (
    Object.keys(c).sort().join() === "score_scale,variance_scale" &&
    Object.entries(c).every(
      ([k, v]) =>
        Number.isFinite(v) &&
        v >= 0.9 &&
        v <= 1.1 &&
        Math.abs(v / prior[k as keyof Config] - 1) <= GATES.max_step + 1e-9,
    )
  );
}
export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const quantile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
export function describe(xs: number[]) {
  const m = mean(xs);
  return {
    n: xs.length,
    mean: m,
    median: quantile(xs, 0.5),
    p05: quantile(xs, 0.05),
    p25: quantile(xs, 0.25),
    p75: quantile(xs, 0.75),
    p95: quantile(xs, 0.95),
    sd:
      xs.length > 1
        ? Math.sqrt(xs.reduce((s, x) => s + (x - m!) ** 2, 0) / (xs.length - 1))
        : null,
  };
}
export function numeric(rows: any[]) {
  const errors = rows.map((r) => r.predicted - r.actual);
  return {
    ...describe(errors),
    mae: mean(errors.map(Math.abs)),
    rmse: errors.length ? Math.sqrt(mean(errors.map((e) => e * e))!) : null,
    bias: mean(errors),
    coverage80: mean(
      rows
        .filter((r) => Number.isFinite(r.sd))
        .map((r) =>
          Number(Math.abs(r.predicted - r.actual) <= 1.281551565545 * r.sd),
        ),
    ),
  };
}
export function probability(rows: any[]) {
  const valid = rows.filter(
    (r) => Number.isFinite(r.p) && r.p >= 0 && r.p <= 1 && [0, 1].includes(r.y),
  );
  const bands = Array.from({ length: 5 }, (_, i) => {
    const group = valid.filter((r) => Math.min(4, Math.floor(r.p * 5)) === i);
    return {
      lo: i / 5,
      hi: (i + 1) / 5,
      n: group.length,
      predicted: mean(group.map((r) => r.p)),
      observed: mean(group.map((r) => r.y)),
    };
  });
  return {
    n: valid.length,
    brier: mean(valid.map((r) => (r.p - r.y) ** 2)),
    log_loss: mean(
      valid.map((r) => {
        const p = Math.max(1e-6, Math.min(1 - 1e-6, r.p));
        return -r.y * Math.log(p) - (1 - r.y) * Math.log(1 - p);
      }),
    ),
    bands,
  };
}
export function cdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const v =
    1 -
    (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) *
      t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z < 0 ? 1 - v : v;
}
export function fairProbability(
  q: any,
  models: any[],
  config: Config = BASELINE,
  specials?: any,
): number | null {
  if (
    [
      "player_h2h",
      "player_milestone",
      "team_milestone",
      "winning_margin",
    ].includes(q.kind)
  )
    return Number.isFinite(q.metadata?.simulated_probability)
      ? q.metadata.simulated_probability
      : null;
  const home = models.find((m) => m.id === q.home_team_id),
    away = models.find((m) => m.id === q.away_team_id),
    team = models.find((m) => m.id === q.team_id);
  const scale = config.score_scale,
    variance = config.variance_scale;
  const over = (line: number, mu: number, sd: number) =>
    sd > 0 ? 1 - cdf((line - mu * scale) / (sd * variance)) : null;
  let p: number | null = null;
  if (q.kind === "moneyline" && home && away) {
    p = Math.min(
      0.95,
      Math.max(
        0.05,
        1 /
          (1 +
            Math.exp(
              (-(home.mean - away.mean) * scale * 1.7) /
                (Math.hypot(home.sd, away.sd) * variance),
            )),
      ),
    );
    return q.side === "home" ? p : 1 - p;
  }
  if (q.kind === "spread" && home && away) {
    p = over(
      -Number(q.line),
      q.side === "home" ? home.mean - away.mean : away.mean - home.mean,
      Math.hypot(home.sd, away.sd),
    );
    return p;
  }
  if (q.kind === "match_total" && home && away)
    p = over(
      Number(q.line),
      home.mean + away.mean,
      Math.hypot(home.sd, away.sd),
    );
  if (q.kind === "team_total" && team)
    p = over(Number(q.line), team.mean, team.sd);
  // Shadow diagnostic distribution; posted fixed -110 player prices remain unchanged.
  if (q.kind === "player_points") {
    const d = q.metadata?.player_distribution;
    if (!d || !Number.isFinite(d.mean) || !Number.isFinite(d.sd) || d.sd <= 0)
      return null;
    const p = 1 - cdf((Number(q.line) - d.mean) / d.sd);
    return q.side === "under" ? 1 - p : p;
  }
  if (q.kind.startsWith("future_"))
    return Number.isFinite(q.metadata?.simulated_probability)
      ? q.metadata.simulated_probability
      : null;
  const index = models.findIndex((m) => m.id === q.team_id);
  if (specials) {
    if (q.kind === "weekly_high") return specials.high[index] ?? null;
    if (q.kind === "weekly_low") return specials.low[index] ?? null;
    if (["weekly_count_150", "weekly_count_projection"].includes(q.kind)) {
      const histogram =
        q.kind === "weekly_count_150"
          ? specials.counts150
          : specials.countsProjection;
      // Projection specials have a frozen published benchmark; candidate replay is blocked for this family.
      return q.side.endsWith("+")
        ? histogram
            .slice(Number(q.line))
            .reduce((a: number, b: number) => a + b, 0)
        : histogram[Number(q.line)];
    }
    if (q.kind === "weekly_any_below_100") p = specials.anyBelow100;
    if (q.kind === "weekly_any_200") p = specials.anyAtLeast200;
    if (q.kind === "weekly_average" || q.kind === "weekly_highest_score") {
      const samples =
        q.kind === "weekly_average"
          ? specials.averageScores
          : specials.highestScores;
      p =
        samples.filter((v: number) => v > Number(q.line)).length /
        samples.length;
    }
  }
  if (p === null) return null;
  return ["under", "no"].includes(q.side) ? 1 - p : p;
}
export function selectHorizons(runs: any[], cutoff: string) {
  const selected = new Map<string, any>();
  for (const run of [...runs].sort(
    (a, b) =>
      a.captured_at.localeCompare(b.captured_at) ||
      String(a.id).localeCompare(String(b.id)),
  )) {
    if (
      run.provenance !== "as_of" ||
      run.phase !== "pregame" ||
      run.captured_at >= cutoff
    )
      continue;
    const k = run.category;
    if (!selected.has(`${k}:opening`))
      selected.set(`${k}:opening`, { ...run, horizon: "opening" });
    selected.set(`${k}:final_pregame`, { ...run, horizon: "final_pregame" });
  }
  return [...selected.values()];
}
export function assessWeek(
  runs: any[],
  published: any[],
  outcome: any,
  cutoff: string,
) {
  if (
    !outcome.final ||
    !outcome.confirmed_games_final ||
    !outcome.completed_period
  )
    throw new Error("Confirmed completed week required.");
  const selected = selectHorizons(runs, cutoff),
    scores: any[] = [],
    players: any[] = [],
    selection: any[] = [],
    markets: any[] = [],
    categorical: any[] = [],
    distributions: any[] = [],
    excluded: any[] = [],
    trajectories: any[] = [],
    eventErrors: any[] = [];
  const seenTeams = new Set<string>(),
    seenPlayers = new Set<string>();
  for (const run of selected) {
    const context = {
      run_id: run.id,
      horizon: run.horizon,
      category: run.category,
      model_version: run.model_version,
      model_config: run.payload.model_config,
    };
    const archivedSettings = run.payload.quotes[0]?.metadata?.scoring_settings;
    if (
      archivedSettings &&
      outcome.sources?.settings?.scoring_settings &&
      digest(archivedSettings) !==
        digest(outcome.sources.settings.scoring_settings)
    ) {
      excluded.push({
        ...context,
        reason:
          "Scoring rules changed since prediction; forecast excluded from comparable model evidence.",
      });
      continue;
    }
    for (const model of run.payload.models) {
      if (run.category !== "Matchups") continue;
      const actual = outcome.rosters.find(
        (r: any) => r.roster_id === model.roster_id,
      );
      const teamKey = `${run.horizon}:${model.id}`;
      if (!actual || seenTeams.has(teamKey)) continue;
      seenTeams.add(teamKey);
      const prior = run.payload.pool,
        actualPicks = actual.starters
          .filter((id: string) => id !== "0")
          .map((id: string) => prior.find((p: any) => p.id === id));
      const missing = actualPicks.some((p: any) => !p);
      const starterMean = missing
        ? null
        : actualPicks.reduce((s: number, p: any) => s + p.expected, 0) *
          run.payload.model_config.score_scale;
      const selectedPoints = model.lineup.map(
        (p: any) => outcome.players[p.id],
      );
      const conditionalActual = selectedPoints.some((p: any) => !p)
        ? null
        : selectedPoints.reduce((s: number, p: any) => s + p.points, 0);
      scores.push({
        ...context,
        team_id: model.id,
        view: "team_market",
        predicted: model.mean,
        actual: actual.points,
        sd: model.sd,
      });
      if (conditionalActual !== null)
        scores.push({
          ...context,
          team_id: model.id,
          view: "best_lineup_conditional",
          predicted: model.mean,
          actual: conditionalActual,
          sd: model.sd,
        });
      if (starterMean !== null) {
        scores.push({
          ...context,
          team_id: model.id,
          view: "actual_starters",
          predicted: starterMean,
          actual: actual.points,
          sd: model.sd,
        });
        selection.push({
          ...context,
          team_id: model.id,
          forecast_selection_gap: model.mean - starterMean,
          realized_selection_gap:
            conditionalActual === null
              ? null
              : conditionalActual - actual.points,
        });
      } else
        excluded.push({
          ...context,
          team_id: model.id,
          reason:
            "Final starter absent from as-of pool; no reconstructed prediction.",
        });
      for (const id of actual.starters) {
        const p = prior.find((p: any) => p.id === id),
          final = outcome.players[id],
          key = `${run.horizon}:${id}`;
        if (!p || !final || seenPlayers.has(key)) continue;
        seenPlayers.add(key);
        players.push({
          ...context,
          player_id: id,
          position: p.positions[0],
          injury: p.injury,
          played: final.played,
          predicted: p.expected,
          actual: final.points,
          sd: p.assessment_sd ?? null,
        });
      }
    }
    for (const q of run.payload.quotes) {
      if (q.kind.startsWith("future_"))
        trajectories.push({
          ...context,
          market_key: q.market_key,
          side: q.side,
          p: q.metadata?.fair_probability,
          at: run.captured_at,
        });
      const r = q.kind.startsWith("future_")
        ? settleFuture(
            { id: q.id, accepted_line: q.line, settlement_context: q },
            outcome.season_results,
          )
        : settleLeg(
            { id: q.id, accepted_line: q.line, settlement_context: q },
            outcome,
          );
      const p = q.metadata?.fair_probability;
      const row = {
        ...context,
        market_key: q.market_key,
        kind: q.kind,
        side: q.side,
        line: q.line,
        status: r.status,
        actual: r.actual_value,
        p,
        published: published.some((s) =>
          s.quotes.some(
            (v: any) =>
              v.metadata?.assessment_run_id === run.id &&
              v.market_key === q.market_key &&
              v.side === q.side &&
              v.line === q.line,
          ),
        ),
        model_version: run.model_version,
        locked: Boolean(q.metadata?.lineup_locked),
      };
      markets.push({
        ...row,
        y: r.status === "WON" ? 1 : r.status === "LOST" ? 0 : null,
      });
      if (
        r.status !== "OPEN" &&
        !q.kind.startsWith("future_") &&
        ["home", "over"].includes(q.side)
      ) {
        const h = run.payload.models.find((m: any) => m.id === q.home_team_id),
          a = run.payload.models.find((m: any) => m.id === q.away_team_id),
          t = run.payload.models.find((m: any) => m.id === q.team_id);
        const hp = outcome.teams[q.home_team_id]?.points,
          ap = outcome.teams[q.away_team_id]?.points;
        let predicted: number | undefined,
          actual: number | undefined,
          sd: number | undefined;
        if (["spread", "moneyline"].includes(q.kind) && h && a) {
          predicted = h.mean - a.mean;
          actual = hp - ap;
          sd = Math.hypot(h.sd, a.sd);
        }
        if (q.kind === "match_total" && h && a) {
          predicted = h.mean + a.mean;
          actual = hp + ap;
          sd = Math.hypot(h.sd, a.sd);
        }
        if (q.kind === "team_total" && t) {
          predicted = t.mean;
          actual = outcome.teams[t.id]?.points;
          sd = t.sd;
        }
        if (q.kind === "player_points" && r.status !== "PUSH") {
          predicted = q.metadata.expected_points;
          actual = r.actual_value ?? undefined;
        }
        if (Number.isFinite(predicted) && Number.isFinite(actual))
          eventErrors.push({ ...row, predicted, actual, sd });
      }
      if (r.status === "OPEN" || p === null || p === undefined)
        excluded.push({
          ...row,
          reason:
            r.status === "OPEN"
              ? r.evidence
              : "Original model has no fair probability for this selection.",
        });
    }
    const specials = run.payload.specials;
    if (specials && run.category === "Weekly Specials") {
      const values = run.payload.models.map(
        (m: any) => outcome.teams[m.id]?.points,
      );
      if (values.every(Number.isFinite)) {
        for (const kind of ["weekly_high", "weekly_low"]) {
          const extreme =
            kind === "weekly_high" ? Math.max(...values) : Math.min(...values);
          const winners = values.flatMap((v: number, i: number) =>
            v === extreme ? [i] : [],
          );
          const ps = kind === "weekly_high" ? specials.high : specials.low;
          const offered = run.payload.quotes
            .filter((q: any) => q.kind === kind)
            .map((q: any) => q.metadata.fair_probability);
          categorical.push({
            ...context,
            kind,
            tie: winners.length > 1,
            omitted_mass:
              1 - offered.reduce((a: number, b: number) => a + b, 0),
            brier:
              winners.length === 1
                ? ps.reduce(
                    (s: number, p: number, i: number) =>
                      s + (p - Number(i === winners[0])) ** 2,
                    0,
                  )
                : null,
            log_loss:
              winners.length === 1
                ? -Math.log(Math.max(1e-6, ps[winners[0]]))
                : null,
          });
        }
        for (const [kind, dist, actual] of [
          [
            "weekly_count_150",
            specials.counts150,
            values.filter((v: number) => v >= 150).length,
          ],
          [
            "weekly_count_projection",
            specials.countsProjection,
            values.filter(
              (v: number, i: number) => v > run.payload.models[i].mean,
            ).length,
          ],
        ] as const) {
          const predicted = dist.reduce(
            (s: number, p: number, i: number) => s + p * i,
            0,
          );
          let sum = 0;
          const qs = (p: number) =>
            dist.findIndex((v: number) => {
              sum += v;
              return sum >= p;
            });
          const lo = qs(0.1);
          sum = 0;
          const hi = qs(0.9);
          distributions.push({
            ...context,
            kind,
            predicted,
            actual,
            coverage80: Number(actual >= lo && actual <= hi),
            log_loss: -Math.log(Math.max(1e-6, dist[actual])),
            brier: dist.reduce(
              (s: number, p: number, i: number) =>
                s + (p - Number(i === actual)) ** 2,
              0,
            ),
            histogram: dist,
          });
        }
        for (const [kind, samples, actual] of [
          ["weekly_average", specials.averageScores, mean(values)],
          ["weekly_highest_score", specials.highestScores, Math.max(...values)],
        ] as const)
          distributions.push({
            ...context,
            kind,
            predicted: mean(samples),
            actual,
            coverage80: Number(
              actual! >= quantile(samples, 0.1)! &&
                actual! <= quantile(samples, 0.9)!,
            ),
            distribution: describe(samples),
          });
      }
    }
  }
  const scoreViews = [
    "team_market",
    "best_lineup_conditional",
    "actual_starters",
  ].flatMap((view) =>
    ["opening", "final_pregame"].map((horizon) => ({
      view,
      horizon,
      ...numeric(
        scores.filter((r) => r.view === view && r.horizon === horizon),
      ),
    })),
  );
  const families = [...new Set(markets.map((m) => m.kind))].flatMap((kind) =>
    ["opening", "final_pregame"].map((horizon) => {
      const rows = markets.filter(
        (r) => r.kind === kind && r.horizon === horizon,
      );
      return {
        kind,
        horizon,
        generated: rows.length,
        published: rows.filter((r) => r.published).length,
        pushes: rows.filter((r) => r.status === "PUSH").length,
        pending: rows.filter((r) => r.status === "OPEN").length,
        missing_probability: rows.filter((r) => !Number.isFinite(r.p)).length,
        ...probability(rows),
      };
    }),
  );
  return {
    status: "complete",
    assessment_version: ASSESSMENT_VERSION,
    cutoff,
    score_views: scoreViews,
    player_scores: numeric(players),
    players_by_position: [...new Set(players.map((p) => p.position))].flatMap(
      (position) =>
        ["opening", "final_pregame"].map((horizon) => ({
          position,
          horizon,
          ...numeric(
            players.filter(
              (p) => p.position === position && p.horizon === horizon,
            ),
          ),
        })),
    ),
    players_by_availability: [true, false].flatMap((played) =>
      ["opening", "final_pregame"].map((horizon) => ({
        played,
        horizon,
        ...numeric(
          players.filter((p) => p.played === played && p.horizon === horizon),
        ),
      })),
    ),
    event_errors: [...new Set(eventErrors.map((e) => e.kind))].flatMap((kind) =>
      ["opening", "final_pregame"].map((horizon) => ({
        kind,
        horizon,
        ...numeric(
          eventErrors.filter((e) => e.kind === kind && e.horizon === horizon),
        ),
      })),
    ),
    families,
    categorical,
    distributions,
    selection,
    scores,
    players,
    markets,
    excluded,
    trajectories,
    largest_misses: [...scores]
      .filter((r) => r.view === "actual_starters")
      .sort(
        (a, b) =>
          Math.abs(b.predicted - b.actual) - Math.abs(a.predicted - a.actual),
      )
      .slice(0, 5),
    coverage: {
      runs: runs.length,
      selected_runs: selected.length,
      published_snapshots: published.length,
      locked_forecasts: markets.filter((m) => m.locked).length,
      missing_starter_forecasts: excluded.filter((e) => !e.kind).length,
      unknown_source_freshness: runs.reduce(
        (n, r) =>
          n +
          (r.payload.source_quality?.unknown_observation_times ??
            Object.values(r.sources ?? {}).filter(
              (s: any) => !s.source_observed_at,
            ).length),
        0,
      ),
      missing_families: [
        "Matchups",
        "Player Points",
        "Weekly Specials",
        "Season Futures",
      ].filter((c) => !selected.some((r) => r.category === c)),
    },
    limitations: [
      "Opening means first generated as-of run per family; publication is tracked separately.",
      "Horizons, teams and selections are correlated; selections are not independent samples.",
      "Player probabilities and intervals are a new shadow normal diagnostic with shrunk historical variance; original fixed -110 prices are unchanged and availability mixtures are unvalidated.",
      "Normal independent-team uncertainty and joint simulations are assumptions, not guarantees.",
      "Futures final results require confirmed qualification, champion or regular-season outcomes.",
    ],
  };
}

// Paired week blocks keep all within-week dependence together. Fixed seed makes reports reproducible.
export function blockInterval(differences: number[], alpha = 0.01) {
  if (differences.length < 2) return { low: null, high: null };
  let seed = GATES.seed;
  const samples: number[] = [];
  for (let b = 0; b < 6000; b++) {
    let total = 0;
    for (let i = 0; i < differences.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      total += differences[seed % differences.length];
    }
    samples.push(total / differences.length);
  }
  return {
    low: quantile(samples, alpha / 2),
    high: quantile(samples, 1 - alpha / 2),
  };
}
export function propose(training: any[], current: Config): Config {
  const rows = training.flatMap((w) =>
    w.report.scores.filter(
      (r: any) => r.view === "actual_starters" && r.horizon === "opening",
    ),
  );
  const predicted = mean(
      rows.map(
        (r: any) =>
          (r.predicted / (r.model_config?.score_scale ?? 1)) *
          current.score_scale,
      ),
    ),
    actual = mean(rows.map((r: any) => r.actual));
  const shrink = training.length / (training.length + GATES.shrinkage_weeks);
  const bias =
    predicted && actual !== null ? (actual / predicted - 1) * shrink : 0;
  const standardized = mean(
    rows
      .filter((r: any) => r.sd > 0)
      .map(
        (r: any) =>
          (((r.predicted / (r.model_config?.score_scale ?? 1)) *
            current.score_scale -
            r.actual) /
            ((r.sd / (r.model_config?.variance_scale ?? 1)) *
              current.variance_scale)) **
          2,
      ),
  );
  const variance =
    standardized === null ? 0 : (Math.sqrt(standardized) - 1) * shrink;
  const bounded = (v: number, old: number) =>
    Math.max(
      0.9,
      Math.min(
        1.1,
        old * (1 + Math.max(-GATES.max_step, Math.min(GATES.max_step, v))),
      ),
    );
  return {
    score_scale: bounded(bias, current.score_scale),
    variance_scale: bounded(variance, current.variance_scale),
  };
}
export function compareCandidate(
  weeks: any[],
  current: Config,
  paused: boolean,
) {
  const ordered = [...weeks].sort((a, b) => a.period - b.period),
    n = ordered.length;
  const train = ordered.slice(
      0,
      Math.max(0, n - GATES.validation_weeks - GATES.holdout_weeks),
    ),
    validation = ordered.slice(
      train.length,
      Math.max(train.length, n - GATES.holdout_weeks),
    ),
    holdout = ordered.slice(Math.max(train.length, n - GATES.holdout_weeks));
  const availableTrain = train.filter(
    (w) => w.known_at <= holdout[0]?.prediction_at,
  );
  const candidate = propose(availableTrain, current),
    tests: any[] = [],
    reasons: string[] = [];
  if (paused) reasons.push("Automatic improvement is paused.");
  if (
    availableTrain.length < GATES.train_weeks ||
    validation.length < GATES.validation_weeks ||
    holdout.length < GATES.holdout_weeks
  )
    reasons.push(
      "Insufficient independent completed weeks for training, validation and untouched holdout.",
    );
  if (!validConfig(candidate, current))
    reasons.push("Parameter bounds failed.");
  // One predeclared candidate. Walk-forward fits use only older corrected results known at the fold time.
  for (const [phase, segment] of [
    ["validation", validation],
    ["holdout", holdout],
  ] as const) {
    const gains: number[] = [],
      baselineGains: number[] = [];
    let count = 0;
    for (const week of segment) {
      const rows = week.report.scores.filter(
        (r: any) => r.view === "actual_starters" && r.horizon === "opening",
      );
      const historical = ordered.filter(
        (w) => w.period < week.period && w.known_at <= week.prediction_at,
      );
      const c =
        phase === "validation" ? propose(historical, current) : candidate;
      const errors = rows.map((r: any) =>
        Math.abs(
          (r.predicted / (r.model_config?.score_scale ?? 1)) *
            current.score_scale -
            r.actual,
        ),
      );
      const adjusted = rows.map((r: any) =>
        Math.abs(
          (r.predicted / (r.model_config?.score_scale ?? 1)) * c.score_scale -
            r.actual,
        ),
      );
      const frozen = rows.map((r: any) =>
        Math.abs(r.predicted / (r.model_config?.score_scale ?? 1) - r.actual),
      );
      count += rows.length;
      if (rows.length) {
        gains.push(mean(errors)! - mean(adjusted)!);
        baselineGains.push(mean(frozen)! - mean(adjusted)!);
      }
      if (week.report.coverage.missing_families.length)
        reasons.push(
          "Incomplete as-of market family coverage; promotion blocked.",
        );
      const replay = replaySafety(week, c, current);
      if (!replay.passed) reasons.push(...replay.reasons);
    }
    const interval = blockInterval(gains),
      frozenInterval = blockInterval(baselineGains);
    const original =
      mean(
        segment.flatMap((w) =>
          w.report.scores
            .filter(
              (r: any) =>
                r.view === "actual_starters" && r.horizon === "opening",
            )
            .map((r: any) => Math.abs(r.predicted - r.actual)),
        ),
      ) ?? 0;
    const pass =
      count >=
        (phase === "holdout"
          ? GATES.min_holdout_observations
          : GATES.min_observations) &&
      interval.low !== null &&
      interval.low > 0 &&
      frozenInterval.low !== null &&
      frozenInterval.low >= 0 &&
      (mean(gains) ?? 0) >= original * GATES.min_relative_gain;
    tests.push({
      phase,
      weeks: segment.length,
      observations: count,
      mae_gain: mean(gains),
      interval,
      frozen_interval: frozenInterval,
      pass,
    });
    if (!pass)
      reasons.push(
        `${phase}: sample, practical improvement or week-block confidence gate failed.`,
      );
  }
  return {
    candidate,
    current,
    gates: GATES,
    training_weeks: availableTrain.length,
    tests,
    passed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    decision: reasons.length
      ? "Assessment completed; insufficient evidence to change."
      : "Candidate passed every predeclared gate.",
    scope:
      "Weekly team pregame only; player, live and futures configurations are frozen.",
  };
}

export function replaySafety(week: any, candidate: Config, current: Config) {
  const reasons: string[] = [];
  if (!week.runs?.length)
    return {
      passed: false,
      reasons: ["Candidate as-of replay inputs missing."],
    };
  for (const run of selectHorizons(week.runs, week.report.cutoff)) {
    if (run.category === "Season Futures" || run.category === "Player Points")
      continue;
    const base = run.payload.models.map((m: any) => ({
      ...m,
      mean: m.mean / run.model_config.score_scale,
      sd: m.sd / run.model_config.variance_scale,
    }));
    const targets = run.payload.models.map((m: any) => m.mean);
    const simulate = (c: Config) =>
      run.category === "Weekly Specials"
        ? highLowProbabilities(
            base.map((m: any) => ({
              mean: m.mean * c.score_scale,
              sd: m.sd * c.variance_scale,
            })),
            week.week,
            targets,
          )
        : undefined;
    const oldSim = simulate(current),
      newSim = simulate(candidate),
      frozenSim = simulate(BASELINE);
    const byKind = new Map<
      string,
      {
        old: number[];
        candidate: number[];
        frozen: number[];
        oldLog: number[];
        newLog: number[];
        frozenLog: number[];
      }
    >();
    for (const q of run.payload.quotes) {
      const r = settleLeg(
        { id: q.id, accepted_line: q.line, settlement_context: q },
        week.outcome,
      );
      if (r.status === "PUSH") continue;
      if (r.status === "OPEN") {
        reasons.push("Unresolved affected-family outcome.");
        continue;
      }
      const y = Number(r.status === "WON"),
        a = fairProbability(q, base, current, oldSim),
        b = fairProbability(q, base, candidate, newSim),
        f = fairProbability(q, base, BASELINE, frozenSim);
      if (
        a === null ||
        b === null ||
        f === null ||
        ![a, b, f].every((p) => Number.isFinite(p) && p >= 0 && p <= 1)
      ) {
        reasons.push("Affected-family probability replay missing.");
        continue;
      }
      const group = byKind.get(q.kind) ?? {
        old: [],
        candidate: [],
        frozen: [],
        oldLog: [],
        newLog: [],
        frozenLog: [],
      };
      const loss = (p: number) => -Math.log(Math.max(1e-6, y ? p : 1 - p));
      group.old.push((a - y) ** 2);
      group.candidate.push((b - y) ** 2);
      group.frozen.push((f - y) ** 2);
      group.oldLog.push(loss(a));
      group.newLog.push(loss(b));
      group.frozenLog.push(loss(f));
      byKind.set(q.kind, group);
    }
    for (const group of byKind.values()) {
      if (
        mean(group.candidate)! >
        Math.min(mean(group.old)!, mean(group.frozen)!) +
          GATES.max_segment_regression
      )
        reasons.push("Worst market-family Brier regression tolerance failed.");
      if (
        mean(group.newLog)! >
        Math.min(mean(group.oldLog)!, mean(group.frozenLog)!) + 0.02
      )
        reasons.push(
          "Worst market-family log-loss regression tolerance failed.",
        );
    }
    for (const m of base) {
      const final = week.outcome.rosters.find(
        (r: any) => r.roster_id === m.roster_id,
      );
      if (!final) {
        reasons.push("Candidate score outcome missing.");
        continue;
      }
      const oldError = Math.abs(m.mean * current.score_scale - final.points),
        newError = Math.abs(m.mean * candidate.score_scale - final.points);
      if (newError > oldError + Math.max(1, oldError * 0.05))
        reasons.push("Worst team score regression tolerance failed.");
    }
    const coverage = (c: Config) =>
      mean(
        base.map((m: any) =>
          Number(
            Math.abs(
              m.mean * c.score_scale -
                week.outcome.rosters.find(
                  (r: any) => r.roster_id === m.roster_id,
                )?.points,
            ) <=
              1.281551565545 * m.sd * c.variance_scale,
          ),
        ),
      )!;
    if (
      Math.abs(coverage(candidate) - 0.8) >
      Math.abs(coverage(current) - 0.8) + 0.05
    )
      reasons.push("Interval coverage regression tolerance failed.");
  }
  return { passed: !reasons.length, reasons: [...new Set(reasons)] };
}
