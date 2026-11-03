export const sportsbookDefaults = Object.freeze({
  featured_boost_pct: 25,
  matchup_odds_step: 10,
  weekly_odds_step: 25,
  futures_odds_step: 50,
  futures_max_odds: 10000,
  matchups_enabled: true,
  players_enabled: true,
  specials_enabled: true,
  futures_enabled: true,
});
export interface SportsbookValues {
  featured_boost_pct: number;
  matchup_odds_step: number;
  weekly_odds_step: number;
  futures_odds_step: number;
  futures_max_odds: number;
  matchups_enabled: boolean;
  players_enabled: boolean;
  specials_enabled: boolean;
  futures_enabled: boolean;
}
export interface SportsbookPolicy {
  contract: "sportsbook-policy-v1";
  revision: number;
  values: SportsbookValues;
}
export const defaultSportsbookPolicy: SportsbookPolicy = {
  contract: "sportsbook-policy-v1",
  revision: 0,
  values: sportsbookDefaults,
};
export function parseSportsbookPolicy(value: unknown): SportsbookPolicy {
  const p = value as SportsbookPolicy,
    v = p?.values;
  if (
    !p ||
    p.contract !== "sportsbook-policy-v1" ||
    !Number.isInteger(p.revision) ||
    p.revision < 0 ||
    p.revision > 64 ||
    !v ||
    Object.keys(v).sort().join() !==
      Object.keys(sportsbookDefaults).sort().join() ||
    !Number.isInteger(v.featured_boost_pct) ||
    v.featured_boost_pct < 0 ||
    v.featured_boost_pct > 50 ||
    ![10, 25, 50].includes(v.matchup_odds_step) ||
    ![10, 25, 50].includes(v.weekly_odds_step) ||
    ![25, 50, 100].includes(v.futures_odds_step) ||
    !Number.isInteger(v.futures_max_odds) ||
    v.futures_max_odds < 1000 ||
    v.futures_max_odds > 10000 ||
    v.futures_max_odds % v.futures_odds_step !== 0 ||
    [
      "matchups_enabled",
      "players_enabled",
      "specials_enabled",
      "futures_enabled",
    ].some((k) => typeof v[k as keyof SportsbookValues] !== "boolean")
  )
    throw Error("Unsupported shared sportsbook policy.");
  return p;
}
export function marketFamily(
  kind: string,
): "matchups" | "players" | "specials" | "futures" {
  if (kind.startsWith("future_")) return "futures";
  if (["player_points", "player_h2h", "player_milestone"].includes(kind))
    return "players";
  if (kind.startsWith("weekly_")) return "specials";
  return "matchups";
}
export function featuredBoost(
  q: { featured?: string; kind: string; side: string },
  p: SportsbookValues = sportsbookDefaults,
) {
  return (q.featured === "Game of the Week" && q.kind === "moneyline") ||
    (q.featured === "Tank Bowl" &&
      (q.kind === "moneyline" ||
        (q.kind === "match_total" && q.side === "over")))
    ? p.featured_boost_pct
    : 0;
}
export function policyOdds(
  odds: number,
  kind: string,
  p: SportsbookValues = sportsbookDefaults,
) {
  if (!Number.isFinite(odds) || Math.abs(odds) < 100)
    throw Error("Supported American price required.");
  if (["spread", "match_total", "team_total", "player_points"].includes(kind))
    return odds;
  const family = marketFamily(kind),
    step =
      family === "futures"
        ? p.futures_odds_step
        : family === "specials"
          ? p.weekly_odds_step
          : p.matchup_odds_step;
  return (
    Math.sign(odds) *
    Math.min(
      family === "futures" ? p.futures_max_odds : 100000,
      Math.max(100, Math.round(Math.abs(odds) / step) * step),
    )
  );
}
