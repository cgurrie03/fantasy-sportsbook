import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
export function LineRefreshStatus({
  leagueId,
  review = false,
  admin = false,
}: {
  leagueId: string;
  review?: boolean;
  admin?: boolean;
}) {
  const [status, setStatus] = useState<any>(
    review
      ? {
          any_in_progress: true,
          interval_minutes: 15,
          last_error:
            "Live pricing unavailable: observed starter points and a validated remaining-points model are required.",
          live_families: {
            matchups: false,
            players: false,
            specials: false,
            futures: false,
          },
        }
      : null,
  );
  useEffect(() => {
    if (!admin || review || !supabase) return;
    let active = true;
    const load = async () => {
      const r = await supabase!
        .from("line_refresh_runtime")
        .select("*")
        .eq("league_id", leagueId)
        .maybeSingle();
      if (active && !r.error) setStatus(r.data);
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [leagueId, review, admin]);
  if (!admin)
    return (
      <p className="line-updates-coming-soon">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 17l6-6 4 3 8-10M15 4h6v6" />
        </svg>
        <span>Live line updates are in development and coming soon</span>
      </p>
    );
  const time = (v: string | null) =>
    v
      ? new Date(v).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }) + " Eastern"
      : "Awaiting successful refresh";
  return (
    <section className="line-refresh-status" aria-label="Line updates">
      <strong>
        {status?.any_in_progress
          ? "NFL games in progress"
          : "Automatic line updates"}
      </strong>
      <span>
        Every{" "}
        {status?.interval_minutes === 15
          ? "15 minutes during games"
          : "2 hours when no NFL game is in progress"}
      </span>
      {status?.last_error && <p role="status">{status.last_error}</p>}
      {!status && (
        <p>
          Waiting for scheduler status. Live betting is unavailable until
          pricing checks pass.
        </p>
      )}
      {admin && status && (
        <>
          <span>Last publication: {time(status.last_success_at)}</span>
          <span>Next due: {time(status.next_due_at)}</span>
          <span>Status checked: {time(status.observed_at)}</span>
          <span>
            Live families:{" "}
            {Object.entries(status.live_families ?? {})
              .map(
                ([family, enabled]) =>
                  `${family}: ${enabled ? "enabled" : "disabled"}`,
              )
              .join(" · ")}
          </span>
        </>
      )}
    </section>
  );
}
