import type { SupabaseClient } from "@supabase/supabase-js";
export const routineKinds = [
  "opening",
  "reminder",
  "recap",
  "monday_watch",
  "reopening",
] as const;
export const isRoutine = (kind: string) =>
  routineKinds.includes(kind as (typeof routineKinds)[number]);
export interface RoutineContext {
  contract: "routine-composition-v1";
  league_id: string;
  user_id: string;
  nfl_season: number;
  period_start: string;
  kind: string;
  merge_watch: boolean;
  include_details?: boolean;
  open_ticket_count: number;
  prepared_at: string;
  recap?: RecapSnapshot;
}
const recapStates = [
  "credited",
  "no_topup_needed",
  "funding_pending",
  "results_pending",
  "review_pending",
  "weekly_calendar_complete",
] as const;
export interface RecapSnapshot {
  state: (typeof recapStates)[number];
  credited: number | null;
}
export function validRecapSnapshot(value: unknown): value is RecapSnapshot {
  const c = value as RecapSnapshot;
  return (
    !!c &&
    recapStates.includes(c.state) &&
    (c.credited === null ||
      (typeof c.credited === "number" &&
        Number.isFinite(c.credited) &&
        c.credited >= 0)) &&
    ((c.state === "credited" && c.credited !== null && c.credited > 0) ||
      (c.state === "no_topup_needed" && c.credited === 0) ||
      (!["credited", "no_topup_needed"].includes(c.state) &&
        c.credited === null))
  );
}
export async function recapSnapshot(
  db: SupabaseClient,
  row: {
    league_id: string;
    team_id: string;
    recipient: string;
    market_week: number;
  },
  season: number,
): Promise<RecapSnapshot> {
  const r = await db
    .rpc("recap_financial_context", {
      p_league: row.league_id,
      p_team: row.team_id,
      p_recipient: row.recipient,
      p_season: season,
      p_week: row.market_week + 1,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (
    r.error ||
    r.data?.league_id !== row.league_id ||
    r.data?.team_id !== row.team_id ||
    r.data?.recipient !== row.recipient ||
    r.data?.nfl_season !== season ||
    r.data?.replenishment_week !== row.market_week + 1 ||
    r.data?.ready !== true ||
    !validRecapSnapshot(r.data)
  )
    throw Error("Recorded recap credit or pending state is unavailable.");
  return { state: r.data.state, credited: r.data.credited };
}
export type RoutinePermission =
  | { allowed: false; reason: string }
  | { allowed: true; context: RoutineContext };
export async function routinePermission(
  db: SupabaseClient,
  row: { id: string; league_id: string; kind: string },
  commit: boolean,
): Promise<RoutinePermission> {
  const r = await db
    .rpc("routine_delivery_permission", { p_email: row.id, p_commit: commit })
    .abortSignal(AbortSignal.timeout(15000));
  if (r.error)
    throw Error(
      "Routine notification preferences and budget could not be verified.",
    );
  if (
    r.data?.allowed === false &&
    typeof r.data.reason === "string" &&
    r.data.reason.length <= 256
  )
    return r.data;
  const c = r.data?.context as RoutineContext;
  if (
    r.data?.allowed !== true ||
    !c ||
    c.contract !== "routine-composition-v1" ||
    c.league_id !== row.league_id ||
    c.kind !== row.kind ||
    typeof c.user_id !== "string" ||
    !c.user_id ||
    c.user_id.length > 64 ||
    !Number.isInteger(c.nfl_season) ||
    c.nfl_season < 1900 ||
    c.nfl_season > 2200 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(c.period_start) ||
    typeof c.merge_watch !== "boolean" ||
    (c.include_details !== undefined && typeof c.include_details !== "boolean") ||
    !Number.isInteger(c.open_ticket_count) ||
    c.open_ticket_count < 0 ||
    c.open_ticket_count > 10000 ||
    !Number.isFinite(Date.parse(c.prepared_at)) ||
    (row.kind === "recap" && !validRecapSnapshot(c.recap)) ||
    new TextEncoder().encode(JSON.stringify(c)).length > 512
  )
    throw Error("Routine notification permission scope is invalid.");
  return { allowed: true, context: c };
}
