import { useEffect, useState } from "react";
import { useRoute } from "../lib/navigation";
import type { ReactNode } from "react";
import type { Ticket } from "../lib/accounts";
import {useTicketPage} from '../lib/account-history';
import type {RemoteTicketScope,TicketPage} from '../lib/account-history';
export function TicketFilters({
  tickets,
  owner,
  children,
  id,
  personal = false,
  searchText = (t) => t.id,
  remote,
  teamOptions,
  onVisibleChange,
}: {
  tickets: Ticket[];
  owner: (id: string) => string;
  children: (filtered: Ticket[],page?:TicketPage) => ReactNode;
  id: string;
  personal?: boolean;
  searchText?: (ticket: Ticket) => string;
  remote?:RemoteTicketScope;
  teamOptions?:string[];
  onVisibleChange?:(tickets:Ticket[])=>void;
}) {
  const route = useRoute();
  const routeTicket =
    new URLSearchParams(route.split("?")[1]).get("ticket") ?? "";
  const [status, setStatus] = useState("All"),
    [expanded, setExpanded] = useState(false),
    [week, setWeek] = useState("all"),
    [bettor, setBettor] = useState("all"),
    [sort, setSort] = useState("placed"),
    [direction, setDirection] = useState("desc"),
    [query, setQuery] = useState(routeTicket),
    [compact, setCompact] = useState(false),
    [pagination, setPagination] = useState({ signature: "", count: 20 });
  useEffect(() => setQuery(routeTicket), [routeTicket]);
  const signature = [status, week, bettor, sort, direction, query].join("|");
  const limit = pagination.signature === signature ? pagination.count : 20;
  const page=useTicketPage(remote,{status,week,sort,direction,query,team:bettor,personal,...(remote?.details===false?{details:false}:{})});
  const active = [
    status !== "All",
    week !== "all",
    !personal && bettor !== "all",
    !!query.trim(),
  ].filter(Boolean).length;
  const value = (t: Ticket) =>
    sort === "placed"
      ? Date.parse(t.placed_at)
      : sort === "settled"
        ? t.settled_at
          ? Date.parse(t.settled_at)
          : null
        : sort === "winnings"
          ? Number(t.actual_payout)
          : t.accepted_combined_odds > 0
            ? 1 + t.accepted_combined_odds / 100
            : 1 + 100 / Math.abs(t.accepted_combined_odds);
  const filtered = remote?(page.data?.tickets??[]):tickets
    .filter(
      (t) =>
        (status === "All" ||
          (status === "Settled"
            ? t.status !== "OPEN"
            : t.status === status.toUpperCase())) &&
        (personal || bettor === "all" || t.team_id === bettor) &&
        (week === "all" ||
          (week === "futures"
            ? t.ticket_type === "future"
            : t.placement_week === Number(week))) &&
        searchText(t)
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
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
  const remoteEnabled=!!remote;
  useEffect(()=>{if(remoteEnabled&&onVisibleChange)onVisibleChange(page.data?.tickets??[]);},[remoteEnabled,remote?.leagueId,page.data,onVisibleChange]);
  return (
    <>
      <div className="ticket-status-tabs" aria-label="Ticket Status">
        <button
          className="filter-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          Filters{active ? ` (${active})` : ""}
        </button>
        {["All", "Open", "Settled", "Won", "Lost", "Voided"].map((v) => (
          <button
            key={v}
            aria-pressed={status === v}
            onClick={() => setStatus(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="ticket-search">
        <label>
          Search tickets
          <input
            type="search"
            maxLength={128}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Player, team, selection, or ticket ID"
          />
        </label>
        <button aria-pressed={compact} onClick={() => setCompact(!compact)}>
          Compact view
        </button>
      </div>
      <div className="ticket-controls" id={id} hidden={!expanded}>
        <label>
          Placement week
          <select value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="all">All weeks</option>
            {Array.from({ length: 18 }, (_, i) => (
              <option key={i} value={i + 1}>
                Week {i + 1}
              </option>
            ))}
            <option value="futures">Season futures</option>
          </select>
        </label>
        {!personal && (
          <label>
            Bettor
            <select value={bettor} onChange={(e) => setBettor(e.target.value)}>
              <option value="all">All members</option>
              {[...new Set(teamOptions??tickets.map((t) => t.team_id))].map((v) => (
                <option key={v} value={v}>
                  {owner(v)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="placed">Date placed</option>
            <option value="settled">Date settled</option>
            <option value="winnings">Total return</option>
            <option value="odds">Odds</option>
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
                ? "Newest first"
                : "Highest first"}
            </option>
            <option value="asc">
              {sort === "placed" || sort === "settled"
                ? "Oldest first"
                : "Lowest first"}
            </option>
          </select>
        </label>
        <button
          onClick={() => {
            setStatus("All");
            setWeek("all");
            setBettor("all");
            setQuery("");
            setSort("placed");
            setDirection("desc");
          }}
        >
          Reset filters
        </button>
      </div>
      <p className="result-count" aria-live="polite">
        {remote?`Showing ${filtered.length?((page.page-1)*20)+1:0}–${((page.page-1)*20)+filtered.length} of ${page.data?.total??'…'} tickets`:
          `Showing ${Math.min(limit, filtered.length)} of ${filtered.length} tickets`}
        {' · Times shown in Eastern'}
      </p>
      {remote&&page.busy&&<p role="status">Loading ticket history…</p>}
      {remote&&page.error&&<p role="alert">{page.error} <button onClick={page.retry}>Retry ticket history</button></p>}
      <div className={compact ? "ticket-results compact" : "ticket-results"}>
        {children(remote?filtered:filtered.slice(0, limit),page.data??undefined)}
      </div>
      {!filtered.length && !(remote&&(page.busy||page.error)) && <p>No tickets match these filters.</p>}
      {remote&&<div className="ticket-page-controls">
        <button disabled={page.busy||page.page<=1} onClick={page.previous}>Previous 20 tickets</button>
        <button disabled={page.busy||!page.data?.next} onClick={page.next}>Next 20 tickets</button>
      </div>}
      {!remote&&(filtered.length > 20 || pagination.signature === signature) && (
        <button
          className="secondary"
          disabled={limit >= filtered.length}
          onClick={() => setPagination({ signature, count: limit + 20 })}
        >
          {limit >= filtered.length
            ? "All tickets shown"
            : "Show 20 more tickets"}
        </button>
      )}
    </>
  );
}
