import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
export function ReadinessPanel({
  leagueId,
  review = false,
}: {
  leagueId: string;
  review?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(true),
    pending = useRef(false);
  const load = useCallback(async () => {
    if (review || !supabase || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const r = await supabase.rpc("sportsbook_readiness", {
        p_league: leagueId,
      });
      if (r.error) throw r.error;
      if (active.current) {
        setData(r.data);
        setError("");
      }
    } catch {
      if (active.current)
        setError(
          "Readiness could not refresh. Last available diagnostics remain visible.",
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }, [leagueId, review]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);
  const time = (v: string | null) =>
    v && Number.isFinite(Date.parse(v))
      ? new Date(v).toLocaleString("en-US", { timeZone: "America/New_York" }) +
        " Eastern"
      : "Unavailable";
  return (
    <section className="admin-panel readiness-panel">
      <h2>Board readiness and data health</h2>
      <p>
        Publication, source checks, and lineup availability are separate checks.
        Locked bets do not stop eligible bets from opening.
      </p>
      {review ? (
        <p>
          Readiness is unavailable in this local layout review. No production
          diagnostics are requested.
        </p>
      ) : (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Checking readiness…" : "Refresh readiness"}
        </button>
      )}
      {error && <p role="status">{error}</p>}
      {data && (
        <>
          <dl className="standing-metrics">
            <div>
              <dt>Game-state source checked</dt>
              <dd>{time(data.runtime?.observed_at)}</dd>
            </div>
            <div>
              <dt>Last complete pricing refresh</dt>
              <dd>{time(data.runtime?.last_success_at)}</dd>
            </div>
            <div>
              <dt>Next refresh due</dt>
              <dd>{time(data.runtime?.next_due_at)}</dd>
            </div>
          </dl>
          {data.runtime?.last_error && (
            <p role="status">
              Source unavailable; new acceptance stays protected.{" "}
              <a href="#/admin/schedule">Open automation diagnostics</a>.
            </p>
          )}
          {(data.boards ?? []).map((b: any) => (
            <section key={b.id}>
              <h3>
                {b.type === "future" ? "Season Futures" : `Week ${b.week}`} /{" "}
                {b.status}
              </h3>
              <p>
                Cutoff: {time(b.closes_at)}. Prices valid until:{" "}
                {time(b.valid_until)}.
              </p>
              {b.suspension_reason && <p>Unavailable: {b.suspension_reason}</p>}
              <div className="standings-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Active selections</th>
                      <th scope="col">Locked</th>
                      <th scope="col">Oldest quote generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(b.categories ?? []).map((c: any) => (
                      <tr key={c.kind}>
                        <th scope="row">{c.kind.replaceAll("_", " ")}</th>
                        <td>{c.quotes}</td>
                        <td>{c.locked}</td>
                        <td>{time(c.oldest_generated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
      <p>
        <a href="#/admin/lines">Review markets and lineups</a> /{" "}
        <a href="#/admin/reports?report=14">Automation history</a> /{" "}
        <a href="#/admin/reports?report=15">Email delivery</a>
      </p>
    </section>
  );
}
