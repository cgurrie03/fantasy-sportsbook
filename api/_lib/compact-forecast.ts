import { describe, quantile } from "./model-assessment.js";

export const COMPACT_FORECAST_FORMAT = "compact-forecast-v1";
export const EVALUATION_ROW_BYTES = 256 * 1024;
const copy = (value: any, keys: string[]) => Object.fromEntries(keys
  .filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
const array = (value: any, maximum: number, field: string): any[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`Invalid compact evaluation ${field}.`);
  return value;
};
const summary = (values: number[]) => ({ ...describe(values),
  p10: quantile(values, 0.1), p90: quantile(values, 0.9) });

// Prediction targets and numeric evidence only. Never persist provider bodies,
// Candidate objects, full lineups/rosters, names, replacement pools or simulations.
export function compactForecastPayload(input: any, category?: string) {
  const quotes = array(input.quotes, 1500, "quotes").map((quote) => {
    const metadata = copy(quote.metadata, ["assessment_run_id", "player_id", "opponent_player_id",
      "margin_lower", "margin_upper", "expected_team_count", "projection_targets", "roster_id",
      "fair_probability", "simulated_probability", "expected_points", "expected_wins", "sleeper_projection",
      "win_distribution", "lineup_locked"]);
    if (quote.metadata?.player_distribution)
      metadata.player_distribution = copy(quote.metadata.player_distribution, ["mean", "sd"]);
    if (metadata.projection_targets && Object.keys(metadata.projection_targets).length > 16)
      throw new Error("Too many compact projection targets.");
    if (metadata.win_distribution && Object.keys(metadata.win_distribution).length > 32)
      throw new Error("Too many compact win bins.");
    return { ...copy(quote, ["id", "market_key", "kind", "side", "line", "odds",
      "team_id", "home_team_id", "away_team_id"]), metadata };
  });
  const models = array(input.models, 16, "teams").map((model) => ({
    ...copy(model, ["id", "roster_id", "mean", "sd"]),
    // IDs identify the scored prediction targets; no roster/Candidate bodies.
    lineup: array(model.lineup ?? [], 32, "lineup target IDs").map((p) => ({ id: p.id })),
  }));
  const pool = array(input.pool, 512, "player predictions").map((player) => ({
    ...copy(player, ["id", "expected", "assessment_sd", "injury", "sleeper_projection"]),
    positions: array(player.positions ?? [], 8, "positions"),
  }));
  let specials = null;
  if (input.specials) {
    specials = copy(input.specials, ["anyBelow100", "anyAtLeast200"]);
    for (const key of ["high", "low", "counts150", "countsProjection"])
      if (input.specials[key] !== undefined)
        specials[key] = array(input.specials[key], 32, "special probability bins");
    for (const [field, target] of [["averageScores", "average_summary"], ["highestScores", "highest_summary"]]) {
      const values = array(input.specials[field] ?? [], 20000, "simulation values");
      if (values.some((n) => !Number.isFinite(n))) throw new Error("Invalid simulation values.");
      specials[target] = summary(values);
    }
  }
  const first = input.quotes[0]?.metadata;
  return {
    context: {
      scoring_settings: input.scoring_settings ?? first?.scoring_settings ?? null,
      roster_positions: input.roster_positions ?? first?.roster_positions ?? null,
    },
    payload: {
      retention_format: COMPACT_FORECAST_FORMAT,
      algorithm_version: input.algorithm_version,
      models: ["Season Futures", "Player Points"].includes(category ?? "") ? [] : models,
      pool: category && category !== "Matchups" ? [] : pool,
      quotes, specials: category && category !== "Weekly Specials" ? null : specials,
      source_quality: copy(input.source_quality, ["source_count", "unknown_observation_times"]),
    },
  };
}

