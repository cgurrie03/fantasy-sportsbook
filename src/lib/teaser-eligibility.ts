export interface TeaserSelection {
  id: string;
  board_id: string;
  matchup_key: string | null;
  kind: string;
  line: number | null;
  boost_pct: number;
  team_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  active: boolean;
  market_state?: string;
  suspension_reason?: string | null;
  metadata: Record<string, unknown>;
}

export function teaserEligibility(
  picks: TeaserSelection[],
  board: { id: string; phase?: string; board_type?: string } | null,
  matchupCount: number,
  promotion = false,
) {
  if (!board || board.phase === "live" || board.board_type === "future")
    return "Teasers require pregame matchup spreads.";
  if (
    !Number.isInteger(matchupCount) ||
    matchupCount < 3 ||
    picks.length < 3 ||
    picks.length > Math.min(6, matchupCount)
  )
    return "Choose 3 or more distinct matchups, up to the league maximum (at most 6).";
  if (promotion || picks.some((p) => p.boost_pct !== 0))
    return "Teasers cannot combine with promos or boosts.";
  const matchups = new Set<string>(),
    teams = new Set<string>();
  for (const p of picks) {
    if (
      p.kind !== "spread" ||
      p.board_id !== board.id ||
      p.line === null ||
      !Number.isFinite(p.line) ||
      !p.matchup_key ||
      !p.active ||
      (p.market_state && p.market_state !== "open") ||
      p.suspension_reason ||
      p.metadata.resolved ||
      p.metadata.lineup_locked
    )
      return "Every selection must be an available pregame matchup spread.";
    if (
      !p.home_team_id ||
      !p.away_team_id ||
      p.home_team_id === p.away_team_id ||
      ![p.home_team_id, p.away_team_id].includes(p.team_id ?? "")
    )
      return "Matchup team details are incomplete.";
    if (
      matchups.has(p.matchup_key) ||
      teams.has(p.home_team_id) ||
      teams.has(p.away_team_id)
    )
      return "Choose one side from each distinct matchup.";
    matchups.add(p.matchup_key);
    teams.add(p.home_team_id);
    teams.add(p.away_team_id);
  }
  return "";
}

export const adjustedSpread = (original: number, adjustment: number) => {
  if (
    !Number.isFinite(original) ||
    !Number.isFinite(adjustment) ||
    adjustment <= 0
  )
    throw new Error("Invalid spread adjustment.");
  return Math.round((original + adjustment) * 100) / 100;
};
