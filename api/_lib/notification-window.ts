import type { SupabaseClient } from "@supabase/supabase-js";
export const promotionalKinds = ["opening", "reminder", "reopening"] as const;
export type PromotionalKind = (typeof promotionalKinds)[number];
export const isPromotional = (kind: string): kind is PromotionalKind =>
  promotionalKinds.includes(kind as PromotionalKind);
export interface NotificationWindow {
  contract: "weekly-notification-window-v1";
  league_id: string;
  nfl_season: number;
  market_week: number;
  kind: PromotionalKind;
  eligible: boolean;
  reason: string | null;
  board_id?: string;
  deadline?: string;
  send_before?: string;
  window_key?: string;
  minimum_stake?: number;
  policy_revision?: number;
  reopening_id?: string | null;
  window_type?: "pregame" | "reopening";
}
type Scope = { league_id: string; market_week: number; kind: string };
export function validateNotificationWindow(
  value: unknown,
  scope: Scope,
  season: number,
): NotificationWindow {
  const w = value as NotificationWindow;
  if (
    !w ||
    w.contract !== "weekly-notification-window-v1" ||
    w.league_id !== scope.league_id ||
    w.nfl_season !== season ||
    w.market_week !== scope.market_week ||
    w.kind !== scope.kind ||
    typeof w.eligible !== "boolean" ||
    new TextEncoder().encode(JSON.stringify(w)).length > 2048
  )
    throw Error("Promotional window scope is unavailable.");
  if (
    w.eligible &&
    (!w.board_id ||
      !w.window_key ||
      !/^[a-f0-9]{32}$/.test(w.window_key) ||
      !Number.isFinite(Date.parse(w.deadline ?? "")) ||
      !Number.isFinite(Date.parse(w.send_before ?? "")) ||
      Date.parse(w.send_before!) > Date.parse(w.deadline!) ||
      typeof w.minimum_stake !== "number" ||
      !Number.isFinite(w.minimum_stake) ||
      w.minimum_stake < 1 ||
      w.minimum_stake > 10000 ||
      !Number.isInteger(w.policy_revision) ||
      w.policy_revision! < 0 ||
      w.policy_revision! > 64)
  )
    throw Error("Promotional window contract is incomplete.");
  return w;
}
export async function currentNotificationWindow(
  db: SupabaseClient,
  scope: Scope,
  season: number,
) {
  if (!isPromotional(scope.kind) || !Number.isInteger(season))
    throw Error("Promotional season and purpose are required.");
  const result = await db
    .rpc("notification_window", {
      p_league: scope.league_id,
      p_season: season,
      p_week: scope.market_week,
      p_kind: scope.kind,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (result.error)
    throw Error("Current promotional window could not be verified.");
  return validateNotificationWindow(result.data, scope, season);
}
export function windowRejection(
  row: Scope & { notification_context?: unknown; reopening_id?: string },
  current: NotificationWindow,
  now = Date.now(),
): string | null {
  const bound = row.notification_context as NotificationWindow | undefined;
  if (!bound)
    return "Queued promotion has no verified window; prepare a fresh notification.";
  validateNotificationWindow(bound, row, bound.nfl_season);
  if (!bound.eligible || !current.eligible)
    return (
      "Weekly betting is unavailable: " +
      (current.reason ?? "window unavailable") +
      "."
    );
  if (bound.window_key !== current.window_key)
    return "The betting window or policy changed after this notification was queued.";
  if (
    now >= Date.parse(bound.send_before!) ||
    now >= Date.parse(current.deadline!)
  )
    return "This promotional notification is no longer useful.";
  if (
    row.kind === "reopening" &&
    (bound.reopening_id !== row.reopening_id ||
      current.reopening_id !== row.reopening_id)
  )
    return "The approved reopening changed.";
  return null;
}
