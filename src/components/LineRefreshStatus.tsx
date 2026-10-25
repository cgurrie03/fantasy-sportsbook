import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { safeJobDetail } from "../lib/execution-health";
export function LineRefreshStatus({
  leagueId,
  review = false,
  admin = false,
}: {
  leagueId: string;
  review?: boolean;
  admin?: boolean;
}) {
  const [status, setStatus] = useState<any>(null);
  const [scores, setScores] = useState<any>(null);
  const [shadow, setShadow] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const loadedLeague = useRef(leagueId);
  useEffect(() => {
    if (!admin || review || !supabase) return;
    let active = true,
      pending = false;
    if (loadedLeague.current !== leagueId) {
      loadedLeague.current = leagueId;
      setStatus(null);
      setScores(null);
      setShadow(null);
    }
    setErrors([]);
    setLoading(true);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const [runtime, observations, forecasts] = await Promise.all([
          supabase!
            .from("line_refresh_runtime")
            .select("*")
            .eq("league_id", leagueId)
            .maybeSingle(),
          supabase!
            .from("ticket_score_observations")
            .select("fetched_at,cadence_minutes,market_week")
            .eq("league_id", leagueId)
            .order("fetched_at", { ascending: false })
            .limit(1),
          supabase!
            .from("live_forecast_runs")
            .select("captured_at,status,market_week")
            .eq("league_id", leagueId)
            .order("captured_at", { ascending: false })
            .limit(1),
        ]);
        if (!active) return;
        const failed = [];
        if (runtime.error) failed.push("Scheduler");
        else setStatus(runtime.data);
        if (observations.error) failed.push("Scores");
        else setScores(observations.data?.[0] ?? null);
        if (forecasts.error) failed.push("Shadow forecasts");
        else setShadow(forecasts.data?.[0] ?? null);
        setErrors(failed);
        setClock(Date.now());
      } catch {
        if (active) setErrors(["Operating status"]);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [leagueId, review, admin, retry]);
  if (!admin) return null;
  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }) + " ET"
      : "Not recorded";
  const delayed = (value: string | undefined, minutes: number) =>
    value && clock - Date.parse(value) > (minutes + 3) * 60000;
  const liveEnabled = Object.values(status?.live_families ?? {}).some(Boolean);
  return (
    <section className="line-refresh-status" aria-label="Line updates">
      <h3>Scores, forecasts and prices</h3>
      {review ? (
        <p>Sample operating status. Live betting is disabled.</p>
      ) : loading && !status ? (
        <p role="status">Checking update status…</p>
      ) : (
        <>
          <p>
            <strong>Score refresh</strong>:{" "}
            {errors.includes("Scores") ? (
              "status unavailable"
            ) : scores ? (
              <>
                Week {scores.market_week} · {time(scores.fetched_at)} · every{" "}
                {scores.cadence_minutes === 15 ? "15 minutes" : "2 hours"}
                {delayed(scores.fetched_at, scores.cadence_minutes)
                  ? " · Update overdue"
                  : ""}
              </>
            ) : (
              "Awaiting the first score update"
            )}
          </p>
          <p>
            <strong>Shadow forecasts</strong>:{" "}
            {errors.includes("Shadow forecasts") ? (
              "status unavailable"
            ) : shadow ? (
              <>
                Week {shadow.market_week} · {time(shadow.captured_at)} ·{" "}
                {shadow.status}
                {delayed(shadow.captured_at, status?.interval_minutes ?? 120)
                  ? " · Update overdue"
                  : ""}
              </>
            ) : (
              "No recent forecast recorded"
            )}
            . Unavailable for betting.
          </p>
          <p>
            <strong>Published prices</strong>: {time(status?.last_success_at)}.{" "}
            {liveEnabled
              ? "Live pricing enabled for approved markets."
              : "Live betting disabled; published prices are separate from shadow forecasts."}
          </p>
          <p>
            <strong>Scheduler</strong>:{" "}
            {errors.includes("Scheduler") ? (
              "status unavailable"
            ) : status ? (
              <>
                Checked {time(status.observed_at)} · next due{" "}
                {time(status.next_due_at)}
                {status.next_due_at &&
                clock - Date.parse(status.next_due_at) > 5 * 60000
                  ? " · Overdue"
                  : ""}
              </>
            ) : (
              "No status recorded"
            )}
            .
          </p>
          {status?.last_error && (
            <p role="status">{safeJobDetail(status.last_error)}</p>
          )}
          {errors.length > 0 && (
            <p role="status">
              Could not refresh: {errors.join(", ")}. Last successful data
              remains visible.{" "}
              <button onClick={() => setRetry((v) => v + 1)}>
                Retry update status
              </button>
            </p>
          )}
          {status && (
            <p className="history-note">
              Cadence: every{" "}
              {status.interval_minutes === 15
                ? "15 minutes during games"
                : "2 hours outside games"}
              . Live markets:{" "}
              {Object.entries(status.live_families ?? {})
                .map(
                  ([family, enabled]) =>
                    `${family} ${enabled ? "enabled" : "disabled"}`,
                )
                .join(" · ") || "not configured"}
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}
