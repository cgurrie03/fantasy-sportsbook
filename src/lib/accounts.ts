import { supabase } from "./supabase";
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
  history_revision?:number;
  betting_totals?:BettingTotal[];
  betting_scope?:{leagueId:string;season:number|null;week:number|null};
  betting_error?:string;
  history_remote?:boolean;
  history_league_id?: string;
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
export interface BettingTotal {
  team_id:string;placed:number;settled:number;stake:number;profit:number;roi:number|null;
  open:number;open_future:number;open_count:number;open_weekly_count:number;all_stake:number;
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
export async function loadAccounts(
  previous?: AccountData,
  onCore?: (data: AccountData) => void,
  options: {leagueId?:string;claim?:boolean;coreOnly?:boolean;signal?:AbortSignal;history?:'tickets'|'balance'|'aggregate'|'none'} = {},
): Promise<AccountData> {
  if (!supabase) throw new Error("Account Service Is Not Configured.");
  const signal=options.signal??AbortSignal.timeout(30000);
  if(options.claim){
    const claim=await supabase.rpc('claim_memberships').abortSignal(signal);
    if(claim.error)throw claim.error;
  }
  // Directory reads are small and explicit. Financial detail belongs to scoped page RPCs.
  const core=await Promise.all([
    supabase.from('leagues').select('id,name,league_season,nfl_season,avatar_url,sleeper_league_id,sportsbook_url,email_sender,operations_enabled').order('id').limit(129).abortSignal(signal),
    supabase.from('teams').select('id,league_id,roster_id,team_name,sportsbook_owner_id,sportsbook_owner_name,co_owner_names,avatar_url,wins,losses,ties').order('roster_id').order('id').limit(513).abortSignal(signal),
    supabase.from('league_memberships').select('id,league_id,team_id,user_id,invited_email,display_name,role').order('league_id').order('id').limit(513).abortSignal(signal),
    supabase.from('wallets').select('team_id,balance').order('team_id').limit(513).abortSignal(signal),
  ]);
  for(const result of core)if(result.error)throw result.error;
  signal.throwIfAborted();
  if(core.some((r,i)=>(r.data?.length??0)>(i===0?128:512))||new TextEncoder().encode(JSON.stringify(core.map(r=>r.data))).length>524288)
    throw new Error('Account directory exceeds its read budget. Contact the league administrator.');
  const leagueId=options.leagueId??core[0].data?.[0]?.id;
  if(options.leagueId&&!core[0].data?.some(l=>l.id===options.leagueId))throw new Error('League access is no longer available.');
  const snapshot:AccountData={leagues:core[0].data as League[],teams:core[1].data as Team[],memberships:core[2].data as Membership[],wallets:core[3].data as Wallet[],
    events:[],ledger:[],tickets:[],legs:[],ticketPromotions:[],history_remote:true,
    history_league_id:options.coreOnly?undefined:leagueId,history_loading:false,
    history_revision:previous?.history_league_id===leagueId?(previous?.history_revision??0)+1:0};
  if(options.coreOnly||!leagueId||options.history!=='aggregate')return snapshot;
  const prior=previous?.history_league_id===leagueId?previous:undefined;
  const previousScope=prior?.betting_scope;
  const cached=previousScope&&previousScope.leagueId===leagueId&&previousScope.season===null&&previousScope.week===null?prior?.betting_totals:undefined;
  onCore?.({...snapshot,history_revision:previous?.history_revision??0,betting_totals:cached,betting_scope:{leagueId,season:null,week:null},history_loading:true});
  const totals=await supabase.rpc('account_betting_totals',{p_league:leagueId,p_season:null,p_week:null}).abortSignal(signal);
  signal.throwIfAborted();
  const valid=!totals.error&&Array.isArray(totals.data)&&totals.data.length<=128&&totals.data.every((t:BettingTotal)=>
    snapshot.teams.some(team=>team.league_id===leagueId&&team.id===t.team_id)&&Number.isFinite(t.open)&&Number.isFinite(t.stake)&&Number.isFinite(t.open_future));
  return {...snapshot,betting_scope:{leagueId,season:null,week:null},betting_totals:valid?totals.data as BettingTotal[]:cached,
    betting_error:valid?undefined:'Betting totals could not refresh. Try refreshing your account.'};
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
