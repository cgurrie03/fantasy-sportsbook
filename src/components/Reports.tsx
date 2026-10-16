import { useRoute, navigate } from "../lib/navigation";
import { csvCell } from "../lib/csv";
import { ModelReview } from "./ModelReview";
import "./ModelReview.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage, money, loadAccounts } from "../lib/accounts";
import { readAllRows } from "../lib/pagination";
import { supabase } from "../lib/supabase";
import {
  bettingStats,
  deduplicateForecasts,
  scoreRows,
  optimalActualLineup,
  confirmedSeasonResults,
  winQuantile,
  performanceVsExpectations,
} from "../lib/reporting";
import type { Forecast, ScoreWeek } from "../lib/reporting";
import { settleLeg } from "../../api/_lib/settlement";
import { settleFuture } from "../../api/_lib/futures-settlement";
import type { Market } from "../lib/markets";
import { ScoreTrend } from "./ScoreTrend";
import { ReportFigure } from "./ReportFigure";
import type { FigureSpec } from "./ReportFigure";
import { exportReport } from "../lib/report-export";
import { formatOdds, marketType } from "../lib/markets";
const titles = [
  "Projected vs. Actual",
  "Scoring Trends",
  "Expected vs. Actual Wins",
  "Scoring Consistency",
  "Lineup efficiency & review",
  "Standings & Playoff Race",
  "Championship & #1 Pick Outlook",
  "Regular-Season Win Outlook",
  "Betting Performance",
  "Wallet Activity",
  "Popular Selections",
  "Open Ticket Exposure",
  "Weekly Storylines",
  "Model Accuracy & Special Trends",
  "Automation Health",
  "Email Delivery Health",
];
const reportGroups = [
  { name: "League Stats", reports: [0, 5, 12, 1, 2, 3] },
  { name: "Forecasts & Model Accuracy", reports: [13, 7, 6] },
  { name: "Betting Stats", reports: [8, 10, 11, 9] },
  { name: "Operations & Delivery", reports: [14, 15] },
];
const descriptions = [
  "Compares each team's actual score with its archived opening projection, or a clearly labelled reconstructed starter projection. Weekly high and low deviations identify the biggest surprises.",
  "Tracks each team's final weekly scores on a shared scale, with its average, season high and season low. Reveals scoring momentum rather than prediction accuracy.",
  "Compares actual matchup wins in the selected weeks with expected wins from scoring against every other team. Shows who benefited from, or suffered from, the schedule.",
  "Compares each team's scoring floor, ceiling, average and standard deviation across final weeks. A smaller deviation means steadier scoring; it does not mean a stronger team.",
  "Compares the actual starting score with the best legal lineup drawn from the roster archived at opening. Shows possible missed points; unavailable eligibility stays blank.",
  "Ranks current teams by record, then recorded points, and compares their latest simulated playoff probabilities. These are current standings and season forecasts, not a selected week's standings.",
  "Compares each team's simulated chance of winning the championship and finishing last in the regular season. Pick ownership is shown separately from the team being forecast.",
  "Compares expected final regular-season wins, the posted half-win line and the simulated over/under probabilities. The chart shows uncertainty, not a guaranteed final record.",
  "Compares settled ticket profit and return on settled stakes by team. Open tickets are excluded from ROI; voided tickets contribute no profit or loss.",
  "Shows recorded balance movements, including wagers, payouts, replenishments and admin adjustments. This is the latest wallet history, not a selected week's financial statement.",
  "Ranks selections by the number of non-voided tickets containing them. Ticket stakes are shown per selection appearance and must not be added across parlay legs.",
  "Compares stakes currently committed to open weekly and futures tickets. Potential payouts are possible obligations, not guaranteed losses or independent totals.",
  "Summarizes final weekly high and low scores and the biggest positive projection deviation. These are league-wide storylines; the team filter does not narrow the high/low contest.",
  "Evaluates original opening forecasts against final outcomes, including unbet markets. Calibration compares predicted probabilities with observed win rates; futures remain pending until their season outcome is confirmed.",
  "Summarizes the latest 100 scheduled execution jobs by operation and recorded status. A successful job log indicates execution, not proof that every downstream action succeeded.",
  "Summarizes the latest 100 email records by communication type and delivery status. Sent means accepted by the provider, not confirmed inbox delivery.",
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
  data: initialData,
  leagueId,
  previewData,
}: {
  data: AccountData;
  leagueId: string;
  previewData?: { weeks: ScoreWeek[]; forecasts?: Forecast[] };
}) {
  const [expectedCompleted, setExpectedCompleted] = useState(0);
  const [liveData, setLiveData] = useState(initialData);
  const data = previewData ? initialData : liveData;
  useEffect(() => setLiveData(initialData), [initialData]);
  const inFlight = useRef(false);
  const exportNode = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (event: PointerEvent) => {
      if (!exportMenu.current?.contains(event.target as Node))
        setExportOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [exportOpen]);
  const league = data.leagues.find((l) => l.id === leagueId)!;
  const route = useRoute();
  const routeReport = Number(
    new URLSearchParams(route.split("?")[1]).get("report") ?? 0,
  );
  const [report, setReport] = useState(
      Number.isInteger(routeReport) &&
        routeReport >= 0 &&
        routeReport < titles.length
        ? routeReport
        : 0,
    ),
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
  useEffect(() => {
    if (
      !previewData &&
      Number.isInteger(routeReport) &&
      routeReport >= 0 &&
      routeReport < titles.length
    )
      setReport(routeReport);
  }, [routeReport, previewData]);
  const load = useCallback(async () => {
    const responses = await Promise.all([
      readAllRows((from, to) =>
        supabase!
          .from("forecast_snapshots")
          .select("*")
          .eq("league_id", leagueId)
          .eq("nfl_season", season)
          .order("captured_at")
          .order("id")
          .range(from, to),
      ),
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
      supabase!.rpc("sportsbook_period", { p_league: leagueId }),
    ]);
    for (const r of responses) if (r.error) throw r.error;
    setForecasts((responses[0].data ?? []) as Forecast[]);
    const cached = (responses[1].data ?? []) as ScoreWeek[];
    setWeeks(cached);
    const expected = Math.min(
      18,
      Math.max(0, Number(responses[4].data?.[0]?.week ?? 1) - 1),
    );
    setExpectedCompleted(expected);
    setJobs((responses[2].data ?? []) as Log[]);
    setEmails((responses[3].data ?? []) as Log[]);
    setLiveData(await loadAccounts());
    setAsOf(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    return (
      Array.from({ length: expected }, (_, i) => i + 1).some(
        (w) => !cached.some((row) => row.market_week === w && row.final),
      ) ||
      !cached.length ||
      cached.some(
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
        setNotice("Sleeper results refreshed successfully.");
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
        (r) =>
          (!week || r.week === week) &&
          (!team || r.team === team) &&
          (report !== 0 || r.final),
      ),
    [weeks, forecasts, week, team, report],
  );
  const completedWeeks = weeks.filter(
    (w) => w.final && (!week || w.market_week === week),
  );
  const teamPerformance = (id: string) => {
    return performanceVsExpectations(rows, id);
  };
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
      [
        "Team",
        "All-play win rate",
        "Matchup win-equivalents*",
        "Expected wins*",
      ],
      byTeam.map(({ t, r }) => [
        owner(t.id),
        percent(mean(r.map((x) => x.allPlay))),
        r.reduce(
          (n, x) =>
            n +
            (x.opponent === null
              ? 0
              : x.actual > x.opponent
                ? 1
                : x.actual === x.opponent
                  ? 0.5
                  : 0),
          0,
        ),
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
      data.teams
        .filter((t) => t.league_id === leagueId)
        .sort(
          (a, b) =>
            b.wins + b.ties / 2 - a.wins - a.ties / 2 ||
            scoreRows(weeks, forecasts)
              .filter((r) => r.final && r.team === b.id)
              .reduce((n, r) => n + r.actual, 0) -
              scoreRows(weeks, forecasts)
                .filter((r) => r.final && r.team === a.id)
                .reduce((n, r) => n + r.actual, 0),
        )
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
        ])
        .filter((row) => !team || row[1] === owner(team)),
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
          new Date(l.created_at).toLocaleString("en-US", {
            timeZone: "America/New_York",
          }),
          owner(l.team_id),
          l.reason,
          l.balance_before === null ? "—" : money(l.balance_before),
          money(l.balance_after),
        ]),
    );
  if (report === 10) {
    const counts = new Map<
      string,
      {
        count: number;
        stakes: number;
        won: number;
        lost: number;
        pushed: number;
        open: number;
      }
    >();
    for (const t of filteredTickets.filter((t) => t.status !== "VOIDED")) {
      for (const l of (data.legs ?? []).filter((l) => l.ticket_id === t.id)) {
        const selection = /moneyline|^ml$/i.test(l.market_type)
          ? `${l.selection.replace(/\s*·?\s*ML$/i, "")} · ML`
          : l.selection;
        const entry = counts.get(selection) ?? {
          count: 0,
          stakes: 0,
          won: 0,
          lost: 0,
          pushed: 0,
          open: 0,
        };
        entry.count++;
        entry.stakes += Number(t.stake);
        if (l.status === "WON") entry.won++;
        else if (l.status === "LOST") entry.lost++;
        else if (["PUSH", "VOIDED"].includes(l.status)) entry.pushed++;
        else entry.open++;
        counts.set(selection, entry);
      }
    }
    add(
      [
        "Selection",
        "Ticket Appearances",
        "Ticket Stakes*",
        "Won",
        "Lost",
        "Push / Void",
        "Pending",
      ],
      [...counts]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([s, n]) => [
          s,
          n.count,
          money(n.stakes),
          n.won,
          n.lost,
          n.pushed,
          n.open,
        ]),
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
            (!team ||
              q.team_id === team ||
              q.home_team_id === team ||
              q.away_team_id === team) &&
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
        new Date(j.created_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
        }),
        j.operation ?? "",
        j.status,
        j.last_error ?? "—",
      ]),
    );
  if (report === 15)
    add(
      ["Date", "Type", "Recipient", "Status", "Details"],
      emails.map((e) => [
        new Date(e.created_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
        }),
        e.kind ?? "",
        e.recipient ?? "",
        e.status,
        e.last_error ?? "—",
      ]),
    );
  const number = (value: string | number) =>
    typeof value === "number"
      ? value
      : Number.parseFloat(value.replace(/[$,%]/g, ""));
  if ([1, 6, 7, 8].includes(report)) {
    const index = report === 8 ? 3 : report === 1 ? 2 : 1;
    table.sort((a, b) => number(b[index]) - number(a[index]));
  }
  if (report === 4)
    table.sort(
      (a, b) =>
        (Number.isFinite(number(b[4])) ? number(b[4]) : -Infinity) -
        (Number.isFinite(number(a[4])) ? number(a[4]) : -Infinity),
    );
  let figure: FigureSpec | undefined;
  const chart = (
    type: FigureSpec["type"],
    title: string,
    unit: string,
    note: string,
    points: FigureSpec["points"],
    legend?: string[],
  ) => {
    figure = { type, title, unit, note, points, legend };
  };
  if (report === 2)
    chart(
      "paired",
      "Matchup wins versus all-play expected wins",
      "wins",
      "Blue: matchup wins plus half of ties in the selected final weeks. Gold: all-play expected wins. The gap isolates schedule advantage.",
      table.map((r) => ({
        label: String(r[0]),
        value: number(r[2]),
        second: number(r[3]),
      })),
      ["Matchup win-equivalents", "Expected wins"],
    );
  if (report === 3)
    chart(
      "range",
      "Scoring floor, average and ceiling",
      "points",
      "Blue range: lowest to highest final score. Gold dot: average. The table's standard deviation measures consistency.",
      byTeam
        .filter((x) => x.r.length)
        .map(({ t, r }) => ({
          label: owner(t.id),
          value: mean(r.map((x) => x.actual))!,
          low: Math.min(...r.map((x) => x.actual)),
          high: Math.max(...r.map((x) => x.actual)),
        })),
      ["Min–max score", "Average"],
    );
  if (report === 4)
    chart(
      "bars",
      "Points left out of the starting lineup",
      "points",
      "Up to 24 largest missed-point results. Only weeks with a complete archived eligible roster and final player scores are included. This is a hindsight comparison.",
      table
        .filter((r) => Number.isFinite(number(r[4])))
        .sort((a, b) => number(b[4]) - number(a[4]))
        .slice(0, 24)
        .map((r) => ({ label: `W${r[0]} ${r[1]}`, value: number(r[4]) })),
    );
  if (report === 5)
    chart(
      "bars",
      "Playoff qualification forecast",
      "%",
      "Raw simulation probability, not the probability implied by rounded betting odds. Current record and recorded season points determine the displayed order.",
      table.map((r) => ({ label: `${r[0]}. ${r[1]}`, value: number(r[3]) })),
    );
  if (report === 6)
    chart(
      "paired",
      "Championship chance versus last-place chance",
      "%",
      "The same team can have uncertainty at both ends of the standings. #1 pick ownership does not change which team's finish is forecast.",
      table.map((r) => ({
        label: String(r[0]),
        value: number(r[1]),
        second: number(r[3]),
      })),
      ["League winner", "Regular-season last"],
    );
  if (report === 7)
    chart(
      "range",
      "Regular-season win forecast and uncertainty",
      "wins",
      "Blue: 10th–90th percentile simulated wins. Gold: expected wins. Vertical marker: posted half-win betting line. This is an 80% model interval.",
      teams
        .flatMap((t) => {
          const q = currentQuotes.find(
            (q) =>
              q.kind === "future_win_total" &&
              q.side === "over" &&
              q.team_id === t.id,
          );
          if (!q) return [];
          const distribution = q.metadata.win_distribution as
            Record<string, number> | undefined;
          return [
            {
              label: owner(t.id),
              value: Number(q.metadata.expected_wins),
              second: q.line ?? undefined,
              low: winQuantile(distribution, 0.1),
              high: winQuantile(distribution, 0.9),
            },
          ];
        })
        .sort((a, b) => b.value - a.value),
      ["80% interval", "Expected wins"],
    );
  if (report === 8)
    chart(
      "diverging",
      "Settled betting profit by team",
      "$",
      "Zero is break-even. Blue is net profit; orange is net loss. Open and voided tickets do not enter settled profit.",
      table.map((r) => ({ label: String(r[0]), value: number(r[3]) })),
    );
  if (report === 9)
    chart(
      "paired",
      "Recorded cash credits versus deductions",
      "$",
      "Totals use entries with known before/after balances. Opening entries are excluded. Credits include replenishments and admin changes, so this is cash flow rather than betting ROI.",
      teams.map((t) => {
        const changes = data.ledger
          .filter((l) => l.team_id === t.id && l.balance_before !== null)
          .map((l) => Number(l.balance_after) - Number(l.balance_before))
          .filter(Number.isFinite);
        return {
          label: owner(t.id),
          value: changes.filter((n) => n < 0).reduce((sum, n) => sum - n, 0),
          second: changes.filter((n) => n > 0).reduce((sum, n) => sum + n, 0),
        };
      }),
      ["Deductions", "Credits"],
    );
  if (report === 10)
    chart(
      "bars",
      "Most frequently selected lines",
      "tickets",
      "Top 12 by ticket appearances. A parlay contributes one appearance to each selection it contains, so these counts are not independent tickets.",
      table
        .slice(0, 12)
        .map((r) => ({ label: String(r[0]), value: number(r[1]) })),
    );
  if (report === 11)
    chart(
      "stacked",
      "Open stakes: weekly bets versus futures",
      "$",
      "Stake committed to open tickets, grouped by team and category. This compares tied-up cash; it does not sum potential payouts.",
      teams.map((t) => ({
        label: owner(t.id),
        value: filteredTickets
          .filter(
            (q) =>
              q.team_id === t.id &&
              q.status === "OPEN" &&
              q.ticket_type !== "future",
          )
          .reduce((n, q) => n + Number(q.stake), 0),
        second: filteredTickets
          .filter(
            (q) =>
              q.team_id === t.id &&
              q.status === "OPEN" &&
              q.ticket_type === "future",
          )
          .reduce((n, q) => n + Number(q.stake), 0),
      })),
      ["Weekly stakes", "Futures stakes"],
    );
  if (report === 12)
    chart(
      "range",
      "League-wide scoring spread each week",
      "points",
      "Blue: lowest to highest team score. Gold: league average. Wide ranges indicate weeks with a bigger gap between the league's best and worst scores.",
      weeks
        .filter((w) => w.final && (!week || week === w.market_week))
        .map((w) => {
          const scores = Object.values(w.results).map((r) => r.points);
          return {
            label: `Week ${w.market_week}`,
            value: mean(scores)!,
            low: Math.min(...scores),
            high: Math.max(...scores),
          };
        }),
      ["Low–high score", "League average"],
    );
  if (report === 13)
    chart(
      "calibration",
      "Are forecast probabilities calibrated?",
      "%",
      "Each bubble groups forecasts into a 10-point probability band. Bubble size indicates sample count. The gold diagonal is perfect calibration. Correlated markets and small samples limit conclusions.",
      Array.from({ length: 10 }, (_, i) => {
        const sample = evaluations.filter(
          (e) =>
            e.p !== null &&
            e.p >= i / 10 &&
            (i === 9 ? e.p <= 1 : e.p < (i + 1) / 10) &&
            e.brier !== null,
        );
        return {
          label: `${i * 10}–${(i + 1) * 10}%`,
          value: sample.length ? mean(sample.map((e) => e.p!))! * 100 : NaN,
          second: sample.length
            ? mean(sample.map((e) => Number(e.outcome.status === "WON")))! * 100
            : NaN,
          count: sample.length,
        };
      }),
    );
  if (report === 14 || report === 15) {
    const records = report === 14 ? jobs : emails;
    const groups = [
      ...new Set(
        records.map((r) => (report === 14 ? r.operation : r.kind) ?? "Unknown"),
      ),
    ];
    chart(
      "stacked",
      report === 14
        ? "Scheduled job outcomes by operation"
        : "Email processing outcomes by type",
      report === 14 ? "jobs" : "emails",
      "Counts use the latest 100 records. Gold includes work still pending or processing; orange indicates recorded failure or review.",
      groups.map((label) => {
        const items = records.filter(
          (r) =>
            ((report === 14 ? r.operation : r.kind) ?? "Unknown") === label,
        );
        const done = (s: string) =>
          ["sent", "done", "completed", "succeeded", "success"].includes(s);
        const failed = (s: string) =>
          ["failed", "needs_review", "error"].includes(s);
        return {
          label,
          value: items.filter((r) => done(r.status)).length,
          second: items.filter((r) => !done(r.status) && !failed(r.status))
            .length,
          high: items.filter((r) => failed(r.status)).length,
        };
      }),
      [
        report === 14 ? "Completed" : "Sent",
        "Pending / other",
        "Failed / review",
      ],
    );
  }
  const countWeeks = new Set(finalRows.map((r) => r.week)).size;
  let kpis: [string, string | number][] = [
    ["Completed Team Scores", finalRows.length],
    ["Average Projection Error", `${fixed(mae)} pts`],
    [
      "Average vs. Expectations",
      `${bias !== null && bias > 0 ? "+" : ""}${fixed(bias)} pts`,
    ],
    ["Saved Forecast Versions", forecasts.length],
  ];
  if ([1, 2, 3, 4, 12].includes(report))
    kpis = [
      ["Teams in view", teams.length],
      ["Final weeks", countWeeks],
      [
        "Lowest final score",
        finalRows.length
          ? fixed(Math.min(...finalRows.map((r) => r.actual)))
          : "—",
      ],
      [
        "Highest final score",
        finalRows.length
          ? fixed(Math.max(...finalRows.map((r) => r.actual)))
          : "—",
      ],
    ];
  if ([5, 6, 7].includes(report))
    kpis = [
      ["Teams in view", teams.length],
      [
        "Latest forecast selections",
        currentQuotes.filter((q) => !team || q.team_id === team).length,
      ],
      [
        "Simulation trials",
        currentQuotes.length
          ? Number(currentQuotes[0].metadata.trials ?? 0).toLocaleString()
          : "—",
      ],
      [
        "Archived future revisions",
        forecasts.filter((f) => f.board_type === "future").length,
      ],
    ];
  if (report === 8) {
    const settled = filteredTickets.filter((t) =>
        ["WON", "LOST", "PUSH"].includes(t.status),
      ),
      stake = settled.reduce((n, t) => n + Number(t.stake), 0),
      profit = settled.reduce(
        (n, t) => n + Number(t.actual_payout) - Number(t.stake),
        0,
      );
    kpis = [
      ["Settled tickets", settled.length],
      ["Settled stakes", money(stake)],
      ["Net settled profit", money(profit)],
      ["Return on settled stakes", percent(stake ? profit / stake : null)],
    ];
  }
  if (report === 9)
    kpis = [
      ["Balance entries", table.length],
      ["Teams in view", teams.length],
      [
        "Recorded current cash",
        money(
          data.wallets
            .filter((w) => teams.some((t) => t.id === w.team_id))
            .reduce((n, w) => n + Number(w.balance), 0),
        ),
      ],
      ["Displayed history", "Latest available"],
    ];
  if (report === 10)
    kpis = [
      ["Unique selection labels", table.length],
      ["Ticket appearances", table.reduce((n, r) => n + number(r[1]), 0)],
      ["Most selected appearances", table[0]?.[1] ?? "—"],
      ["Stake basis", "Per appearance"],
    ];
  if (report === 11) {
    const open = filteredTickets.filter((t) => t.status === "OPEN");
    kpis = [
      ["Open tickets", open.length],
      [
        "Weekly stakes",
        money(
          open
            .filter((t) => t.ticket_type !== "future")
            .reduce((n, t) => n + Number(t.stake), 0),
        ),
      ],
      [
        "Futures stakes",
        money(
          open
            .filter((t) => t.ticket_type === "future")
            .reduce((n, t) => n + Number(t.stake), 0),
        ),
      ],
      [
        "Total committed stakes",
        money(open.reduce((n, t) => n + Number(t.stake), 0)),
      ],
    ];
  }
  if (report === 13)
    kpis = [
      ["Opening selections evaluated", evaluations.length],
      [
        "Binary outcomes with probabilities",
        evaluations.filter((e) => e.brier !== null).length,
      ],
      [
        "Mean Brier score",
        fixed(
          mean(evaluations.flatMap((e) => (e.brier === null ? [] : [e.brier]))),
          3,
        ),
      ],
      ["Forecast versions archived", forecasts.length],
    ];
  if ([14, 15].includes(report)) {
    const records = report === 14 ? jobs : emails;
    kpis = [
      ["Records in view", records.length],
      [
        report === 14 ? "Completed" : "Provider accepted",
        records.filter((r) => r.status === (report === 14 ? "done" : "sent"))
          .length,
      ],
      [
        "Failed / review",
        records.filter((r) => ["failed", "needs_review"].includes(r.status))
          .length,
      ],
      [
        "Pending / processing",
        records.filter((r) =>
          ["pending", "running", "sending"].includes(r.status),
        ).length,
      ],
    ];
  }
  const download = async (format: "png" | "pdf") => {
    setExportOpen(false);
    if (!exportNode.current) return;
    setExporting(true);
    try {
      await exportReport(
        exportNode.current,
        `league-${leagueId}-${titles[report].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${season}${week ? `-week-${week}` : ""}`,
        format,
      );
      setNotice(
        `${format.toUpperCase()} prepared with the selected filters. Long detail tables show 40 rows; CSV includes every row.`,
      );
    } catch (e) {
      setNotice(`Export failed: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  };
  if (report === 0)
    add(
      [
        "Team",
        "Week",
        "Actual",
        "Projected",
        "Difference",
        "Projection basis",
        "Status",
        "Team Total Difference",
        "Team Average Difference",
      ],
      rows.map((r) => [
        owner(r.team),
        r.week,
        r.actual,
        r.projection ?? "",
        r.error ?? "",
        r.basis,
        r.final ? "Final" : "Live",
        teamPerformance(r.team).total ?? "",
        teamPerformance(r.team).average ?? "",
      ]),
    );
  const exportCsv = () => {
    setExportOpen(false);
    const csv = [columns, ...table]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `league-${leagueId}-report-${season}-${report}${week ? `-week-${week}` : ""}.csv`;
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
            onChange={(e) => {
              const next = Number(e.target.value);
              setReport(next);
              if (!previewData) navigate(`/admin/reports?report=${next}`);
              if ([5, 6, 7, 9, 14, 15].includes(next)) setWeek(0);
              if ([12, 14, 15].includes(next)) setTeam("");
            }}
          >
            {reportGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.reports.map((i) => (
                  <option key={i} value={i}>
                    {titles[i]}
                  </option>
                ))}
              </optgroup>
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
            disabled={[5, 6, 7, 9, 14, 15].includes(report)}
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            <option value={0}>All weeks</option>
            {[
              ...new Set(
                (report === 0 ? weeks.filter((w) => w.final) : weeks).map(
                  (w) => w.market_week,
                ),
              ),
            ].map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select
            disabled={[12, 14, 15].includes(report)}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
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
          {busy ? "Refreshing…" : "Refresh Sleeper Data"}
        </button>
        <div className="report-export-menu" ref={exportMenu}>
          <button
            disabled={exporting}
            aria-expanded={exportOpen}
            aria-controls="report-export-options"
            onClick={() => setExportOpen(!exportOpen)}
          >
            <span aria-hidden="true">↓</span>{" "}
            {exporting ? "Exporting…" : "Export"}{" "}
            <span aria-hidden="true">⌄</span>
          </button>
          {exportOpen && (
            <div id="report-export-options" className="report-export-options">
              <span>Export this report</span>
              <button onClick={() => void download("pdf")}>
                <span aria-hidden="true">▤</span> PDF Document
              </button>
              <button onClick={() => void download("png")}>
                <span aria-hidden="true">▧</span> PNG Image
              </button>
              <button disabled={!table.length} onClick={exportCsv}>
                <span aria-hidden="true">▦</span> CSV Data
              </button>
            </div>
          )}
        </div>
      </div>
      {notice && (
        <p
          role="status"
          className={`report-notice ${/failed|error/i.test(notice) ? "error" : ""}`}
        >
          {notice}
        </p>
      )}
      <div ref={exportNode} className="report-export-surface">
        {report === 13 && !previewData && (
          <ModelReview key={leagueId} leagueId={leagueId} />
        )}
        <div className="report-export-context">
          <strong>{league.name}</strong>
          <span>{season}</span>
          <span>
            {week
              ? `Week ${week}`
              : report === 0
                ? "Completed Weeks"
                : "All Weeks"}
          </span>
          <span>{team ? owner(team) : "All Teams"}</span>
        </div>
        <div className="report-kpis">
          {kpis.map(([label, value], index) => (
            <article key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
              {report === 0 && (
                <p className="report-kpi-help">
                  {
                    [
                      "Number of completed team scores in view.",
                      "Average miss in points, ignoring direction (MAE).",
                      "Positive means actual scores beat projections on average.",
                      "Archived snapshots, including recalculations; not an accuracy score.",
                    ][index]
                  }
                </p>
              )}
            </article>
          ))}
        </div>
        <article className="admin-panel">
          <div className="report-heading">
            <h2>{titles[report]}</h2>
            <small>Page checked {asOf || "—"} · Eastern</small>
          </div>
          <p className="report-description">{descriptions[report]}</p>
          <section className="report-note" aria-label="Report source freshness">
            <strong>
              Source coverage:{" "}
              {weeks.filter((w) => w.final).length
                ? `through completed Week ${Math.max(...weeks.filter((w) => w.final).map((w) => w.market_week))}`
                : "no completed weeks saved"}
            </strong>
            <p>
              Last successful results import:{" "}
              {weeks.length
                ? new Date(
                    Math.max(...weeks.map((w) => Date.parse(w.fetched_at))),
                  ).toLocaleString("en-US", { timeZone: "America/New_York" }) +
                  " Eastern"
                : "Not imported yet"}
              . Source age is separate from the page check time.
            </p>
            {Array.from({ length: expectedCompleted }, (_, i) => i + 1)
              .filter(
                (w) => !weeks.some((row) => row.market_week === w && row.final),
              )
              .map((w) => (
                <p key={w}>
                  Week {w}:{" "}
                  {weeks.some((row) => row.market_week === w)
                    ? "Waiting for confirmed final source results."
                    : "No saved results yet. Refresh results to import this week."}
                </p>
              ))}
          </section>
          {report === 13 && (
            <p className="report-note report-model-explainer">
              This report needs an original archived opening forecast and a
              final result for the same week. Current-week markets cannot be
              graded until games finish. Reconstructed historical player
              projections do not substitute for original sportsbook lines.
              Futures are evaluated when their season outcomes are confirmed.
            </p>
          )}
          {report === 1 && <ScoreTrend rows={finalRows} owner={owner} />}
          {figure && <ReportFigure spec={figure} />}
          {report === 0 ? (
            <>
              <p className="report-note">
                Actual minus projected points. Blue = overperformance; orange =
                underperformance. HIGH / LOW mark each week's largest deviation.
                Only completed weeks are included. Total and average show each
                team's performance against expectations across the selected
                completed weeks.
              </p>
              <div className="report-table-wrap">
                <table className="score-heatmap">
                  <thead>
                    <tr>
                      <th>Team</th>
                      {completedWeeks.map((w) => (
                        <th key={w.market_week}>
                          Week {w.market_week}
                          <small>{w.final ? "Final" : "Live"}</small>
                        </th>
                      ))}
                      <th data-summary="true">
                        Total Difference<small>Actual − projected</small>
                      </th>
                      <th data-summary="true">
                        Average Difference<small>Per measured week</small>
                      </th>
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
                        {completedWeeks.map((w) => {
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
                        {[
                          teamPerformance(t.id).total,
                          teamPerformance(t.id).average,
                        ].map((value, i) => (
                          <td key={`summary-${i}`}>
                            <span
                              className={`report-performance ${value !== null && value >= 0 ? "over" : "under"}`}
                            >
                              {value !== null && value > 0 ? "+" : ""}
                              {fixed(value)}
                              <small>pts</small>
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="report-note">
                Cell footer: actual / projected. Historical starter projections
                are reconstructed from current provider data; they are not
                original pregame sportsbook forecasts. Hover a cell for its
                basis.
              </p>
            </>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {columns.map((c, i) => (
                      <th key={`${i}:${c}`}>{c}</th>
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
          {[5, 6, 7, 9, 14, 15].includes(report) && (
            <p className="report-note">
              Week filters do not apply to current season outlooks, wallet
              history or operations logs. These views show the latest available
              records.
            </p>
          )}
          {report === 2 && (
            <p className="report-note">
              *Matchup ties count as half a win. All-play rate counts wins
              against every other team that week, ties as half-wins. Expected
              wins is the sum of weekly all-play rates; it measures schedule
              luck rather than forecasting.
            </p>
          )}
          {report === 4 && (
            <p className="report-note">
              *The optimal score uses the eligible roster archived at opening,
              not later waiver additions. Missing archived eligibility or player
              scores produces an unavailable value, rather than a guessed
              optimum. Players without provider names retain their Sleeper IDs.
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
                unresolved/push outcomes from Brier scores. Each binary market
                is counted once. Lower Brier scores are better; small samples
                are preliminary.
              </p>
              <h3>Accuracy by market and model</h3>
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Model</th>
                      <th>Evaluated</th>
                      <th>Mean absolute error</th>
                      <th>Mean Brier score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...new Set(
                        evaluations.map(
                          (e) =>
                            `${e.q.kind}|${String(e.q.metadata.model_version ?? "Unavailable")}`,
                        ),
                      ),
                    ].map((key) => {
                      const [kind, model] = key.split("|");
                      const sample = evaluations.filter(
                        (e) =>
                          e.q.kind === kind &&
                          String(
                            e.q.metadata.model_version ?? "Unavailable",
                          ) === model,
                      );
                      return (
                        <tr key={key}>
                          <td>{marketType[kind as Market["kind"]]}</td>
                          <td>{model}</td>
                          <td>{sample.length}</td>
                          <td>
                            {fixed(
                              mean(
                                sample.flatMap((e) =>
                                  e.error === null ? [] : [Math.abs(e.error)],
                                ),
                              ),
                              2,
                            )}{" "}
                            {kind.includes("count") ? "teams" : "points"}
                          </td>
                          <td>
                            {fixed(
                              mean(
                                sample.flatMap((e) =>
                                  e.brier === null ? [] : [e.brier],
                                ),
                              ),
                              3,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="report-note">
                Error units stay separate by market. A blank value means the
                measure is unavailable or does not apply. Team filters omit
                league-wide specials.
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
                      <th>Brier score</th>
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
                              <td>
                                {new Date(f.captured_at).toLocaleString(
                                  "en-US",
                                  { timeZone: "America/New_York" },
                                )}
                              </td>
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
                              <td>
                                {["WON", "LOST"].includes(
                                  futureOutcome(q).status,
                                ) &&
                                typeof q.metadata.simulated_probability ===
                                  "number"
                                  ? fixed(
                                      (q.metadata.simulated_probability -
                                        Number(
                                          futureOutcome(q).status === "WON",
                                        )) **
                                        2,
                                      3,
                                    )
                                  : "—"}
                              </td>
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
              Latest 100 records. “Sent” means accepted by the email provider,
              not confirmed inbox delivery.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
