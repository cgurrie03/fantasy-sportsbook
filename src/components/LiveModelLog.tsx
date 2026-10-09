import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { LineMovement } from "./LineMovement";
export function LiveModelLog({
  leagueId,
  review = false,
  previewData,
}: {
  leagueId: string;
  review?: boolean;
  previewData?: { runs: any[]; reviews: any[] };
}) {
  const [runs, setRuns] = useState<any[]>([]),
    [reviews, setReviews] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (review || !supabase) return;
    let active = true;
    const load = async () => {
      const [r, v] = await Promise.all([
        supabase!
          .from("live_forecast_runs")
          .select("id,captured_at,market_week,status,model_version,payload")
          .eq("league_id", leagueId)
          .order("captured_at", { ascending: false })
          .limit(20),
        supabase!
          .from("live_model_reviews")
          .select("id,created_at,market_week,report")
          .eq("league_id", leagueId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (!active) return;
      if (r.error || v.error) {
        setError("Live forecast logs are unavailable.");
        return;
      }
      setRuns(r.data ?? []);
      setReviews(v.data ?? []);
      setError("");
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [leagueId, review]);
  const shownRuns = review ? (previewData?.runs ?? []) : runs;
  const shownReviews = review ? (previewData?.reviews ?? []) : reviews;
  const latest =
    review && !previewData
      ? {
          status: "shadow",
          market_week: 5,
          payload: {
            quotes: [],
            limitations: [
              "Experimental clock-based model; live acceptance is disabled.",
            ],
          },
        }
      : shownRuns[0];
  return (
    <section className="live-model-log" aria-label="Live forecast history">
      <h3>Live forecast history</h3>
      <p>
        Shadow forecasts are logged every refresh. Published lines and accepted
        tickets retain their own immutable histories. Live acceptance is
        disabled while the model is being evaluated.
      </p>
      {error ? (
        <p role="status">{error}</p>
      ) : latest ? (
        <p>
          Week {latest.market_week} · {latest.status} ·{" "}
          {latest.payload.quotes?.length ?? 0} matchup forecasts
          {latest.payload.reason ? ` · ${latest.payload.reason}` : ""}
        </p>
      ) : (
        <p>Waiting for the first live shadow cycle.</p>
      )}
      {latest?.payload.limitations?.map((reason: string) => (
        <p key={reason} className="muted">
          {reason}
        </p>
      ))}
      <details>
        <summary>Recent revisions · {shownRuns.length}</summary>
        <table className="execution-balances">
          <thead>
            <tr>
              <th>Checked</th>
              <th>Week</th>
              <th>Status</th>
              <th>Matchups</th>
            </tr>
          </thead>
          <tbody>
            {shownRuns.map((r) => (
              <tr key={r.id}>
                <td>
                  {new Date(r.captured_at).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}{" "}
                  Eastern
                </td>
                <td>{r.market_week}</td>
                <td>{r.status}</td>
                <td>{r.payload.quotes?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {!!latest?.payload.quotes?.length && (
        <details>
          <summary>Latest shadow lines · unavailable for betting</summary>
          <table className="execution-balances">
            <thead>
              <tr>
                <th>Matchup</th>
                <th>Home spread</th>
                <th>Total</th>
                <th>Home odds</th>
                <th>Away odds</th>
              </tr>
            </thead>
            <tbody>
              {latest.payload.quotes.map((q: any) => (
                <tr key={q.matchup_id}>
                  <td>
                    {
                      latest.payload.teams.find(
                        (t: any) => t.team_id === q.home_team_id,
                      )?.name
                    }{" "}
                    vs.{" "}
                    {
                      latest.payload.teams.find(
                        (t: any) => t.team_id === q.away_team_id,
                      )?.name
                    }
                  </td>
                  {[q.spread, q.total, q.home_odds, q.away_odds].map(
                    (value: number, i) => (
                      <td key={i}>
                        {value}
                        <LineMovement
                          value={value}
                          scope={`${leagueId}:${latest.market_week}:${q.matchup_id}:${i}`}
                          live
                        />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <h4>Weekly accuracy review</h4>
      {shownReviews[0] ? (
        <>
          <p>
            Week {shownReviews[0].market_week} ·{" "}
            {shownReviews[0].report.change_decision}
          </p>
          <table className="execution-balances">
            <thead>
              <tr>
                <th>Progress horizon</th>
                <th>Teams</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>Bias</th>
                <th>Brier</th>
              </tr>
            </thead>
            <tbody>
              {shownReviews[0].report.horizons.map((h: any) => (
                <tr key={h.horizon}>
                  <td>
                    {h.horizon * 25}–{(h.horizon + 1) * 25}%
                  </td>
                  <td>{h.team_count}</td>
                  {[h.mae, h.rmse, h.bias, h.brier].map((v, i) => (
                    <td key={i}>
                      {typeof v === "number" ? v.toFixed(2) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{shownReviews[0].report.methodology}</p>
        </>
      ) : (
        <p>
          Runs after the NFL week is final, with daily correction checks during
          the following week. No automatic model changes.
        </p>
      )}
    </section>
  );
}
