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
  sportsbook_owner_id: string | null;
  sportsbook_owner_name: string;
  co_owner_names: string[];
  avatar_url: string | null;
  wins: number;
  losses: number;
  ties: number;
}
export interface Membership {
  wallet_id?: string;
  id: string;
  league_id: string;
  team_id: string;
  user_id: string | null;
  invited_email: string;
  display_name: string;
  role: "admin" | "member";
}
export interface Wallet {
  wallet_id?: string;
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
export interface LeagueAccess {
  wallet_model?: "legacy" | "user";
  participant?: FinancialParticipant | null;
  league_id: string;
  view: boolean;
  admin: boolean;
  configure: boolean;
  platform_owner: boolean;
  bet: boolean;
  team_id: string | null;
}
export interface FinancialParticipant extends Membership {
  wallet_id: string;
  balance: number | string | null;
  source: "financial";
}
export interface AccountData {
  viewer_participants?: FinancialParticipant[];
  access?: LeagueAccess[];
  history_revision?: number;
  betting_totals?: BettingTotal[];
  betting_scope?: {
    leagueId: string;
    season: number | null;
    week: number | null;
  };
  betting_error?: string;
  history_remote?: boolean;
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
  wallet_id?: string;
  team_id: string;
  placed: number;
  settled: number;
  stake: number;
  profit: number;
  roi: number | null;
  open: number;
  open_future: number;
  open_count: number;
  open_weekly_count: number;
  all_stake: number;
}
export interface TicketPromotion {
  ticket_id: string;
  kind: "boost" | "fixed";
  boost_pct: number | string;
  base_decimal: number | string;
}
export interface Ticket {
  user_wallet_id?: string | null;
  bettor_display_name?: string | null;
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
  options: {
    leagueId?: string;
    claim?: boolean;
    coreOnly?: boolean;
    signal?: AbortSignal;
    history?: "tickets" | "balance" | "aggregate" | "none";
  } = {},
): Promise<AccountData> {
  if (!supabase) throw new Error("Account Service Is Not Configured.");
  const signal = options.signal ?? AbortSignal.timeout(30000);
  if (options.claim) {
    const claim = await supabase.rpc("claim_memberships").abortSignal(signal);
    if (claim.error) throw claim.error;
  }
  // Directory reads are small and explicit. Financial detail belongs to scoped page RPCs.
  const core = await Promise.all([
    supabase
      .from("leagues")
      .select(
        "id,name,league_season,nfl_season,avatar_url,sleeper_league_id,sportsbook_url,email_sender,operations_enabled",
      )
      .order("id")
      .limit(129)
      .abortSignal(signal),
    supabase
      .from("teams")
      .select(
        "id,league_id,roster_id,team_name,sportsbook_owner_id,sportsbook_owner_name,co_owner_names,avatar_url,wins,losses,ties",
      )
      .order("roster_id")
      .order("id")
      .limit(513)
      .abortSignal(signal),
    supabase
      .from("league_memberships")
      .select("id,league_id,team_id,user_id,invited_email,display_name,role")
      .order("league_id")
      .order("id")
      .limit(513)
      .abortSignal(signal),
    supabase
      .from("wallets")
      .select("team_id,balance")
      .order("team_id")
      .limit(513)
      .abortSignal(signal),
    supabase.rpc("account_access").abortSignal(signal),
  ]);
  for (const result of core) if (result.error) throw result.error;
  if (core.slice(0,4).some((r) => !Array.isArray(r.data)))
    throw new Error("Account directory response is incomplete.");
  signal.throwIfAborted();
  if (
    core.some(
      (r, i) => (r.data?.length ?? 0) > (i === 0 || i === 4 ? 128 : 512),
    ) ||
    new TextEncoder().encode(JSON.stringify(core.map((r) => r.data))).length >
      524288
  )
    throw new Error(
      "Account directory exceeds its read budget. Contact the league administrator.",
    );
  const leagueId = options.leagueId ?? core[0].data?.[0]?.id;
  if (options.leagueId && !core[0].data?.some((l) => l.id === options.leagueId))
    throw new Error("League access is no longer available.");
  if (
    !Array.isArray(core[4].data) ||
    core[4].data.length !== core[0].data?.length ||
    new Set(core[4].data.map((a: LeagueAccess) => a.league_id)).size !==
      core[0].data?.length ||
    core[4].data.some(
      (a: LeagueAccess) =>
        !core[0].data?.some((l) => l.id === a.league_id) ||
        a.view !== true ||
        typeof a.admin !== "boolean" ||
        typeof a.configure !== "boolean" ||
        typeof a.bet !== "boolean" ||
        typeof a.platform_owner !== "boolean" ||
        (a.team_id !== null && typeof a.team_id !== "string"),
    )
  )
    throw new Error("League access could not be verified.");
  const access = core[4].data as LeagueAccess[];
  const participants = access.flatMap((a) => a.participant ? [a.participant] : []);
  if (participants.some((p) => typeof p !== "object" || p.source !== "financial" ||
      typeof p.id !== "string" || p.wallet_id !== p.id || typeof p.user_id !== "string" ||
      p.role !== "member" || typeof p.display_name !== "string" || !p.display_name.trim() || p.display_name.length > 80 ||
      (p.balance !== null && !Number.isFinite(Number(p.balance))) ||
      !access.some((a) => a.wallet_model === "user" && a.league_id === p.league_id && a.team_id === p.team_id) ||
      !(core[1].data as Team[]).some((t) => t.id === p.team_id && t.league_id === p.league_id)))
    throw new Error("Financial participant scope could not be verified.");
  const financialLeagues = new Set(access.filter((a) => a.wallet_model === "user").map((a) => a.league_id));
  const financialTeams = new Set((core[1].data as Team[]).filter((t) => financialLeagues.has(t.league_id)).map((t) => t.id));
  const snapshot: AccountData = {
    access,
    viewer_participants: participants,
    leagues: core[0].data as League[],
    teams: core[1].data as Team[],
    memberships: core[2].data as Membership[],
    wallets: [ ...(core[3].data as Wallet[]).filter((w) => !financialTeams.has(w.team_id)),
      ...participants.map((p) => ({team_id:p.team_id,wallet_id:p.wallet_id,balance:p.balance})) ],
    events: [],
    ledger: [],
    tickets: [],
    legs: [],
    ticketPromotions: [],
    history_remote: true,
    history_league_id: options.coreOnly ? undefined : leagueId,
    history_loading: false,
    history_revision:
      previous?.history_league_id === leagueId
        ? (previous?.history_revision ?? 0) + 1
        : 0,
  };
  if (options.coreOnly || !leagueId || options.history !== "aggregate")
    return snapshot;
  const prior = previous?.history_league_id === leagueId ? previous : undefined;
  const previousScope = prior?.betting_scope;
  const cached =
    previousScope &&
    previousScope.leagueId === leagueId &&
    previousScope.season === null &&
    previousScope.week === null
      ? prior?.betting_totals
      : undefined;
  onCore?.({
    ...snapshot,
    history_revision: previous?.history_revision ?? 0,
    betting_totals: cached,
    betting_scope: { leagueId, season: null, week: null },
    history_loading: true,
  });
  const totals = await supabase
    .rpc(access.find((a) => a.league_id === leagueId)?.wallet_model === "user" ? "account_personal_totals" : "account_betting_totals", {
      p_league: leagueId,
      p_season: null,
      p_week: null,
    })
    .abortSignal(signal);
  signal.throwIfAborted();
  const valid =
    !totals.error &&
    Array.isArray(totals.data) &&
    totals.data.length <= 128 &&
    totals.data.every(
      (t: BettingTotal) =>
        snapshot.teams.some(
          (team) => team.league_id === leagueId && team.id === t.team_id,
        ) &&
        Number.isFinite(t.open) &&
        Number.isFinite(t.stake) &&
        Number.isFinite(t.open_future),
    );
  return {
    ...snapshot,
    betting_scope: { leagueId, season: null, week: null },
    betting_totals: valid ? (totals.data as BettingTotal[]) : cached,
    betting_error: valid
      ? undefined
      : "Betting totals could not refresh. Try refreshing your account.",
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
