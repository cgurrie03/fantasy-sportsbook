import {live,bookSection} from "./live";
import { useEffect, useRef, useState } from "react";
import {
  members,
  profileTeam,
  exampleTickets,
  money,
  ticketReturn,
} from "./model";
import type { Ticket } from "./model";
import { Badge } from "./ui";
export function balanceEntries(
  user: string,
  tickets: Ticket[] = exampleTickets,
) {
  if(live())return live().ledger.map((r:any)=>({id:r.id,reason:r.reason||r.kind,delta:Number(r.amount),balance:Number(r.balance_after),detail:r.created_at?new Date(r.created_at).toLocaleString():""}));
  let balance = 0;
  const rows: {
    id: string;
    reason: string;
    delta: number;
    balance: number;
    detail: string;
  }[] = [];
  const add = (id: string, reason: string, delta: number, detail: string) => {
    balance += delta;
    rows.push({ id, reason, delta, balance, detail });
  };
  add("season", "Season Credits", 200, "Opening Allocation");
  add("replenishment", "Weekly Replenishment", 50, "Week 8");
  for (const t of tickets.filter((t) => t.participant === user)) {
    add(t.id + "-stake", "Wager", -t.stake, t.id);
    if (t.status === "Won")
      add(
        t.id + "-return",
        "Payout",
        ticketReturn(t),
        t.id + " · Includes Stake",
      );
    else if (["Push", "Voided"].includes(t.status))
      add(t.id + "-refund", "Refund", t.stake, t.id);
  }
  return rows.reverse();
}
export const userBalance = (user: string, tickets: Ticket[] = exampleTickets) =>
  live()?(user===profileTeam.manager?Number(live().balance):Number(live().teams.find((t:any)=>t.id===members.find(m=>m.name===user&&!m.co)?.team.id)?.wallets?.balance||0)):balanceEntries(user, tickets)[0]?.balance || 0;
export function BalanceHistory({
  tickets = exampleTickets,
  owner = false,
}: {
  tickets?: Ticket[];
  owner?: boolean;
}) {
  const [user, setUser] = useState(profileTeam.manager);
  const [expanded, setExpanded] = useState(false);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[next,setNext]=useState<unknown>(null);
  const [remote,setRemote]=useState<any[]>([]);
  const request=useRef<AbortController|null>(null);
  const leagueId=live()?.leagueId,balance=live()?.balance;
  async function load(cursor:unknown,signal:AbortSignal){
    setLoading(true);setError('');
    try{const data=await bookSection({history:'ledger',...(cursor?{cursor:JSON.stringify(cursor)}:{})},signal);
      if(signal.aborted)return;
      setRemote(previous=>cursor?[...new Map([...previous,...data.entries].map(row=>[row.id,row])).values()]:data.entries);setNext(data.next);
      live().ledger=cursor?[...new Map([...live().ledger,...data.entries].map((row:any)=>[row.id,row])).values()]:data.entries;
    }catch(e){if(!signal.aborted)setError((e as Error).message);}
    finally{if(!signal.aborted)setLoading(false);}
  }
  useEffect(()=>{
    if(!leagueId)return;const abort=new AbortController();request.current=abort;setRemote([]);void load(null,abort.signal);
    return()=>abort.abort();
  },[leagueId,balance]);
  const rows = live()?remote.map(r=>({id:r.id,reason:r.reason||r.kind,delta:Number(r.amount),balance:Number(r.balance_after),detail:r.created_at?new Date(r.created_at).toLocaleString():""})):balanceEntries(user, tickets);
  return (
    <section className="panel balance-history">
      <div className="panel-heading">
        <h3>Balance History</h3>
        <Badge>{live()?"Dev Credits":"Example Credits"}</Badge>
      </div>
      {owner && !live() && (
        <label className="balance-user">
          Participant
          <select
            aria-label="Balance History Participant"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="balance-current">
        <span>Available Balance</span>
        <strong>
          {money(live()?Number(live().balance):rows[0]?.balance || 0)} <small>credits</small>
        </strong>
      </div>
      <div className="balance-entries">
        {loading&&<p role="status">Loading Transactions…</p>}
        {error&&<p role="alert">{error} <button className="text-button" onClick={()=>request.current&&void load(null,request.current.signal)}>Retry</button></p>}
        {(expanded ? rows : rows.slice(0, 4)).map((r: {id:string;reason:string;delta:number;balance:number;detail:string}) => (
          <div className="balance-entry" key={r.id}>
            <span>
              <strong>{r.reason}</strong>
              <small>{r.detail}</small>
            </span>
            <b className={r.delta < 0 ? "negative" : "positive"}>
              {r.delta > 0 ? "+" : ""}
              {money(r.delta)}
            </b>
            <span>
              {money(r.balance)}
              <small>Balance</small>
            </span>
          </div>
        ))}
      </div>
      {rows.length > 4 && (
        <button
          className="text-button balance-more"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show Recent Transactions" : "Show More Transactions"}
        </button>
      )}
      {expanded&&!!next&&<button className="button secondary" disabled={loading} onClick={()=>request.current&&void load(next,request.current.signal)}>Load Older Transactions</button>}
    </section>
  );
}
