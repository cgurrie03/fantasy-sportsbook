import { useEffect, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage } from "../lib/accounts";
import type { Board, Market } from "../lib/markets";
import {
  formatOdds,
  loadMarketBoard,
  marketType,
  orderMatchups,
  weeklyKinds,
} from "../lib/markets";
import { supabase } from "../lib/supabase";
import "./Sportsbook.css";
import { FuturesAdmin } from "./SeasonFutures";

export function easternTimestamp(value: string) {
  let date = new Date(value + "Z");
  for (let i = 0; i < 2; i++) {
    const displayed = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(" ", "T");
    const difference = Date.parse(value + "Z") - Date.parse(displayed + "Z");
    date = new Date(date.getTime() + difference);
  }
  return date.toISOString();
}
function wallTime(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" ", "T");
}
export function weeklyTimes(week: number, nflSeason: number) {
  const seasonStart = new Date(Date.UTC(nflSeason, 8, 1));
  const day = seasonStart.getUTCDay();
  seasonStart.setUTCDate(8 + ((4 - day + 7) % 7) + 7 * (week - 1));
  const cutoff = seasonStart.toISOString().slice(0, 10) + "T20:00";
  seasonStart.setUTCDate(seasonStart.getUTCDate() - 1);
  return {
    opens_at: easternTimestamp(
      seasonStart.toISOString().slice(0, 10) + "T08:00",
    ),
    closes_at: easternTimestamp(cutoff),
  };
}

export function MarketAdmin({
  data,
  leagueId,
  review,
}: {
  data: AccountData;
  leagueId: string;
  review?: { board: Board; markets: Market[] };
}) {
  const [board, setBoard] = useState<Board | null>(review?.board ?? null);
  const [markets, setMarkets] = useState<Market[]>(review?.markets ?? []);
  const [notice, setNotice] = useState<{
    text: string;
    tone: "error" | "success" | "info";
  }>({ text: "", tone: "info" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!!review);
  const [category, setCategory] = useState("Matchups");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const league = data.leagues.find((l) => l.id === leagueId);
  const teams = data.teams.filter((t) => t.league_id === leagueId);
  const team = (id: string) => teams.find((t) => t.id === id);
  const message = (text: string, tone: "error" | "success" | "info" = "info") =>
    setNotice({ text, tone });

  useEffect(() => {
    if (review) return;
    let active = true;
    loadMarketBoard(leagueId)
      .then((r) => {
        if (!active) return;
        setMarkets(r.markets);
        const fallback = {
          id: crypto.randomUUID(),
          league_id: leagueId,
          market_week: r.week,
          nfl_season: league?.nfl_season ?? 2026,
          league_season: league?.league_season ?? 3,
          status: "draft" as const,
          revision: 0,
          ...weeklyTimes(r.week, league?.nfl_season ?? 2026),
        };
        const loadedBoard = r.board ?? fallback;
        const times =
          loadedBoard.status === "draft" &&
          Date.parse(loadedBoard.closes_at) <= Date.now()
            ? weeklyTimes(loadedBoard.market_week, loadedBoard.nfl_season)
            : {
                opens_at: loadedBoard.opens_at,
                closes_at: loadedBoard.closes_at,
              };
        setBoard({ ...loadedBoard, ...times });
        setLoaded(true);
      })
      .catch((e) => {
        if (active) message(errorMessage(e), "error");
      });
    return () => {
      active = false;
    };
  }, [leagueId, league?.nfl_season, league?.league_season, review]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const matchups = orderMatchups(
    [
      ...new Set(
        markets.map((m) => m.matchup_key).filter((id): id is string => !!id),
      ),
    ].map((id) => markets.filter((m) => m.matchup_key === id)),
    teams,
  );
  const marketOpen =
    !!board &&
    board.status === "published" &&
    now >= Date.parse(board.opens_at) &&
    now < Date.parse(board.closes_at);
  const categoryKinds =
    category === "Matchups"
      ? ["spread", "moneyline", "match_total", "team_total"]
      : category === "Player Points"
        ? ["player_points"]
        : weeklyKinds;
  const hasGeneratedLines = markets.some((m) => categoryKinds.includes(m.kind));

  async function generate() {
    if (review || busy) return;
    setBusy(true);
    message("");
    try {
      const session = (await supabase!.auth.getSession()).data.session;
      if (!session) throw new Error("Sign in before generating markets.");
      const response = await fetch("/api/generate-markets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          league_id: leagueId,
          week: board?.market_week ?? 5,
          nfl_season: board?.nfl_season ?? 2026,
          category,
        }),
      });
      const raw = await response.text();
      let result: { quotes?: Market[]; error?: string; warnings?: string[] };
      try {
        result = JSON.parse(raw) as {
          quotes?: Market[];
          error?: string;
          warnings?: string[];
        };
      } catch {
        throw new Error(
          raw.slice(0, 240) || `Market generation failed (${response.status}).`,
        );
      }
      if (!response.ok)
        throw new Error(result.error ?? "Market generation failed.");
      const quotes = result.quotes ?? [];
      const normalized = quotes.map((quote) => {
        const existing = markets.find(
          (m) => m.market_key === quote.market_key && m.side === quote.side,
        );
        return existing ? { ...quote, id: existing.id } : quote;
      });
      const generated =
        category === "Player Points"
          ? normalized.map((quote) => {
              const matchup = markets.find(
                (m) =>
                  m.kind === "spread" &&
                  m.home_team_id === quote.home_team_id &&
                  m.away_team_id === quote.away_team_id,
              );
              return matchup
                ? { ...quote, matchup_key: matchup.matchup_key }
                : quote;
            })
          : normalized;
      const replacedKinds =
        category === "Matchups"
          ? ["spread", "moneyline", "match_total", "team_total"]
          : category === "Player Points"
            ? ["player_points"]
            : weeklyKinds;
      setMarkets([
        ...markets.filter((m) => !replacedKinds.includes(m.kind)),
        ...generated,
      ]);
      setEditingKey(null);
      message(
        `Generated ${quotes.length} ${category.toLowerCase()} markets from Sleeper data. Review them before publishing.${result.warnings?.length ? " " + result.warnings.join(" ") : ""}`,
        result.warnings?.length ? "info" : "success",
      );
    } catch (e) {
      message(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  function feature(key: string, title: Market["featured"]) {
    setMarkets(
      markets.map((m) => {
        const featured =
          m.matchup_key === key
            ? title
            : title && m.featured === title
              ? ""
              : m.featured;
        return {
          ...m,
          featured,
          boost_pct:
            (featured === "Game of the Week" && m.kind === "moneyline") ||
            (featured === "Tank Bowl" &&
              (m.kind === "moneyline" ||
                (m.kind === "match_total" && m.side === "over")))
              ? 25
              : 0,
        };
      }),
    );
  }
  async function save(status: Board["status"]) {
    if (!board || busy) return;
    if (review) {
      message("This is a local review. No markets were saved or published.");
      return;
    }
    if (status === "published" && !markets.length) {
      message("Generate at least one market before publishing.", "error");
      return;
    }
    if (status === "published" && Date.parse(board.closes_at) <= Date.now()) {
      message("Set a future cutoff time before publishing.", "error");
      return;
    }
    if (
      status === "published" &&
      markets.some((m) => m.kind === "spread") &&
      (!markets.some((m) => m.featured === "Game of the Week") ||
        matchups.length !== teams.length / 2)
    ) {
      message(
        "Add all league matchups and choose a Game of the Week before publishing.",
        "error",
      );
      return;
    }
    setBusy(true);
    message("");
    try {
      const r = await supabase!.rpc("save_market_board", {
        p_board: board.id,
        p_league: leagueId,
        p_week: board.market_week,
        p_opens: board.opens_at,
        p_closes: board.closes_at,
        p_quotes: markets,
        p_status: status,
      });
      if (r.error) throw r.error;
      const next = await loadMarketBoard(leagueId);
      setBoard(next.board);
      setMarkets(next.markets);
      message(
        status === "published"
          ? "Market board published. Betting will follow the opening and cutoff times."
          : "Betting closed manually. Use Open Betting Market to reopen it.",
        "success",
      );
    } catch (e) {
      message(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function toggleBetting() {
    await save(marketOpen ? "closed" : "published");
  }
  function renderQuotes(quotes: Market[]) {
    return (
      quotes.length > 0 && (
        <div className="market-edit-list">
          {quotes.map((m) => (
            <div className="market-edit-row" key={m.id}>
              <span>
                <strong>{m.label}</strong>
                <small>
                  {marketType[m.kind]}
                  {m.boost_pct ? " · 25% Profit Boost" : ""}
                </small>
              </span>
              {m.line != null && (
                <label>
                  Line
                  <input
                    aria-label={`Line for ${m.label}`}
                    type="number"
                    step="0.1"
                    value={m.line}
                    onChange={(e) => {
                      const line = Number(e.target.value);
                      setMarkets(
                        markets.map((q) => {
                          if (q.market_key !== m.market_key) return q;
                          const nextLine =
                            q.kind === "spread" && q.id !== m.id ? -line : line;
                          return {
                            ...q,
                            line: nextLine,
                            label:
                              q.subject +
                              " " +
                              (q.kind === "spread"
                                ? (nextLine > 0 ? "+" : "") + nextLine
                                : (q.side === "over" ? "Over " : "Under ") +
                                  nextLine),
                          };
                        }),
                      );
                    }}
                  />
                </label>
              )}
              <label>
                Odds
                <input
                  aria-label={`Odds for ${m.label}`}
                  type="number"
                  step="1"
                  value={m.odds}
                  onChange={(e) =>
                    setMarkets(
                      markets.map((q) =>
                        q.id === m.id
                          ? { ...q, odds: Number(e.target.value) }
                          : q,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
      )
    );
  }
  function lineRows(group: Market[], kind: Market["kind"]) {
    return group
      .filter((m) => m.kind === kind)
      .map((m) => (
        <div className="matchup-preview-line" key={m.id}>
          <span>
            {m.kind === "match_total"
              ? m.side === "over"
                ? "Over"
                : "Under"
              : m.subject}
          </span>
          <strong>
            {m.line != null
              ? `${m.kind === "spread" && Number(m.line) > 0 ? "+" : ""}${m.line}`
              : formatOdds(m.odds)}
            {m.boost_pct ? " · Boosted" : ""}
          </strong>
        </div>
      ));
  }
  function playerRows(group: Market[], teamId: string | null) {
    const keys = [
      ...new Set(
        group
          .filter((m) => m.kind === "player_points" && m.team_id === teamId)
          .map((m) => m.market_key),
      ),
    ];
    return (
      <div className="player-points-rows">
        {keys.map((key) => {
          const pair = group.filter((m) => m.market_key === key);
          const first = pair[0];
          return (
            <div className="player-points-row" key={key}>
              <span>
                <strong>{first.subject}</strong>
                <small>
                  {String(first.metadata?.position ?? "Player")} · Projected:{" "}
                  {first.metadata?.projection ?? first.line ?? "—"}
                </small>
              </span>
              <div>
                {pair.map((m) => (
                  <span key={m.id}>
                    {m.side === "over" ? "Over" : "Under"} {m.line}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="market-admin">
      {!loaded ? (
        <p>Loading market controls…</p>
      ) : (
        board && (
          <>
            <div className={`market-admin-notice ${notice.tone}`} role="status">
              {notice.text && <strong>{notice.text}</strong>}
            </div>
            <div className="market-season-heading">
              <p className="eyebrow">
                SEASON {board.league_season} • WEEK {board.market_week}
              </p>
              <span className="muted">
                {marketOpen
                  ? "Betting Open"
                  : board.status === "closed"
                    ? "Manually Closed"
                    : "Scheduled"}
              </span>
            </div>
            <div className="market-admin-actions market-admin-actions-top">
              <label>
                Betting Type
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option>Matchups</option>
                  <option>Player Points</option>
                  <option>Weekly Specials</option>
                  <option>Season Futures</option>
                </select>
              </label>
              {category !== "Season Futures" && (
                <>
                  <button
                    className="primary generate-lines"
                    onClick={() => void generate()}
                    disabled={busy}
                  >
                    {hasGeneratedLines ? "Recalculate Lines" : "Generate Lines"}
                  </button>
                  <button
                    className="primary"
                    onClick={() => void save("published")}
                    disabled={busy || !markets.length}
                  >
                    Publish Board
                  </button>
                  <button
                    onClick={() => void toggleBetting()}
                    disabled={busy || !markets.length}
                  >
                    {marketOpen
                      ? "Close Betting Market"
                      : "Open Betting Market"}
                  </button>
                </>
              )}
            </div>
            {category === "Season Futures" ? (
              <FuturesAdmin
                data={data}
                leagueId={leagueId}
                week={board.market_week}
                season={board.nfl_season}
              />
            ) : (
              <div className="market-admin-times market-admin-times-split">
                <label>
                  Opening · Eastern
                  <input
                    type="datetime-local"
                    value={wallTime(board.opens_at)}
                    onChange={(e) => {
                      if (e.target.value)
                        setBoard({
                          ...board,
                          opens_at: easternTimestamp(e.target.value),
                        });
                    }}
                  />
                </label>
                <span className="time-divider">→</span>
                <label>
                  Cutoff · Eastern
                  <input
                    type="datetime-local"
                    value={wallTime(board.closes_at)}
                    onChange={(e) => {
                      if (e.target.value)
                        setBoard({
                          ...board,
                          closes_at: easternTimestamp(e.target.value),
                        });
                    }}
                  />
                </label>
              </div>
            )}
            <p className="muted">
              Recalculate using the latest Sleeper data at any time. Only the
              selected betting type is replaced; accepted tickets keep their
              original picks and odds. Review the updated markets before
              publishing.
            </p>
            {category === "Matchups" && (
              <div className="market-admin-preview">
                {matchups.map((g) => {
                  const first = g[0],
                    home = team(first.home_team_id ?? ""),
                    away = team(first.away_team_id ?? "");
                  return (
                    <article
                      className="market-preview-card"
                      key={first.matchup_key}
                    >
                      <header>
                        <div>
                          <h2>
                            {home?.team_name} vs. {away?.team_name}
                          </h2>
                          <p>
                            {home?.wins}–{home?.losses} · Projected{" "}
                            {first.home_projection} vs. {away?.wins}–
                            {away?.losses} · Projected {first.away_projection}
                          </p>
                        </div>
                        <div className="matchup-controls">
                          <select
                            aria-label="Featured Matchup"
                            value={first.featured}
                            onChange={(e) =>
                              feature(
                                first.matchup_key!,
                                e.target.value as Market["featured"],
                              )
                            }
                          >
                            <option value="">No Feature</option>
                            <option>Game of the Week</option>
                            <option>Tank Bowl</option>
                          </select>
                          <button
                            aria-label={`Edit ${home?.team_name} vs. ${away?.team_name}`}
                            onClick={() =>
                              setEditingKey(
                                editingKey === first.matchup_key
                                  ? null
                                  : first.matchup_key,
                              )
                            }
                          >
                            ✎
                          </button>
                        </div>
                      </header>
                      <div className="market-preview-columns">
                        <div>
                          <small>Spread</small>
                          <div className="matchup-preview-lines">
                            {lineRows(g, "spread")}
                          </div>
                        </div>
                        <div>
                          <small>Match Total</small>
                          <div className="matchup-preview-lines">
                            {lineRows(g, "match_total")}
                          </div>
                        </div>
                        <div>
                          <small>Moneyline</small>
                          <div className="matchup-preview-lines">
                            {lineRows(g, "moneyline")}
                          </div>
                        </div>
                      </div>
                      <details className="admin-team-totals">
                        <summary>Team Totals</summary>
                        <div className="player-points-preview">
                          {[home, away].map((t) => (
                            <div key={t?.id}>
                              <h3>{t?.team_name}</h3>
                              {g
                                .filter(
                                  (q) =>
                                    q.kind === "team_total" &&
                                    q.team_id === t?.id,
                                )
                                .map((q) => (
                                  <div
                                    className="matchup-preview-line"
                                    key={q.id}
                                  >
                                    <span>
                                      {q.side === "over" ? "Over" : "Under"}
                                    </span>
                                    <strong>{q.line}</strong>
                                  </div>
                                ))}
                            </div>
                          ))}
                        </div>
                      </details>
                      {editingKey === first.matchup_key && (
                        <div className="matchup-editor">
                          {renderQuotes(
                            g.filter((q) => q.kind !== "player_points"),
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {category === "Player Points" && (
              <div className="market-admin-preview">
                <p className="muted">
                  The top 12 players from each matchup’s best projected lineups
                  are shown.
                </p>
                {matchups.map((g) => {
                  const first = g[0],
                    home = team(first.home_team_id ?? ""),
                    away = team(first.away_team_id ?? "");
                  return (
                    <article
                      className="market-preview-card"
                      key={first.matchup_key}
                    >
                      <header>
                        <div>
                          <h2>
                            {home?.team_name} vs. {away?.team_name}
                          </h2>
                          <p>
                            {home?.wins}–{home?.losses} · Projected{" "}
                            {first.home_projection ?? "—"} vs. {away?.wins}–
                            {away?.losses} · Projected{" "}
                            {first.away_projection ?? "—"}
                          </p>
                        </div>
                        <div className="matchup-controls">
                          <button
                            aria-label={`Edit ${home?.team_name} vs. ${away?.team_name} player points`}
                            onClick={() =>
                              setEditingKey(
                                editingKey === first.matchup_key
                                  ? null
                                  : first.matchup_key,
                              )
                            }
                          >
                            ✎
                          </button>
                        </div>
                      </header>
                      <div className="player-points-preview">
                        <div>
                          <h3>{home?.team_name}</h3>
                          {playerRows(g, first.home_team_id)}
                        </div>
                        <div>
                          <h3>{away?.team_name}</h3>
                          {playerRows(g, first.away_team_id)}
                        </div>
                      </div>
                      {editingKey === first.matchup_key && (
                        <div className="matchup-editor">
                          {renderQuotes(
                            g.filter((m) => m.kind === "player_points"),
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {category === "Weekly Specials" && (
              <div className="props-grid">
                {weeklyKinds.map((kind) => (
                  <article className="prop-card" key={kind}>
                    <h2>{marketType[kind as Market["kind"]]}</h2>
                    {markets
                      .filter((q) => q.kind === kind)
                      .sort((a, b) => a.odds - b.odds)
                      .slice(
                        0,
                        kind === "weekly_high" || kind === "weekly_low"
                          ? 6
                          : 12,
                      )
                      .map((q) => (
                        <div className="matchup-preview-line" key={q.id}>
                          <span>{q.label}</span>
                          <strong>{formatOdds(q.odds)}</strong>
                        </div>
                      ))}
                    {!markets.some((q) => q.kind === kind) && (
                      <p>
                        Generate weekly specials to preview the selections and
                        odds.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
