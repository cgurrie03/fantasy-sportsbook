import { supabase } from "./supabase";
export interface League {
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
  team_id: string;
  reason: string;
  balance_before: number | string | null;
  balance_after: number | string;
  created_at: string;
  kind: string;
}
export interface AccountData {
  leagues: League[];
  teams: Team[];
  memberships: Membership[];
  wallets: Wallet[];
  events: Event[];
  ledger: Ledger[];
}
export async function loadAccounts(): Promise<AccountData> {
  if (!supabase) throw new Error("Account Service Is Not Configured.");
  const claim = await supabase.rpc("claim_memberships");
  if (claim.error) throw claim.error;
  const results = await Promise.all([
    supabase.from("leagues").select("*"),
    supabase.from("teams").select("*").order("roster_id"),
    supabase.from("league_memberships").select("*"),
    supabase.from("wallets").select("*"),
    supabase
      .from("balance_events")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("wallet_ledger")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  return {
    leagues: results[0].data as League[],
    teams: results[1].data as Team[],
    memberships: results[2].data as Membership[],
    wallets: results[3].data as Wallet[],
    events: results[4].data as Event[],
    ledger: results[5].data as Ledger[],
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
