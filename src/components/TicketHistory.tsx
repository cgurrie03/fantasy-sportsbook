import { useState } from "react";
import type { ReactNode } from "react";
import type { AccountData, Ticket, TicketLeg } from "../lib/accounts";
import { money } from "../lib/accounts";

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
const decimalOdds = (value: number) =>
  value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);

function TicketFilters({
  tickets,
  owner,
  children,
  id,
}: {
  tickets: Ticket[];
  owner: (id: string) => string;
  children: (filtered: Ticket[]) => ReactNode;
  id: string;
}) {
  const [status, setStatus] = useState("All"),
    [expanded, setExpanded] = useState(false),
    [week, setWeek] = useState("all"),
    [bettor, setBettor] = useState("all"),
    [sort, setSort] = useState("placed"),
    [direction, setDirection] = useState("desc");
  const value = (t: Ticket) =>
    sort === "placed"
      ? Date.parse(t.placed_at)
      : sort === "settled"
        ? t.settled_at
          ? Date.parse(t.settled_at)
          : null
        : sort === "winnings"
          ? Number(t.actual_payout)
          : decimalOdds(t.accepted_combined_odds);
  const filtered = tickets
    .filter(
      (t) =>
        (status === "All" ||
          (status === "Settled"
            ? t.status !== "OPEN"
            : t.status === status.toUpperCase())) &&
        (bettor === "all" || t.team_id === bettor) &&
        (week === "all" ||
          (week === "futures"
            ? t.ticket_type === "future"
            : t.placement_week === Number(week))),
    )
    .sort((a, b) => {
      const x = value(a),
        y = value(b);
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      return (
        (x === null || y === null ? 0 : direction === "asc" ? x - y : y - x) ||
        Date.parse(b.placed_at) - Date.parse(a.placed_at) ||
        a.id.localeCompare(b.id)
      );
    });
  const owners = [...new Set(tickets.map((t) => t.team_id))];
  return (
    <>
      <div className="ticket-status-tabs" aria-label="Ticket Status">
        <button
          className="filter-toggle"
          aria-label="Show or hide filters"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h6m4 0h6M4 17h10m4 0h2" />
            <circle cx="12" cy="7" r="2" />
            <circle cx="16" cy="17" r="2" />
          </svg>
        </button>
        {["All", "Open", "Settled", "Won", "Lost"].map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="ticket-controls" id={id} hidden={!expanded}>
        <label>
          Week Placed
          <select value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="all">All Weeks</option>
            {Array.from({ length: 18 }, (_, i) => (
              <option key={i} value={i + 1}>
                Week {i + 1}
              </option>
            ))}
            <option value="futures">Futures</option>
          </select>
        </label>
        <label>
          Sort By
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="placed">Date Placed</option>
            <option value="settled">Date Settled</option>
            <option value="winnings">Winnings</option>
            <option value="odds">Odds</option>
          </select>
        </label>
        <label>
          Bettor
          <select value={bettor} onChange={(e) => setBettor(e.target.value)}>
            <option value="all">All Users</option>
            {owners.map((id) => (
              <option key={id} value={id}>
                {owner(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="desc">
              {sort === "placed" || sort === "settled"
                ? "Newest First"
                : "Highest First"}
            </option>
            <option value="asc">
              {sort === "placed" || sort === "settled"
                ? "Oldest First"
                : "Lowest First"}
            </option>
          </select>
        </label>
      </div>
      <p className="result-count" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "Ticket" : "Tickets"} · Times
        shown in Eastern
      </p>
      {children(filtered)}
      {!filtered.length && <p>No tickets match these filters.</p>}
    </>
  );
}

const legResult = (leg: TicketLeg) => {
  if (leg.actual_value == null)
    return leg.status === "OPEN"
      ? "Awaiting result"
      : "Actual result unavailable";
  const value = Number(leg.actual_value);
  const points = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (leg.market_type === "Spread" || leg.market_type === "Moneyline")
    return value === 0
      ? "Result: Tied"
      : "Result: " +
          (value > 0 ? "Won by " : "Lost by ") +
          points(Math.abs(value)) +
          " points";
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
}: {
  data: AccountData;
  tickets: Ticket[];
  owner: (id: string) => string;
}) {
  return (
    <TicketFilters tickets={tickets} owner={owner} id="admin-ticket-filters">
      {(visible) => (
        <>
          <div className="ticket-list">
            {visible.map((t) => {
              const legs = (data.legs ?? [])
                .filter((l) => l.ticket_id === t.id)
                .sort((a, b) => a.leg_number - b.leg_number);
              return (
                <details key={t.id} className="history-ticket">
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
                      {t.ticket_type === "future"
                        ? "Future Bet"
                        : `${legs.length} Pick Parlay`}{" "}
                      · Week {t.market_week} · {ticketDate(t.placed_at)}
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
                          {t.status === "OPEN" ? "Potential Payout" : "Payout"}
                        </small>
                        <strong className={t.status.toLowerCase()}>
                          {money(
                            t.status === "OPEN"
                              ? (t.accepted_potential_payout ?? 0)
                              : t.actual_payout,
                          )}
                        </strong>
                      </div>
                    </div>
                  </summary>
                  <div className="ticket-body">
                    {legs.map((l) => (
                      <TicketLegDetails key={l.id} leg={l} />
                    ))}
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
                    <p className={"ticket-meta " + t.status.toLowerCase()}>
                      {t.status !== "OPEN" &&
                        "Net Profit: " +
                          money(Number(t.actual_payout) - Number(t.stake))}
                    </p>
                  </div>
                </details>
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
              event: "Bet Settled",
              amount: t.actual_payout,
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

export function TicketLegDetails({ leg: l }: { leg: TicketLeg }) {
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
      </div>
    </div>
  );
}
