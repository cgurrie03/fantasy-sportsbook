import {auth,live} from "./live";
import { LegState } from "./LegState";
import { PickProgress } from "./TicketProgress";
import { PickLabel } from "./PickLabel";
import { routeUrl, navigate, currentRoute, routeQuery } from "./routing";
import { useEffect, useRef, useState } from "react";
import { Icon, Badge } from "./ui";
import {
  exampleTickets,
  price,
  money,
  ticketOdds,
  ticketReturn,
} from "./model";
import type { Ticket } from "./model";
const liveUpdates = (tickets:Ticket[]) => tickets.filter(t=>!!live().user.walletId&&t.walletId===live().user.walletId).slice(0,8).map(t=>({id:t.id,title:t.status==="Open"?"Ticket Placed":"Ticket "+t.status,ticket:t,text:t.status==="Won"?"Return "+money(ticketReturn(t))+" credits.":t.status==="Open"?"Follow Your Selections In My Bets.":"",tone:t.status==="Won"?"gold":t.status==="Lost"?"red":"neutral"}));
const previewUpdates = live()?[]:[
  {
    id: "ticket-won",
    title: "Ticket Won",
    ticket: exampleTickets[1],
    text: "Return " + money(ticketReturn(exampleTickets[1])) + " credits.",
    tone: "gold",
  },
  {
    id: "leg-won",
    title: "Parlay Leg Won",
    ticket: exampleTickets[0],
    text:
      exampleTickets[0].picks[0].label +
      " won. One leg remains awaiting confirmation.",
    tone: "gold",
  },
  {
    id: "ticket-lost",
    title: "Ticket Lost",
    ticket: exampleTickets[2],
    text: exampleTickets[2].picks[0].result!.summary,
    tone: "red",
  },
  {
    id: "ticket-push",
    title: "Stake Returned",
    ticket: exampleTickets[3],
    text: "This ticket pushed. All 20.00 credits returned.",
    tone: "neutral",
  },
];
function resolutionSummary(ticket: Ticket, text: string) {
  const count = (state: string) =>
    ticket.picks.filter((p) => (p.result?.status || "Open") === state).length;
  const won = count("Won"),
    pushed = count("Push"),
    open = count("Open"),
    lost = count("Lost");
  if (ticket.status === "Open") {
    const confirming = ticket.picks
      .filter((p) => (p.result?.status || "Open") === "Open")
      .every((p) => /confirmation/i.test(p.result?.summary || ""));
    return {
      icon: "clock",
      title: open
        ? `${open} ${open === 1 ? "Leg" : "Legs"} ${confirming ? "Awaiting Confirmation" : "Still Open"}`
        : "Awaiting Settlement",
      detail: [
        won ? `${won} Won` : "",
        pushed ? `${pushed} Pushed` : "",
        lost ? `${lost} Lost` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      next: confirming
        ? "Ticket settles after the final result is confirmed."
        : "Follow the remaining selections in your ticket.",
    };
  }
  return {
    icon:
      ticket.status === "Won"
        ? "check"
        : ticket.status === "Lost"
          ? "close"
          : "minus",
    title:
      ticket.status === "Won"
        ? "Ticket Complete"
        : ticket.status === "Lost"
          ? "Ticket Settled"
          : "Stake Returned",
    detail: text,
    next: "",
  };
}
export function NotificationsFeed({
  onTicket,
  tickets=exampleTickets,
  onClose = () => {},
  supportCount = 0,
}: {
  onTicket: (t: Ticket, share?: boolean) => void;
  onClose?: () => void;
  supportCount?: number;
  tickets?: Ticket[];
}) {
  const updates=live()?liveUpdates(tickets):previewUpdates;
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const entries = [...element.querySelectorAll(".notification-item")].slice(0, 3);
    const update = () => {
      const height = entries.reduce((total, item) => total + item.getBoundingClientRect().height
        + (parseFloat(getComputedStyle(item.parentElement!).borderBottomWidth) || 0), 0);
      element.style.setProperty("--three-notices", height + "px");
    };
    const observer = new ResizeObserver(update);
    entries.forEach((entry) => observer.observe(entry));
    update();
    return () => observer.disconnect();
  }, [updates.length,supportCount]);
  return (
    <>
      <div className="notification-list" ref={list} tabIndex={0} aria-label="Notification History">
        {supportCount>0&&<article className="notification-entry"><a className="notification-item" href="/platform?section=support" onClick={onClose}>
          <span className="notification-dot gold"/><span><strong>{supportCount} New Support Request{supportCount===1?'':'s'}</strong><small>Review In The Platform Owner Inbox</small></span><Icon name="chevron" size={14}/>
        </a></article>}
        {updates.map((u) => {
          const summary = resolutionSummary(u.ticket, u.text);
          return (
            <article className="notification-entry" key={u.id}>
              <button
                className="notification-item"
                aria-expanded={expanded === u.id}
                onClick={() => setExpanded(expanded === u.id ? null : u.id)}
              >
                <span className={"notification-dot " + u.tone} />
                <span>
                  <strong>{u.title}</strong>
                  <small className="notification-ticket-meta">
                    {u.ticket.picks.length === 1
                      ? "Single"
                      : u.ticket.picks.length + "-Leg Parlay"}
                    <b>{price(ticketOdds(u.ticket))}</b>
                    <span>Wager {money(u.ticket.stake)}</span>
                  </small>
                  <time>Week {u.ticket.week || 8}</time>
                </span>
                <Icon name="chevron" size={14} />
              </button>
              {u.ticket.status === "Won" && expanded !== u.id && (
                <button
                  className="notification-share text-button"
                  onClick={() => {
                    onClose();
                    onTicket(u.ticket, true);
                  }}
                >
                  <Icon name="share" size={14} />
                  Share This Win
                </button>
              )}
              {expanded === u.id && (
                <div className="notification-detail">
                  <ul>
                    {u.ticket.picks.map((p) => (
                      <li className="notification-leg" key={p.id}>
                        {u.ticket.picks.length > 1 && (
                          <LegState status={p.result?.status || "Open"} small />
                        )}
                        <div className="notification-leg-body">
                          <span className="notification-selection">
                            <PickLabel pick={p} />
                          </span>
                          {p.matchupLabel && (
                            <small className="notification-game">
                              {p.matchupLabel}
                            </small>
                          )}
                          {p.result?.summary && p.result.status !== "Open" && <small className="notification-game">{p.result.summary}</small>}
                          <PickProgress pick={p} />
                        </div>
                        <Badge>{p.result?.status || "Open"}</Badge>
                      </li>
                    ))}
                  </ul>
                  <section
                    className={"notification-summary result-" + u.tone}
                    aria-label="Ticket Update"
                  >
                    <Icon name={summary.icon} size={17} />
                    <div>
                      <strong>{summary.title}</strong>
                      {summary.detail && <p>{summary.detail}</p>}
                      {summary.next && <small>{summary.next}</small>}
                    </div>
                  </section>
                  <div className="notification-detail-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        onClose();
                        onTicket(u.ticket);
                      }}
                    >
                      View Ticket <Icon name="arrow" size={14} />
                    </button>
                    {u.ticket.status === "Won" && (
                      <button
                        className="text-button"
                        onClick={() => {
                          onClose();
                          onTicket(u.ticket, true);
                        }}
                      >
                        <Icon name="share" size={14} />
                        Share This Win
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <a
        className="notification-preferences"
        href={routeUrl("profile?section=communications")}
        onClick={onClose}
      >
        Notification Preferences
        <Icon name="arrow" size={15} />
      </a>
    </>
  );
}
export function NotificationBell({
  onTicket,
  tickets=exampleTickets,
}: {
  onTicket: (t: Ticket, share?: boolean) => void;
  tickets?: Ticket[];
}) {
  const [open, setOpen] = useState(false),
    [read, setRead] = useState(false);
  const [supportCount,setSupportCount]=useState(0),[supportRefresh,setSupportRefresh]=useState(0);
  useEffect(()=>{const update=()=>setSupportRefresh(v=>v+1);window.addEventListener('boff-support-updated',update);window.addEventListener('boff-account-refreshed',update);return()=>{window.removeEventListener('boff-support-updated',update);window.removeEventListener('boff-account-refreshed',update);};},[]);
  useEffect(()=>{
    if(!live()?.user.platformOwner)return;const controller=new AbortController();
    void auth.rpc('dev_support_notice').abortSignal(controller.signal).then(({data,error})=>{if(!controller.signal.aborted&&!error)setSupportCount(Number(data?.count??0));});
    return()=>controller.abort();
  },[open,supportRefresh]);
  const ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="notification-control" ref={ref}>
      <button
        className="icon-button notification-bell"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="notification-popover"
        ref={button}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" size={19} />
        {(!read||supportCount>0) && <span className="unread-dot" />}
      </button>
      {open && (
        <div
          id="notification-popover"
          className="notification-popover"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notification-heading">
            <h2>Notifications</h2>
            <button className="text-button" onClick={() => setRead(true)}>
              {read ? "All Read" : "Mark All Read"}
            </button>
            <button
              className="icon-button"
              aria-label="Close Notifications"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
              }}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
          <NotificationsFeed
            tickets={tickets}
            onTicket={onTicket}
            onClose={() => setOpen(false)}
            supportCount={supportCount}
          />
        </div>
      )}
    </div>
  );
}
