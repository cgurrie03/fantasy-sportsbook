import { useEffect, useRef, useState } from "react";
import type { AccountData, Membership, Team } from "../lib/accounts";
import { errorMessage, money } from "../lib/accounts";
import type { Board, Market } from "../lib/markets";
import {
  americanPrice,
  combinedPrice,
  formatOdds,
  loadMarketBoard,
  marketType,
  pickConflict,
  placeTicket,
  selectionPrice,
  orderMatchups,
  weeklyKinds,
  canPlacePicks,
} from "../lib/markets";
import { supabase } from "../lib/supabase";
import { Chevron, TicketHistory } from "./TicketHistory";
import { WeeklyCountPicker } from "./WeeklyCountPicker";
import "./Sportsbook.css";

export interface Standing {
  team_id: string;
  bets_placed: number;
  bets_won: number;
  bets_lost: number;
  bets_push: number;
  total_wagered: number;
  total_payout: number;
  net_profit: number;
  roi: number;
  win_percentage: number;
  biggest_parlay_legs: number;
  biggest_parlay_odds: number;
  biggest_payout: number;
  current_balance: number;
}
export interface BoardReview {
  board: Board;
  markets: Market[];
  standings: Standing[];
}
export function Sportsbook({
  data,
  member,
  refresh,
  review,
}: {
  data: AccountData;
  member: Membership;
  refresh: () => Promise<void>;
  review?: BoardReview;
}) {
  const [tab, setTab] = useState("Home"),
    [board, setBoard] = useState<Board | null>(review?.board ?? null),
    [markets, setMarkets] = useState<Market[]>(review?.markets ?? []),
    [week, setWeek] = useState(review?.board.market_week ?? 5),
    [standings, setStandings] = useState<Standing[]>(review?.standings ?? []),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(!review),
    [category, setCategory] = useState("Matchups"),
    [matchup, setMatchup] = useState("all"),
    [picks, setPicks] = useState<Market[]>([]),
    [open, setOpen] = useState(false),
    [stake, setStake] = useState("0"),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    banner = useRef<HTMLButtonElement>(null),
    request = useRef({ key: "", id: "" });
  const balance = Number(
      data.wallets.find((w) => w.team_id === member.team_id)?.balance ?? 0,
    ),
    wager = Number(stake),
    price = combinedPrice(picks),
    valid =
      canPlacePicks(picks) &&
      wager >= 1 &&
      wager <= balance &&
      Math.round(wager * 100) === wager * 100;
  const team = (id: string | null) => data.teams.find((t) => t.id === id),
    owner = (id: string) =>
      data.memberships.find((m) => m.team_id === id)?.display_name ??
      "League Member";
  const groups = [
    ...new Set(
      markets.filter((m) => m.kind === "spread").map((m) => m.matchup_key),
    ),
  ]
    .filter((id): id is string => !!id)
    .map((id) => markets.filter((m) => m.matchup_key === id));
  const record = (t: Team | undefined) =>
    t ? `${t.wins}–${t.losses}${t.ties ? "–" + t.ties : ""}` : "—";
  groups.splice(0, groups.length, ...orderMatchups(groups, data.teams));
  const preferredMatchup =
    groups.find(
      (g) =>
        g[0].home_team_id === member.team_id ||
        g[0].away_team_id === member.team_id,
    )?.[0].matchup_key ??
    groups[0]?.[0].matchup_key ??
    "";
  const selectedMatchup = groups.some((g) => g[0].matchup_key === matchup)
    ? matchup
    : preferredMatchup;
  const playerMatch = groups.find(
    (g) => g[0].matchup_key === selectedMatchup,
  )?.[0];
  const name = (m: Market) =>
    m.home_team_id && m.away_team_id
      ? `${team(m.home_team_id)?.team_name} vs. ${team(m.away_team_id)?.team_name}${m.featured ? " • " + m.featured : ""}`
      : m.subject;
  const accepting =
    !!board &&
    board.status === "published" &&
    clock >= Date.parse(board.opens_at) &&
    clock < Date.parse(board.closes_at);
  useEffect(() => {
    if (review) return;
    let active = true;
    setLoading(true);
    Promise.all([
      loadMarketBoard(member.league_id),
      supabase?.rpc("league_leaderboard", { p_league: member.league_id }),
    ])
      .then(([r, s]) => {
        if (!active) return;
        setBoard(r.board);
        setMarkets(r.markets);
        setWeek(r.week);
        if (s?.error) throw s.error;
        setStandings(s?.data ?? []);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [member.league_id, review, data.tickets]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  function toggle(m: Market) {
    if (busy || m.metadata.lineup_locked) return;
    setNotice("");
    if (picks.some((p) => p.id === m.id)) {
      setPicks(picks.filter((p) => p.id !== m.id));
      return;
    }
    const conflict = pickConflict(picks, m);
    if (conflict) {
      setNotice(conflict);
      return;
    }
    setPicks([...picks, m]);
  }
  async function submit() {
    if (!board || !valid || busy) return;
    if (review) {
      setNotice("This is a local review. No bet was placed or email sent.");
      return;
    }
    setBusy(true);
    setNotice("");
    const key = JSON.stringify([
      board.id,
      board.revision,
      picks.map((p) => p.id),
      wager,
    ]);
    if (request.current.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const result = await placeTicket(board, picks, wager, request.current.id);
      setPicks([]);
      setStake("0");
      setOpen(false);
      setNotice(
        result.email_status === "sent"
          ? "Bet placed. Your confirmation email is on its way."
          : "Bet placed. Your confirmation email is awaiting delivery.",
      );
      await refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function quote(m: Market | undefined, short?: string) {
    if (!m) return <span className="quote-empty">—</span>;
    const selected = picks.some((p) => p.id === m.id);
    return (
      <button
        type="button"
        className={`market-quote${selected ? " selected" : ""}${m.boost_pct ? " boosted" : ""}`}
        title={
          m.metadata.lineup_locked ? String(m.metadata.lock_reason) : undefined
        }
        aria-label={
          m.metadata.lineup_locked
            ? `${m.label}: Locked — incomplete projected lineup`
            : undefined
        }
        aria-pressed={selected}
        disabled={
          Boolean(m.metadata.lineup_locked) || (!accepting && !review) || busy
        }
        onClick={() => toggle(m)}
      >
        {m.metadata.lineup_locked ? (
          <>
            <svg
              className="market-lock"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="5" y="10" width="14" height="11" rx="3" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span>Locked</span>
          </>
        ) : (
          <strong>{short ?? m.label}</strong>
        )}
        {!m.metadata.lineup_locked &&
          (m.kind === "moneyline" ||
            weeklyKinds.includes(m.kind) ||
            m.boost_pct > 0) && (
            <span>
              {m.boost_pct > 0 && m.kind === "moneyline" && (
                <del>{formatOdds(m.odds)}</del>
              )}{" "}
              {formatOdds(americanPrice(selectionPrice(m)))}
            </span>
          )}
      </button>
    );
  }
  const topPlayerKeys = groups.flatMap((g) =>
    [
      ...new Set(
        g.filter((m) => m.kind === "player_points").map((m) => m.market_key),
      ),
    ]
      .sort(
        (a, b) =>
          Number(
            g.find((m) => m.market_key === b)?.metadata.expected_points ??
              g.find((m) => m.market_key === b)?.metadata.projection ??
              0,
          ) -
          Number(
            g.find((m) => m.market_key === a)?.metadata.expected_points ??
              g.find((m) => m.market_key === a)?.metadata.projection ??
              0,
          ),
      )
      .slice(0, 12),
  );
  const selectionGroups = [
    ...new Set(picks.map((p) => p.matchup_key ?? p.subject)),
  ];
  return (
    <main className="sportsbook">
      <nav className="sportsbook-tabs" aria-label="Sportsbook Navigation">
        {["Home", "My Bets", "All Bets", "Leaderboard"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="feedback" role="status">
          {notice}
        </p>
      )}
      {review && (
        <p className="review-notice">
          Design Review · Illustrative markets. Betting and email delivery are
          disabled.
        </p>
      )}
      {tab === "Home" && (
        <>
          <div className="board-heading">
            <div>
              <h1>
                <span>SEASON {board?.league_season ?? 3}</span>
                <span className="season-divider"> • </span>
                <span>WEEK {week}</span>
              </h1>
            </div>
            <div className="board-window">
              {board ? (
                <>
                  <strong>
                    {board.status === "draft"
                      ? "Draft · Admin Preview"
                      : accepting
                        ? "Betting Open"
                        : "Betting Closed"}
                  </strong>
                  <span className="board-dates">
                    <span className="board-date">
                      {new Date(board.opens_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                    </span>
                    <span className="board-date-divider">– </span>
                    <span className="board-date">
                      {new Date(board.closes_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      Eastern
                    </span>
                  </span>
                </>
              ) : (
                <strong>Markets Coming Soon</strong>
              )}
            </div>
          </div>
          <nav className="market-categories" aria-label="Market Categories">
            {[
              "Matchups",
              "Player Points",
              "Weekly Specials",
              "Season Futures",
            ].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </nav>
          {loading ? (
            <p role="status">Loading weekly markets…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !markets.length ? (
            <section className="empty">
              <h2>The Next Board Is On Its Way</h2>
              <p>
                Weekly markets appear here after your league admin publishes
                them.
              </p>
            </section>
          ) : (
            <>
              {category === "Matchups" && (
                <div className="matchup-board">
                  {groups.map((g) => {
                    const first = g[0],
                      h = team(first.home_team_id),
                      a = team(first.away_team_id);
                    return (
                      <article
                        className={`matchup-card${first.featured ? " featured-match" : ""}`}
                        key={first.matchup_key}
                      >
                        {first.featured && (
                          <div className="featured-strip">
                            <strong>
                              {first.featured === "Game of the Week" ? (
                                "★"
                              ) : (
                                <svg
                                  className="tank-icon"
                                  viewBox="0 0 32 24"
                                  aria-hidden="true"
                                  fill="currentColor"
                                >
                                  <path d="M12 4h9v3h10v3H21l-2 3H8l3-3V6h1zM6 13h19l4 5-3 5H5l-4-5z" />
                                  <path
                                    d="M7 17h17v3H7z"
                                    fill="var(--tank-track-color, #edca69)"
                                  />
                                </svg>
                              )}{" "}
                              {first.featured}
                            </strong>
                            <span>25% PROFIT BOOST</span>
                          </div>
                        )}
                        <div className="match-grid">
                          <span />
                          <span className="market-column-label">Spread</span>
                          <span className="market-column-label">Total</span>
                          <span className="market-column-label">Moneyline</span>
                          {[h, a].map((t, i) => (
                            <div className="match-team-row" key={t?.id ?? i}>
                              <div className="match-team">
                                {t?.avatar_url && (
                                  <img src={t.avatar_url} alt="" />
                                )}
                                <div>
                                  <strong>{t?.team_name}</strong>
                                  <span>{t ? owner(t.id) : ""}</span>
                                  <span>{record(t)}</span>
                                  <span>
                                    Projected:{" "}
                                    {i === 0
                                      ? first.home_projection
                                      : first.away_projection}
                                  </span>
                                </div>
                              </div>
                              {quote(
                                g.find(
                                  (m) =>
                                    m.kind === "spread" && m.team_id === t?.id,
                                ),
                                g.find(
                                  (m) =>
                                    m.kind === "spread" && m.team_id === t?.id,
                                )?.line != null
                                  ? `${Number(g.find((m) => m.kind === "spread" && m.team_id === t?.id)?.line) > 0 ? "+" : ""}${g.find((m) => m.kind === "spread" && m.team_id === t?.id)?.line}`
                                  : undefined,
                              )}
                              {quote(
                                g.find(
                                  (m) =>
                                    m.kind === "match_total" &&
                                    m.side === (i === 0 ? "over" : "under"),
                                ),
                                `${i === 0 ? "O" : "U"} ${g.find((m) => m.kind === "match_total")?.line ?? ""}`,
                              )}
                              {quote(
                                g.find(
                                  (m) =>
                                    m.kind === "moneyline" &&
                                    m.team_id === t?.id,
                                ),
                                "Win",
                              )}
                            </div>
                          ))}
                        </div>
                        <details className="team-totals">
                          <summary>
                            <strong>Team Totals</strong>
                            <Chevron />
                          </summary>
                          <div className="team-total-grid">
                            {[h, a].map((t) => (
                              <div key={t?.id}>
                                <strong>{t?.team_name}</strong>
                                <div>
                                  {quote(
                                    g.find(
                                      (m) =>
                                        m.kind === "team_total" &&
                                        m.team_id === t?.id &&
                                        m.side === "over",
                                    ),
                                    "Over " +
                                      g.find(
                                        (m) =>
                                          m.kind === "team_total" &&
                                          m.team_id === t?.id,
                                      )?.line,
                                  )}
                                  {quote(
                                    g.find(
                                      (m) =>
                                        m.kind === "team_total" &&
                                        m.team_id === t?.id &&
                                        m.side === "under",
                                    ),
                                    "Under " +
                                      g.find(
                                        (m) =>
                                          m.kind === "team_total" &&
                                          m.team_id === t?.id,
                                      )?.line,
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                        <button
                          className="projections-link"
                          onClick={() => {
                            setCategory("Player Points");
                            setMatchup(first.matchup_key ?? "all");
                          }}
                        >
                          Player Projections <span aria-hidden="true">→</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
              {category === "Player Points" && (
                <>
                  <label className="matchup-picker">
                    Matchup
                    <select
                      value={selectedMatchup}
                      onChange={(e) => setMatchup(e.target.value)}
                    >
                      {groups.map((g) => (
                        <option
                          key={g[0].matchup_key}
                          value={g[0].matchup_key ?? ""}
                        >
                          {name(g[0])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {playerMatch && (
                    <section
                      className="player-match-header"
                      aria-label="Selected matchup teams"
                    >
                      {[playerMatch.home_team_id, playerMatch.away_team_id].map(
                        (id, index) => {
                          const t = team(id);
                          return (
                            <div
                              className={`player-match-team${index === 1 ? " player-match-team-right" : ""}`}
                              key={id}
                            >
                              {t?.avatar_url ? (
                                <img src={t.avatar_url} alt="" />
                              ) : (
                                <span className="player-team-initial">
                                  {t?.team_name.slice(0, 1)}
                                </span>
                              )}
                              <div>
                                <strong>{t?.team_name}</strong>
                                <span>
                                  {owner(id ?? "")} · {record(t)}
                                </span>
                                <small>
                                  Projected:{" "}
                                  {Number(
                                    index === 0
                                      ? playerMatch.home_projection
                                      : playerMatch.away_projection,
                                  ).toFixed(1)}
                                </small>
                              </div>
                            </div>
                          );
                        },
                      )}
                      <span className="player-match-vs">vs.</span>
                    </section>
                  )}
                  <div className="props-grid compact-player-grid">
                    {topPlayerKeys
                      .filter((key) =>
                        markets.some(
                          (m) =>
                            m.market_key === key &&
                            m.matchup_key === selectedMatchup,
                        ),
                      )
                      .map((key) => {
                        const pair = markets.filter(
                            (m) => m.market_key === key,
                          ),
                          m = pair[0];
                        return (
                          <article
                            className="prop-card player-market-card"
                            key={key}
                          >
                            <div className="player-card-team">
                              <span>{team(m.team_id)?.team_name}</span>
                              <small>{owner(m.team_id ?? "")}</small>
                            </div>
                            <h2>
                              {m.subject} • {m.metadata.position} -{" "}
                              {m.metadata.nfl_team}
                            </h2>
                            <p>
                              Season Average: {m.metadata.season_average ?? "—"}{" "}
                              • Projected: {m.metadata.projection ?? "—"}
                            </p>
                            {m.metadata.game_info &&
                              !m.metadata.game_info.includes(
                                "Sleeper projection",
                              ) && <p>{m.metadata.game_info}</p>}
                            <div>
                              {pair.map((p) => (
                                <span key={p.id}>
                                  {quote(
                                    p,
                                    `${p.side === "over" ? "Over" : "Under"} ${p.line}`,
                                  )}
                                </span>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                  </div>
                  {!markets.some(
                    (m) =>
                      m.kind === "player_points" &&
                      m.matchup_key === selectedMatchup,
                  ) && (
                    <p>
                      Player markets have not been published for this matchup
                      yet.
                    </p>
                  )}
                </>
              )}
              {category === "Weekly Specials" && (
                <div className="props-grid">
                  {["weekly_high", "weekly_low"].map((kind) => (
                    <article className="prop-card" key={kind}>
                      <h2>
                        {kind === "weekly_high"
                          ? "Highest Weekly Scorer"
                          : "Lowest Weekly Scorer"}
                      </h2>
                      <p>
                        Choose the team you think will finish{" "}
                        {kind === "weekly_high" ? "highest" : "lowest"} this
                        week.
                      </p>
                      <div className="special-quotes">
                        {markets
                          .filter((m) => m.kind === kind)
                          .sort((a, b) => a.odds - b.odds)
                          .slice(0, 6)
                          .map((m) => (
                            <span key={m.id}>{quote(m)}</span>
                          ))}
                      </div>
                      {!markets.some((m) => m.kind === kind) && (
                        <p>These markets are coming soon.</p>
                      )}
                    </article>
                  ))}
                  <WeeklyCountPicker
                    markets={markets.filter(
                      (m) => m.kind === "weekly_count_150",
                    )}
                    renderQuote={quote}
                  />
                  {(["weekly_any_below_100", "weekly_any_200"] as const).map(
                    (kind) => (
                      <article className="prop-card" key={kind}>
                        <h2>
                          {kind === "weekly_any_below_100"
                            ? "Will Any Team Score Below 100?"
                            : "Will Any Team Score 200+?"}
                        </h2>
                        <p>
                          {kind === "weekly_any_below_100"
                            ? "At least one team must finish below 100 points for Yes to win."
                            : "At least one team must finish with 200 or more points for Yes to win."}
                        </p>
                        <div>
                          {markets
                            .filter((m) => m.kind === kind)
                            .map((m) => (
                              <span key={m.id}>{quote(m)}</span>
                            ))}
                        </div>
                        {!markets.some((m) => m.kind === kind) && (
                          <p>These markets are coming soon.</p>
                        )}
                      </article>
                    ),
                  )}
                </div>
              )}
              {category === "Season Futures" && (
                <section className="empty futures-placeholder">
                  <p className="eyebrow">SEASON {board?.league_season ?? 3}</p>
                  <h2>Season Futures</h2>
                  <p>
                    Season-long markets are being prepared. Potential categories
                    include league champion, season points leader, first overall
                    pick, playoff qualification, and regular-season win totals.
                  </p>
                  <span className="status-pill">Work In Progress</span>
                </section>
              )}
            </>
          )}
        </>
      )}
      {(tab === "My Bets" || tab === "All Bets") && (
        <>
          <h1>{tab}</h1>
          <TicketHistory
            data={data}
            tickets={(data.tickets ?? []).filter(
              (t) =>
                t.league_id === member.league_id &&
                (!member.team_id ||
                  tab === "All Bets" ||
                  t.team_id === member.team_id),
            )}
            owner={owner}
            canVoid={member.role === "admin" && !review}
            onChanged={refresh}
          />
        </>
      )}
      {tab === "Leaderboard" && (
        <>
          <h1>League Leaderboard</h1>
          <p className="muted">
            <em>Ranked by Net Profit, Balance, then Bets Placed</em>
          </p>
          <div className="standings-table">
            <div className="standings-head">
              <span>Member</span>
              <span>Net Profit</span>
              <span>Balance</span>
              <span>Bets</span>
            </div>
            {standings.map((s, i) => (
              <details className="standing" key={s.team_id}>
                <summary>
                  <span className="standing-member">
                    <span className="standing-rank">{i + 1}</span>
                    <span>
                      <strong>{owner(s.team_id)}</strong>
                      <small>{team(s.team_id)?.team_name}</small>
                    </span>
                    <Chevron />
                  </span>
                  <strong
                    className={
                      Number(s.net_profit) >= 0
                        ? "profit-positive"
                        : "profit-negative"
                    }
                  >
                    {money(s.net_profit)}
                  </strong>
                  <strong>{money(s.current_balance)}</strong>
                  <strong>{s.bets_placed}</strong>
                </summary>
                <div className="standing-extras">
                  {[
                    [
                      "Won / Lost / Push",
                      `${s.bets_won} / ${s.bets_lost} / ${s.bets_push}`,
                    ],
                    ["Win Rate", `${Number(s.win_percentage).toFixed(1)}%`],
                    ["ROI", `${Number(s.roi).toFixed(1)}%`],
                    ["Wagered", money(s.total_wagered)],
                    ["Total Payout", money(s.total_payout)],
                    ["Biggest Win", money(s.biggest_payout)],
                    ["Longest Parlay", `${s.biggest_parlay_legs} Picks`],
                    [
                      "Biggest Odds",
                      s.biggest_parlay_odds
                        ? formatOdds(s.biggest_parlay_odds)
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <span key={label}>
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </span>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
      {tab === "Season Futures" && (
        <section className="empty futures-placeholder">
          <p className="eyebrow">SEASON 3</p>
          <h1>Season Futures</h1>
          <p>
            Season-long markets are being prepared. Potential categories include
            league champion, season points leader, first overall pick, playoff
            qualification, and regular-season win totals.
          </p>
          <span className="status-pill">Work In Progress</span>
        </section>
      )}
      {picks.length > 0 && (
        <button
          ref={banner}
          className="slip-banner"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="slip-number">{picks.length}</span>
          <strong>Bet Slip</strong>
          <span className="slip-banner-price">
            <strong>Odds {formatOdds(americanPrice(price))}</strong>
            <small>$10 pays {money(10 * price)}</small>
          </span>
          <Chevron />
        </button>
      )}
      <dialog
        ref={dialog}
        className="bet-slip-dialog"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          banner.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientY < r.top ||
              e.clientY > r.bottom ||
              e.clientX < r.left ||
              e.clientX > r.right
            )
              setOpen(false);
          }
        }}
        aria-labelledby="bet-slip-title"
      >
        <div className="slip-header">
          <span className="slip-number">{picks.length}</span>
          <h2 id="bet-slip-title">Bet Slip</h2>
          <strong className="slip-odds">
            Odds {picks.length ? formatOdds(americanPrice(price)) : "—"}
          </strong>
          <button disabled={busy} onClick={() => setPicks([])}>
            Clear All
          </button>
          <button aria-label="Collapse Bet Slip" onClick={() => setOpen(false)}>
            <Chevron />
          </button>
        </div>
        <div className="slip-legs">
          {selectionGroups.map((key) => {
            const selections = picks.filter(
              (p) => (p.matchup_key ?? p.subject) === key,
            );
            return (
              <section key={key}>
                <strong>{name(selections[0])}</strong>
                {selections.map((m) => (
                  <div className="slip-leg" key={m.id}>
                    <span>
                      {m.label}
                      <small>{marketType[m.kind]}</small>
                    </span>
                    <button
                      disabled={busy}
                      aria-label={`Remove ${m.label}`}
                      onClick={() =>
                        setPicks(picks.filter((p) => p.id !== m.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
        <div className="wager-split">
          <div>
            <small>◉ Balance Remaining</small>
            <strong>
              {money(balance - (Number.isFinite(wager) ? wager : 0))}
            </strong>
          </div>
          <label>
            <small>＄ Wager</small>
            <input
              aria-label="Wager"
              type="number"
              min="0"
              max={balance}
              step="0.01"
              value={stake}
              disabled={busy}
              onChange={(e) => setStake(e.target.value)}
            />
          </label>
        </div>
        <div className="quick-wagers">
          {[10, 25].map((n) => (
            <button
              key={n}
              disabled={busy}
              onClick={() =>
                setStake(String(Math.min(balance, (Number(stake) || 0) + n)))
              }
            >
              +${n}
            </button>
          ))}
          <button disabled={busy} onClick={() => setStake(String(balance))}>
            Max
          </button>
        </div>
        <p className="wager-help">
          {!canPlacePicks(picks)
            ? "Choose at least 2 picks, or a Weekly Special single."
            : `Enter a wager from $1 to ${money(balance)}.`}
        </p>
        {notice && (
          <p className="slip-feedback" role="status">
            {notice}
          </p>
        )}
        <button
          className="place-bet"
          disabled={!valid || busy || (!accepting && !review)}
          onClick={() => void submit()}
        >
          <strong>
            {busy ? "Placing Bet…" : `Place Bet ${money(wager || 0)}`}
          </strong>
          <small>Total Payout: {money((wager || 0) * price)}</small>
        </button>
      </dialog>
    </main>
  );
}
