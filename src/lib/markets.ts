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
    | "weekly_any_200";
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
};
export const weeklyKinds = [
  "weekly_high",
  "weekly_low",
  "weekly_count_150",
  "weekly_any_below_100",
  "weekly_any_200",
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
  picks.length >= 2 ||
  (picks.length === 1 && weeklyKinds.includes(picks[0].kind));
export function specialConflict(a: Market, b: Market) {
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
