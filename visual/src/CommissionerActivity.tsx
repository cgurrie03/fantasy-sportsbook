import {useEffect,useState} from 'react';
import {auth,live} from './live';
import {Badge} from './ui';
import {routeUrl,sharedTicketPath} from './routing';
import {getSettings} from './settings';
type Activity={event_id:string;event_at:string;event_type:string;label:string;member_name:string;actor_name:string;ticket_id:string|null;week:number|null;details:Record<string,string|number|null>};
const types=[['All','All Events'],['TicketPlaced','Ticket Placement'],['TicketSettled','Ticket Settlement'],['TicketVoided','Ticket Voids'],['Credits','Credits'],['Correction','Corrections'],['Membership','Membership & Access'],['Rules','Rules & Configuration'],['Administration','Other Administration']];
export function CommissionerActivity(){
 const [type,setType]=useState('All'),[member,setMember]=useState(''),[week,setWeek]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState('');
 const [events,setEvents]=useState<Activity[]>([]),[members,setMembers]=useState<{id:string;name:string}[]>([]),[next,setNext]=useState<unknown>(null),[count,setCount]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[request,setRequest]=useState<AbortController|null>(null);
 const league=live()?.leagueId;
 async function load(cursor:unknown,signal:AbortSignal){
  if(!league)return;setLoading(true);setError('');
  try{
   const {data,error}=await auth.rpc('dev_commissioner_activity',{p_league:league,p_type:type,p_member:member||null,p_week:week?Number(week):null,p_from:from||null,p_until:until||null,p_cursor:cursor}).abortSignal(signal);
   if(error)throw error;if(signal.aborted)return;
   setEvents(previous=>cursor?[...new Map([...previous,...data.events].map((row:Activity)=>[row.event_id,row])).values()]:data.events);setMembers(data.members);setNext(data.next);setCount(data.count);
  }catch(e){if(!signal.aborted)setError((e as Error).message);}finally{if(!signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  if(!league)return;const controller=new AbortController();setRequest(controller);setEvents([]);setNext(null);setLoading(true);
  if(from&&until&&from>until){setError('The start date must be before the end date.');setLoading(false);return()=>controller.abort();}
  void load(null,controller.signal);return()=>controller.abort();
 },[league,type,member,week,from,until,refresh]);
 const zone=getSettings().timezone;
 return <section className="panel commissioner-activity">
  <div className="panel-heading"><h3>Betting Log</h3><button className="button secondary" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Refresh Log</button></div>
  <p className="field-note">Actual ticket, credit and administrative records. Date filters use Eastern time. Week filters include events with a recorded betting week.</p>
  <div className="activity-filters">
   <label>Event Type<select aria-label="Activity Event Type" value={type} onChange={e=>setType(e.target.value)}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>Member<select aria-label="Activity Member" value={member} onChange={e=>setMember(e.target.value)}><option value="">All Members</option>{members.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
   <label>Week<select aria-label="Activity Week" value={week} onChange={e=>setWeek(e.target.value)}><option value="">All Weeks</option>{Array.from({length:18},(_,i)=><option key={i} value={i+1}>Wk. {i+1}</option>)}</select></label>
   <label>From<input aria-label="Activity From" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>Through<input aria-label="Activity Through" type="date" value={until} onChange={e=>setUntil(e.target.value)}/></label>
  </div>
  <p className="field-note">{loading?'Loading Activity…':`${count} Matching Events`}</p>
  {error&&<p role="alert">{error} <button className="text-button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
  <div className="activity-events">{events.map(event=><article key={event.event_id} className="activity-event">
   <div className="activity-event-heading"><Badge tone={event.event_type==='Credits'?'gold':event.event_type==='TicketVoided'?'red':'neutral'}>{event.label}</Badge>
    <time dateTime={event.event_at}>{new Date(event.event_at).toLocaleString(undefined,{timeZone:zone==='device'?undefined:zone})}</time>{event.week&&<span>Wk. {event.week}</span>}
   </div>
   <strong>{event.member_name}</strong>
   <dl>{Object.entries(event.details).filter(([,value])=>value!==null&&value!=='').map(([key,value])=><div key={key}><dt>{key}</dt><dd>{key==='Accepted Odds'&&Number(value)>0?'+':''}{String(value)}</dd></div>)}</dl>
   <div className="activity-event-footer"><small>Source: {event.event_id}</small>{event.ticket_id?<a className="button secondary compact-button" href={sharedTicketPath(event.ticket_id)}>View Ticket</a>:<a className="text-button" href={routeUrl('commissioner')}>Commissioner Settings</a>}</div>
  </article>)}</div>
  {!loading&&!error&&!events.length&&<p>No activity matches these filters.</p>}
  {!!next&&<button className="button secondary" disabled={loading||!request} onClick={()=>request&&void load(next,request.signal)}>Load More Activity</button>}
  <p className="field-note">History reflects retained source records. Corrections appear when an audit record exists; missing historical timestamps are not invented.</p>
 </section>;
}
