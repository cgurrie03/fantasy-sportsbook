import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage, money } from "../lib/accounts";
import { supabase } from "../lib/supabase";
import {
  bettingStats,
  deduplicateForecasts,
  scoreRows,
  optimalActualLineup,
  confirmedSeasonResults,
} from "../lib/reporting";
import type { Forecast, ScoreWeek } from "../lib/reporting";
import { settleLeg } from "../../api/_lib/settlement";
import { settleFuture } from "../../api/_lib/futures-settlement";
import type { Market } from "../lib/markets";
import { ScoreTrend } from "./ScoreTrend";
import { formatOdds, marketType } from "../lib/markets";
const titles = [
  "Projected vs. actual",
  "Scoring trends",
  "Schedule luck & all-play",
  "Scoring consistency",
  "Lineup efficiency & review",
  "Standings & playoff race",
  "Championship & #1 pick outlook",
  "Regular-season win outlook",
  "Betting performance",
  "Wallet activity",
  "Popular selections",
  "Open ticket exposure",
  "Weekly storylines",
  "Model accuracy & special trends",
  "Automation health",
  "Email delivery health",
];
const fixed = (n: number | null, places = 1) =>
  n === null || !Number.isFinite(n) ? "—" : n.toFixed(places);
const percent = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : (n * 100).toFixed(1) + "%";
type Log = {
  id: string;
  status: string;
  operation?: string;
  kind?: string;
  recipient?: string;
  created_at: string;
  last_error: string | null;
};
export function Reports({
  data,
  leagueId,
  previewData,
}: {
  data: AccountData;
  leagueId: string;
  previewData?: { weeks: ScoreWeek[]; forecasts?: Forecast[] };
}) {
  const inFlight = useRef(false);
  const league = data.leagues.find((l) => l.id === leagueId)!;
  const [report, setReport] = useState(0),
    [week, setWeek] = useState(0),
    [team, setTeam] = useState(""),
    [season, setSeason] = useState(league.nfl_season),
    [weeks, setWeeks] = useState<ScoreWeek[]>(previewData?.weeks ?? []),
    [forecasts, setForecasts] = useState<Forecast[]>(
      previewData?.forecasts ?? [],
    ),
    [jobs, setJobs] = useState<Log[]>([]),
    [emails, setEmails] = useState<Log[]>([]),
    [notice, setNotice] = useState(
      previewData
        ? "Layout preview using previously retrieved league scores. No database actions are enabled."
        : "",
    ),
    [busy, setBusy] = useState(false),
    [asOf, setAsOf] = useState("");
  const teams = data.teams.filter(
    (t) => t.league_id === leagueId && (!team || t.id === team),
  );
  const owner = (id: string) =>
    data.teams.find((t) => t.id === id)?.sportsbook_owner_name ??
    data.memberships.find((m) => m.team_id === id)?.display_name ??
    id;
  const load = useCallback(async () => {
    const responses = await Promise.all([
      supabase!
        .from("forecast_snapshots")
        .select("*")
        .eq("league_id", leagueId)
        .eq("nfl_season", season)
        .order("captured_at"),
      supabase!
        .from("league_result_weeks")
        .select("*")
        .eq("league_id", leagueId)
        .eq("nfl_season", season)
        .order("market_week"),
      supabase!
        .from("automation_jobs")
        .select("id,status,operation,created_at,last_error")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase!
        .from("outbound_emails")
        .select("id,status,kind,recipient,created_at,last_error")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    for (const r of responses) if (r.error) throw r.error;
    setForecasts(responses[0].data ?? []);
    setWeeks(responses[1].data ?? []);
    setJobs(responses[2].data ?? []);
    setEmails(responses[3].data ?? []);
    setAsOf(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    return (
      !responses[1].data?.length ||
      responses[1].data.some(
        (w) => !w.final && Date.now() - Date.parse(w.fetched_at) > 300000,
      )
    );
  }, [leagueId, season]);
  const refresh = useCallback(
    async (allWeeks = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setNotice("");
      try {
        if (season !== league.nfl_season)
          throw new Error(
            "Historical seasons show stored data; Sleeper refresh is available for the connected season.",
          );
        const token = (await supabase!.auth.getSession()).data.session
          ?.access_token;
        // Backfill at most 18 weeks in resumable two-week batches, without sending emails.
        for (let i = 0; i < 9; i++) {
          const response = await fetch("/api/report-results", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              league_id: leagueId,
              ...(week && !allWeeks ? { week } : {}),
            }),
          });
          const raw = await response.text();
          let result: {
            error?: string;
            remaining: number;
            refreshed: number[];
          };
          try {
            result = JSON.parse(raw);
          } catch {
            throw new Error(raw.slice(0, 180));
          }
          if (!response.ok) throw new Error(result.error ?? "Refresh failed.");
          if (
            (week && !allWeeks) ||
            !result.remaining ||
            !result.refreshed.length
          )
            break;
        }
        await load();
        setNotice(
          "Sleeper results refreshed. Tickets, balances, and emails are unchanged.",
        );
      } catch (e) {
        setNotice(errorMessage(e));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [load, season, league.nfl_season, leagueId, week],
  );
  useEffect(() => {
    if (previewData) return;
    let active = true;
    const update = () =>
      load()
        .then((stale) => {
          if (stale && active && season === league.nfl_season)
            void refresh(true);
        })
        .catch((e) => {
          if (active) setNotice(errorMessage(e));
        });
    void update();
    const timer = setInterval(() => {
      if (!document.hidden) void update();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [leagueId, season, league.nfl_season, load, refresh, previewData]);
  const rows = useMemo(
    () =>
      scoreRows(weeks, forecasts).filter(
        (r) => (!week || r.week === week) && (!team || r.team === team),
      ),
    [weeks, forecasts, week, team],
  );
  const finalRows = rows.filter((r) => r.final),
    errors = finalRows.filter((r) => r.error !== null);
  const mean = (values: number[]) =>
    values.length ? values.reduce((n, v) => n + v, 0) / values.length : null;
  const mae = mean(errors.map((r) => Math.abs(r.error!))),
    bias = mean(errors.map((r) => r.error!));
  const currentQuotes =
    forecasts.filter((f) => f.board_type === "future").at(-1)?.quotes ?? [];
  const seasonResults = confirmedSeasonResults(
    weeks,
    data.teams.filter((t) => t.league_id === leagueId),
    Number(currentQuotes[0]?.metadata.playoff_week_start ?? 15) - 1,
    Number(currentQuotes[0]?.metadata.playoff_teams ?? 7),
  );
  const futureOutcome = (q: Market) =>
    settleFuture(
      { id: q.id, accepted_line: q.line, settlement_context: q },
      seasonResults,
    );
  const filteredTickets = (data.tickets ?? []).filter(
    (t) =>
      t.league_id === leagueId &&
      t.nfl_season === season &&
      (!week || t.market_week === week) &&
      (!team || t.team_id === team),
  );
  const columns: string[] = [];
  let table: (string | number)[][] = [];
  const add = (headers: string[], values: (string | number)[][]) => {
    columns.push(...headers);
    table = values;
  };
  const byTeam = teams.map((t) => ({
    t,
    r: finalRows.filter((r) => r.team === t.id),
  }));
  if (report === 1)
    add(
      ["Team", "Weeks", "Average", "Highest", "Lowest"],
      byTeam.map(({ t, r }) => [
        owner(t.id),
        r.length,
        fixed(mean(r.map((x) => x.actual))),
        r.length ? fixed(Math.max(...r.map((x) => x.actual))) : "—",
        r.length ? fixed(Math.min(...r.map((x) => x.actual))) : "—",
      ]),
    );
  if (report === 2)
    add(
      ["Team", "All-play win rate", "Actual record", "Expected wins*"],
      byTeam.map(({ t, r }) => [
        owner(t.id),
        percent(mean(r.map((x) => x.allPlay))),
        `${t.wins}–${t.losses}`,
        fixed(r.reduce((n, x) => n + x.allPlay, 0)),
      ]),
    );
  if (report === 3)
    add(
      ["Team", "Weeks", "Average", "Standard deviation"],
      byTeam.map(({ t, r }) => {
        const average = mean(r.map((x) => x.actual));
        return [
          owner(t.id),
          r.length,
          fixed(average),
          r.length > 1
            ? fixed(
                Math.sqrt(
                  r.reduce((n, x) => n + (x.actual - average!) ** 2, 0) /
                    (r.length - 1),
                ),
              )
            : "—",
        ];
      }),
    );
  if (report === 4)
    add(
      [
        "Week",
        "Team",
        "Starting score",
        "Best opening-roster score*",
        "Missed points*",
        "Highest-scoring starter",
      ],
      weeks
        .filter((w) => !week || w.market_week === week)
        .flatMap((w) =>
          teams.map((t) => {
            const s = w.results[t.id];
            const snapshot = deduplicateForecasts(forecasts).find(
              (f) =>
                f.board_type === "weekly" && f.market_week === w.market_week,
            );
            const quote = snapshot?.quotes.find(
              (q) => q.home_team_id === t.id || q.away_team_id === t.id,
            );
            const eligible = quote?.metadata[
              quote.home_team_id === t.id
                ? "home_eligible_players"
                : "away_eligible_players"
            ] as { id: string; positions: string[] }[] | undefined;
            const positions = quote?.metadata.roster_positions as
              string[] | undefined;
            const optimal =
              w.final && s && eligible && positions
                ? optimalActualLineup(eligible, positions, s.players_points)
                : null;

            const top = s
              ? Object.entries(s.players_points)
                  .filter(
                    ([id]) =>
                      s && (s as { starters: string[] }).starters?.includes(id),
                  )
                  .sort((a, b) => b[1] - a[1])[0]
              : null;
            return [
              w.market_week,
              owner(t.id),
              s ? fixed(s.points) : "—",
              fixed(optimal),
              s && optimal !== null
                ? fixed(Math.max(0, optimal - s.points))
                : "—",
              top ? (s?.player_names?.[top[0]] ?? top[0]) : "—",
            ];
          }),
        ),
    );
  if (report === 5)
    add(
      ["Rank", "Team", "Record", "Make playoffs", "Miss playoffs"],
      [...teams]
        .sort((a, b) => b.wins + b.ties / 2 - a.wins - a.ties / 2)
        .map((t, i) => [
          i + 1,
          owner(t.id),
          `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ""}`,
          percent(
            Number(
              currentQuotes.find(
                (q) =>
                  q.team_id === t.id &&
                  q.kind === "future_playoffs" &&
                  q.side === "make",
              )?.metadata.simulated_probability ?? NaN,
            ),
          ),
          percent(
            Number(
              currentQuotes.find(
                (q) =>
                  q.team_id === t.id &&
                  q.kind === "future_playoffs" &&
                  q.side === "miss",
              )?.metadata.simulated_probability ?? NaN,
            ),
          ),
        ]),
    );
  if (report === 6)
    add(
      [
        "Team",
        "Championship probability",
        "Odds",
        "#1 pick probability",
        "Pick owner",
      ],
      teams.map((t) => {
        const c = currentQuotes.find(
            (q) => q.team_id === t.id && q.kind === "future_champion",
          ),
          p = currentQuotes.find(
            (q) => q.team_id === t.id && q.kind === "future_first_pick",
          );
        return [
          owner(t.id),
          percent(c ? Number(c.metadata.simulated_probability) : null),
          c ? formatOdds(c.odds) : "—",
          percent(p ? Number(p.metadata.simulated_probability) : null),
          String(p?.metadata.pick_owner_name ?? "—"),
        ];
      }),
    );
  if (report === 7)
    add(
      [
        "Team",
        "Expected wins",
        "Line",
        "Over probability",
        "Under probability",
      ],
      teams.map((t) => {
        const q = currentQuotes.find(
          (q) =>
            q.team_id === t.id &&
            q.kind === "future_win_total" &&
            q.side === "over",
        );
        return [
          owner(t.id),
          fixed(q ? Number(q.metadata.expected_wins) : null),
          q?.line ?? "—",
          percent(q ? Number(q.metadata.simulated_probability) : null),
          percent(q ? 1 - Number(q.metadata.simulated_probability) : null),
        ];
      }),
    );
  if (report === 8)
    add(
      ["Team", "Tickets", "Settled", "Net profit", "ROI"],
      teams.map((t) => {
        const s = bettingStats(data, t.id, week, season);
        return [
          owner(t.id),
          s.placed,
          s.settled,
          money(s.profit),
          percent(s.roi),
        ];
      }),
    );
  if (report === 9)
    add(
      ["Date", "Team", "Event", "Balance before", "Balance after"],
      data.ledger
        .filter((l) => teams.some((t) => t.id === l.team_id))
        .map((l) => [
          new Date(l.created_at).toLocaleString(),
          owner(l.team_id),
          l.reason,
          l.balance_before === null ? "—" : money(l.balance_before),
          money(l.balance_after),
        ]),
    );
  if (report === 10) {
    const counts = new Map<string, { count: number; stakes: number }>();
    for (const t of filteredTickets.filter((t) => t.status !== "VOIDED")) {
      for (const l of (data.legs ?? []).filter((l) => l.ticket_id === t.id)) {
        const entry = counts.get(l.selection) ?? { count: 0, stakes: 0 };
        entry.count++;
        entry.stakes += Number(t.stake);
        counts.set(l.selection, entry);
      }
    }
    add(
      ["Selection", "Ticket appearances", "Ticket stakes*"],
      [...counts]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([s, n]) => [s, n.count, money(n.stakes)]),
    );
  }
  if (report === 11)
    add(
      [
        "Team",
        "Ticket",
        "Market week",
        "Category",
        "Stake",
        "Potential payout",
      ],
      filteredTickets
        .filter((t) => t.status === "OPEN")
        .map((t) => [
          owner(t.team_id),
          t.legacy_ticket_id ?? t.id.slice(0, 8),
          t.market_week,
          t.ticket_type ?? "weekly",
          money(t.stake),
          money(t.accepted_potential_payout ?? 0),
        ]),
    );
  if (report === 12)
    add(
      [
        "Week",
        "High scorer",
        "Score",
        "Low scorer",
        "Score",
        "Biggest overperformance",
      ],
      weeks
        .filter((w) => w.final && (!week || w.market_week === week))
        .map((w) => {
          const values = Object.entries(w.results).sort(
              (a, b) => b[1].points - a[1].points,
            ),
            over = finalRows
              .filter((r) => r.week === w.market_week && r.error !== null)
              .sort((a, b) => b.error! - a.error!)[0];
          return [
            w.market_week,
            owner(values[0][0]),
            fixed(values[0][1].points),
            owner(values.at(-1)![0]),
            fixed(values.at(-1)![1].points),
            over
              ? `${owner(over.team)} (${over.error! >= 0 ? "+" : ""}${fixed(over.error)})`
              : "—",
          ];
        }),
    );
  const evaluations = deduplicateForecasts(forecasts)
    .filter(
      (f) => f.board_type === "weekly" && (!week || f.market_week === week),
    )
    .flatMap((f) => {
      const result = weeks.find(
        (w) => w.market_week === f.market_week && w.final,
      );
      if (!result) return [];
      return f.quotes
        .filter(
          (q) =>
            !q.metadata.lineup_locked &&
            (!team || q.team_id === team) &&
            ((["moneyline", "spread"].includes(q.kind) && q.side === "home") ||
              (["match_total", "team_total", "player_points"].includes(
                q.kind,
              ) &&
                q.side === "over") ||
              (q.kind.startsWith("weekly_") &&
                !["under", "no"].includes(q.side))),
        )
        .map((q) => {
          const outcome = settleLeg(
            { id: q.id, accepted_line: q.line, settlement_context: q },
            {
              final: true,
              teams: result.results,
              players: Object.assign(
                {},
                ...Object.values(result.results).map(
                  (r) => r.player_results ?? {},
                ),
              ),
            },
          );
          const p =
            typeof q.metadata.simulated_probability === "number"
              ? q.metadata.simulated_probability
              : null;
          return {
            q,
            outcome,
            p,
            error:
              q.line !== null &&
              outcome.actual_value !== null &&
              outcome.status !== "OPEN" &&
              !(q.kind === "player_points" && outcome.status === "PUSH")
                ? outcome.actual_value -
                  (q.kind === "spread" ? -q.line : q.line)
                : null,
            week: f.market_week,
            brier:
              p !== null && ["WON", "LOST"].includes(outcome.status)
                ? (p - Number(outcome.status === "WON")) ** 2
                : null,
          };
        });
    });
  if (report === 13)
    add(
      [
        "Week",
        "Market",
        "Selection",
        "Raw probability",
        "Actual",
        "Outcome",
        "Error (points/count)",
        "Brier score",
      ],
      evaluations.map((e) => [
        e.week,
        marketType[e.q.kind],
        e.q.label,
        percent(e.p),
        e.outcome.actual_value === null
          ? "—"
          : fixed(e.outcome.actual_value, 2),
        e.outcome.status,
        fixed(e.error, 2),
        fixed(e.brier, 3),
      ]),
    );
  if (report === 14)
    add(
      ["Date", "Operation", "Status", "Details"],
      jobs.map((j) => [
        new Date(j.created_at).toLocaleString(),
        j.operation ?? "",
        j.status,
        j.last_error ?? "—",
      ]),
    );
  if (report === 15)
    add(
      ["Date", "Type", "Recipient", "Status", "Details"],
      emails.map((e) => [
        new Date(e.created_at).toLocaleString(),
        e.kind ?? "",
        e.recipient ?? "",
        e.status,
        e.last_error ?? "—",
      ]),
    );
  const exportCsv = () => {
    const csv = [columns, ...table]
      .map((row) =>
        row
          .map((cell) => '"' + String(cell).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `league-report-${season}-${report}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="admin-workspace reports">
      <div className="report-toolbar">
        <label>
          Report
          <select
            value={report}
            onChange={(e) => setReport(Number(e.target.value))}
          >
            {titles.map((t, i) => (
              <option key={t} value={i}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Season
          <select
            value={season}
            onChange={(e) => {
              setSeason(Number(e.target.value));
              setWeek(0);
            }}
          >
            {[
              ...new Set([
                league.nfl_season,
                ...forecasts.map((f) => f.nfl_season),
              ]),
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Week
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            <option value={0}>All weeks</option>
            {[...new Set(weeks.map((w) => w.market_week))].map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {data.teams
              .filter((t) => t.league_id === leagueId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {owner(t.id)}
                </option>
              ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || Boolean(previewData)}
          onClick={() => void refresh()}
        >
          {busy ? "Refreshing…" : "Refresh Sleeper data"}
        </button>
        {report !== 0 && (
          <button disabled={!table.length} onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="market-admin-notice">
          {notice}
        </p>
      )}
      <div className="report-kpis">
        <article>
          <small>Final team-week results</small>
          <strong>{finalRows.length}</strong>
        </article>
        <article>
          <small>Available projection error · MAE</small>
          <strong>
            {fixed(mae)} <em>points</em>
          </strong>
        </article>
        <article>
          <small>Scoring above projection</small>
          <strong>
            {bias !== null && bias > 0 ? "+" : ""}
            {fixed(bias)} <em>average</em>
          </strong>
        </article>
        <article>
          <small>Forecast versions archived</small>
          <strong>{forecasts.length}</strong>
        </article>
      </div>
      <article className="admin-panel">
        <div className="report-heading">
          <h2>{titles[report]}</h2>
          <small>Updated {asOf || "—"} · Eastern</small>
        </div>
        {[0, 1].includes(report) && <ScoreTrend rows={rows} />}
        {report === 0 ? (
          <>
            <p className="report-note">
              Actual minus projected points. Blue = overperformance; orange =
              underperformance. HIGH / LOW mark each week's largest deviation.
              Live scores are labelled.
            </p>
            <div className="report-table-wrap">
              <table className="score-heatmap">
                <thead>
                  <tr>
                    <th>Team</th>
                    {weeks
                      .filter((w) => !week || w.market_week === week)
                      .map((w) => (
                        <th key={w.market_week}>
                          Week {w.market_week}
                          <small>{w.final ? "Final" : "Live"}</small>
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id}>
                      <th>
                        <span className="report-team">
                          {t.avatar_url && <img src={t.avatar_url} alt="" />}
                          <span>
                            {owner(t.id)}
                            <small>{t.team_name}</small>
                          </span>
                        </span>
                      </th>
                      {weeks
                        .filter((w) => !week || w.market_week === week)
                        .map((w) => {
                          const r = rows.find(
                            (r) => r.team === t.id && r.week === w.market_week,
                          );
                          const all = scoreRows([w], forecasts).filter(
                            (r) => r.error !== null,
                          );
                          const high = Math.max(...all.map((r) => r.error!)),
                            low = Math.min(...all.map((r) => r.error!));
                          return (
                            <td key={w.market_week}>
                              <div
                                className={`heat-cell ${r?.error !== null && r?.error !== undefined ? (r.error >= 0 ? "over" : "under") : ""}`}
                                title={r?.basis}
                                style={
                                  {
                                    "--heat": String(
                                      Math.min(
                                        0.8,
                                        0.18 + Math.abs(r?.error ?? 0) / 100,
                                      ),
                                    ),
                                  } as React.CSSProperties
                                }
                              >
                                <small>
                                  {r && r.error !== null
                                    ? r.error === high
                                      ? "HIGH"
                                      : r.error === low
                                        ? "LOW"
                                        : ""
                                    : ""}
                                </small>
                                <strong>
                                  {r?.error !== null && r?.error !== undefined
                                    ? `${r.error >= 0 ? "+" : ""}${fixed(r.error)}`
                                    : "—"}
                                </strong>
                                <span>
                                  {r
                                    ? `${fixed(r.actual)} / ${fixed(r.projection)}`
                                    : "No data"}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-note">
              Cell footer: actual / projected. Historical starter projections
              are reconstructed from current provider data; they are not
              original pregame sportsbook forecasts. Hover a cell for its basis.
            </p>
          </>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!table.length && <p>No eligible data for these filters yet.</p>}
          </div>
        )}
        {[9, 14, 15].includes(report) && (
          <p className="report-note">
            Week filters do not apply to wallet or operations logs. These views
            show the latest recorded activity.
          </p>
        )}
        {report === 2 && (
          <p className="report-note">
            *All-play rate counts wins against every other team that week, ties
            as half-wins. Expected wins is the sum of weekly all-play rates; it
            measures schedule luck rather than forecasting.
          </p>
        )}
        {report === 4 && (
          <p className="report-note">
            *The optimal score uses the eligible roster archived at opening, not
            later waiver additions. Missing archived eligibility or player
            scores produces an unavailable value, rather than a guessed optimum.
            Players without provider names retain their Sleeper IDs.
          </p>
        )}
        {report === 10 && (
          <p className="report-note">
            *Ticket stakes count the full ticket stake for each selection
            appearance; this is popularity, not additive financial exposure.
          </p>
        )}
        {report === 13 && (
          <>
            <p className="report-note">
              Evaluation uses the final pre-opening snapshot, or the first
              opening publication snapshot when it commits just after opening,
              includes unbet selections, excludes locked markets and
              unresolved/push outcomes from Brier scores. Each binary market is
              counted once. Lower Brier scores are better; small samples are
              preliminary.
            </p>
            <h3>Futures forecast history</h3>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>As of</th>
                    <th>Team</th>
                    <th>Market</th>
                    <th>Probability</th>
                    <th>Line</th>
                    <th>Model</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {forecasts
                    .filter((f) => f.board_type === "future")
                    .flatMap((f) =>
                      f.quotes
                        .filter(
                          (q) =>
                            (!team || q.team_id === team) &&
                            !["miss", "under"].includes(q.side),
                        )
                        .map((q) => (
                          <tr key={`${f.id}:${q.id}`}>
                            <td>{new Date(f.captured_at).toLocaleString()}</td>
                            <td>{owner(q.team_id ?? "")}</td>
                            <td>{marketType[q.kind]}</td>
                            <td>
                              {percent(
                                Number(q.metadata.simulated_probability),
                              )}
                            </td>
                            <td>{q.line ?? "—"}</td>
                            <td>
                              {String(
                                q.metadata.model_version ?? "Unavailable",
                              )}
                            </td>
                            <td>{futureOutcome(q).status}</td>
                          </tr>
                        )),
                    )}
                </tbody>
              </table>
            </div>
            <p className="report-note">
              Season outcomes remain pending until confirmed. Older boards
              captured at installation are retained as history, not treated as
              original published predictions.
            </p>
          </>
        )}
        {[14, 15].includes(report) && (
          <p className="report-note">
            Latest 100 records. “Sent” means accepted by the email provider, not
            confirmed inbox delivery.
          </p>
        )}
      </article>
    </section>
  );
}
