import { TicketFilters } from "./TicketFilters";
import {
  ticketCategory,
  ticketTypeLabel,
  ticketReturns,
} from "../lib/ticket-labels";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import { useState } from "react";
import type { AccountData, Ticket, TicketLeg } from "../lib/accounts";
import { money } from "../lib/accounts";
import { TicketShare } from "./TicketShare";
import {
  useTicketProgress,
  observedLegProgress,
  TicketProgressNotice,
} from "./TicketProgress";

export function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg
      className="chevron-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={left ? "m15 6-6 6 6 6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}
const ticketDate = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const title = (value: string) => value[0] + value.slice(1).toLowerCase();
const odds = (value: number) => (value > 0 ? "+" + value : String(value));

const legResult = (leg: TicketLeg) => {
  if (leg.status === "VOIDED") return "Wager refunded";
  if (
    ["Head to Head", "Winning Margin"].includes(leg.market_type) &&
    leg.status !== "OPEN"
  )
    return (
      leg.result_evidence ||
      (leg.status === "PUSH" ? "Leg pushed" : "Confirmed result")
    );
  if (leg.actual_value == null)
    return leg.status === "OPEN"
      ? "Awaiting result"
      : "Actual result unavailable";
  const value = Number(leg.actual_value);
  if (
    ["League Winner", "Make / Miss Playoffs", "#1 Pick"].includes(
      leg.market_type,
    )
  )
    return leg.result_evidence ?? "Confirmed season result";
  const points = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (leg.market_type === "Spread" || leg.market_type === "Moneyline")
    return value === 0
      ? "Result: Tied"
      : "Result: " +
          (value > 0 ? "Won by " : "Lost by ") +
          points(Math.abs(value)) +
          " points";
  if (
    leg.market_type.includes("Weekly High") ||
    leg.market_type.includes("Weekly Low")
  )
    return "Actual Winner: " + leg.selection + " · " + points(value);
  return (
    (leg.market_type.includes("Over") || leg.market_type.includes("Under")
      ? "Actual Total: "
      : "Actual Score: ") + points(value)
  );
};

export function TicketHistory({
  data,
  tickets,
  owner,
  canVoid = false,
  personal = false,
  readOnly = false,
  onChanged,
}: {
  data: AccountData;
  canVoid?: boolean;
  personal?: boolean;
  readOnly?: boolean;
  onChanged?: () => Promise<void>;
  tickets: Ticket[];
  owner: (id: string) => string;
}) {
  const [voiding, setVoiding] = useState<Ticket | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const observations = useTicketProgress(
    tickets[0]?.league_id,
    tickets,
    undefined,
    !readOnly,
  );
  async function cancelTicket() {
    if (readOnly || !voiding || !reason.trim() || saving || !supabase) return;
    setSaving(true);
    setFeedback("");
    try {
      const result = await supabase.rpc("void_sportsbook_ticket", {
        p_ticket: voiding.id,
        p_reason: reason.trim(),
      });
      if (result.error) throw result.error;
      setVoiding(null);
      setReason("");
      await onChanged?.();
      setFeedback("Ticket voided. The wager has been refunded.");
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <TicketFilters
      tickets={tickets}
      owner={owner}
      personal={personal}
      id="admin-ticket-filters"
      searchText={(t) =>
        [
          t.id,
          t.legacy_ticket_id,
          owner(t.team_id),
          data.teams.find((team) => team.id === t.team_id)?.team_name,
          ...(data.legs ?? [])
            .filter((l) => l.ticket_id === t.id)
            .map((l) => [l.selection, l.matchup, l.market_type].join(" ")),
        ].join(" ")
      }
    >
      {(visible) => (
        <>
          {canVoid && !tickets.some((t) => t.status === "OPEN") && (
            <p className="history-note">
              No open tickets to cancel. The cancel icon appears beside Open;
              settled tickets are preserved.
            </p>
          )}
          {feedback && (
            <p className="feedback" role="status">
              {feedback}
            </p>
          )}
          <div className={personal ? "ticket-list personal" : "ticket-list"}>
            {visible.map((t) => {
              const legs = (data.legs ?? [])
                .filter((l) => l.ticket_id === t.id)
                .sort((a, b) => a.leg_number - b.leg_number);
              const observation = observations.rows.find(
                (r) =>
                  r.league_id === t.league_id &&
                  r.market_week === t.market_week &&
                  r.nfl_season === t.nfl_season,
              );
              return (
                <article key={t.id} className="history-ticket-wrap">
                  <details
                    id={`ticket-${t.id}`}
                    className="history-ticket"
                    ref={(node) => {
                      if (
                        node &&
                        new URLSearchParams(
                          window.location.hash.split("?")[1],
                        ).get("ticket") === t.id &&
                        !node.dataset.focused
                      ) {
                        node.open = true;
                        node.dataset.focused = "true";
                        node.scrollIntoView({ block: "center" });
                      }
                    }}
                  >
                    <summary>
                      <div className="ticket-top">
                        <div className="ticket-owner">
                          <strong>{owner(t.team_id)}</strong>
                          <small>
                            {
                              data.teams.find((team) => team.id === t.team_id)
                                ?.team_name
                            }
                          </small>
                        </div>
                        <div className="ticket-labels">
                          <strong className={t.status.toLowerCase()}>
                            {title(t.status)}
                          </strong>
                          <span className="ticket-chevron">
                            <Chevron />
                          </span>
                        </div>
                      </div>
                      <p className="ticket-meta">
                        {ticketTypeLabel(t, legs.length)} · {ticketCategory(t)}{" "}
                        · {ticketDate(t.placed_at)}
                      </p>
                      <p className="ticket-selection-preview">
                        {legs
                          .slice(0, 2)
                          .map((l) => l.selection)
                          .join(" · ")}
                        {legs.length > 2 ? ` · +${legs.length - 2} more` : ""}
                      </p>
                      <div className="ticket-values">
                        <div>
                          <small>Wager</small>
                          <strong>{money(t.stake)}</strong>
                        </div>
                        <div>
                          <small>Odds</small>
                          <strong>{odds(t.accepted_combined_odds)}</strong>
                        </div>
                        <div>
                          <small>
                            {t.status === "OPEN"
                              ? "Potential total return"
                              : t.status === "VOIDED"
                                ? "Refund"
                                : "Total return"}
                          </small>
                          <strong className={t.status.toLowerCase()}>
                            {money(
                              t.status === "OPEN"
                                ? (t.accepted_potential_payout ?? 0)
                                : ticketReturns(t).total,
                            )}
                          </strong>
                        </div>
                      </div>
                      <p className="ticket-profit">
                        {t.status === "OPEN"
                          ? "Potential profit"
                          : t.status === "VOIDED"
                            ? "Net change"
                            : "Net profit / loss"}
                        : {money(ticketReturns(t).profit)}
                      </p>
                    </summary>
                    <div className="ticket-body">
                      <p className="history-note">
                        Total return includes your stake. Net profit is total
                        return minus stake. Open stakes are not settled losses.
                      </p>
                      {t.status === "OPEN" && t.ticket_type !== "future" && (
                        <TicketProgressNotice
                          row={observation}
                          loading={observations.loading}
                          error={observations.error}
                          now={observations.now}
                        />
                      )}
                      {voiding?.id === t.id && (
                        <section
                          className="void-confirmation"
                          role="region"
                          aria-label="Confirm ticket cancellation"
                        >
                          <h2>Void Ticket</h2>
                          <p>
                            Refund {money(voiding.stake)} to{" "}
                            {owner(voiding.team_id)} and preserve this ticket as
                            Voided.
                          </p>
                          <label>
                            Cancellation Reason
                            <input
                              value={reason}
                              maxLength={500}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          </label>
                          <button
                            className="primary"
                            disabled={saving || !reason.trim()}
                            onClick={cancelTicket}
                          >
                            {saving ? "Voiding…" : "Void & Refund"}
                          </button>
                          <button
                            className="secondary"
                            disabled={saving}
                            onClick={() => setVoiding(null)}
                          >
                            Keep Ticket
                          </button>
                        </section>
                      )}
                      {legs.map((l) => {
                        const tracksWins =
                          t.ticket_type === "future" &&
                          t.status === "OPEN" &&
                          l.status === "OPEN" &&
                          (l.market_kind === "future_win_total" ||
                            l.market_type === "Regular-season Wins");
                        const league = data.leagues.find(
                          (item) => item.id === t.league_id,
                        );
                        const subject = data.teams.find(
                          (team) =>
                            team.id === l.subject_team_id &&
                            team.league_id === t.league_id,
                        );
                        const hasWins =
                          league != null &&
                          league.nfl_season === t.nfl_season &&
                          subject != null &&
                          Number.isInteger(subject.wins) &&
                          subject.wins >= 0;
                        return (
                          <TicketLegDetails
                            key={l.id}
                            leg={l}
                            progress={
                              tracksWins
                                ? hasWins
                                  ? `Current wins: ${subject!.wins}`
                                  : "Current wins unavailable"
                                : observedLegProgress(l, observation)
                            }
                          />
                        );
                      })}
                      <div className="ticket-foot">
                        <span>
                          Bet ID: {t.legacy_ticket_id ?? t.id.slice(0, 8)}
                        </span>
                        <span>
                          {t.settled_at
                            ? "Settled: " + ticketDate(t.settled_at)
                            : "Awaiting results"}
                        </span>
                      </div>
                      <TicketShare
                        data={data}
                        ticket={t}
                        owner={owner(t.team_id)}
                      />
                      <p className={"ticket-meta " + t.status.toLowerCase()}>
                        {t.status !== "OPEN" &&
                          "Net Profit: " +
                            money(Number(t.actual_payout) - Number(t.stake))}
                      </p>
                    </div>
                  </details>
                  {canVoid && !readOnly && t.status === "OPEN" && (
                    <button
                      className="void-ticket-icon"
                      disabled={saving}
                      aria-label="Void Ticket"
                      title="Void Ticket"
                      aria-expanded={voiding?.id === t.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const details = e.currentTarget
                          .closest("article")
                          ?.querySelector("details");
                        if (details) details.open = true;
                        setVoiding(voiding?.id === t.id ? null : t);
                        setReason("Cancelled by league admin");
                        setFeedback("");
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="8" />
                        <path d="m6.5 17.5 11-11" />
                      </svg>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </TicketFilters>
  );
}

export function BettingLogs({
  tickets,
  owner,
}: {
  tickets: Ticket[];
  owner: (id: string) => string;
}) {
  return (
    <TicketFilters tickets={tickets} owner={owner} id="admin-log-filters">
      {(visible) => <BettingLogTable tickets={visible} owner={owner} />}
    </TicketFilters>
  );
}

function BettingLogTable({
  tickets,
  owner,
}: {
  tickets: Ticket[];
  owner: (id: string) => string;
}) {
  const entries = tickets.flatMap((t) =>
    [
      {
        ticket: t,
        key: t.id + "placed",
        time: t.placed_at,
        event: "Bet Placed",
        amount: t.stake,
        result: "Wager",
      },
      ...(t.settled_at
        ? [
            {
              ticket: t,
              key: t.id + "settled",
              time: t.settled_at,
              event: t.status === "VOIDED" ? "Bet Voided" : "Bet Settled",
              amount: ticketReturns(t).total,
              result: title(t.status),
            },
          ]
        : []),
    ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)),
  );
  return (
    <div className="betting-logs">
      <table>
        <caption>
          {entries.length} Records · All times Eastern · Placement and
          settlement records for matching tickets
        </caption>
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Bettor</th>
            <th>Event / Ticket</th>
            <th className="log-amount">Amount / Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key}>
              <td>
                <time dateTime={e.time}>
                  <strong>
                    {new Date(e.time).toLocaleDateString("en-US", {
                      timeZone: "America/New_York",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </strong>
                  <small>
                    {new Date(e.time).toLocaleTimeString("en-US", {
                      timeZone: "America/New_York",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </time>
              </td>
              <td>{owner(e.ticket.team_id)}</td>
              <td>
                {e.event}
                <small>
                  {e.ticket.legacy_ticket_id ?? e.ticket.id.slice(0, 8)}
                </small>
              </td>
              <td className="log-amount">
                <strong>{money(e.amount)}</strong>
                <small className={e.result.toLowerCase()}>{e.result}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length && <p>No betting records yet.</p>}
    </div>
  );
}

export function TicketLegDetails({
  leg: l,
  progress,
}: {
  leg: TicketLeg;
  progress?: string;
}) {
  return (
    <div className={"history-leg " + l.status.toLowerCase()} key={l.id}>
      <span
        className="leg-mark"
        aria-label={`Leg ${l.leg_number} ${title(l.status)}`}
      >
        {l.status === "WON" || l.status === "LOST" ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path
              d={
                l.status === "LOST" ? "m6 6 12 12M18 6 6 18" : "m5 12 4 4 10-10"
              }
            />
          </svg>
        ) : (
          l.leg_number
        )}
      </span>
      <div>
        <strong>{l.selection}</strong>
        {l.matchup && (
          <small className="leg-matchup">
            {l.matchup.replace(/\bvs\.?\s/gi, "vs. ")}
          </small>
        )}
        <small>
          {l.market_type} · {title(l.status)}
        </small>
        <small className="leg-actual">{legResult(l)}</small>
        {progress && <small className="leg-progress">{progress}</small>}
      </div>
    </div>
  );
}
