import { supabase } from "./supabase";
import { readAllRows } from "./pagination";
export interface League {
  sportsbook_url?: string | null;
  email_sender?: string | null;
  operations_enabled?: boolean;
  sleeper_league_id?: string;
  id: string;
  name: string;
  league_season: number;
  nfl_season: number;
  avatar_url: string | null;
}
export interface Team {
  id: string;
  league_id: string;
  roster_id: number;
  team_name: string;
  sportsbook_owner_id: string;
  sportsbook_owner_name: string;
  co_owner_names: string[];
  avatar_url: string | null;
  wins: number;
  losses: number;
  ties: number;
}
export interface Membership {
  id: string;
  league_id: string;
  team_id: string;
  user_id: string | null;
  invited_email: string;
  display_name: string;
  role: "admin" | "member";
}
export interface Wallet {
  team_id: string;
  balance: number | string | null;
}
export interface Event {
  id: string;
  team_id: string;
  reason: string;
  previous_balance: number | string | null;
  new_balance: number | string;
  created_at: string;
  kind: string;
}
export interface Ledger {
  id: string;
  ticket_id?: string | null;
  source_batch?: string | null;
  team_id: string;
  reason: string;
  balance_before: number | string | null;
  balance_after: number | string;
  created_at: string;
  kind: string;
}
export interface AccountData {
  history_loading?: boolean;
  history_error?: string;
  leagues: League[];
  teams: Team[];
  memberships: Membership[];
  wallets: Wallet[];
  events: Event[];
  ledger: Ledger[];
  tickets?: Ticket[];
  legs?: TicketLeg[];
  ticketPromotions?: TicketPromotion[];
}
export interface TicketPromotion {
  ticket_id: string;
  kind: "boost" | "fixed";
  boost_pct: number | string;
  base_decimal: number | string;
}
export interface Ticket {
  nfl_season?: number;
  id: string;
  league_id: string;
  team_id: string;
  legacy_ticket_id: string | null;
  placement_week: number;
  market_week: number;
  placed_at: string;
  settled_at: string | null;
  stake: number | string;
  accepted_combined_odds: number;
  ticket_type?: string;
  accepted_potential_payout?: number | string;
  actual_payout: number | string;
  status: string;
}
export interface TicketLeg {
  id: string;
  ticket_id: string;
  leg_number: number;
  selection: string;
  market_type: string;
  market_kind?: string | null;
  accepted_line?: number | string | null;
  settlement_context?: import("../../api/_lib/settlement").LegInput["settlement_context"];
  subject_team_id?: string | null;
  actual_value?: number | string | null;
  result_evidence?: string;
  matchup: string | null;
  status: string;
}
export async function loadAccounts(previous?: AccountData, onCore?: (data: AccountData) => void): Promise<AccountData> {
  if (!supabase) throw new Error("Account Service Is Not Configured.");
  const claim = await supabase.rpc("claim_memberships");
  if (claim.error) throw claim.error;
  const queries = [
    supabase.from("leagues").select("*"),
    supabase.from("teams").select("*").order("roster_id"),
    supabase.from("league_memberships").select("*"),
    supabase.from("wallets").select("*"),
    readAllRows((from, to) =>
      supabase!
        .from("balance_events")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase!
        .from("tickets")
        .select(
          "id,league_id,nfl_season,team_id,legacy_ticket_id,placement_week,market_week,placed_at,settled_at,stake,accepted_combined_odds,ticket_type,accepted_potential_payout,actual_payout,status",
        )
        .order("placed_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase!
        .from("ticket_legs")
        .select(
          "id,ticket_id,leg_number,selection,market_type,matchup,status,actual_value,result_evidence,accepted_line,settlement_context,market_kind:settlement_context->>kind,subject_team_id:settlement_context->>team_id",
        )
        .order("leg_number")
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase!
        .from("wallet_ledger")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase!
        .from("ticket_promotions")
        .select("ticket_id,kind,boost_pct,base_decimal")
        .order("ticket_id")
        .range(from, to),
    ),
  ].map(query => Promise.resolve(query).catch(error => ({data:null,error})));
  const core = await Promise.all(queries.slice(0,4));
  for (const result of core) if (result.error) throw result.error;
  onCore?.({
    ...previous,
    leagues: core[0].data as League[], teams: core[1].data as Team[],
    memberships: core[2].data as Membership[], wallets: core[3].data as Wallet[],
    events: previous?.events ?? [], ledger: previous?.ledger ?? [],
    tickets: previous?.tickets ?? [], legs: previous?.legs ?? [],
    ticketPromotions: previous?.ticketPromotions ?? [], history_loading:true,
  });
  const results = await Promise.all(queries);
  const ticketFailure = !!(results[5].error || results[6].error || results[8].error);
  const historyFailure = ticketFailure || !!(results[4].error || results[7].error);
  if (historyFailure) console.error("Account history refresh failed", results.slice(4).map(r => r.error));
  return {
    history_loading:false,
    history_error:historyFailure ? "History could not refresh. Showing the last available records." : undefined,
    leagues: results[0].data as League[],
    teams: results[1].data as Team[],
    memberships: results[2].data as Membership[],
    wallets: results[3].data as Wallet[],
    events: (results[4].error ? previous?.events ?? [] : results[4].data) as Event[],
    ledger: (results[7].error ? previous?.ledger ?? [] : results[7].data) as Ledger[],
    tickets: (ticketFailure ? previous?.tickets ?? [] : results[5].data) as Ticket[],
    legs: (ticketFailure ? previous?.legs ?? [] : results[6].data) as TicketLeg[],
    ticketPromotions: (ticketFailure ? previous?.ticketPromotions ?? [] : results[8].data) as TicketPromotion[],
  };
}
export const money = (value: number | string | null | undefined) =>
  value == null
    ? "Not Set"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(value));
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Could Not Complete This Action. Please Try Again.";
