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
}
export const marketType = {
  spread: "Spread",
  moneyline: "Moneyline",
  match_total: "Match Total",
  team_total: "Team Total",
  player_points: "Player Points",
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
  future_first_pick: "#1 Pick",
};
export const futureKinds = [
  "future_champion",
  "future_playoffs",
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
      (picks.length === 1 || picks.every((p) => p.kind === "future_playoffs"))
    : picks.length >= 2 ||
      (picks.length === 1 && weeklyKinds.includes(picks[0].kind));
export function specialConflict(a: Market, b: Market) {
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
      next.kind === "future_playoffs" &&
      picks.every((p) => p.kind === "future_playoffs")
    )
  )
    return "League Winner and #1 Pick are standalone bets. Playoff picks can combine only with other playoff picks.";
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
  const period = await supabase.rpc("sportsbook_period", {
    p_league: leagueId,
  });
  if (period.error) throw period.error;
  const week = Number(period.data?.[0]?.week ?? 5);
  const boards = await supabase
    .from("sportsbook_boards")
    .select("*")
    .eq("league_id", leagueId)
    .eq("board_type", "weekly")
    .eq("market_week", week)
    .order("nfl_season", { ascending: false })
    .limit(1);
  if (boards.error) throw boards.error;
  const board = boards.data?.[0] as Board | undefined;
  if (!board) return { board: null, markets: [], week };
  const quotes = await supabase
    .from("sportsbook_markets")
    .select("*")
    .eq("board_id", board.id)
    .eq("active", true);
  if (quotes.error) throw quotes.error;
  return { board, markets: quotes.data as Market[], week };
}

export async function loadFuturesBoard(leagueId: string) {
  if (!supabase) throw new Error("The market service is unavailable.");
  const response = await supabase
    .from("sportsbook_boards")
    .select("*")
    .eq("league_id", leagueId)
    .eq("board_type", "future")
    .order("nfl_season", { ascending: false })
    .limit(1);
  if (response.error) throw response.error;
  const board = response.data?.[0] as Board | undefined;
  if (!board) return { board: null, markets: [] as Market[] };
  const quotes = await supabase
    .from("sportsbook_markets")
    .select("*")
    .eq("board_id", board.id)
    .eq("active", true);
  if (quotes.error) throw quotes.error;
  return { board, markets: quotes.data as Market[] };
}

export async function placeTicket(
  board: Board,
  picks: Market[],
  stake: number,
  requestId: string,
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
