export interface LegInput {
  id: string;
  accepted_line: number | string | null;
  settlement_context: {
    kind: string;
    side: string;
    team_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    metadata?: {
      player_id?: string;
      opponent_player_id?: string;
      margin_lower?: number;
      margin_upper?: number | null;
      expected_team_count?: number;
      projection_targets?: Record<string, number>;
    };
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
    case "player_h2h": {
      const left = results.players[c.metadata?.player_id ?? ""],
        right = results.players[c.metadata?.opponent_player_id ?? ""];
      if (!left || !right || !["home", "away"].includes(c.side))
        return pending("Both player participation results are required.");
      if (!left.played || !right.played)
        return {
          id: leg.id,
          status: "PUSH",
          actual_value: null,
          evidence: "A head-to-head player did not play; leg pushed.",
        };
      actual = (c.side === "home" ? 1 : -1) * (left.points - right.points);
      difference = actual;
      evidence = `Selected player: ${(c.side === "home" ? left : right).points.toFixed(2)} points · Opponent: ${(c.side === "home" ? right : left).points.toFixed(2)} points. A tie pushes the leg.`;
      break;
    }
    case "player_milestone": {
      const player = results.players[c.metadata?.player_id ?? ""];
      if (!player || line == null)
        return pending("Player participation or milestone is unconfirmed.");
      if (!player.played)
        return {
          id: leg.id,
          status: "PUSH",
          actual_value: 0,
          evidence: "Player did not play; milestone leg pushed.",
        };
      actual = player.points;
      difference = actual >= line ? 1 : -1;
      evidence = `Actual player points: ${actual.toFixed(2)}. Milestone ${line}+ includes equality.`;
      break;
    }
    case "team_milestone":
      if (!team || line == null)
        return pending("Team score or milestone is missing.");
      actual = team.points;
      difference = actual >= line ? 1 : -1;
      evidence = `Actual team points: ${actual.toFixed(2)}. Milestone ${line}+ includes equality.`;
      break;
    case "winning_margin": {
      if (!team || !home || !away)
        return pending("Both matchup scores are required.");
      const lo = c.metadata?.margin_lower,
        hi = c.metadata?.margin_upper;
      if (
        !Number.isFinite(lo) ||
        lo! < 0 ||
        (hi !== null && (!Number.isFinite(hi) || hi! <= lo!))
      )
        return pending("Accepted margin boundaries are missing.");
      actual =
        Math.round(
          (team.points - (c.team_id === c.home_team_id ? away : home).points) *
            100,
        ) / 100;
      if (actual === 0)
        return {
          id: leg.id,
          status: "PUSH",
          actual_value: 0,
          evidence: "The fantasy matchup tied; winning-margin leg pushed.",
        };
      difference =
        actual > 0 && actual >= lo! && (hi === null || actual < hi!) ? 1 : -1;
      evidence = `${team.name} winning margin: ${actual.toFixed(2)}. Accepted range ${lo} to ${hi ?? "no upper limit"} (upper boundary excluded).`;
      break;
    }
    case "weekly_count_150":
    case "weekly_any_below_100":
    case "weekly_any_200": {
      const scores = Object.values(results.teams).map((t) => t.points);
      const expected = c.metadata?.expected_team_count;
      if (
        !expected ||
        scores.length !== expected ||
        scores.some((n) => !Number.isFinite(n))
      )
        return pending("Complete league scores are required for this special.");
      if (c.kind === "weekly_count_150") {
        if (
          line == null ||
          !Number.isInteger(line) ||
          line < 1 ||
          line > expected
        )
          return pending("Accepted team count is missing.");
        actual = scores.filter((s) => s >= 150).length;
        if (![String(line), "exact", `${line}+`].includes(c.side))
          return pending("Accepted count selection is invalid.");
        difference = (c.side === `${line}+` ? actual >= line : actual === line)
          ? 1
          : -1;
        evidence = `Actual: ${actual} ${actual === 1 ? "team" : "teams"} scored 150+. ${c.side === `${line}+` ? "At least" : "Exactly"} ${line} required.`;
      } else {
        if (!["yes", "no"].includes(c.side))
          return pending("Accepted Yes/No selection is missing.");
        actual =
          c.kind === "weekly_any_below_100"
            ? Math.min(...scores)
            : Math.max(...scores);
        const occurred =
          c.kind === "weekly_any_below_100" ? actual < 100 : actual >= 200;
        difference = (c.side === "yes") === occurred ? 1 : -1;
        evidence = `Actual: ${occurred ? "Yes" : "No"} · ${c.kind === "weekly_any_below_100" ? "Lowest" : "Highest"} score: ${actual.toFixed(2)}.`;
      }
      break;
    }
    case "weekly_count_projection":
    case "weekly_average":
    case "weekly_highest_score": {
      const rows = Object.entries(results.teams),
        expected = c.metadata?.expected_team_count;
      if (
        !expected ||
        rows.length !== expected ||
        rows.some(([, t]) => !Number.isFinite(t.points)) ||
        line === null
      )
        return pending(
          "Complete league scores and an accepted line are required.",
        );
      if (c.kind === "weekly_count_projection") {
        const targets = c.metadata?.projection_targets;
        if (
          !targets ||
          rows.some(([id]) => !Number.isFinite(targets[id])) ||
          Object.keys(targets).length !== expected ||
          !Number.isInteger(line) ||
          line < 0 ||
          line > expected
        )
          return pending("Accepted projection targets are incomplete.");
        actual = rows.filter(([id, t]) => t.points > targets[id]).length;
        if (
          ![String(line), "exact", ...(line > 0 ? [`${line}+`] : [])].includes(
            c.side,
          )
        )
          return pending("Accepted count selection is invalid.");
        difference = (c.side === `${line}+` ? actual >= line : actual === line)
          ? 1
          : -1;
        evidence = `Actual: ${actual} teams beat their accepted projection. ${c.side === `${line}+` ? "At least" : "Exactly"} ${line} required. Tied projections do not count.`;
      } else {
        if (!["over", "under"].includes(c.side))
          return pending("Accepted Over/Under selection is unavailable.");
        actual =
          c.kind === "weekly_average"
            ? rows.reduce((n, [, t]) => n + t.points, 0) / expected
            : Math.max(...rows.map(([, t]) => t.points));
        difference = c.side === "over" ? actual - line : line - actual;
        evidence = `Actual ${c.kind === "weekly_average" ? "league average" : "highest score"}: ${actual.toFixed(2)}.`;
      }
      break;
    }
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
  if (!Number.isFinite(actual) || !Number.isFinite(difference))
    return pending("Result value is unconfirmed.");
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
