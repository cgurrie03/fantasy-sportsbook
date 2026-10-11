import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Ticket, TicketLeg } from "../lib/accounts";
import { legProgress } from "../../api/_lib/ticket-progress";
export function useTicketProgress(
  leagueId: string | undefined,
  tickets: Ticket[],
) {
  const [state, setState] = useState<{
    rows: any[];
    loading: boolean;
    error: boolean;
    now: number;
  }>({ rows: [], loading: false, error: false, now: 0 });
  const signature = tickets
    .filter((t) => t.status === "OPEN" && t.ticket_type !== "future")
    .map((t) => `${t.nfl_season}:${t.market_week}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!leagueId || !signature || !supabase) return;
    let cancelled = false,
      pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      setState((s) => ({ ...s, loading: true, now: Date.now() }));
      try {
        const r = await supabase!
          .from("ticket_score_observations")
          .select(
            "league_id,nfl_season,market_week,fetched_at,cadence_minutes,payload",
          )
          .eq("league_id", leagueId);
        if (r.error) throw r.error;
        if (!cancelled)
          setState({
            rows: r.data ?? [],
            loading: false,
            error: false,
            now: Date.now(),
          });
      } catch {
        if (!cancelled)
          setState((s) => ({ ...s, loading: false, error: true }));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [leagueId, signature]);
  return state;
}
export function observedLegProgress(leg: TicketLeg, row: any) {
  if (!row || leg.status !== "OPEN" || !leg.settlement_context)
    return undefined;
  if (!row.payload?.teams || !row.payload?.players)
    return "Current scores unavailable";
  return (
    legProgress(
      {
        id: leg.id,
        accepted_line: leg.accepted_line ?? null,
        settlement_context: leg.settlement_context,
      },
      row.payload,
    ) ?? "Current score unavailable · awaiting participation data"
  );
}
export function TicketProgressNotice({
  row,
  loading,
  error,
  now,
}: {
  row: any;
  loading: boolean;
  error: boolean;
  now: number;
}) {
  if (!row)
    return (
      <small className="ticket-progress-notice">
        {loading
          ? "↻ Checking scores…"
          : "Current scores awaiting scheduled update"}
      </small>
    );
  const stale =
    now - Date.parse(row.fetched_at) > row.cadence_minutes * 60000 + 180000;
  return (
    <small className="ticket-progress-notice" role="status">
      {loading ? "↻ " : ""}Updates every{" "}
      {row.cadence_minutes === 15 ? "15 minutes" : "2 hours"} · Checked{" "}
      {new Date(row.fetched_at).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      })}{" "}
      ET{stale || error ? " · Update delayed" : ""}
      <span> Scores are provisional until settlement.</span>
    </small>
  );
}
