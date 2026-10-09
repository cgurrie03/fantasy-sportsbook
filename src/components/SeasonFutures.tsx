import { useEffect, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage } from "../lib/accounts";
import type { Board, Market } from "../lib/markets";
import { formatOdds, futureKinds, loadFuturesBoard } from "../lib/markets";
import { supabase } from "../lib/supabase";

export function SeasonFutures({
  data,
  markets,
  quote,
}: {
  data: AccountData;
  markets: Market[];
  quote: (m: Market, text?: string) => React.ReactNode;
}) {
  const rowCount = Math.max(
    1,
    ...futureKinds.map(
      (kind) =>
        markets.filter(
          (m) =>
            m.kind === kind &&
            (kind !== "future_playoffs" || m.side === "make") &&
            (kind !== "future_win_total" || m.side === "over"),
        ).length,
    ),
  );
  return (
    <div
      className="season-futures-grid"
      style={{ "--future-rows": rowCount } as React.CSSProperties}
    >
      {[
        "future_win_total",
        "future_playoffs",
        "future_champion",
        "future_first_pick",
      ].map((kind) => (
        <article className="prop-card season-future-card" key={kind}>
          <header>
            <span className="future-emblem" aria-hidden="true">
              {kind === "future_champion"
                ? "🏆"
                : kind === "future_playoffs"
                  ? "★"
                  : kind === "future_win_total"
                    ? "↗"
                    : "#1"}
            </span>
            <div>
              <h2>
                {kind === "future_champion"
                  ? "League Winner"
                  : kind === "future_playoffs"
                    ? "Make / Miss Playoffs"
                    : kind === "future_win_total"
                      ? "Regular-season Wins"
                      : "#1 Pick"}
              </h2>
              <p>
                {kind === "future_champion"
                  ? "Win the league championship."
                  : kind === "future_playoffs"
                    ? "Qualify for the seven-team playoff field."
                    : kind === "future_win_total"
                      ? "Over or under the win line. No pushes."
                      : "Regular-season last place. Pick owner below."}
              </p>
            </div>
          </header>
          <div className="future-rows">
            {markets
              .filter(
                (m) =>
                  m.kind === kind &&
                  (kind !== "future_playoffs" || m.side === "make") &&
                  (kind !== "future_win_total" || m.side === "over"),
              )
              .sort(
                (a, b) =>
                  Number(
                    kind === "future_win_total"
                      ? b.metadata.expected_wins
                      : b.metadata.simulated_probability,
                  ) -
                  Number(
                    kind === "future_win_total"
                      ? a.metadata.expected_wins
                      : a.metadata.simulated_probability,
                  ),
              )
              .map((m, index) => {
                const team = data.teams.find((t) => t.id === m.team_id);
                return (
                  <div
                    className={`future-row${kind === "future_playoffs" && index === 7 ? " playoff-cutoff" : ""}`}
                    key={m.id}
                  >
                    <div className="future-team">
                      {team?.avatar_url ? (
                        <img src={team.avatar_url} alt="" />
                      ) : (
                        <span className="player-team-initial">
                          {team?.team_name.slice(0, 1)}
                        </span>
                      )}
                      <div>
                        <strong>{team?.team_name ?? m.subject}</strong>
                        {kind === "future_first_pick" && (
                          <small className="future-pick-owner">
                            Pick Owner:{" "}
                            {data.teams.find(
                              (t) => t.id === m.metadata.pick_owner_team_id,
                            )?.team_name ??
                              String(m.metadata.pick_owner_name ?? "Unknown")}
                          </small>
                        )}
                        <small>
                          {data.memberships.find(
                            (member) => member.team_id === team?.id,
                          )?.display_name ?? team?.sportsbook_owner_name}{" "}
                          · {team?.wins}–{team?.losses}
                        </small>
                      </div>
                    </div>
                    <div className="future-actions">
                      <div className="future-buttons">
                        {["future_playoffs", "future_win_total"].includes(kind)
                          ? [
                              m,
                              markets.find(
                                (q) =>
                                  q.kind === kind &&
                                  q.team_id === m.team_id &&
                                  q.side ===
                                    (kind === "future_win_total"
                                      ? "under"
                                      : "miss"),
                              ),
                            ]
                              .filter((q): q is Market => !!q)
                              .map((q) => (
                                <span key={q.id}>
                                  {quote(
                                    q,
                                    kind === "future_win_total"
                                      ? `${q.side === "over" ? "Over" : "Under"} ${q.line}`
                                      : q.side === "make"
                                        ? "Make"
                                        : "Miss",
                                  )}
                                </span>
                              ))
                          : quote(m, "")}
                      </div>
                      <small className="future-eligibility">
                        {kind === "future_playoffs"
                          ? "Playoff parlays only"
                          : kind === "future_win_total"
                            ? "Singles or win-total parlays"
                            : "Singles only"}
                      </small>
                    </div>
                  </div>
                );
              })}
            {!markets.some((m) => m.kind === kind) && (
              <p>
                Season markets will appear after they are generated and
                published.
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function FuturesAdmin({
  data,
  leagueId,
  week,
  season,
}: {
  data: AccountData;
  leagueId: string;
  week: number;
  season: number;
}) {
  const [board, setBoard] = useState<Board | null>(null),
    [markets, setMarkets] = useState<Market[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [failed, setFailed] = useState(false);
  const reload = async () => {
    const r = await loadFuturesBoard(leagueId);
    setBoard(r.board);
    setMarkets(r.markets);
  };
  useEffect(() => {
    let active = true;
    loadFuturesBoard(leagueId)
      .then((r) => {
        if (active) {
          setBoard(r.board);
          setMarkets(r.markets);
        }
      })
      .catch((e) => {
        if (active) {
          setNotice(errorMessage(e));
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [leagueId]);
  async function action(generate: boolean, status?: Board["status"]) {
    setBusy(true);
    setNotice("");
    setFailed(false);
    try {
      if (generate) {
        const session = (await supabase!.auth.getSession()).data.session;
        const response = await fetch("/api/generate-markets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({
            league_id: leagueId,
            week,
            nfl_season: season,
            category: "Season Futures",
          }),
        });
        const raw = await response.text();
        let r: { quotes: Market[]; error?: string; warnings?: string[] };
        try {
          r = JSON.parse(raw);
        } catch {
          throw new Error(raw.slice(0, 240) || "Futures generation failed.");
        }
        if (!response.ok)
          throw new Error(r.error ?? "Futures generation failed.");
        setMarkets(
          r.quotes.map((q) => ({
            ...q,
            id:
              markets.find(
                (m) => m.market_key === q.market_key && m.side === q.side,
              )?.id ?? q.id,
          })),
        );
        setNotice(
          "Season odds generated. Review the teams, pick ownership, and odds, then publish. " +
            (r.warnings ?? []).join(" "),
        );
      } else {
        const r = await supabase!.rpc("save_future_board", {
          p_board: board?.id ?? crypto.randomUUID(),
          p_league: leagueId,
          p_quotes: markets,
          p_status: status ?? "draft",
        });
        if (r.error) throw r.error;
        await reload();
        setNotice(
          status === "closed"
            ? "Season Futures closed manually."
            : "Season Futures published. Weekly cutoffs will not close these markets.",
        );
      }
    } catch (e) {
      setNotice(errorMessage(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="futures-admin">
      <div className="market-admin-actions market-admin-actions-top">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void action(true)}
        >
          {markets.length ? "Recalculate Futures" : "Generate Futures"}
        </button>
        <button
          className="primary"
          disabled={busy || !markets.length}
          onClick={() => void action(false, "published")}
        >
          Publish Futures
        </button>
        <button
          disabled={busy || !board}
          onClick={() =>
            void action(
              false,
              board?.status === "published" ? "closed" : "published",
            )
          }
        >
          {board?.status === "published" ? "Close Futures" : "Open Futures"}
        </button>
      </div>
      {notice && (
        <p
          className={`market-admin-notice ${failed ? "error" : "success"}`}
          role="status"
        >
          {notice}
        </p>
      )}
      <p>
        League Winner and #1 Pick: singles · Make/Miss Playoffs: parlays only ·
        Win totals: singles or win-total-only parlays · Odds rounded to 50,
        capped at ±10,000 · Record, then points for seeding · Seven playoff
        teams, #1 seed bye · 2027 first-round ownership from Sleeper
      </p>
      <SeasonFutures
        data={data}
        markets={markets}
        quote={(m, text) => (
          <label className="future-edit">
            <span>{text}</span>
            <input
              type="number"
              min="-10000"
              max="10000"
              step="50"
              aria-label={`${m.label} Odds`}
              value={m.odds}
              onBlur={() =>
                setMarkets(
                  markets.map((q) =>
                    q.id === m.id
                      ? {
                          ...q,
                          odds:
                            Math.sign(q.odds || 1) *
                            Math.min(
                              10000,
                              Math.max(
                                100,
                                Math.round(Math.abs(q.odds) / 50) * 50,
                              ),
                            ),
                        }
                      : q,
                  ),
                )
              }
              onChange={(e) =>
                setMarkets(
                  markets.map((q) =>
                    q.id === m.id ? { ...q, odds: Number(e.target.value) } : q,
                  ),
                )
              }
            />
            <small>{formatOdds(m.odds)}</small>
          </label>
        )}
      />
    </section>
  );
}
