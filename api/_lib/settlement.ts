export interface LegInput {
  id: string;
  accepted_line: number | string | null;
  settlement_context: {
    kind: string;
    side: string;
    team_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    metadata?: { player_id?: string };
  } | null;
}
export interface FinalResults {
  final: boolean;
  teams: Record<string, { name: string; points: number }>;
  players: Record<string, { played: boolean; points: number }>;
}
export interface LegResult {
  id: string;
  status: "WON" | "LOST" | "PUSH" | "OPEN";
  actual_value: number | null;
  evidence: string;
}
export function settleLeg(leg: LegInput, results: FinalResults): LegResult {
  const pending = (evidence: string): LegResult => ({
    id: leg.id,
    status: "OPEN",
    actual_value: null,
    evidence,
  });
  if (!results.final) return pending("Waiting for confirmed weekly results.");
  const c = leg.settlement_context;
  if (!c)
    return pending(
      "Accepted market details are missing; admin review required.",
    );
  const team = c.team_id ? results.teams[c.team_id] : null;
  const home = c.home_team_id ? results.teams[c.home_team_id] : null;
  const away = c.away_team_id ? results.teams[c.away_team_id] : null;
  const line = leg.accepted_line == null ? null : Number(leg.accepted_line);
  let actual: number;
  let difference: number;
  let evidence: string;
  switch (c.kind) {
    case "moneyline":
    case "spread": {
      if (!home || !away || !team)
        return pending("Matchup scores are missing.");
      const opponent = c.team_id === c.home_team_id ? away : home;
      actual = Math.round((team.points - opponent.points) * 100) / 100;
      if (c.kind === "spread" && line == null)
        return pending("Accepted spread is missing.");
      difference = actual + (c.kind === "spread" ? line! : 0);
      evidence = `${team.name} ${team.points} vs. ${opponent.name} ${opponent.points}; winning margin ${actual}.`;
      break;
    }
    case "match_total":
    case "team_total":
      if (line == null || (c.kind === "match_total" ? !home || !away : !team))
        return pending("Total score or accepted line is missing.");
      actual =
        c.kind === "match_total" ? home!.points + away!.points : team!.points;
      difference = c.side === "over" ? actual - line : line - actual;
      evidence = `Actual ${c.kind === "match_total" ? "match" : "team"} total: ${actual.toFixed(2)}.`;
      break;
    case "player_points": {
      const player = results.players[c.metadata?.player_id ?? ""];
      if (!player || line == null)
        return pending("Player participation or accepted line is unconfirmed.");
      if (!player.played)
        return {
          id: leg.id,
          status: "PUSH",
          actual_value: 0,
          evidence: "Player did not play; leg pushed.",
        };
      actual = player.points;
      difference = c.side === "over" ? actual - line : line - actual;
      evidence = `Actual player points: ${actual.toFixed(2)}.`;
      break;
    }
    case "weekly_high":
    case "weekly_low": {
      if (!team || !Object.keys(results.teams).length)
        return pending("League scores are missing.");
      const target = (c.kind === "weekly_high" ? Math.max : Math.min)(
        ...Object.values(results.teams).map((t) => t.points),
      );
      const winners = Object.values(results.teams).filter(
        (t) => t.points === target,
      );
      actual = target;
      evidence = `Actual Winner: ${winners.map((t) => t.name).join(" / ")} · ${target.toFixed(2)}.`;
      if (team.points === target && winners.length > 1)
        return {
          id: leg.id,
          status: "PUSH",
          actual_value: actual,
          evidence: evidence + " Tied outcome pushed.",
        };
      difference = team.points === target ? 1 : -1;
      break;
    }
    default:
      return pending("This market needs a settlement rule.");
  }
  return {
    id: leg.id,
    status:
      Math.abs(difference) < 0.000001
        ? "PUSH"
        : difference > 0
          ? "WON"
          : "LOST",
    actual_value: Math.round(actual * 100) / 100,
    evidence,
  };
}
