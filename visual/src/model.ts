import { live } from "./live";
import type { Assignment } from "./featuredRules";
import { featureCatalog } from "./featuredOptions";
import { getFeatureSettings, selectFeatureAssignments } from "./featuredRules";
import fixture from "./data.json";
import players from "./players.json";
import { getSettings } from "./settings";
const originalLines = new Map(fixture.markets.map((m) => [m.id, m.line]));
export function halfPoint(n: number) {
  return Math.floor(Math.abs(n)) + 0.5;
}
// New preview quotes use half-integer targets. Accepted ticket examples below remain immutable.
for (const id of new Set(fixture.markets.map((m) => m.matchup))) {
  const rows = fixture.markets.filter((m) => m.matchup === id),
    away = rows.find((m) => m.kind === "spread" && m.side === "away");
  const awayLine = away
    ? (away.line! < 0 ? -1 : 1) * halfPoint(away.line!)
    : 0.5;
  for (const m of rows) {
    if (m.kind === "spread") m.line = m.side === "away" ? awayLine : -awayLine;
    if (m.kind === "match_total") m.line = halfPoint(m.line!);
  }
}
export const league = fixture;
export type Team = (typeof fixture.teams)[number] & {clockVerified?: boolean; managerProfiles: {name:string; avatar?:string | null; sleeperId?:string}[]};
export function currentTeamScore(team: Team) {
  const score = league.finalScores.find(row=>row.roster===team.roster_id)?.points;
  return live() && typeof score==="number" && Number.isFinite(score) ? score.toFixed(1) : "—";
}
export function liveTeamProjection(team: Team, fallback: number) {
  const liveTeam = live()?.book.payload.teams.find((row: Team) => row.id === team.id);
  if (liveTeam?.clockVerified === false) return "—";
  const value = liveTeam?.currentProjection ?? fallback;
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}
export function pregameTeamProjection(team: Team) {
  const value=live()?.book.payload.openingTargets?.[team.id];
  return typeof value==="number"&&Number.isFinite(value)?value.toFixed(1):"—";
}
export type Pick = {
  id: string;
  label: string;
  detail: string;
  odds: number;
  group: string;
  family: string;
  line?: number;
  side?: string;
  teamId?: string;
  originalOdds?: number;
  decimalOdds?: number;
  groupPosition?: string;
  result?: { status: "Won" | "Lost" | "Push" | "Open"; summary: string };
  kind?: string;
  matchupId?: string;
  matchupLabel?: string;
};
export type Ticket = {
  walletId?: string;
  id: string;
  label: string;
  stake: number;
  odds: number;
  status: string;
  picks: Pick[];
  created: string;
  profitBoost?: number;
  participant?: string;
  placedAt?: number;
  season?: string;
  week?: number;
};
export const teams = fixture.teams;
export const team = (id: string) => teams.find((t) => t.id === id)!;
export const decimal = (odds: number) =>
  odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
export const american = (d: number) =>
  d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
export const price = (n: number) =>
  getSettings().oddsFormat === "decimal"
    ? decimal(n).toFixed(2)
    : (n > 0 ? "+" : "") + n;
export const line = (n: number) => (n > 0 ? "+" : "") + n;
export const money = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const matchupIds = [...new Set(fixture.markets.map((m) => m.matchup))];
const rawMatchups = matchupIds.map((id, index) => {
  const markets = fixture.markets.filter((m) => m.matchup === id);
  const first = markets[0];
  const away = team(first.away),
    home = team(first.home);
  const games =
    away.wins + away.losses + away.ties + home.wins + home.losses + home.ties;
  return {
    id,
    index,
    markets,
    away,
    home,
    awayProjection: first.away_projection,
    homeProjection: first.home_projection,
    total: markets.find((m) => m.kind === "match_total")!.line!,
    combinedRecord: games
      ? (away.wins + home.wins + 0.5 * (away.ties + home.ties)) / games
      : 0,
    combinedPoints: away.pointsFor + home.pointsFor,
    spread: Math.abs(markets.find((m) => m.kind === "spread")!.line!),
    rankScore: 0,
    featured: "",
  };
});
const normalized = (value: number, values: number[]) =>
  Math.max(...values) === Math.min(...values)
    ? 0.5
    : (value - Math.min(...values)) /
      (Math.max(...values) - Math.min(...values));
// Proposed default weights: record 50%, points for 25%, competitiveness 15%, total 10%.
for (const m of rawMatchups)
  m.rankScore =
    0.5 *
      normalized(
        m.combinedRecord,
        rawMatchups.map((x) => x.combinedRecord),
      ) +
    0.25 *
      normalized(
        m.combinedPoints,
        rawMatchups.map((x) => x.combinedPoints),
      ) +
    0.15 *
      (1 -
        normalized(
          m.spread,
          rawMatchups.map((x) => x.spread),
        )) +
    0.1 *
      normalized(
        m.total,
        rawMatchups.map((x) => x.total),
      );
export const matchups = rawMatchups.sort(
  (a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id),
);
export type Matchup = (typeof matchups)[number];
export function featuredAssignment(m: Matchup): Assignment | null {
  const book = live();
  if (book) {
    const boostedQuotes = book.quotes.filter(
      (quote: { matchup_key: string; boost_pct: number }) =>
        quote.matchup_key === m.id && quote.boost_pct > 0,
    );
    const first = boostedQuotes[0];
    if (!first) return null;
    const kind = (Object.entries(featureCatalog).find(([,feature])=>feature.label.toLowerCase()===first.featured?.toLowerCase())?.[0] ?? "game") as keyof typeof featureCatalog;
    return {
      kind,
      label: featureCatalog[kind].label,
      boost: first.boost_pct,
      market: kind === "tank" ? "over" : "moneyline",
      targets: boostedQuotes.flatMap((quote: { team_id: string | null }) =>
        quote.team_id ? [quote.team_id] : [],
      ),
      raceTeams: [],
      reason: featureCatalog[kind].rule,
      source: first.metadata?.feature_source === "Commissioner" ? "Commissioner" : "Automatic",
    };
  }
  return (
    selectFeatureAssignments(matchups, teams, getFeatureSettings()).get(m.id) ||
    null
  );
}
export function featuredLabel(m: Matchup) {
  return featuredAssignment(m)?.label || "";
}
export function marketPick(
  m: (typeof fixture.markets)[number],
  useFeatured = true,
  historical = false,
): Pick {
  if (historical)
    m = { ...m, line: originalLines.get(m.id) ?? m.line } as typeof m;
  const t = m.team_id ? team(m.team_id) : null;
  const match = matchups.find((x) => x.id === m.matchup)!;
  const feature = useFeatured ? featuredAssignment(match) : null;
  const eligibleBoost =
    feature &&
    (feature.market === "over"
      ? m.kind === "match_total" && m.side === "over"
      : m.kind === "moneyline" && feature.targets.includes(t?.id || ""));
  return {
    id: m.id,
    teamId: m.team_id || undefined,
    line: m.line ?? undefined,
    side: m.side,
    label:
      m.kind === "spread"
        ? `${t!.name} ${line(m.line!)}`
        : m.kind === "moneyline"
          ? t!.name
          : `${m.side === "over" ? "Over" : "Under"} ${m.line}`,
    detail:
      m.kind === "spread"
        ? "Spread"
        : m.kind === "moneyline"
          ? "Moneyline"
          : "Match Total",
    matchupLabel: `${match.away.name} vs ${match.home.name}`,
    matchupId: match.id,
    odds: eligibleBoost && feature ? boosted(m.odds, feature.boost) : m.odds,
    originalOdds: eligibleBoost ? m.odds : undefined,
    group: m.matchup,
    family: m.kind,
    kind: "weekly",
  };
}
export const getPick = (id: string) => {
  const m = fixture.markets.find((m) => m.id === id);
  return m ? marketPick(m) : undefined;
};
export const profileTeam =
  teams.find(t=>t.id===live()?.user.teamId) || teams.find(
    (t) =>
      t.manager.toLowerCase().includes("cooper") ||
      t.manager.toLowerCase().includes("cgurr"),
  ) || teams[0];
export const members = teams.flatMap((t) =>
  t.managers.map((name, i) => ({ name, team: t, co: i > 0, sleeperId: (t as Team).managerProfiles[i]?.sleeperId })),
);
export const futures = [
  { title: "League Champion", kind: "champion" },
  { title: "Playoffs", kind: "playoffs" },
  { title: "Win Totals", kind: "wins" },
  { title: "Last Place", kind: "last" },
  { title: "Regular-Season Points Leader", kind: "points-leader" },
  { title: "Regular-Season Top Seed", kind: "top-seed" },
];
export function futurePick(
  t: Team,
  kind: string,
  side = "yes",
  candidates = teams,
  title?: string,
): Pick {
  const target = t.wins + 3.5;
  const leader =
    kind === "points-leader" ||
    kind === "top-seed" ||
    kind.startsWith("division:");
  const score = (x: Team) =>
    kind === "points-leader"
      ? x.pointsFor / Math.max(1, x.games)
      : ((x.wins + 0.5 * x.ties + 2) / (x.games + 4)) * 100;
  const best = Math.max(...candidates.map(score));
  const weight = (x: Team) => Math.exp((score(x) - best) / 25);
  const leaderOdds =
    Math.round(
      american(
        1 /
          Math.min(
            0.98,
            Math.max(
              0.005,
              (weight(t) / candidates.reduce((n, x) => n + weight(x), 0)) *
                1.06,
            ),
          ),
      ) / 25,
    ) * 25;
  const odds = leader
    ? leaderOdds
    : kind === "wins"
      ? -110
      : kind === "playoffs"
        ? side === "no"
          ? 140
          : t.wins >= 5
            ? -180
            : 165
        : Math.round(
            ((kind === "last" ? t.wins + 2 : 14 - t.wins) * 100) / 25,
          ) * 25;
  const suffix =
    kind === "wins"
      ? ` · ${side === "under" ? "Under" : "Over"} ${target} wins`
      : kind === "playoffs"
        ? ` · ${side === "no" ? "Miss" : "Make"} playoffs`
        : "";
  return {
    id: `future-${kind}-${t.id}-${side}`,
    teamId: t.id,
    line: kind === "wins" ? target : undefined,
    side,
    label: t.name + suffix,
    detail: title || futures.find((f) => f.kind === kind)!.title,
    odds,
    group: `future-${kind}-${leader || kind === "champion" || kind === "last" ? "league" : t.id}`,
    family: "future",
    kind: "future",
  };
}
const underdogs = matchups.slice(0, 3).map((m) =>
  marketPick(
    m.markets.find((x) => x.kind === "moneyline" && x.odds > 0)!,
    false,
  ),
);
const totals = matchups.slice(0, 4).map((m) =>
  marketPick(
    m.markets.find((x) => x.kind === "match_total" && x.side === "over")!,
    false,
  ),
);
function offerCutoff(picks: Pick[]) {
  const ids = new Set(picks.map((p) => p.matchupId));
  const rosters = new Set(
    matchups
      .filter((m) => ids.has(m.id))
      .flatMap((m) => [m.away.roster_id, m.home.roster_id]),
  );
  return (
    players
      .filter((p) => rosters.has(p.roster) && p.kickoff)
      .map((p) => p.kickoff!)
      .sort()[0] || league.offerCutoffs.earliestGame
  );
}
export const offers = [
  {
    id: "underdogs",
    title: "Underdog Parlay",
    name: "Underdog Parlay",
    description: "3 Moneyline Legs",
    picks: underdogs,
    base: Math.max(
      500,
      Math.round(
        american(underdogs.reduce((d, p) => d * decimal(p.odds), 1)) / 500,
      ) * 500,
    ),
    boost: 50,
    deadline: offerCutoff(underdogs),
    type: "parlay",
  },
  {
    id: "over",
    title: "Match Totals Parlay",
    name: "Match Totals Parlay",
    description: "4 Over Selections",
    picks: totals,
    base: Math.max(
      500,
      Math.round(
        american(totals.reduce((d, p) => d * decimal(p.odds), 1)) / 500,
      ) * 500,
    ),
    boost: 25,
    deadline: offerCutoff(totals),
    type: "parlay",
  },
  {
    id: "boost",
    title: "Player H2H Profit Boost",
    name: "Player H2H Profit Boost",
    description: "4+ Leg Player Head-To-Head Parlay",
    picks: [],
    base: 0,
    boost: 25,
    deadline: league.offerCutoffs.sundayGame,
    type: "boost",
  },
];
export function offerPrice(o: (typeof offers)[number]) {
  return Math.max(500, Math.round(boosted(o.base, o.boost) / 500) * 500);
}
export function boosted(base: number, boost: number) {
  return american(1 + (decimal(base) - 1) * (1 + boost / 100));
}
// Accepted terms below are illustrative tickets; displayed final scores come from the archived league week.
const finalScore = (t: Team) =>
  fixture.finalScores.find((r) => r.roster === t.roster_id)!.points;
function resolvedMoneyline(m: Matchup): Pick {
  const a = finalScore(m.away),
    h = finalScore(m.home);
  const p = marketPick(
    m.markets.find(
      (x) => x.kind === "moneyline" && x.side === (a > h ? "away" : "home"),
    )!,
    false,
  );
  return {
    ...p,
    result: {
      status: a === h ? "Push" : "Won",
      summary: `Final: ${m.away.name} ${a.toFixed(2)} - ${m.home.name} ${h.toFixed(2)}`,
    },
  };
}
const lostMatch = matchups[0];
const lostTotal = finalScore(lostMatch.away) + finalScore(lostMatch.home);
const losingPick = marketPick(
  lostMatch.markets.find(
    (x) =>
      x.kind === "match_total" &&
      x.side === (lostTotal > lostMatch.total ? "under" : "over"),
  )!,
  false,
  true,
);
const pushMatch = matchups[3];
const pushLine = Number(
  (finalScore(pushMatch.home) - finalScore(pushMatch.away)).toFixed(2),
);
const pushedPick: Pick = {
  ...marketPick(
    pushMatch.markets.find((x) => x.kind === "spread" && x.side === "away")!,
    false,
  ),
  label: pushMatch.away.name + " " + line(pushLine),
  line: pushLine,
  odds: -110,
  result: {
    status: "Push",
    summary: `Final: ${pushMatch.away.name} ${finalScore(pushMatch.away).toFixed(2)} - ${pushMatch.home.name} ${finalScore(pushMatch.home).toFixed(2)}.`,
  },
};
const winningPicks = matchups.slice(0, 3).map(resolvedMoneyline);
export const exampleTickets: Ticket[] = [
  {
    id: "BF-08104",
    label: "3-Leg Parlay",
    stake: 25,
    odds: 550,
    status: "Open",
    created: "Archived Week 8 · Example",
    picks: [
      resolvedMoneyline(matchups[1]),
      pushedPick,
      {
        ...marketPick(
          matchups[2].markets.find(
            (x) => x.kind === "moneyline" && x.side === "away",
          )!,
          false,
        ),
        result: { status: "Open", summary: "Awaiting Final Confirmation" },
      },
    ],
  },
  {
    id: "BF-08097",
    label: "3-Leg Parlay",
    stake: 10,
    odds: american(winningPicks.reduce((d, p) => d * decimal(p.odds), 1)),
    status: "Won",
    picks: winningPicks,
    created: "Archived Week 8 · Example",
  },
  {
    id: "BF-08091",
    label: "Single",
    stake: 15,
    odds: losingPick.odds,
    status: "Lost",
    picks: [
      {
        ...losingPick,
        result: {
          status: "Lost",
          summary: `Final Combined Score: ${lostTotal.toFixed(2)}.`,
        },
      },
    ],
    created: "Archived Week 8 · Example",
  },
  {
    id: "BF-08088",
    label: "Single",
    stake: 20,
    odds: -110,
    status: "Push",
    picks: [pushedPick],
    created: "Archived Week 8 · Example",
  },
  {
    id: "BF-08082",
    label: "2-Leg Parlay",
    stake: 10,
    odds: 280,
    status: "Lost",
    picks: [
      {
        ...losingPick,
        result: {
          status: "Lost",
          summary: `Final Combined Score: ${lostTotal.toFixed(2)}.`,
        },
      },
      resolvedMoneyline(matchups[2]),
    ],
    created: "Archived Week 8 · Example",
  },
];
exampleTickets.push({
  id: "BF-08105",
  label: "Single",
  stake: 10,
  odds: -110,
  status: "Open",
  created: "Archived Week 8 · Example",
  picks: [
    {
      ...futurePick(profileTeam, "wins", "over"),
      result: { status: "Open", summary: "" },
    },
  ],
});
for (const t of exampleTickets) {
  t.participant = profileTeam.manager;
  t.placedAt =
    Date.parse(league.offerCutoffs.sundayGame) -
    (8105 - Number(t.id.replace(/\D/g, ""))) * 60000;
  t.season = String(league.season);
  t.week = league.week;
}
export const ticketOdds = (t: Ticket) => {
  const remaining = t.picks.filter((p) => p.result?.status !== "Push");
  if (remaining.length === t.picks.length || !remaining.length) return t.odds;
  const base = remaining.reduce((d, p) => d * decimal(p.odds), 1);
  return american(1 + (base - 1) * (1 + (t.profitBoost || 0) / 100));
};
export const ticketReturn = (t: Ticket) =>
  (t as any).actualReturn != null && t.status !== "Open" ? (t as any).actualReturn :
  t.status === "Won"
    ? t.stake * decimal(ticketOdds(t))
    : ["Push", "Voided"].includes(t.status)
      ? t.stake
      : 0;
export function groupPicks(picks: Pick[]) {
  const groups = new Map<
    string,
    { id: string; label: string; picks: Pick[] }
  >();
  for (const p of picks) {
    const id = p.matchupId || (p.kind === "future" ? "futures" : "specials");
    if (!groups.has(id))
      groups.set(id, {
        id,
        label:
          p.matchupLabel ||
          (p.kind === "future" ? "Season Futures" : "This Week's Specials"),
        picks: [],
      });
    groups.get(id)!.picks.push(p);
  }
  return [...groups.values()];
}
