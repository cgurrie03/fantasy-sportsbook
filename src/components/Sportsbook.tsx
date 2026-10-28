import { openSleeperMatchup } from "../lib/sleeper-link";
import { MatchupScore, MatchupScoresNotice } from "./MatchupScores";
import { useTicketProgress } from "./TicketProgress";
import { LeagueStandings } from "./LeagueStandings";
import { useRoute, navigate, tabRoutes, routeTab } from "../lib/navigation";
import { displayProjection, formatGameInfo } from "../../api/_lib/event-time";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  loadFuturesBoard,
  isFuture,
  boardAvailable,
  quoteUnavailable,
} from "../lib/markets";
import { supabase } from "../lib/supabase";
import { Chevron, TicketHistory } from "./TicketHistory";
import { TicketShare } from "./TicketShare";
import { HeadToHead, Milestones, WinningMargins } from "./ExtraMarkets";
import { WeeklyCountPicker } from "./WeeklyCountPicker";
import { SeasonFutures } from "./SeasonFutures";
import "./Sportsbook.css";
import { adjustedSpread, teaserEligibility } from "../lib/teaser-eligibility";
import { LineRefreshStatus } from "./LineRefreshStatus";
import { StarterActivity } from "./StarterActivity";
import { LineMovement } from "./LineMovement";
import { MarketTitle } from "./MarketTitle";
import { OfferCards } from "./OfferCards";
import type { PromoOffer } from "../lib/promotions";
import {
  loadPromos,
  claimPromo,
  eligible,
  profitPrice,
  claimBy,
} from "../lib/promotions";
import { useStarterActivity } from "../lib/starter-activity";
import { TeaserConversion } from "./TeaserConversion";
import type { TeaserPreviewPrice } from "./TeaserConversion";
import type { StarterSnapshot } from "../lib/starter-activity";

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
  embedded?: boolean;
  reviewLabel?: string;
  teaserPrices?: TeaserPreviewPrice[];
  starterActivity?: StarterSnapshot;
  simulateMovement?: boolean;
  scoreObservation?: any;
  board: Board;
  markets: Market[];
  standings: Standing[];
  futureBoard?: Board;
  futureMarkets?: Market[];
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
  const Container = review?.embedded ? "section" : "main";
  const route = useRoute();
  const [localTab, setLocalTab] = useState("Home"),
    [futureBoard, setFutureBoard] = useState<Board | null>(
      review?.futureBoard ?? null,
    ),
    [futureMarkets, setFutureMarkets] = useState<Market[]>(
      review?.futureMarkets ?? [],
    ),
    [board, setBoard] = useState<Board | null>(review?.board ?? null),
    [markets, setMarkets] = useState<Market[]>(review?.markets ?? []),
    [week, setWeek] = useState(review?.board.market_week ?? null),
    [standings, setStandings] = useState<Standing[]>(review?.standings ?? []),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(!review),
    [category, setCategory] = useState("Matchups"),
    [matchup, setMatchup] = useState("all"),
    [picks, setPicks] = useState<Market[]>([]),
    [open, setOpen] = useState(false),
    [stake, setStake] = useState(""),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(() => Date.now());
  const tab = review ? localTab : routeTab(route);
  const setTab = (next: string) =>
    review ? setLocalTab(next) : navigate(tabRoutes[next] ?? "/home");
  const currentSeason = data.leagues.find(
    (l) => l.id === member.league_id,
  )?.nfl_season;
  const scoreObservations = useTicketProgress(
    member.league_id,
    [],
    currentSeason && week ? { season: currentSeason, week } : undefined,
    !review,
  );
  const scoreObservation =
    review?.scoreObservation ??
    scoreObservations.rows.find(
      (r) => r.nfl_season === currentSeason && r.market_week === week,
    );
  const quoteLoad = useRef<Promise<void> | null>(null);
  const accountPeriod = useRef<string | null>(null);
  const accountRefresh = useRef(refresh);
  useEffect(() => {
    accountRefresh.current = refresh;
  }, [refresh]);
  const periodRefresh = useRef(false);
  const [weekAccountPending, setWeekAccountPending] = useState(false);
  const quoteFailures = useRef(0);
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<number | null>(null);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const [futuresError, setFuturesError] = useState("");
  const [standingsError, setStandingsError] = useState("");
  const [standingsLoading, setStandingsLoading] = useState(!review);
  const [offers, setOffers] = useState<PromoOffer[]>([]),
    [fixedOffer, setFixedOffer] = useState<PromoOffer | null>(null),
    [boostId, setBoostId] = useState<string | null>(null),
    [pendingOffer, setPendingOffer] = useState<PromoOffer | null>(null);
  const [teaserPreview, setTeaserPreview] = useState(false);
  const [placedTicketId, setPlacedTicketId] = useState<string | null>(null);
  const [teaserAdjustment, setTeaserAdjustment] = useState(9);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const eligibleOffers = offers.filter((o) => eligible(o, picks, clock));
  const appliedBoost = eligibleOffers.find((o) => o.id === boostId);
  const promoUnavailable =
    !!fixedOffer &&
    (!offers.some((o) => o.id === fixedOffer.id && !o.used) ||
      clock >= Date.parse(fixedOffer.expires_at));
  async function refreshOffers() {
    if (review) return;
    setOffers(await loadPromos(member.league_id));
  }
  useEffect(() => {
    if (review) return;
    let active = true;
    let loadingOffers = false;
    const reload = () => {
      if (loadingOffers || document.visibilityState !== "visible") return;
      loadingOffers = true;
      void loadPromos(member.league_id)
        .then((o) => {
          if (active) setOffers(o);
        })
        .catch(() => {})
        .finally(() => {
          loadingOffers = false;
        });
    };
    reload();
    const timer = setInterval(reload, 60000);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("sportsbook-promos")
        : null;
    if (channel) channel.onmessage = reload;
    return () => {
      active = false;
      clearInterval(timer);
      channel?.close();
    };
  }, [member.league_id, review]);
  useEffect(() => {
    if (pendingOffer && !replaceDialog.current?.open)
      replaceDialog.current?.showModal();
    else if (!pendingOffer) replaceDialog.current?.close();
  }, [pendingOffer]);
  function fillFixed(o: PromoOffer) {
    if (busy) return;
    setTeaserPreview(false);
    setFixedOffer(o);
    setBoostId(null);
    setPicks(o.terms.legs ?? []);
    setPickRevision(board?.revision ?? null);
    setStake(String(o.terms.fixed_stake ?? 10));
    setOpen(true);
    setPendingOffer(null);
    setNotice("");
  }
  async function chooseOffer(o: PromoOffer) {
    if (busy) return;
    if (o.kind === "fixed") {
      if (picks.length) setPendingOffer(o);
      else fillFixed(o);
      return;
    }
    try {
      await claimPromo(o.id);
      await refreshOffers();
      setNotice(
        "Boost claimed. Build a qualifying slip, then choose whether to apply it.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }
  const [pickRevision, setPickRevision] = useState<number | null>(null);
  const starterActivity = useStarterActivity(
    member.league_id,
    review?.starterActivity,
    !!review,
  );
  const dialog = useRef<HTMLDialogElement>(null),
    banner = useRef<HTMLButtonElement>(null),
    request = useRef({ key: "", id: "" });
  const balance = Number(
      data.wallets.find((w) => w.team_id === member.team_id)?.balance ?? 0,
    ),
    wager = Number(stake),
    basePrice = combinedPrice(picks),
    price = appliedBoost
      ? profitPrice(basePrice, Number(appliedBoost.terms.percent))
      : basePrice,
    valid =
      !weekAccountPending &&
      canPlacePicks(picks) &&
      wager >= 1 &&
      wager <= balance &&
      Math.abs(Math.round(wager * 100) - wager * 100) < 1e-7 &&
      (!appliedBoost || wager <= Number(appliedBoost.terms.max_stake)) &&
      (!fixedOffer?.terms.fixed_stake ||
        wager === Number(fixedOffer.terms.fixed_stake)) &&
      !promoUnavailable &&
      (!boostId || !!appliedBoost);
  const team = (id: string | null) => data.teams.find((t) => t.id === id),
    owner = (id: string) =>
      data.memberships.find((m) => m.team_id === id)?.display_name ??
      "League Member";
  const matchupBoard = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = matchupBoard.current;
    if (!board) return;
    const rows = [...board.querySelectorAll<HTMLElement>(".match-team")];
    const align = () => {
      const height =
        Math.ceil(
          Math.max(
            96,
            ...rows.map((row) => row.getBoundingClientRect().height),
          ),
        ) + 12;
      board.style.setProperty("--matchup-team-row-height", height + "px");
    };
    const observer = new ResizeObserver(align);
    rows.forEach((row) => observer.observe(row));
    align();
    return () => observer.disconnect();
  }, [markets, category, tab]);
  const groups = [
    ...new Set(
      markets.filter((m) => m.kind === "spread").map((m) => m.matchup_key),
    ),
  ]
    .filter((id): id is string => !!id)
    .map((id) => markets.filter((m) => m.matchup_key === id));
  const routeMatchup = new URLSearchParams(route.split("?")[1]).get("matchup");
  useEffect(() => {
    if (routeMatchup && category === "Matchups" && tab === "Home") {
      const target = document.getElementById(`matchup-${routeMatchup}`);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    }
  }, [routeMatchup, category, tab, loading, markets.length]);
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
  const accepting = boardAvailable(board, clock);
  const futureAccepting = boardAvailable(futureBoard, clock);
  const selectedBoard = picks.some(isFuture) ? futureBoard : board;
  const teaserReason = teaserEligibility(
    picks,
    selectedBoard,
    groups.length,
    !!fixedOffer || !!boostId,
  );
  const teaserPrice = !teaserReason
    ? review?.teaserPrices?.find((p) => p.adjustment === teaserAdjustment)
    : undefined;
  const ticketOdds = teaserPreview
    ? teaserPrice
      ? formatOdds(teaserPrice.odds)
      : "Price pending"
    : formatOdds(americanPrice(price));
  const ticketPayout = teaserPreview
    ? teaserPrice
      ? money((wager || 0) * teaserPrice.decimal)
      : "Pending validation"
    : money((wager || 0) * price);
  const currentQuotes = picks.some(isFuture) ? futureMarkets : markets;
  const changedPicks =
    !fixedOffer && picks.length > 0 && pickRevision !== selectedBoard?.revision;
  const unavailablePicks =
    !fixedOffer &&
    picks.some(
      (p) => !currentQuotes.some((m) => m.id === p.id && !quoteUnavailable(m)),
    );
  const reloadQuotes = useCallback(async () => {
    if (quoteLoad.current) return quoteLoad.current;
    setRefreshingQuotes(true);
    let failed = false;
    const pending = Promise.allSettled([
      loadMarketBoard(member.league_id)
        .then((r) => {
          const period = `${r.board?.nfl_season ?? currentSeason}:${r.week}`;
          if (accountPeriod.current === null) accountPeriod.current = period;
          if (accountPeriod.current !== period && !periodRefresh.current) {
            periodRefresh.current = true;
            setWeekAccountPending(true);
            setPicks([]);
            setFixedOffer(null);
            setBoostId(null);
            setPendingOffer(null);
            setOpen(false);
            setStake("");
            setPickRevision(null);
            setNotice(
              `Week ${r.week} is here. Refreshing your balance and tickets automatically…`,
            );
            void accountRefresh
              .current()
              .then(() => {
                accountPeriod.current = period;
                setWeekAccountPending(false);
                setNotice(
                  `Week ${r.week} is ready. Your balance and tickets are up to date; accepted bets keep their original terms.`,
                );
              })
              .catch(() => {
                setNotice(
                  "The new week is loading. Your account will retry automatically; betting waits for your updated balance.",
                );
              })
              .finally(() => {
                periodRefresh.current = false;
              });
          }
          setBoard(r.board);
          setMarkets(r.markets);
          setWeek(r.week);
          setQuoteUpdatedAt(Date.now());
          setError("");
        })
        .catch((e) => {
          failed = true;
          console.error("Weekly quotes could not refresh", e);
          setError(
            "Weekly prices could not refresh. Retry to check the latest lines.",
          );
        })
        .finally(() => setLoading(false)),
      loadFuturesBoard(member.league_id)
        .then((f) => {
          setFutureBoard(f.board);
          setFutureMarkets(f.markets);
          setFuturesError("");
        })
        .catch((e) => {
          failed = true;
          console.error("Futures quotes could not refresh", e);
          setFuturesError("Season futures could not refresh. Please retry.");
        }),
    ]).then(() => {
      quoteFailures.current = failed
        ? Math.min(quoteFailures.current + 1, 3)
        : 0;
    });
    quoteLoad.current = pending;
    try {
      await pending;
    } finally {
      quoteLoad.current = null;
      setRefreshingQuotes(false);
    }
  }, [member.league_id, currentSeason]);
  useEffect(() => {
    if (review) return;
    setLoading(true);
    void reloadQuotes();
  }, [review, reloadQuotes]);
  useEffect(() => {
    if (review) return;
    let active = true;
    setStandingsLoading(true);
    void Promise.resolve(
      supabase?.rpc("league_leaderboard", { p_league: member.league_id }),
    )
      .then((s) => {
        if (!active) return;
        if (!s) throw new Error("Standings service unavailable");
        if (s.error) {
          console.error("Leaderboard could not refresh", s.error);
          setStandingsError("Standings could not refresh. Please retry.");
        } else {
          setStandings(s.data ?? []);
          setStandingsError("");
        }
        setStandingsLoading(false);
      })
      .catch(() => {
        if (active) {
          setStandingsError("Standings could not refresh. Please retry.");
          setStandingsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [member.league_id, review, data.tickets, reloadQuotes]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (review) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (document.visibilityState === "visible") {
        await reloadQuotes();
      }
      if (active) timer = setTimeout(poll, 30000 * 2 ** quoteFailures.current);
    };
    timer = setTimeout(poll, 30000);
    const resume = () => {
      if (document.visibilityState === "visible") void reloadQuotes();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [reloadQuotes, review]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
  }, [teaserPreview]);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const update = () => {
      dialog.current?.style.setProperty(
        "--slip-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      dialog.current?.style.setProperty(
        "--slip-viewport-bottom",
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [open]);
  function toggle(m: Market) {
    if (fixedOffer) {
      setNotice(
        "This promo’s selections are locked. Discard the promo slip to build another ticket.",
      );
      setOpen(true);
      return;
    }
    if (busy || quoteUnavailable(m)) return;
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
    if (!picks.length)
      setPickRevision((isFuture(m) ? futureBoard : board)?.revision ?? null);
    setPicks([...picks, m]);
  }
  async function submit() {
    if (teaserPreview) return;
    if (!selectedBoard || !valid || busy || changedPicks || unavailablePicks)
      return;
    if (review) {
      setNotice("This is a local review. No bet was placed or email sent.");
      return;
    }
    setBusy(true);
    setNotice("");
    const key = JSON.stringify([
      selectedBoard.id,
      selectedBoard.revision,
      picks.map((p) => p.id),
      wager,
      fixedOffer?.id ?? appliedBoost?.id ?? null,
    ]);
    if (request.current.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const result = await placeTicket(
        { ...selectedBoard, revision: pickRevision ?? selectedBoard.revision },
        picks,
        wager,
        request.current.id,
        fixedOffer
          ? { id: fixedOffer.id, kind: "fixed" }
          : appliedBoost
            ? { id: appliedBoost.id, kind: "boost" }
            : undefined,
      );
      setPlacedTicketId(result.ticket_id);
      setPicks([]);
      setFixedOffer(null);
      setBoostId(null);
      await refreshOffers().catch(() => {});
      const channel =
        typeof BroadcastChannel !== "undefined"
          ? new BroadcastChannel("sportsbook-promos")
          : null;
      channel?.postMessage("used");
      channel?.close();
      setStake("");
      setOpen(false);
      setNotice(
        result.email_status === "sent"
          ? "Bet placed. Your confirmation email is on its way."
          : "Bet placed. Your confirmation email is awaiting delivery.",
      );
      await refresh();
    } catch (e) {
      setNotice(errorMessage(e));
      await reloadQuotes().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function quote(m: Market | undefined, short?: string) {
    if (!m) return <span className="quote-empty">—</span>;
    const selected = picks.some((p) => p.id === m.id);
    const unavailable = quoteUnavailable(m);
    const showsPrice =
      m.kind === "moneyline" ||
      weeklyKinds.includes(m.kind) ||
      isFuture(m) ||
      m.boost_pct > 0;
    const movement = (
      <LineMovement
        value={
          showsPrice
            ? americanPrice(selectionPrice(m))
            : Number(m.line ?? m.odds)
        }
        scope={`${m.board_id}:${week}`}
        live={
          (isFuture(m) ? futureBoard : board)?.phase === "live" &&
          !(isFuture(m) ? futureBoard : board)?.reopening_id
        }
      />
    );
    return (
      <button
        type="button"
        className={`market-quote${selected ? " selected" : ""}${m.boost_pct ? " boosted" : ""}`}
        title={unavailable || undefined}
        aria-label={`${m.label}: ${formatOdds(americanPrice(selectionPrice(m)))}${m.boost_pct ? ` (boosted; original ${formatOdds(m.odds)})` : ""}${unavailable ? `. Unavailable: ${unavailable}` : ""}`}
        aria-pressed={selected}
        disabled={
          Boolean(unavailable) ||
          (!(isFuture(m) ? futureAccepting : accepting) && !review) ||
          busy
        }
        onClick={() => toggle(m)}
      >
        {unavailable ? (
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
            <span>{m.metadata.lineup_locked ? "Locked" : "Suspended"}</span>
          </>
        ) : (
          short !== "" && (
            <strong>
              {short ?? m.label}
              {!showsPrice && movement}
            </strong>
          )
        )}
        {
          <span className="quote-price">
            {m.boost_pct > 0 && m.kind === "moneyline" && (
              <del>{formatOdds(m.odds)}</del>
            )}{" "}
            {formatOdds(americanPrice(selectionPrice(m)))}
            {movement}
          </span>
        }
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
  const rawSuspensionReason = (
    category === "Season Futures" ? futureBoard : board
  )?.suspension_reason;
  const suspensionReason =
    rawSuspensionReason &&
    /timeout|failed to fetch|gateway|canceling statement|ECONN|fetch failed/i.test(
      rawSuspensionReason,
    )
      ? "Prices are temporarily unavailable. Existing lines remain visible while a verified refresh is pending."
      : rawSuspensionReason;
  return (
    <Container className="sportsbook">
      <nav className="sportsbook-tabs" aria-label="Sportsbook Navigation">
        {["Home", "My Bets", "All Bets", "Leaderboard"].map((t) =>
          review ? (
            <button
              key={t}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ) : (
            <a
              key={t}
              href={`#${tabRoutes[t]}`}
              aria-current={tab === t ? "page" : undefined}
            >
              {t}
            </a>
          ),
        )}
      </nav>
      {notice && (
        <p className="feedback" role="status">
          {notice}
        </p>
      )}
      {placedTicketId &&
        data.tickets
          ?.filter(
            (t) => t.id === placedTicketId && t.league_id === member.league_id,
          )
          .map((t) => (
            <div className="receipt-placement" key={t.id}>
              <TicketShare data={data} ticket={t} owner={member.display_name} />
            </div>
          ))}
      {review && (
        <p className="review-notice">
          {review.reviewLabel ??
            "Design Review · Illustrative markets. Betting and email delivery are disabled."}
          {review.simulateMovement && (
            <button
              type="button"
              onClick={() => {
                setBoard((before) =>
                  before
                    ? { ...before, revision: before.revision + 1 }
                    : before,
                );
                setMarkets((before) =>
                  before.map((m) =>
                    m.line == null
                      ? m
                      : {
                          ...m,
                          line:
                            Number(m.line) +
                            (m.kind === "match_total" || m.side === "a"
                              ? 1
                              : -1),
                        },
                  ),
                );
              }}
            >
              Preview live line movement
            </button>
          )}
        </p>
      )}
      {tab === "Home" && (
        <>
          <LineRefreshStatus leagueId={member.league_id} review={!!review} />
          {suspensionReason &&
            !suspensionReason.startsWith("Live pricing unavailable:") && (
              <p className="feedback" role="status">
                {suspensionReason}
              </p>
            )}
          <div className="board-heading">
            <div>
              <h1>
                <span>
                  SEASON{" "}
                  {board?.league_season ??
                    data.leagues.find((l) => l.id === member.league_id)
                      ?.league_season ??
                    "—"}
                </span>
                <span className="season-divider"> • </span>
                <span>WEEK {week ?? "—"}</span>
              </h1>
            </div>
            <div className="board-window">
              {category === "Season Futures" ? (
                <>
                  <strong>
                    {futureAccepting
                      ? "Season Futures Open"
                      : "Season Futures Closed"}
                  </strong>
                  <span>
                    {futureBoard?.reopening_until
                      ? `Reopening closes ${new Date(futureBoard.reopening_until).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" })} Eastern`
                      : "Available throughout the week unless closed."}
                  </span>
                </>
              ) : board ? (
                <>
                  <strong>
                    {board.status === "draft"
                      ? "Draft · Admin Preview"
                      : accepting
                        ? board.reopening_id
                          ? "Reopened"
                          : "Betting Open"
                        : "Betting Closed"}
                  </strong>
                  <span>
                    Scores: every 15 min during games · 2 hours otherwise
                  </span>
                  <span>Pregame lines: every 2 hours</span>
                </>
              ) : (
                <strong>
                  {loading
                    ? "Loading weekly markets…"
                    : error
                      ? "Markets temporarily unavailable"
                      : "Markets scheduled"}
                </strong>
              )}
              <MatchupScoresNotice
                row={scoreObservation}
                loading={scoreObservations.loading}
                error={scoreObservations.error}
                now={clock}
              />
            </div>
          </div>
          <nav className="market-categories" aria-label="Market Categories">
            {[
              "Matchups",
              "Player Points",
              "Head to Head",
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
          {["Player Points", "Head to Head"].includes(category) && (
            <p className="history-note">
              Model projections use one decimal place. Betting lines may be
              rounded separately; the selection shows the exact target and
              price.
            </p>
          )}
          {category === "Matchups" && (
            <OfferCards
              offers={offers.filter((o) => clock < Date.parse(o.expires_at))}
              onClaim={(o) => void chooseOffer(o)}
              busy={busy}
            />
          )}
          {(category === "Season Futures" ? futuresError : error) && (
            <p role="status" className="feedback error">
              {category === "Season Futures" ? futuresError : error}
              {quoteUpdatedAt && (
                <>
                  {" "}
                  Showing the last available data, checked{" "}
                  {new Date(quoteUpdatedAt).toLocaleTimeString("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  Eastern.
                </>
              )}
              <button
                className="text-button"
                disabled={refreshingQuotes}
                onClick={() => void reloadQuotes()}
              >
                Retry prices
              </button>
            </p>
          )}
          {loading && !markets.length && category !== "Season Futures" ? (
            <p role="status">Loading weekly markets…</p>
          ) : error && !markets.length && category !== "Season Futures" ? (
            <p>The weekly board could not load. Use Retry prices above.</p>
          ) : category === "Season Futures" ? (
            <SeasonFutures data={data} markets={futureMarkets} quote={quote} />
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
                <div className="matchup-board" ref={matchupBoard}>
                  {groups.map((g) => {
                    const first = g[0],
                      h = team(first.home_team_id),
                      a = team(first.away_team_id),
                      sleeperLeagueId = data.leagues.find(
                        (l) => l.id === member.league_id,
                      )?.sleeper_league_id;
                    return (
                      <article
                        id={`matchup-${first.matchup_key}`}
                        tabIndex={-1}
                        className={`matchup-card${first.featured ? " featured-match" : ""}`}
                        key={first.matchup_key}
                      >
                        {first.featured ? (
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
                        ) : (
                          <div
                            className="featured-strip featured-strip-placeholder"
                            aria-hidden="true"
                          />
                        )}
                        <div className="matchup-card-tools">
                          {review && !review.starterActivity ? (
                            <span className="matchup-status-unavailable">
                              Captured game state; see source checks above.
                            </span>
                          ) : (
                            <StarterActivity
                              rosterIds={[h?.roster_id, a?.roster_id]}
                              {...starterActivity}
                              now={
                                review?.starterActivity
                                  ? Date.parse(
                                      review.starterActivity.observed_at,
                                    )
                                  : clock
                              }
                            />
                          )}
                          {sleeperLeagueId && week && h?.roster_id && (
                            <a
                              className="sleeper-matchup-link"
                              href={`https://sleeper.com/matchup/${encodeURIComponent(sleeperLeagueId)}/${week}/${h.roster_id}`}
                              onClick={(e) =>
                                openSleeperMatchup(
                                  e,
                                  sleeperLeagueId,
                                  week,
                                  h.roster_id,
                                )
                              }
                              rel="noopener noreferrer"
                              aria-label={`Open ${h.team_name} vs. ${a?.team_name ?? "opponent"} in Sleeper`}
                              title="Open matchup in Sleeper"
                            >
                              <svg
                                className="sleeper-matchup-icon"
                                viewBox="0 0 24 24"
                                width="20"
                                height="20"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M11 2h2v4h1a7 7 0 0 1 7 7v2a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7v-2a7 7 0 0 1 7-7h1V2ZM6 12v3a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-3H6Z"
                                />
                                <path d="m8 14 2 1 2-1v2l-2 1-2-1v-2Zm5 0 2 1 2-1v2l-2 1-2-1v-2Z" />
                              </svg>
                            </a>
                          )}
                        </div>
                        <div className="match-grid">
                          <span className="market-column-spacer" />
                          <span className="market-column-label">Spread</span>
                          <span className="market-column-label">Total</span>
                          <span className="market-column-label">Moneyline</span>
                          {[h, a].map((t, i) => (
                            <div className="match-team-row" key={t?.id ?? i}>
                              <div className="match-team">
                                {t?.avatar_url ? (
                                  <img
                                    src={t.avatar_url}
                                    width={32}
                                    height={32}
                                    alt=""
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.hidden = true;
                                      e.currentTarget.nextElementSibling?.removeAttribute(
                                        "hidden",
                                      );
                                    }}
                                  />
                                ) : null}
                                <span
                                  className="match-team-avatar-fallback"
                                  hidden={Boolean(t?.avatar_url)}
                                  aria-hidden="true"
                                >
                                  {t?.team_name.slice(0, 1) ?? "?"}
                                </span>
                                <div>
                                  <strong
                                    className="match-team-name"
                                    title={t?.team_name}
                                  >
                                    <span className="match-team-name-text">
                                      {t?.team_name}
                                    </span>{" "}
                                    <span className="team-record">
                                      ({record(t)})
                                    </span>
                                  </strong>
                                  <span>{t ? owner(t.id) : ""}</span>
                                  <MatchupScore
                                    row={scoreObservation}
                                    teamId={t?.id}
                                  />
                                  <span>
                                    Projected:{" "}
                                    {displayProjection(
                                      i === 0
                                        ? first.home_projection
                                        : first.away_projection,
                                    )}
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
                        <Milestones
                          markets={g.filter((m) => m.kind === "team_milestone")}
                          data={data}
                          quote={quote}
                        />
                        <WinningMargins
                          markets={g.filter((m) => m.kind === "winning_margin")}
                          data={data}
                          quote={quote}
                        />
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
              {category === "Head to Head" && (
                <HeadToHead
                  groups={groups}
                  selected={selectedMatchup}
                  onSelect={setMatchup}
                  data={data}
                  quote={quote}
                />
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
                                <strong>
                                  {t?.team_name}{" "}
                                  <span className="team-record">
                                    ({record(t)})
                                  </span>
                                </strong>
                                <span>{owner(id ?? "")}</span>
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
                              Season average:{" "}
                              {displayProjection(m.metadata.season_average)} ·
                              Projected:{" "}
                              {displayProjection(
                                m.metadata.expected_points ??
                                  m.metadata.projection,
                              )}
                            </p>
                            {quoteUnavailable(m) && (
                              <p className="market-availability">
                                Unavailable: {quoteUnavailable(m)}
                              </p>
                            )}
                            {m.metadata.game_info &&
                              !m.metadata.game_info.includes(
                                "Sleeper projection",
                              ) && (
                                <p>
                                  {formatGameInfo(
                                    m.metadata.game_info,
                                    m.metadata.cutoff_at,
                                  )}
                                </p>
                              )}
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
                            <Milestones
                              markets={markets.filter(
                                (p) =>
                                  p.kind === "player_milestone" &&
                                  p.metadata.player_id ===
                                    m.metadata.player_id &&
                                  p.matchup_key === m.matchup_key,
                              )}
                              quote={quote}
                            />
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
                      <MarketTitle eligibility="Eligible for Singles and Parlays">
                        {kind === "weekly_high"
                          ? "Highest Weekly Scorer"
                          : "Lowest Weekly Scorer"}
                      </MarketTitle>
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
                  <WeeklyCountPicker
                    projection
                    markets={markets.filter(
                      (m) => m.kind === "weekly_count_projection",
                    )}
                    renderQuote={quote}
                  />
                  {(["weekly_average", "weekly_highest_score"] as const).map(
                    (kind) => (
                      <article className="prop-card" key={kind}>
                        <MarketTitle eligibility="Eligible for Singles and Parlays">
                          {kind === "weekly_average"
                            ? "League Average Score"
                            : "Highest Score Of The Week"}
                        </MarketTitle>
                        <div>
                          {markets
                            .filter((m) => m.kind === kind)
                            .map((m) => (
                              <span key={m.id}>{quote(m)}</span>
                            ))}
                        </div>
                        {!markets.some((m) => m.kind === kind) && (
                          <p>Generate Weekly Specials to add this market.</p>
                        )}
                      </article>
                    ),
                  )}
                  {(["weekly_any_below_100", "weekly_any_200"] as const).map(
                    (kind) => (
                      <article className="prop-card" key={kind}>
                        <MarketTitle eligibility="Eligible for Singles and Parlays">
                          {kind === "weekly_any_below_100"
                            ? "Will Any Team Score Below 100?"
                            : "Will Any Team Score 200+?"}
                        </MarketTitle>
                        {markets.some(
                          (m) => m.kind === kind && m.metadata.lineup_locked,
                        ) && (
                          <p className="market-lock-explanation" role="status">
                            {quoteUnavailable(
                              markets.find(
                                (m) =>
                                  m.kind === kind && m.metadata.lineup_locked,
                              )!,
                            )}
                          </p>
                        )}
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
                  <p className="eyebrow">
                    SEASON{" "}
                    {board?.league_season ??
                      data.leagues.find((l) => l.id === member.league_id)
                        ?.league_season ??
                      "—"}
                  </p>
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
          {data.history_loading && <p role="status">Loading ticket history…</p>}
          {data.history_error && (
            <p role="status">
              {data.history_error}{" "}
              <button className="text-button" onClick={() => void refresh()}>
                Retry history
              </button>
            </p>
          )}
          {(!(data.history_loading || data.history_error) ||
            !!data.tickets?.length) && (
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
              personal={tab === "My Bets"}
              readOnly={!!review}
              canVoid={member.role === "admin" && !review}
              onChanged={refresh}
            />
          )}
        </>
      )}
      {tab === "Leaderboard" && (
        <>
          <h1>League Leaderboard</h1>
          <p className="muted">
            <em>Ranked by Net Profit, Balance, then Bets Placed</em>
          </p>
          {standingsLoading && !standings.length && (
            <p role="status">Loading standings...</p>
          )}
          {standingsError && (
            <p role="status">
              {standingsError}
              <button className="text-button" onClick={() => void refresh()}>
                Retry standings
              </button>
            </p>
          )}
          {!standingsLoading && !standingsError && !standings.length && (
            <p>No standings are available yet.</p>
          )}
          <LeagueStandings data={data} standings={standings} owner={owner} />
        </>
      )}
      {tab === "Season Futures" && (
        <section className="empty futures-placeholder">
          <p className="eyebrow">Season {board?.league_season ?? "—"}</p>
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
            <strong>
              {teaserPreview
                ? "Teaser preview"
                : `Odds ${formatOdds(americanPrice(price))}`}
            </strong>
            <small>
              {teaserPreview
                ? "Betting unavailable"
                : `$10 pays ${money(10 * price)}`}
            </small>
          </span>
          <Chevron />
        </button>
      )}
      <dialog
        ref={dialog}
        className={`bet-slip-dialog${!teaserReason || teaserPreview ? " teaser-capable" : ""}${teaserPreview ? " teaser-preview" : ""}`}
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
          <h2 id="bet-slip-title">
            {fixedOffer ? fixedOffer.title : "Bet Slip"}
          </h2>
          <strong className="slip-odds">
            {!teaserReason || teaserPreview
              ? ""
              : `Odds ${picks.length ? formatOdds(americanPrice(price)) : "—"}`}
          </strong>
          <button
            disabled={busy}
            onClick={() => {
              setPicks([]);
              setFixedOffer(null);
              setBoostId(null);
              setTeaserPreview(false);
            }}
          >
            {fixedOffer ? "Discard promo" : "Clear All"}
          </button>
          <button aria-label="Collapse Bet Slip" onClick={() => setOpen(false)}>
            <Chevron />
          </button>
        </div>
        <TeaserConversion
          active={teaserPreview}
          onActive={setTeaserPreview}
          adjustment={teaserAdjustment}
          onAdjustment={setTeaserAdjustment}
          reason={teaserReason}
          prices={!teaserReason ? review?.teaserPrices : undefined}
          odds={ticketOdds}
        />
        {teaserPreview && (
          <div className="teaser-column-headings">
            <span>Picks</span>
            <span>Points</span>
            <span>New line</span>
            <span />
          </div>
        )}
        <div
          className="slip-legs"
          id="slip-picks"
          role={!teaserReason || teaserPreview ? "tabpanel" : undefined}
          aria-labelledby={
            !teaserReason || teaserPreview
              ? teaserPreview
                ? "teaser-tab"
                : "parlay-tab"
              : undefined
          }
        >
          {selectionGroups.map((key) => {
            const selections = picks.filter(
              (p) => (p.matchup_key ?? p.subject) === key,
            );
            return (
              <section key={key}>
                {!teaserPreview && <strong>{name(selections[0])}</strong>}
                {selections.map((m) => (
                  <div className="slip-leg" key={m.id}>
                    <span>
                      {teaserPreview && m.kind === "spread" && m.line != null
                        ? `${m.subject} ${m.line > 0 ? "+" : ""}${m.line.toFixed(1)}`
                        : m.label}
                      <small>
                        {teaserPreview ? name(m) : marketType[m.kind]}
                      </small>
                    </span>
                    {teaserPreview && (
                      <>
                        <strong className="teaser-points">
                          +{teaserAdjustment}
                        </strong>
                        <strong className="teaser-new-line">
                          {m.kind === "spread" && m.line != null
                            ? ((n: number) =>
                                n > 0 ? "+" + n.toFixed(1) : n.toFixed(1))(
                                adjustedSpread(m.line, teaserAdjustment),
                              )
                            : "—"}
                        </strong>
                      </>
                    )}
                    <button
                      disabled={busy || !!fixedOffer}
                      hidden={!!fixedOffer}
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
              name="stake"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              max={balance}
              step="0.01"
              placeholder="0"
              value={stake}
              onFocus={() => {
                if (Number(stake) === 0) setStake("");
              }}
              disabled={busy || !!fixedOffer?.terms.fixed_stake}
              onChange={(e) => setStake(e.target.value)}
            />
          </label>
        </div>
        {teaserPreview && (
          <details className="teaser-details">
            <summary>How teasers work</summary>
            <p>
              The chosen fantasy points are added to every spread in your favor.
              For example, a −8.5 spread becomes +0.5 with a 9-point teaser.
            </p>
            <p>
              Every remaining pick must win. A losing pick loses the ticket.
              Pushed or voided picks are removed, and the payout is recalculated
              using saved prices. One or two winning picks can still cash. If no
              picks remain, your stake is refunded.
            </p>
          </details>
        )}
        {fixedOffer && (
          <p className="promo-expiry">
            Selections and lines locked · Claim by{" "}
            {claimBy(fixedOffer.expires_at)}
          </p>
        )}
        {!teaserPreview && !fixedOffer && eligibleOffers.length > 0 && (
          <section
            className="promo-eligibility"
            aria-label="Eligible profit boosts"
          >
            <strong>Your slip qualifies for a profit boost.</strong>
            {eligibleOffers.map((o) => (
              <label key={o.id}>
                <span>{o.title}</span>
                <input
                  type="checkbox"
                  aria-label={`Apply ${o.title}`}
                  checked={boostId === o.id}
                  disabled={busy}
                  onChange={(e) => setBoostId(e.target.checked ? o.id : null)}
                />
              </label>
            ))}
          </section>
        )}
        {boostId && !appliedBoost && (
          <p className="slip-feedback" role="status">
            Your selected boost no longer qualifies, expired, or was used in
            another tab.{" "}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setBoostId(null)}
            >
              Continue without boost
            </button>
          </p>
        )}
        {appliedBoost && (
          <section
            className="promo-eligibility"
            aria-label="Boost payout breakdown"
          >
            <div className="promo-price-row">
              <span>Original odds</span>
              <strong>
                {formatOdds(americanPrice(basePrice))} · {basePrice.toFixed(4)}{" "}
                decimal
              </strong>
            </div>
            <div className="promo-price-row">
              <span>Boosted effective odds</span>
              <strong>
                ≈ {formatOdds(americanPrice(price))} · {price.toFixed(4)}{" "}
                decimal
              </strong>
            </div>
            <div className="promo-price-row">
              <span>Original profit</span>
              <strong>{money(wager * (basePrice - 1))}</strong>
            </div>
            <div className="promo-price-row">
              <span>Extra profit</span>
              <strong>{money(wager * (price - basePrice))}</strong>
            </div>
            <div className="promo-price-row">
              <span>Maximum wager</span>
              <strong>{money(Number(appliedBoost.terms.max_stake))}</strong>
            </div>
          </section>
        )}
        <div className="quick-wagers">
          {[10, 25].map((n) => (
            <button
              key={n}
              disabled={busy || !!fixedOffer?.terms.fixed_stake}
              onClick={() =>
                setStake(String(Math.min(balance, (Number(stake) || 0) + n)))
              }
            >
              +${n}
            </button>
          ))}
          <button
            disabled={busy || !!fixedOffer?.terms.fixed_stake}
            onClick={() =>
              setStake(
                String(
                  Math.min(
                    balance,
                    appliedBoost
                      ? Number(appliedBoost.terms.max_stake)
                      : balance,
                  ),
                ),
              )
            }
          >
            Max
          </button>
        </div>
        <p className="wager-help">
          {!canPlacePicks(picks)
            ? picks.some(isFuture)
              ? "Choose at least 2 Make/Miss Playoffs picks."
              : "Choose at least 2 picks, or a Weekly Special single."
            : `Enter a wager from $1 to ${money(Math.min(balance, appliedBoost ? Number(appliedBoost.terms.max_stake) : balance))}.`}
        </p>
        {picks.some(isFuture) && (
          <p className="wager-help">
            Futures stakes remain part of your active balance. Weekly cash
            minimum:{" "}
            {money(
              Math.max(
                25,
                100 -
                  (data.tickets ?? [])
                    .filter(
                      (t) =>
                        t.ticket_type === "future" &&
                        t.status === "OPEN" &&
                        t.team_id === member.team_id,
                    )
                    .reduce((sum, t) => sum + Number(t.stake), 0) -
                  wager,
              ),
            )}
            .
          </p>
        )}
        {notice && (
          <p className="slip-feedback" role="status">
            {notice}
          </p>
        )}
        {changedPicks && (
          <section className="quote-review" aria-label="Changed prices">
            <strong>Lines have changed</strong>
            <p>
              Your picks retain the prices you selected. Review these changes
              before placing the ticket.
            </p>
            {picks.map((p) => {
              const next = currentQuotes.find((m) => m.id === p.id);
              return (
                <p key={p.id}>
                  {p.label}: {formatOdds(p.odds)}
                  {next
                    ? ` → ${next.label} (${formatOdds(next.odds)})`
                    : " → Unavailable"}
                  {next && quoteUnavailable(next)
                    ? ` · ${quoteUnavailable(next)}`
                    : ""}
                </p>
              );
            })}
            <button
              disabled={busy || unavailablePicks}
              onClick={() => {
                setPicks(
                  picks.map((p) => currentQuotes.find((m) => m.id === p.id)!),
                );
                setPickRevision(selectedBoard?.revision ?? null);
                request.current = { key: "", id: "" };
              }}
            >
              Approve updated lines and prices
            </button>
          </section>
        )}
        {unavailablePicks && (
          <p className="slip-feedback" role="status">
            A selected market is unavailable. Remove it to continue; your other
            picks remain in the slip.
          </p>
        )}
        <button
          className="place-bet"
          disabled={
            teaserPreview ||
            !valid ||
            changedPicks ||
            unavailablePicks ||
            busy ||
            (!fixedOffer &&
              !(picks.some(isFuture) ? futureAccepting : accepting) &&
              !review)
          }
          onClick={() => void submit()}
        >
          <strong>
            {teaserPreview
              ? "Teaser betting unavailable"
              : busy
                ? "Placing Bet…"
                : `Place Bet ${money(wager || 0)}`}
          </strong>
          <small>{`Total Payout: ${ticketPayout}`}</small>
        </button>
      </dialog>
      <dialog
        ref={replaceDialog}
        className="promo-replace"
        aria-labelledby="promo-replace-title"
        onCancel={() => setPendingOffer(null)}
      >
        <h2 id="promo-replace-title">Replace your current slip?</h2>
        <p>This offer replaces your selections with its locked ticket.</p>
        <div className="promo-actions">
          <button className="secondary" onClick={() => setPendingOffer(null)}>
            Keep current slip
          </button>
          <button
            className="primary"
            onClick={() => {
              if (pendingOffer) fillFixed(pendingOffer);
            }}
          >
            Replace with promo
          </button>
        </div>
      </dialog>
    </Container>
  );
}
