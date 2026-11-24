import { useEffect, useState } from "react";
import {isDevelopment} from './environment';
import {bookSection,live,receipt} from './live';
import { Badge, PageHeading, Icon, Empty } from "./ui";
import { GroupedPicks } from "./GroupedPicks";
import { PickLabel } from "./PickLabel";
import { PickProgress } from "./TicketProgress";
import { userBalance } from "./BalanceHistory";
import { routeQuery } from "./routing";
import {
  league,
  members,
  profileTeam,
  price,
  money,
  decimal,
  ticketOdds,
  ticketReturn,
} from "./model";
import type { Ticket } from "./model";
export function TicketsPage({
  all = false,
  tickets,
  onTicket,
}: {
  all?: boolean;
  tickets: Ticket[];
  onTicket: (t: Ticket, share?: boolean) => void;
}) {
  const [status, setStatus] = useState("All"),
    [query, setQuery] = useState(""),
    [week, setWeek] = useState("all"),
    [participant, setParticipant] = useState("all"),
    [sort, setSort] = useState("newest"),
    [expanded, setExpanded] = useState<Set<string>>(
      () =>
        new Set(
          routeQuery().get("ticket") ? [routeQuery().get("ticket")!] : [],
        ),
    );
  const [remote,setRemote]=useState<Ticket[]>([]);
  const [page,setPage]=useState<{next:unknown;summary:{count:number;openStake:number};weeks:number[];participants:{id:string;name:string}[]}>({next:null,summary:{count:0,openStake:0},weeks:[],participants:[]});
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [controller,setController]=useState<AbortController|null>(null);
  async function load(cursor:unknown,signal:AbortSignal){
    const context=live();if(!context)return;setLoading(true);setError('');
    try{
      const data=await bookSection({history:'tickets',...(all?{}:{mine:'1'}),status,sort,...(week==='all'?{}:{week}),
        ...(!all||participant==='all'?{}:{participant}),...(query?{search:query}:{}),...(cursor?{cursor:JSON.stringify(cursor)}:{})},signal);
      if(signal.aborted||live()?.user.id!==context.user.id)return;
      const rows=data.tickets.map((row:unknown)=>receipt(row,context));
      setRemote(previous=>cursor?[...new Map([...previous,...rows].map(row=>[row.id,row])).values()]:rows);setPage(data);
    }catch(e){if(!signal.aborted)setError((e as Error).message);}
    finally{if(!signal.aborted)setLoading(false);}
  }
  useEffect(()=>{
    if(!live())return;const abort=new AbortController();setController(abort);setRemote([]);setLoading(true);setPage(previous=>({...previous,next:null}));
    const timer=setTimeout(()=>void load(null,abort.signal),query?250:0);
    return()=>{clearTimeout(timer);abort.abort();};
  },[all,status,sort,week,participant,query,refresh]);
  useEffect(() => {
    const sync = () => {
      const id = routeQuery().get("ticket");
      if (id) {
        setStatus("All");
        setWeek("all");
        setParticipant("all");
        setQuery(live()?id:"");
        setExpanded((prev) => new Set([...prev, id]));
        requestAnimationFrame(() =>
          document
            .getElementById("ticket-" + id)
            ?.scrollIntoView({ block: "nearest" }),
        );
      }
    };
    sync();
    window.addEventListener("boff-navigation", sync);
    return () => window.removeEventListener("boff-navigation", sync);
  }, []);
  const weeks = live()?page.weeks:[...new Set(tickets.map((t) => t.week ?? league.week))].sort(
    (a, b) => b - a,
  );
  const visible = live()?remote:tickets
    .filter(
      (t) =>
        (status === "All" || t.status === status) &&
        (week === "all" || (t.week ?? league.week) === Number(week)) &&
        (!all || participant === "all" || t.participant === participant) &&
        `${t.id} ${t.picks.map((p) => p.label + " " + (p.matchupLabel || "")).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const time = (t: Ticket) => t.placedAt ?? Number(t.id.replace(/\D/g, ""));
      return sort === "stake-high"
        ? b.stake - a.stake || time(b) - time(a)
        : sort === "stake-low"
          ? a.stake - b.stake || time(b) - time(a)
          : sort === "oldest"
            ? time(a) - time(b)
            : time(b) - time(a);
    });
  return (
    <>
      <PageHeading title={all ? "All Bets" : "My Bets"} />
      <div className="ticket-summary">
        <div>
          <span>Balance</span>
          <strong>
            {money(userBalance(profileTeam.manager, tickets))}{" "}
            <small>credits</small>
          </strong>
        </div>
        <div>
          <span>Open Stake</span>
          <strong>
            {live()?money(Number(page.summary.openStake)):money(
              tickets
                .filter((t) => t.status === "Open")
                .reduce((n, t) => n + t.stake, 0),
            )}
          </strong>
        </div>
        <div>
          <span>Tickets</span>
          <strong>{live()?page.summary.count:tickets.length}</strong>
        </div>
        <Badge>{live()?(isDevelopment?"Dev Credits":"Virtual Credits"):"Example Data"}</Badge>
      </div>
      <div className={"ticket-tools " + (all ? "all-bets-tools" : "")}>
        <div className="segmented" aria-label="Ticket Status">
          {["All", "Open", "Won", "Lost", "Push"].map((s) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label>
          Week
          <select
            aria-label="Ticket Week"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          >
            <option value="all">All Weeks</option>
            {weeks.map((w) => (
              <option value={w} key={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        {all && (
          <label>
            Participant
            <select
              aria-label="Ticket Participant"
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
            >
              <option value="all">All Participants</option>
              {live()?page.participants.map(m=><option key={m.id} value={m.id}>{m.name}</option>):members.map((m) => (
                <option key={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Sort By
          <select
            aria-label="Ticket Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {[
              ["newest", "Newest First"],
              ["oldest", "Oldest First"],
              ["stake-high", "Highest Stake"],
              ["stake-low", "Lowest Stake"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="search">
          <Icon name="search" size={16} />
          <input
            aria-label="Find A Ticket"
            placeholder="Find A Ticket"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="tickets-list">
        {loading&&<p role="status">Loading Tickets…</p>}
        {error&&<p role="alert">{error} <button className="text-button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
        {visible.map((t) => {
          const single = t.picks.length === 1;
          const isExpanded = !single && expanded.has(t.id);
          const Header = single ? "div" : "button";
          return (
            <article
              className={
                "ticket-card " +
                (single ? "single-ticket " : "parlay-ticket ") +
                (isExpanded ? "expanded" : "")
              }
              id={"ticket-" + t.id}
              key={t.id}
              onClick={(event) => {
                if (single || !(event.target instanceof Element)) return;
                if (event.target.closest("button,a,input,select,summary") || window.getSelection()?.type === "Range") return;
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                });
              }}
            >
              <Header
                className="ticket-card-toggle"
                aria-expanded={single ? undefined : isExpanded}
                aria-controls={single ? undefined : "ticket-details-" + t.id}
                onClick={
                  single
                    ? undefined
                    : () =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                }
              >
                <div className="ticket-card-top">
                  <div className="ticket-type">
                    <strong>
                      {single
                        ? t.picks[0].detail
                        : t.picks.length + "-Leg Parlay"}
                    </strong>
                    {all && (
                      <small>{t.participant || profileTeam.manager}</small>
                    )}
                  </div>
                  {!single && (
                    <strong className="ticket-header-odds">
                      {price(ticketOdds(t))}
                    </strong>
                  )}
                  <span className="ticket-list-identity">
                    <small title={t.id}>{t.id.length > 12 ? t.id.slice(0, 8) : t.id}</small>
                    <Badge>{t.status}</Badge>
                  </span>
                  {!single && <Icon name="chevron" size={17} />}
                </div>
                {single && (
                  <div className="ticket-card-main">
                    <div>
                      <h3>
                        <PickLabel pick={t.picks[0]} />
                      </h3>
                      <p className="ticket-game-context">
                        {t.picks[0].matchupLabel || "Season Futures"}
                      </p>
                    </div>
                    <strong>{price(ticketOdds(t))}</strong>
                  </div>
                )}
              </Header>
              {!single && !isExpanded && (
                <div className="ticket-leg-overview">
                  {t.picks.map((p) => (
                    <div className="ticket-preview-leg" key={p.id}>
                      <div>
                        <strong>
                          <PickLabel pick={p} />
                        </strong>
                        <small>{p.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {single && (
                <div className="single-ticket-result">
                  {t.picks[0].result?.summary &&
                    t.picks[0].result.summary !==
                      "Awaiting Final Confirmation" && (
                      <p className="leg-result">{t.picks[0].result.summary}</p>
                    )}
                  <PickProgress pick={t.picks[0]} />
                </div>
              )}
              {isExpanded && (
                <div
                  id={"ticket-details-" + t.id}
                  className="inline-ticket-details"
                >
                  <GroupedPicks picks={t.picks} compact />
                </div>
              )}
              <div className="ticket-card-bottom">
                <span>
                  Stake <b>{money(t.stake)}</b>
                </span>
                {t.status !== "Lost" && (
                  <span>
                    {t.status === "Open"
                      ? "Potential Return"
                      : t.status === "Push"
                        ? "Stake Returned"
                        : "Return"}{" "}
                    <b>
                      {money(
                        t.status === "Open"
                          ? t.stake * decimal(ticketOdds(t))
                          : ticketReturn(t),
                      )}
                    </b>
                  </span>
                )}
                <small>{t.created}</small>
                {(single || isExpanded) && (
                  <button
                    className="text-button ticket-share"
                    onClick={() => onTicket(t, true)}
                  >
                    <Icon name="share" size={15} />
                    {t.status === "Won" ? "Share This Win" : "Share Ticket"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!visible.length && !loading && !error && (
          <Empty
            title="No Tickets"
            action={
              <button
                className="button secondary"
                onClick={() => {
                  setStatus("All");
                  setWeek("all");
                  setParticipant("all");
                  setQuery("");
                }}
              >
                Clear Filters
              </button>
            }
          >
            No tickets match these filters.
          </Empty>
        )}
      </div>
      {live()&&<div className="history-pagination">
        {!!page.next&&<button className="button secondary" disabled={loading||!controller} onClick={()=>controller&&void load(page.next,controller.signal)}>Load More Tickets</button>}
        <button className="text-button" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Refresh Tickets</button>
      </div>}
      <p className="footnote">
        {live()?"Filters and search cover the full ticket history. Older tickets load in pages. Boff uses virtual credits.":"Ticket examples use your league’s real teams. No actual wagers or balances."}
      </p>
    </>
  );
}
