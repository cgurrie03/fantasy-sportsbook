import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
const value = (v: number | null | undefined) =>
  v == null ? "—" : v.toFixed(2);
export function ModelReview({
  leagueId,
  preview,
}: {
  leagueId: string;
  preview?: any;
}) {
  const [review, setReview] = useState<any>(preview ?? null),
    [control, setControl] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (preview || !supabase) return;
    let cancelled = false;
    void Promise.all([
      supabase
        .from("model_weekly_reviews")
        .select("*")
        .eq("league_id", leagueId)
        .order("nfl_season", { ascending: false })
        .order("market_week", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("model_controls")
        .select("*")
        .eq("league_id", leagueId)
        .single(),
      supabase
        .from("model_change_events")
        .select("*")
        .eq("league_id", leagueId)
        .order("id", { ascending: false })
        .limit(8),
    ]).then(([r, c, e]) => {
      if (cancelled) return;
      if (r.error || c.error || e.error) {
        setNotice(
          "Model review unavailable. Retry after the assessment service recovers.",
        );
        return;
      }
      setReview(r.data?.[0] ?? null);
      setControl(c.data);
      setEvents(e.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [leagueId, preview]);
  const action = async (kind: string) => {
    if (!supabase) return;
    setBusy(true);
    setNotice("");
    const r = await supabase.rpc("control_model", {
      p_league: leagueId,
      p_action: kind,
      p_reason:
        kind === "rollback"
          ? "Administrator restored the previous configuration and paused improvement."
          : `Administrator requested automatic improvement ${kind}.`,
      p_expected: control.active_id,
    });
    if (r.error) setNotice(errorMessage(r.error));
    else {
      setControl({ ...control, active_id: r.data, paused: kind !== "resume" });
      setNotice(
        kind === "rollback"
          ? "Previous configuration restored. Improvement paused."
          : `Automatic improvement ${kind === "pause" ? "paused" : "resumed"}.`,
      );
    }
    setBusy(false);
  };
  const r = review?.report,
    c = review?.comparison;
  return (
    <section className="model-review" aria-label="This Week's Model Review">
      <div className="model-review-header">
        <h3>This Week’s Model Review</h3>
        {review && (
          <span>
            {review.nfl_season} · Week {review.market_week}
          </span>
        )}
      </div>
      <p role="status">
        {notice ||
          c?.decision ||
          "Waiting for a completed week with confirmed results and reconciled settlement."}
      </p>
      {control && (
        <div className="model-review-actions">
          <span>
            Active version {control.active_id.slice(0, 8)} ·{" "}
            {control.paused
              ? "Improvement paused"
              : "Gated improvement enabled"}
          </span>
          <button
            disabled={busy}
            onClick={() => void action(control.paused ? "resume" : "pause")}
          >
            {control.paused ? "Resume improvement" : "Pause improvement"}
          </button>
          <button
            disabled={busy || control.active_id === control.baseline_id}
            onClick={() => void action("rollback")}
          >
            Restore previous model
          </button>
        </div>
      )}
      {r && (
        <>
          <p className="report-note">
            All generated forecasts, including unbet and locked markets. Week{" "}
            {review.market_week + 1} is excluded until confirmed complete.
            Accuracy is an estimate, not a guarantee.
          </p>
          <div className="model-review-scroll">
            <table>
              <thead>
                <tr>
                  <th>Score view</th>
                  <th>Horizon</th>
                  <th>Sample</th>
                  <th>MAE</th>
                  <th>RMSE</th>
                  <th>Bias</th>
                  <th>80% coverage</th>
                </tr>
              </thead>
              <tbody>
                {r.score_views.map((v: any) => (
                  <tr key={`${v.view}:${v.horizon}`}>
                    <td>{v.view.replaceAll("_", " ")}</td>
                    <td>{v.horizon.replaceAll("_", " ")}</td>
                    <td>{v.n}</td>
                    <td>{value(v.mae)}</td>
                    <td>{value(v.rmse)}</td>
                    <td>{value(v.bias)}</td>
                    <td>
                      {v.coverage80 == null
                        ? "—"
                        : `${(v.coverage80 * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="model-review-charts">
            <figure>
              <figcaption>Largest starter forecast residuals</figcaption>
              <svg
                viewBox="0 0 300 180"
                role="img"
                aria-label="Signed errors in points, forecast minus actual"
              >
                <line
                  x1="150"
                  x2="150"
                  y1="10"
                  y2="150"
                  stroke="currentColor"
                />
                {r.largest_misses.slice(0, 5).map((m: any, i: number) => {
                  const e = m.predicted - m.actual,
                    w = Math.min(100, Math.abs(e) * 2);
                  return (
                    <g key={`${m.run_id}:${m.team_id}`}>
                      <rect
                        x={e < 0 ? 150 - w : 150}
                        y={15 + i * 26}
                        width={w}
                        height="12"
                        fill={e < 0 ? "#b78738" : "#377b9c"}
                      />
                      <text
                        x="150"
                        y={38 + i * 26}
                        textAnchor="middle"
                        fontSize="10"
                        fill="currentColor"
                      >
                        {m.team_id.slice(0, 8)}: {value(e)}
                      </text>
                    </g>
                  );
                })}
                <text
                  x="150"
                  y="172"
                  textAnchor="middle"
                  fontSize="11"
                  fill="currentColor"
                >
                  Underestimate ← 0 → Overestimate
                </text>
              </svg>
            </figure>
            <figure>
              <figcaption>Opening probability reliability</figcaption>
              <svg
                viewBox="0 0 300 180"
                role="img"
                aria-label="Predicted versus observed probability; diagonal indicates perfect calibration"
              >
                <line
                  x1="40"
                  y1="140"
                  x2="260"
                  y2="15"
                  stroke="currentColor"
                  strokeDasharray="4 4"
                />
                {r.families
                  .filter((f: any) => f.horizon === "opening")
                  .flatMap((f: any) =>
                    f.bands
                      .filter((b: any) => b.n)
                      .map((b: any) => (
                        <circle
                          key={`${f.kind}:${b.lo}`}
                          cx={40 + b.predicted * 220}
                          cy={140 - b.observed * 125}
                          r="4"
                          fill="#377b9c"
                        >
                          <title>{`${f.kind}: n=${b.n}, predicted ${value(b.predicted)}, observed ${value(b.observed)}`}</title>
                        </circle>
                      )),
                  )}
                <text
                  x="150"
                  y="172"
                  textAnchor="middle"
                  fontSize="11"
                  fill="currentColor"
                >
                  Predicted probability 0 → 1; observed 0 ↑ 1
                </text>
              </svg>
            </figure>
            <figure>
              <figcaption>80% interval coverage</figcaption>
              <svg
                viewBox="0 0 300 180"
                role="img"
                aria-label="Observed coverage by score view against 80 percent target"
              >
                <line
                  x1="224"
                  x2="224"
                  y1="10"
                  y2="145"
                  stroke="currentColor"
                  strokeDasharray="4 4"
                />
                {r.score_views
                  .filter((v: any) => v.horizon === "opening")
                  .map((v: any, i: number) => (
                    <g key={v.view}>
                      <text
                        x="15"
                        y={22 + i * 38}
                        fontSize="10"
                        fill="currentColor"
                      >
                        {v.view.replaceAll("_", " ")}
                      </text>
                      <line
                        x1="40"
                        x2="270"
                        y1={35 + i * 38}
                        y2={35 + i * 38}
                        stroke="currentColor"
                        opacity=".2"
                      />
                      {v.coverage80 != null && (
                        <circle
                          cx={40 + 230 * v.coverage80}
                          cy={35 + i * 38}
                          r="5"
                          fill="#b78738"
                        />
                      )}
                    </g>
                  ))}
                <text
                  x="150"
                  y="172"
                  textAnchor="middle"
                  fontSize="11"
                  fill="currentColor"
                >
                  0% → 100%; dashed target 80%
                </text>
              </svg>
            </figure>
          </div>
          <p className="report-note">
            Calibration bands are descriptive. Correlated selections and small
            samples do not establish confidence. Full values are available
            below.
          </p>
          <details>
            <summary>Probability calibration and data coverage</summary>
            <div className="model-review-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Family / horizon</th>
                    <th>Generated</th>
                    <th>Published</th>
                    <th>Scored</th>
                    <th>Push / pending</th>
                    <th>Brier</th>
                    <th>Log loss</th>
                  </tr>
                </thead>
                <tbody>
                  {r.families.map((f: any) => (
                    <tr key={`${f.kind}:${f.horizon}`}>
                      <td>
                        {f.kind.replaceAll("_", " ")} /{" "}
                        {f.horizon.replaceAll("_", " ")}
                      </td>
                      <td>{f.generated}</td>
                      <td>{f.published}</td>
                      <td>{f.n}</td>
                      <td>
                        {f.pushes} / {f.pending}
                      </td>
                      <td>{value(f.brier)}</td>
                      <td>{value(f.log_loss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Missing families:{" "}
              {r.coverage.missing_families.join(", ") || "None"}.{" "}
              {r.excluded.length} exclusions or unavailable probability records.
            </p>
            <pre className="model-review-json">
              {JSON.stringify(
                r.families.map((f: any) => ({
                  family: f.kind,
                  horizon: f.horizon,
                  bands: f.bands,
                })),
                null,
                2,
              )}
            </pre>
          </details>
          <details>
            <summary>Special distributions, futures and largest misses</summary>
            <p>
              Futures trajectories remain pending until their final event is
              confirmed. Repeated forecasts of one season event are correlated.
            </p>
            <pre className="model-review-json">
              {JSON.stringify(
                {
                  event_errors: r.event_errors,
                  live_horizons: r.live_horizons,
                  specials: r.distributions,
                  categorical: r.categorical,
                  largest_misses: r.largest_misses,
                  futures: r.futures?.scores,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details>
            <summary>Candidate versus frozen baseline</summary>
            <p>
              Training: {c.training_weeks} independent weeks. Team scores and
              variance only; player, live and futures models remain frozen.
            </p>
            <div className="model-review-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Weeks</th>
                    <th>Observations</th>
                    <th>MAE gain</th>
                    <th>99% week-block interval</th>
                    <th>Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {c.tests.map((t: any) => (
                    <tr key={t.phase}>
                      <td>{t.phase}</td>
                      <td>{t.weeks}</td>
                      <td>{t.observations}</td>
                      <td>{value(t.mae_gain)}</td>
                      <td>
                        {value(t.interval.low)} to {value(t.interval.high)}
                      </td>
                      <td>{t.pass ? "Pass" : "Hold"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul>
              {c.reasons.map((reason: string) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Version history and limitations</summary>
            <ul>
              {events.map((e) => (
                <li key={e.id}>
                  {e.created_at.slice(0, 10)}: {e.kind} · {e.reason}
                </li>
              ))}
            </ul>
            <ul>
              {r.limitations.map((l: string) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p>
              Next assessment: after the next completed week and confirmed
              settlement. Existing Model Accuracy &amp; Special Trends, win
              outlook and championship reports provide additional detail.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
