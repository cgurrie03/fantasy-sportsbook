import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import { archivedReview } from "../../api/_lib/evaluation-summary";
const value = (v: number | null | undefined) =>
  v == null ? "—" : v.toFixed(2);
export function ModelReview({
  leagueId,
  preview,
  canConfigure = false,
}: {
  leagueId: string;
  preview?: any;
  canConfigure?: boolean;
}) {
  const [review, setReview] = useState<any>(preview ?? null),
    [control, setControl] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [capture, setCapture] = useState<{ leagueId: string; rows: any[] } | null>(
      null,
    ),
    [retention, setRetention] = useState<{
      leagueId: string;
      data: any;
    } | null>(null),
    [loadedLeague, setLoadedLeague] = useState(preview ? leagueId : ""),
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
        .order("id", { ascending: false })
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
      supabase
        .from("model_evaluation_coverage")
        .select(
          "nfl_season,market_week,category,stored_requests,eligible_gaps,last_gap_reason",
        )
        .eq("league_id", leagueId)
        .order("nfl_season", { ascending: false })
        .order("market_week", { ascending: false })
        .order("category")
        .limit(4),
      supabase
        .from("evaluation_retention_health")
        .select("heartbeat_at,unresolved_periods,oldest_unresolved_period")
        .eq("league_id", leagueId)
        .maybeSingle(),
    ]).then(([r, c, e, h, retentionHealth]) => {
      if (cancelled) return;
      if (r.error || c.error || e.error) {
        setLoadedLeague(leagueId);
        setReview(null);
        setControl(null);
        setEvents([]);
        setNotice(
          "Model review unavailable. Retry after the assessment service recovers.",
        );
        return;
      }
      setReview(r.data?.[0] ?? null);
      setLoadedLeague(leagueId);
      setControl(c.data);
      setEvents(e.data ?? []);
      setRetention({
        leagueId,
        data: retentionHealth.error ? null : retentionHealth.data,
      });
      const latest = h.data?.[0];
      setCapture({
        leagueId,
        rows:
          !h.error && latest
            ? (h.data ?? []).filter(
                (row: any) =>
                  row.nfl_season === latest.nfl_season &&
                  row.market_week === latest.market_week,
              )
            : [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [leagueId, preview]);
  const action = async (kind: string) => {
    if (!canConfigure || !supabase || loadedLeague !== leagueId) return;
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
  const visibleReview = preview || loadedLeague === leagueId ? review : null;
  const r = visibleReview?.report?.summary
      ? archivedReview(visibleReview.report.summary)
      : visibleReview?.report,
    c = visibleReview?.comparison;
  return (
    <section className="model-review" aria-label="This Week's Model Review">
      <div className="model-review-header">
        <h3>This Week’s Model Review</h3>
        {visibleReview && (
          <span>
            {visibleReview.nfl_season} · Week {visibleReview.market_week}
          </span>
        )}
      </div>
      <p role="status">
        {(loadedLeague === leagueId ? notice : "") ||
          c?.decision ||
          "Waiting for a completed week with confirmed results and reconciled settlement."}
      </p>
      {capture?.leagueId === leagueId &&
        capture.rows.some((row) => Number(row.eligible_gaps) > 0) && (
          <p className="report-note">
            Some {capture.rows[0].nfl_season} Week {capture.rows[0].market_week}{" "}
            forecasts could not be included in model evaluation. Current betting
            lines remain available; model changes still require sufficient
            evidence.
          </p>
        )}
      {retention?.leagueId === leagueId &&
        Number(retention.data?.unresolved_periods) > 0 && (
          <p role="status">
            {retention.data.unresolved_periods} evaluation periods have
            unresolved work after 14 days. Optional evidence remains capped;
            these periods need operator review.
          </p>
        )}
      {control && loadedLeague === leagueId && (
        <div className="model-review-actions">
          <span>
            Active version {control.active_id.slice(0, 8)} ·{" "}
            {control.paused
              ? "Improvement paused"
              : "Gated improvement enabled"}
          </span>
          <button
            disabled={!canConfigure || busy}
            onClick={() => void action(control.paused ? "resume" : "pause")}
          >
            {control.paused ? "Resume improvement" : "Pause improvement"}
          </button>
          <button
            disabled={
              !canConfigure || busy || control.active_id === control.baseline_id
            }
            onClick={() => void action("rollback")}
          >
            Restore previous model
          </button>
        </div>
      )}
      {r && (
        <>
          <details>
            <summary>Sleeper input comparison</summary>
            <p className="report-note">
              Matched forecasts from the same prediction time and league
              scoring. Positive MAE improvement means our adjustment was closer.
              Missing older benchmarks are not reconstructed.
            </p>
            {r.sleeper_comparison?.some((row: any) => row.paired_n > 0) ? (
              <div className="model-review-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Forecast</th>
                      <th>Horizon</th>
                      <th>Matched</th>
                      <th>Our MAE</th>
                      <th>Sleeper input MAE</th>
                      <th>MAE improvement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sleeper_comparison.map((row: any) => (
                      <tr key={row.view + row.horizon}>
                        <td>
                          {row.view === "players"
                            ? "Players"
                            : "Actual starters (team)"}
                        </td>
                        <td>
                          {row.horizon === "opening"
                            ? "Opening"
                            : "Final pregame"}
                        </td>
                        <td>{row.paired_n}</td>
                        <td>{value(row.adjusted?.mae)}</td>
                        <td>{value(row.sleeper?.mae)}</td>
                        <td>{value(row.mae_gain)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                No matched Sleeper input benchmarks were recorded for this
                review.
              </p>
            )}
          </details>
          <p className="report-note">
            {r.row_level_retired &&
              "Row-level records have expired; this view uses finalized compact summaries. "}
            Opening and final pregame forecasts, including unbet and locked
            markets. Week {review.market_week + 1} is excluded until confirmed
            complete. Accuracy is an estimate, not a guarantee.
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
              {r.futures?.note ??
                "Futures results remain pending until their final event is confirmed. Repeated forecasts of one season event are correlated."}
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
