import { exactEventTime } from "../../api/_lib/event-time";
import { supabase } from "./supabase";

export interface Board {
  id: string;
  league_id: string;
  market_week: number;
  nfl_season: number;
  league_season: number;
  status: "draft" | "published" | "closed";
  revision: number;
  opens_at: string;
  closes_at: string;
  board_type?: "weekly" | "future";
  phase?: "pregame" | "live";
  source_observed_at?: string | null;
  quote_valid_until?: string | null;
  suspension_reason?: string | null;
  reopening_id?: string | null;
  reopening_until?: string | null;
}
export interface Market {
  id: string;
  board_id: string;
  market_key: string;
  matchup_key: string | null;
  kind:
    | "spread"
    | "moneyline"
    | "match_total"
    | "team_total"
    | "player_points"
    | "player_h2h"
    | "player_milestone"
    | "team_milestone"
    | "winning_margin"
    | "weekly_high"
    | "weekly_low"
    | "weekly_count_150"
    | "weekly_any_below_100"
    | "weekly_any_200"
    | "weekly_count_projection"
    | "weekly_average"
    | "weekly_highest_score"
    | "future_champion"
    | "future_playoffs"
    | "future_win_total"
    | "future_first_pick";
  label: string;
  subject: string;
  side: string;
  line: number | null;
  odds: number;
  boost_pct: number;
  team_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_projection: number | null;
  away_projection: number | null;
  featured: "" | "Game of the Week" | "Tank Bowl";
  metadata: {
    player_id?: string;
    position?: string;
    nfl_team?: string;
    season_average?: number;
    projection?: number;
    game_info?: string;
    rationale?: string;
    generated_at?: string;
    [key: string]: unknown;
  };
  active: boolean;
  market_state?: "open" | "suspended" | "closed" | "settled";
  suspension_reason?: string | null;
}
export function memberAvailability(reason: string) {
  if (!reason) return "";
  if (/missing or ambiguous|game mapping|including bye/i.test(reason))
    return "A player in the required lineup has no confirmed NFL game, which can include a bye. Affected bets stay locked until the lineup or schedule is corrected.";
  if (/prior.*(match|game)|rate prior/i.test(reason))
    return "Updated projections do not match a player's scheduled game. Affected bets stay locked until matching projections are available.";
  if (/in progress|uncertain event|unknown game/i.test(reason))
    return "A required player's game is in progress or its status is uncertain. Affected bets stay locked until a verified update is available.";
  if (/projection|lineup|starter/i.test(reason))
    return "Player pricing is unavailable for this bet. Try again after projections update.";
  if (/\b\d{4,}:/.test(reason))
    return "Required player information is unavailable. Affected bets stay locked until a verified update is available.";
  return reason;
}
export function quoteUnavailable(m: Market) {
  return memberAvailability(rawQuoteUnavailable(m));
}
function rawQuoteUnavailable(m: Market) {
  return (
    ((
      m.metadata.reopening_events as
        { state: string; starts_at: string }[] | undefined
    )?.some(
      (g) => g.state === "scheduled" && Date.parse(g.starts_at) <= Date.now(),
    )
      ? "NFL kickoff passed. Waiting for updated prices; affected bets are locked."
      : "") ||
    (exactEventTime(m.metadata.cutoff_at) &&
    Date.parse(String(m.metadata.cutoff_at)) <= Date.now()
      ? "This player market has reached kickoff."
      : "") ||
    m.suspension_reason ||
    (m.metadata.reopening_locked
      ? String(
          m.metadata.reopening_lock_reason ??
            "This bet is unavailable for the reopening window.",
        )
      : "") ||
    (m.market_state && m.market_state !== "open"
      ? `Market ${m.market_state}.`
      : "") ||
    (m.metadata.resolved ? "Outcome resolved." : "") ||
    (m.metadata.lineup_locked
      ? String(m.metadata.lock_reason ?? "Incomplete projected lineup.")
      : "")
  );
}
export function boardAvailable(board: Board | null, now: number) {
  return (
    !!board &&
    board.status === "published" &&
    (board.phase !== "live" ||
      Boolean(
        board.reopening_id &&
        board.reopening_until &&
        now < Date.parse(board.reopening_until),
      )) &&
    !board.suspension_reason &&
    now >= Date.parse(board.opens_at) &&
    now < Date.parse(board.closes_at) &&
    (!board.quote_valid_until || now < Date.parse(board.quote_valid_until))
  );
}
export const marketType = {
  spread: "Spread",
  moneyline: "Moneyline",
  match_total: "Match Total",
  team_total: "Team Total",
  player_points: "Player Points",
  player_h2h: "Head to Head",
  player_milestone: "Player Milestone",
  team_milestone: "Team Milestone",
  winning_margin: "Winning Margin",
  weekly_high: "Weekly High Scorer",
  weekly_low: "Weekly Low Scorer",
  weekly_count_150: "Teams Scoring 150+",
  weekly_any_below_100: "Any Team Below 100",
  weekly_any_200: "Any Team Scoring 200+",
  weekly_count_projection: "Teams Beating Projection",
  weekly_average: "League Average Score",
  weekly_highest_score: "Highest Weekly Score",
  future_champion: "League Winner",
  future_playoffs: "Make / Miss Playoffs",
  future_win_total: "Regular-season Wins",
  future_first_pick: "#1 Pick",
};
export const futureKinds = [
  "future_champion",
  "future_playoffs",
  "future_win_total",
  "future_first_pick",
];
export const isFuture = (m: Market) => futureKinds.includes(m.kind);
export const weeklyKinds = [
  "weekly_high",
  "weekly_low",
  "weekly_count_150",
  "weekly_any_below_100",
  "weekly_any_200",
  "weekly_count_projection",
  "weekly_average",
  "weekly_highest_score",
];
export const roundSpecialOdds = (odds: number) =>
  Math.sign(odds) * Math.max(100, Math.round(Math.abs(odds) / 10) * 10);
export const decimalPrice = (odds: number) =>
  odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
export const selectionPrice = (m: Market) =>
  1 + (decimalPrice(m.odds) - 1) * (1 + m.boost_pct / 100);
export const americanPrice = (price: number) =>
  Math.round(price >= 2 ? (price - 1) * 100 : -100 / (price - 1));
export const formatOdds = (odds: number) =>
  odds > 0 ? "+" + odds : String(odds);
export function orderMatchups(
  groups: Market[][],
  teams: { id: string; wins: number; losses: number; ties: number }[],
) {
  const record = (g: Market[]) =>
    [g[0].home_team_id, g[0].away_team_id].map((id) =>
      teams.find((t) => t.id === id),
    );
  const rate = (t: ReturnType<typeof record>[number]) =>
    t ? (t.wins + 0.5 * t.ties) / Math.max(1, t.wins + t.losses + t.ties) : 0;
  const bothWinning = (g: Market[]) => record(g).every((t) => rate(t) > 0.5);
  const combined = (g: Market[]) =>
    record(g).reduce((n, t) => n + (t?.wins ?? 0) + 0.5 * (t?.ties ?? 0), 0);
  const spread = (g: Market[]) =>
    Math.abs(Number(g.find((m) => m.kind === "spread")?.line ?? 999));
  return [...groups].sort(
    (a, b) =>
      Number(bothWinning(b)) - Number(bothWinning(a)) ||
      (bothWinning(a) && bothWinning(b)
        ? spread(a) - spread(b)
        : combined(b) - combined(a)) ||
      spread(a) - spread(b) ||
      Number(b[0].home_projection) +
        Number(b[0].away_projection) -
        (Number(a[0].home_projection) + Number(a[0].away_projection)),
  );
}
export const combinedPrice = (picks: Market[]) =>
  picks.reduce((price, pick) => price * selectionPrice(pick), 1);
export const canPlacePicks = (picks: Market[]) =>
  picks.some(isFuture)
    ? picks.length <= 10 &&
      (picks.every((p) => p.kind === "future_playoffs")
        ? picks.length >= 2
        : picks.every((p) => p.kind === "future_win_total")
          ? picks.length >= 1
          : picks.length === 1)
    : picks.length >= 2 ||
      (picks.length === 1 &&
        (weeklyKinds.includes(picks[0].kind) ||
          [
            "player_h2h",
            "player_milestone",
            "team_milestone",
            "winning_margin",
          ].includes(picks[0].kind)));
export function specialConflict(a: Market, b: Market) {
  const advanced = [
    "player_h2h",
    "player_milestone",
    "team_milestone",
    "winning_margin",
  ];
  if (
    (advanced.includes(a.kind) || advanced.includes(b.kind)) &&
    a.matchup_key &&
    a.matchup_key === b.matchup_key
  )
    return true;
  const highest =
    a.kind === "weekly_highest_score"
      ? a
      : b.kind === "weekly_highest_score"
        ? b
        : null;
  const related = highest === a ? b : a;
  if (highest && highest.line !== null) {
    if (
      highest.side === "under" &&
      ((related.kind === "weekly_any_200" &&
        related.side === "yes" &&
        highest.line <= 200) ||
        (["team_total", "weekly_average"].includes(related.kind) &&
          related.side === "over" &&
          Number(related.line) >= highest.line) ||
        (related.kind === "weekly_count_150" &&
          Number(related.line) > 0 &&
          highest.line <= 150))
    )
      return true;
    if (
      highest.side === "over" &&
      related.kind === "weekly_any_200" &&
      related.side === "no" &&
      highest.line >= 200
    )
      return true;
  }
  const projectionCount =
    a.kind === "weekly_count_projection"
      ? a
      : b.kind === "weekly_count_projection"
        ? b
        : null;
  const other = projectionCount === a ? b : a;
  if (
    projectionCount &&
    ["team_total", "weekly_average"].includes(other.kind)
  ) {
    const targets = projectionCount.metadata.projection_targets as
      Record<string, number> | undefined;
    const values = Object.values(targets ?? {});
    const target =
      other.kind === "team_total"
        ? targets?.[other.team_id ?? ""]
        : values.reduce((n, v) => n + v, 0) / values.length;
    if (
      target !== undefined &&
      Number.isFinite(target) &&
      ((projectionCount.line === 0 &&
        other.side === "over" &&
        Number(other.line) >= target) ||
        (projectionCount.line ===
          projectionCount.metadata.expected_team_count &&
          other.side === "under" &&
          Number(other.line) <= target))
    )
      return true;
  }
  if (
    (a.kind === "weekly_low" && b.kind === "weekly_high") ||
    (a.kind === "weekly_high" && b.kind === "weekly_low")
  )
    return a.team_id === b.team_id;
  const count =
    a.kind === "weekly_count_150"
      ? a
      : b.kind === "weekly_count_150"
        ? b
        : null;
  const low =
    a.kind === "weekly_any_below_100"
      ? a
      : b.kind === "weekly_any_below_100"
        ? b
        : null;
  if (
    count &&
    low?.side === "yes" &&
    Number(count.line) === Number(count.metadata.expected_team_count ?? 12)
  )
    return true;
  const total =
    a.kind === "team_total" ? a : b.kind === "team_total" ? b : null;
  const special = total === a ? b : a;
  if (total && total.line !== null) {
    if (
      special.kind === "weekly_any_below_100" &&
      special.side === "no" &&
      total.side === "under" &&
      total.line <= 100
    )
      return true;
    if (
      special.kind === "weekly_any_200" &&
      special.side === "no" &&
      total.side === "over" &&
      total.line >= 200
    )
      return true;
    if (
      count &&
      total.side === "under" &&
      total.line <= 150 &&
      Number(count.line) === Number(count.metadata.expected_team_count ?? 12)
    )
      return true;
  }
  return false;
}
export function pickConflict(picks: Market[], next: Market) {
  if (picks.some((p) => p.id === next.id)) return "";
  if (
    picks.length &&
    (isFuture(next) || picks.some(isFuture)) &&
    !(
      ["future_playoffs", "future_win_total"].includes(next.kind) &&
      picks.every((p) => p.kind === next.kind)
    )
  )
    return "League Winner and #1 Pick are standalone bets. Playoff picks and win-total picks each combine only within their own category.";
  if (picks.length >= 10) return "A ticket can contain up to 10 picks.";
  if (picks.some((p) => p.market_key === next.market_key))
    return "Choose only one outcome from this market.";
  if (picks.some((p) => specialConflict(p, next)))
    return "These selections have contradictory outcomes.";
  if (
    next.matchup_key &&
    picks.some(
      (p) =>
        p.matchup_key === next.matchup_key &&
        ((p.kind === "spread" && next.kind === "moneyline") ||
          (p.kind === "moneyline" && next.kind === "spread")),
    )
  )
    return "Spread and moneyline picks from the same matchup cannot be combined.";
  return "";
}
export async function loadMarketBoard(leagueId: string) {
  if (!supabase) throw new Error("The market service is unavailable.");
  const snapshot = await supabase
    .rpc("sportsbook_current_snapshot", {
      p_league: leagueId,
      p_type: "weekly",
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (snapshot.error) throw snapshot.error;
  const week = Number(snapshot.data?.week);
  if (!Number.isInteger(week) || week < 1 || week > 18)
    throw new Error(
      "League period is unavailable. Try refreshing your account.",
    );
  return {
    board: (snapshot.data?.board ?? null) as Board | null,
    markets: (snapshot.data?.markets ?? []) as Market[],
    week,
  };
}

export async function loadFuturesBoard(leagueId: string) {
  if (!supabase) throw new Error("The market service is unavailable.");
  const snapshot = await supabase
    .rpc("sportsbook_current_snapshot", {
      p_league: leagueId,
      p_type: "future",
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (snapshot.error) throw snapshot.error;
  return {
    board: (snapshot.data?.board ?? null) as Board | null,
    markets: (snapshot.data?.markets ?? []) as Market[],
  };
}

export async function placeTicket(
  board: Board,
  picks: Market[],
  stake: number,
  requestId: string,
  promotion?: { id: string; kind: "boost" | "fixed" },
) {
  if (!supabase) throw new Error("The account service is unavailable.");
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Sign in before placing a bet.");
  const response = await fetch("/api/place-bet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify({
      board_id: board.id,
      revision: board.revision,
      picks: picks.map((p) => p.id),
      stake,
      request_id: requestId,
      ...(promotion
        ? { offer_id: promotion.id, offer_kind: promotion.kind }
        : {}),
    }),
  });
  const result = (await response.json()) as {
    error?: string;
    ticket_id: string;
    balance: number;
    email_status: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "Your ticket could not be accepted.");
  return result as { ticket_id: string; balance: number; email_status: string };
}
