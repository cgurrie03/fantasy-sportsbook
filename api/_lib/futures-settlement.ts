import type { LegInput, LegResult } from "./settlement.ts";
export interface SeasonResult {
  champion: number | null;
  playoffRosters: number[] | null;
  last: number | null;
  names?: Record<number, string>;
}
export function settleFuture(leg: LegInput, result: SeasonResult): LegResult {
  const context = leg.settlement_context;
  const pending = (evidence: string): LegResult => ({
    id: leg.id,
    status: "OPEN",
    actual_value: null,
    evidence,
  });
  const roster = Number(
    (context?.metadata as Record<string, unknown> | undefined)?.roster_id,
  );
  if (!Number.isInteger(roster) || roster < 1)
    return pending(
      "Accepted season team is unavailable; admin review required.",
    );
  let won: boolean;
  let actual: number;
  let evidence: string;
  if (context?.kind === "future_champion") {
    if (result.champion === null)
      return pending("Waiting for Sleeper's confirmed championship winner.");
    actual = result.champion;
    won = actual === roster;
    evidence = `League Winner: ${result.names?.[actual] ?? "Selected team"}.`;
  } else if (context?.kind === "future_first_pick") {
    if (result.last === null)
      return pending(
        "Waiting for confirmed regular-season last place; tied standings require review.",
      );
    actual = result.last;
    won = actual === roster;
    evidence = `Regular-season Last Place: ${result.names?.[actual] ?? "Selected team"}.`;
  } else if (context?.kind === "future_playoffs") {
    if (result.playoffRosters === null)
      return pending(
        "Waiting for the confirmed playoff field; tied qualification requires review.",
      );
    actual = result.playoffRosters.includes(roster) ? 1 : 0;
    if (!["make", "miss"].includes(context.side))
      return pending("Accepted playoff selection is invalid.");
    won = context.side === "make" ? actual === 1 : actual === 0;
    evidence = `Confirmed playoff qualification: ${actual ? "Made playoffs" : "Missed playoffs"}.`;
  } else return pending("Unknown season market; admin review required.");
  return {
    id: leg.id,
    status: won ? "WON" : "LOST",
    actual_value: actual,
    evidence,
  };
}

export function regularSeasonResults(
  rosters: {
    roster_id: number;
    settings: {
      wins: number;
      ties?: number;
      fpts: number;
      fpts_decimal?: number;
    };
  }[],
  playoffTeams: number,
): Pick<SeasonResult, "playoffRosters" | "last"> {
  const rank = rosters
    .map((r) => ({
      id: r.roster_id,
      record: r.settings.wins + (r.settings.ties ?? 0) / 2,
      points:
        Math.round(
          (r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100) * 100,
        ) / 100,
    }))
    .sort((a, b) => b.record - a.record || b.points - a.points);
  if (
    rank.length < playoffTeams + 1 ||
    rank.some((r) => !Number.isFinite(r.record) || !Number.isFinite(r.points))
  )
    return { playoffRosters: null, last: null };
  const tied = (a: (typeof rank)[number], b: (typeof rank)[number]) =>
    a.record === b.record && a.points === b.points;
  return {
    playoffRosters: tied(rank[playoffTeams - 1], rank[playoffTeams])
      ? null
      : rank.slice(0, playoffTeams).map((r) => r.id),
    last: tied(rank.at(-1)!, rank.at(-2)!) ? null : rank.at(-1)!.id,
  };
}
