import { evaluatePlayoffTiming, playoffTiming } from "./playoff-timing.ts";

type Matchup = { roster_id: number; matchup_id: number | null; points: number; custom_points?: number | null };
type Week = { week: number; matchups: Matchup[]; final: boolean };
type BracketGame = { p?: number; t1?: number | null; t2?: number | null; w?: number | null; l?: number | null;
  t1_from?: { w?: number; l?: number }; t2_from?: { w?: number; l?: number } };
type Rules = { qualification: "sleeper" | "head_to_head" | "official_bracket"; firstPick: "disabled" | "regular_season" | "toilet_bowl" };
type League = { playoffWeek: number; playoffTeams: number; leagueType: number; divisions: number; medianGame: boolean };

export function futuresEvidence(
  rosterIds: number[], weeks: Week[], league: League, rules: Rules,
  winners: BracketGame[], losers: BracketGame[],
) {
  const records = Object.fromEntries(rosterIds.map(id => [id, { wins: 0, record: 0, points: 0 }]));
  const regular = weeks.filter(week => week.week < league.playoffWeek).sort((a, b) => a.week - b.week);
  const known = new Set(rosterIds);
  const officialIds = [...new Set(winners.flatMap(game => [game.t1, game.t2]).filter(
    (id): id is number => typeof id === "number" && known.has(id),
  ))];
  const officialField = officialIds.length === league.playoffTeams ? officialIds : null;
  const schedule = regular.map(({ week, matchups, final }) => {
    const groups = new Map<number, Matchup[]>();
    for (const row of matchups) {
      if (row.matchup_id == null || !known.has(row.roster_id)) continue;
      const rows = groups.get(row.matchup_id) ?? [];
      rows.push(row);
      groups.set(row.matchup_id, rows);
    }
    const games = [...groups.values()].filter(pair => pair.length === 2).map(([home, away]) => ({
      home: home.roster_id, away: away.roster_id,
    }));
    const scores = Object.fromEntries(matchups.map(row => [row.roster_id, row.custom_points ?? row.points]));
    return { week, games, scores: final && rosterIds.every(id => Number.isFinite(scores[id])) ? scores : undefined };
  });
  const completeSchedule = schedule.length === league.playoffWeek - 1 && schedule.every(
    ({ week, games }, index) => week === index + 1
      && games.length * 2 === rosterIds.length
      && new Set(games.flatMap(game => [game.home, game.away])).size === rosterIds.length,
  );
  const firstPickEliminationWeeks: Record<number, number> = {};
  for (const [index, { week, games, scores }] of schedule.entries()) {
    if (!scores) break;
    for (const { home, away } of games) {
      const a = scores[home], b = scores[away];
      records[home].points += a;
      records[away].points += b;
      if (a === b) {
        records[home].record += 0.5;
        records[away].record += 0.5;
      } else {
        const winner = records[a > b ? home : away];
        winner.wins++;
        winner.record++;
      }
    }
    if (completeSchedule && rules.firstPick === "regular_season" && !league.medianGame && !league.divisions) {
      const remaining = schedule.length - index - 1;
      const lowestCeiling = Math.min(...rosterIds.map(id => records[id].record + remaining));
      for (const id of rosterIds) {
        if (records[id].record > lowestCeiling) firstPickEliminationWeeks[id] ??= week;
      }
    }
  }
  const complete = completeSchedule && schedule.every(week => week.scores);
  const firstMissing = schedule.findIndex(week => !week.scores);
  const standings = [...rosterIds].sort((a, b) =>
    records[b].record - records[a].record || records[b].points - records[a].points);
  const last = standings.at(-1);
  const nextLast = standings.at(-2);
  const toiletFinal = losers.find(game => game.p === 1);
  const toiletVerified = toiletFinal?.t1_from?.l != null && toiletFinal.t2_from?.l != null;
  const firstPick = league.leagueType !== 2 || rules.firstPick === "disabled" ? null
    : rules.firstPick === "toilet_bowl" ? toiletVerified ? toiletFinal.l ?? null : null
    : complete && last != null && nextLast != null
      && (records[last].record !== records[nextLast].record || Math.abs(records[last].points - records[nextLast].points) >= 0.01)
      ? last : null;
  const eliminationWeeks: Record<number, number> = {};
  const clinchWeeks: Record<number, number> = {};
  const timing = evaluatePlayoffTiming({
    rosterIds, playoffSpots: league.playoffTeams, regularSeason: completeSchedule ? schedule : [],
    standingsMode: rules.qualification === "head_to_head"
      || (rules.qualification === "sleeper" && !league.divisions && !league.medianGame)
      ? "head-to-head-record" : "custom",
    officialBracket: officialField ? { week: league.playoffWeek, playoffRosterIds: officialField } : undefined,
    onWeek(week, result) {
      for (const rosterId of result.eliminated) eliminationWeeks[rosterId] ??= week;
      for (const rosterId of result.clinched) clinchWeeks[rosterId] ??= week;
    },
  });
  const knownTiming = firstMissing<0?schedule.length:firstMissing;
  const liveQualification = evaluateQualification(rosterIds, records, schedule.slice(knownTiming).flatMap(week=>week.games), league, rules, officialField, completeSchedule);
  const champion = winners.find(game => game.p === 1)?.w;
  return { ...timing, eliminationWeeks, clinchWeeks, firstPickEliminationWeeks, firstPick, officialField, ...liveQualification, champion: champion != null && known.has(champion) ? champion : null,
    wins: Object.fromEntries(rosterIds.map(id => [id, records[id].wins])), regularSeasonFinal: complete,
    scoredThroughWeek: (firstMissing === -1 ? schedule.at(-1)?.week : schedule[firstMissing - 1]?.week) ?? 0 };
}

function evaluateQualification(
 rosterIds: number[], records: Record<number, {record:number}>, games: {home:number;away:number}[],
 league: League, rules: Rules, field: number[] | null, complete: boolean,
) {
 if (field) return {clinched:field, eliminated:rosterIds.filter(id=>!field.includes(id))};
 if (!complete || rules.qualification==='official_bracket' ||
     (rules.qualification==='sleeper' && (league.divisions || league.medianGame))) return {clinched:[],eliminated:[]};
 return playoffTiming(rosterIds.map(rosterId=>({rosterId,recordUnits:records[rosterId].record*2})), games, league.playoffTeams);
}

type Evidence = ReturnType<typeof futuresEvidence>;
type Selection = {
  kind: "future_first_clinch" | "future_first_elimination" | "future_win_total" | "future_playoffs" | "future_first_pick" | "future_champion";
  rosterId?: number;
  side?: string;
  line?: number;
};

export function gradeFuturesSelection(selection: Selection, result: Evidence) {
  const { kind, rosterId, line, side } = selection;
  if (!["future_first_clinch","future_first_elimination","future_win_total","future_playoffs","future_first_pick","future_champion"].includes(kind)) return null;
  if (kind === "future_first_clinch" || kind === "future_first_elimination") {
    const event = kind === "future_first_clinch" ? result.clinch : result.elimination;
    if (line == null || !Number.isFinite(line) || !["over", "under"].includes(side ?? "")) return null;
    if (event) return { won: side === "over" ? event.week > line : event.week < line, actual: event.week, rosters: event.rosterIds };
    return null;
  }
  if (rosterId == null) return null;
  if (kind === "future_win_total") {
    const wins = result.wins[rosterId];
    if (wins == null || line == null || !Number.isFinite(line) || !["over", "under"].includes(side ?? "")) return null;
    if (!result.regularSeasonFinal && wins <= line) return null;
    return { won: side === "over" ? wins > line : wins < line, actual: wins, rosters: [rosterId] };
  }
  if (kind === "future_playoffs") {
    if (!["make", "miss"].includes(side ?? "")) return null;
    const qualifies = result.clinched.includes(rosterId);
    if (!qualifies && !result.eliminated.includes(rosterId)) return null;
    return { won: side === "make" ? qualifies : !qualifies, actual: Number(qualifies), rosters: [rosterId] };
  }
  const winner = kind === "future_champion" ? result.champion : result.firstPick;
  return winner == null ? null : { won: winner === rosterId, actual: winner, rosters: [winner] };
}
