import {
  selectFantasyRewards,
  type FantasyResult,
  type FantasyWeek,
  type RewardRules,
} from "./fantasy-rewards.ts";

type ArchivedResult = {
  points: number;
  matchup_id: number | null;
  projection?: number | null;
};
type ArchivedWeek = {
  market_week: number;
  final: boolean;
  results: Record<string, ArchivedResult>;
};
type Team = { id: string; roster_id: number };
type PublishedLine = { market_week: number; team_id: string; line: number };

export function prepareWeeklyRewards({
  refreshWeek,
  teams,
  weeks,
  lines,
  rules,
  historicalHigh,
  firstClinches,
  champion,
  seasonClosing,
}: {
  refreshWeek: number;
  teams: readonly Team[];
  weeks: readonly ArchivedWeek[];
  lines: readonly PublishedLine[];
  rules?: RewardRules;
  historicalHigh?: number;
  firstClinches?: readonly number[];
  champion?: number;
  seasonClosing?: boolean;
}) {
  const rosterByTeam = new Map(
    teams.map(({ id, roster_id }) => [id, roster_id]),
  );
  const verified: FantasyWeek[] = [];
  for (const week of weeks) {
    if (!week.final || week.market_week >= refreshWeek) continue;
    const rows = Object.entries(week.results);
    const groups = new Map<number, number[]>();
    for (const [id, result] of rows) {
      const roster = rosterByTeam.get(id);
      if (
        roster == null ||
        result.matchup_id == null ||
        !Number.isFinite(result.points)
      )
        continue;
      const members = groups.get(result.matchup_id) ?? [];
      members.push(roster);
      groups.set(result.matchup_id, members);
    }
    const results = rows.flatMap(([id, result]): FantasyResult[] => {
      const rosterId = rosterByTeam.get(id);
      if (rosterId == null || !Number.isFinite(result.points)) return [];
      const members =
        result.matchup_id == null ? [] : (groups.get(result.matchup_id) ?? []);
      const opponentId =
        members.length === 2
          ? members.find((roster) => roster !== rosterId)
          : undefined;
      const spread = lines.find(
        (line) => line.market_week === week.market_week && line.team_id === id,
      )?.line;
      return [
        {
          rosterId,
          opponentId: opponentId ?? -1,
          points: result.points,
          projection:
            typeof result.projection === "number" &&
            Number.isFinite(result.projection)
              ? result.projection
              : undefined,
          spread: Number.isFinite(spread) ? spread : undefined,
        },
      ];
    });
    if (results.length === teams.length)
      verified.push({ week: week.market_week, results });
  }
  const current = verified.find((week) => week.week === refreshWeek - 1);
  if (!current) return null;
  return {
    week: current.week,
    ...selectFantasyRewards({
      current,
      previous: verified,
      rules,
      historicalHigh,
      firstClinches,
      champion,
      seasonClosing,
    }),
  };
}
