import {live} from "./live";
import { american, line, teams } from "./model";
import type { Matchup, Pick, Team } from "./model";
import players from "./players.json";
import source from "./featured-source.json";

// Illustrative dev prices. The calibrated pricing/settlement worker is not connected.
const implied = (odds: number) =>
  odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
export function previewAdjustedOdds(
  base: number,
  easierBy: number,
  scale: number,
) {
  if (easierBy === 0) return base;
  const baseline = Math.min(0.98, Math.max(0.02, (implied(base) * 21) / 22));
  const p =
    1 /
    (1 + Math.exp(-(Math.log(baseline / (1 - baseline)) + easierBy / scale)));
  const priced = Math.min(0.98, Math.max(0.02, (p * 22) / 21));
  return Math.round(american(1 / priced) / 5) * 5;
}
export function alternatePick(
  m: Matchup,
  kind: "spread" | "match_total",
  side: string,
  target: number,
): Pick {
  const sourceRow = m.markets.find(
    (row) => row.kind === kind && row.side === side,
  )!;
  const team =
    kind === "spread" ? (side === "away" ? m.away : m.home) : undefined;
  const easier =
    kind === "spread" || side === "under"
      ? target - sourceRow.line!
      : sourceRow.line! - target;
  const raw = previewAdjustedOdds(
    sourceRow.odds,
    easier,
    Math.max(12, m.total * 0.15),
  );
  return {
    id: `alternate-${m.id}-${kind}-${side}-${target}`,
    teamId: team?.id,
    line: target,
    side,
    label: team
      ? `${team.name} ${line(target)}`
      : `${side === "over" ? "Over" : "Under"} ${target}`,
    detail: kind === "spread" ? "Alternate Spread" : "Alternate Match Total",
    group: m.id,
    family: kind,
    kind: "weekly",
    matchupId: m.id,
    matchupLabel: `${m.away.name} vs ${m.home.name}`,
    odds: raw,
  };
}
export function positionGroups(m: Matchup) {
  const starter = (p: typeof players[number]) => live() ? p.lineupIndex >= 0 : p.starter;
  const starterGroup = (t: Team, position: string) =>
    players.filter(
      (p) => p.roster === t.roster_id && starter(p) && p.position === position,
    );
  const order = ["QB", "RB", "WR", "TE"];
  return [
    ...new Set(
      players
        .filter(
          (p) =>
            starter(p) &&
            [m.away.roster_id, m.home.roster_id].includes(p.roster) &&
            !["K", "DEF"].includes(p.position),
        )
        .map((p) => p.position),
    ),
  ]
    .sort(
      (a, b) =>
        (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) -
          (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b),
    )
    .map((position) => ({
      position,
      away: starterGroup(m.away, position),
      home: starterGroup(m.home, position),
    }))
    .filter((g) => g.away.length && g.home.length);
}
export function positionGroupAvailable(
  group: ReturnType<typeof positionGroups>[number],
) {
  return [...group.away, ...group.home].every(
    (p) =>
      typeof p.seasonAverage === "number" &&
      Number.isFinite(p.seasonAverage) &&
      p.gamesPlayed > 0,
  );
}
export function positionGroupPick(
  m: Matchup,
  position: string,
  side: "away" | "home",
): Pick {
  const g = positionGroups(m).find((g) => g.position === position)!;
  if (!positionGroupAvailable(g))
    throw new Error("Position-group average data is incomplete.");
  const average = (rows: typeof g.away) =>
    rows.reduce((n, p) => n + (p.seasonAverage || 0), 0);
  const own = average(g[side]),
    other = average(g[side === "away" ? "home" : "away"]);
  const t = m[side];
  return {
    id: `position-group-${m.id}-${position}-${side}`,
    teamId: t.id,
    groupPosition: position,
    side,
    label: `${t.name} · Starting ${position}s`,
    detail: `${position} Group Head-To-Head · Final Starters`,
    odds: previewAdjustedOdds(
      -110,
      own - other,
      Math.max(8, (own + other) / 3),
    ),
    group: m.id,
    family: "position_group",
    kind: "player-group",
    matchupId: m.id,
    matchupLabel: `${m.away.name} vs ${m.home.name}`,
  };
}
export function divisionMarkets(
  people: {
    roster: number;
    division: string | number | null;
  }[] = source.participants,
  names: Record<string, string> = source.divisions,
  allTeams: Team[] = teams,
) {
  const ids = [
    ...new Set(
      people.flatMap((p) => (p.division == null ? [] : [String(p.division)])),
    ),
  ].sort();
  return ids.flatMap((id) => {
    const rosters = new Set(
      people.filter((p) => String(p.division) === id).map((p) => p.roster),
    );
    const members = allTeams.filter((t) => rosters.has(t.roster_id));
    return members.length >= 2
      ? [
          {
            title: `${names["division_" + id] || "Division " + id} Winner`,
            kind: "division:" + id,
            teams: members,
          },
        ]
      : [];
  });
}
