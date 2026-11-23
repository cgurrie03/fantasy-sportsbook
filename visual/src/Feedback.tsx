import {useEffect,useRef,useState} from 'react';
import {auth,live} from './live';
import {accountProfile} from './accountState';
import {Badge,Modal} from './ui';
const statuses=['New','In Progress','Resolved','Closed'];
type Row={id:string;category:string;preview:string;status:string;created:string;updated:string;name:string;team:string;league:string;leagueId:string;revision:number};
type Detail={id:string;category:string;message:string;status:string;revision:number;page:string;created:string;name:string;team:string;league:string;email:string|null;canManage:boolean;updates:{id:string;from:string|null;to:string;note:string;created:string}[]};
async function call(name:string,args:Record<string,unknown>,signal?:AbortSignal){
 const {data,error}=await auth.rpc(name,args).abortSignal(signal??AbortSignal.timeout(20000));if(error)throw error;return data;
}
function RequestDetail({id,onClose,onChanged,inline=false}:{id:string;onClose:()=>void;onChanged:()=>void;inline?:boolean}){
 const [detail,setDetail]=useState<Detail|null>(null),[status,setStatus]=useState('New'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');
  void call('dev_support_request',{p_id:id},controller.signal).then(data=>{if(!controller.signal.aborted){setDetail(data);setStatus(data.status);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();},[id,reload]);
 async function save(){
  if(!detail||busy)return;setBusy(true);setError('');
  try{const data=await call('dev_update_support',{p_id:id,p_revision:detail.revision,p_status:status,p_note:note});setDetail(data);setNote('');onChanged();window.dispatchEvent(new Event('boff-support-updated'));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const content=<>
  {error&&<p role="alert">{error} <button className="text-button" onClick={()=>setReload(v=>v+1)}>Refresh Request</button></p>}
  {!detail&&!error&&<p role="status">Loading Request…</p>}
  {detail&&<div className="support-detail">
   <div className="support-request-heading"><Badge>{detail.category}</Badge><Badge tone={detail.status==='New'?'gold':'neutral'}>{detail.status}</Badge></div>
   <p className="field-note">{detail.league} · {detail.team}<br/>{detail.name}{detail.email?' · '+detail.email:''}</p>
   <p className="support-message">{detail.message}</p>
   <dl className="support-context"><div><dt>Submitted</dt><dd>{new Date(detail.created).toLocaleString()}</dd></div><div><dt>Page</dt><dd>{detail.page}</dd></div><div><dt>Reference</dt><dd>{detail.id}</dd></div></dl>
   <h3>Status History</h3><ol className="support-updates">{detail.updates.map(update=><li key={update.id}><strong>{update.from?`${update.from} → ${update.to}`:'Submitted'}</strong><time>{new Date(update.created).toLocaleString()}</time>{update.note&&<p>{update.note}</p>}</li>)}</ol>
   {detail.canManage&&<form className="support-status-form" onSubmit={e=>{e.preventDefault();void save();}}>
    <label>Status<select aria-label="Request Status" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Update For The Member (Optional)<textarea maxLength={1000} rows={3} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label>
    <p className="field-note">Status updates and notes are visible to the member. Choose a different status to save an update.</p>
    <button className="button primary" disabled={busy||status===detail.status}>{busy?'Saving…':'Save Status'}</button>
   </form>}
  </div>}
 </>;
 return inline?<section><div className="panel-heading"><h3>Support Request</h3><button className="text-button" onClick={onClose}>Back To Requests</button></div>{content}</section>:<Modal title="Support Request" onClose={onClose}>{content}</Modal>;
}
export function SupportRequests({owner=false,inlineDetails=false}:{owner?:boolean;inlineDetails?:boolean}){
 const [rows,setRows]=useState<Row[]>([]),[status,setStatus]=useState('All'),[league,setLeague]=useState(''),[member,setMember]=useState('');
 const [leagues,setLeagues]=useState<{id:string;name:string}[]>([]),[members,setMembers]=useState<{id:string;name:string}[]>([]),[next,setNext]=useState<unknown>(null);
 const [count,setCount]=useState(0),[newCount,setNewCount]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(''),[refresh,setRefresh]=useState(0);
 const controller=useRef<AbortController|null>(null);
 async function load(cursor:unknown,signal:AbortSignal){
  setLoading(true);setError('');
  try{const data=await call('dev_support_requests',{p_owner:owner,p_league:league||null,p_member:owner&&member?member:null,p_status:status,p_cursor:cursor},signal);
   if(signal.aborted)return;setRows(previous=>cursor?[...new Map([...previous,...data.requests].map((row:Row)=>[row.id,row])).values()]:data.requests);
   setLeagues(data.leagues);setMembers(data.members);setNext(data.next);setCount(data.count);setNewCount(data.newCount);
  }catch(e){if(!signal.aborted)setError((e as Error).message);}finally{if(!signal.aborted)setLoading(false);}
 }
 useEffect(()=>{const abort=new AbortController();controller.current=abort;setRows([]);setNext(null);setLoading(true);void load(null,abort.signal);return()=>abort.abort();},[owner,status,league,member,refresh]);
 if(selected&&inlineDetails)return <RequestDetail id={selected} inline onClose={()=>setSelected('')} onChanged={()=>setRefresh(v=>v+1)}/>;
 return <section className="support-requests">
  <div className="panel-heading"><h3>{owner?'Support Inbox':'My Requests'}</h3><button className="button secondary" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Refresh Requests</button></div>
  <div className="support-filters">
   <label>League<select aria-label="Support League" value={league} onChange={e=>{setLeague(e.target.value);setMember('');}}><option value="">All Leagues</option>{leagues.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   {owner&&<label>Member<select aria-label="Support Member" value={member} onChange={e=>setMember(e.target.value)}><option value="">All Members</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
   <label>Status<select aria-label="Support Status Filter" value={status} onChange={e=>setStatus(e.target.value)}><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
  </div>
  <p className="field-note">{count} Matching Requests{owner?` · ${newCount} New Across All Leagues`:''}</p>
  {loading&&<p role="status">Loading Requests…</p>}{error&&<p role="alert">{error}</p>}
  <div className="support-request-list">{rows.map(row=><article key={row.id}>
   <div className="support-request-heading"><strong>{row.category}</strong><Badge tone={row.status==='New'?'gold':'neutral'}>{row.status}</Badge><time>{new Date(row.created).toLocaleString()}</time></div>
   <p>{row.preview}{row.preview.length===180?'…':''}</p><small>{row.league} · {row.team}{owner?' · '+row.name:''}</small>
   <div className="support-request-actions"><button className="button secondary" onClick={()=>setSelected(row.id)}>View Request</button></div>
  </article>)}</div>
  {!loading&&!error&&!rows.length&&<p>No support requests match these filters.</p>}
  {!!next&&<button className="button secondary" disabled={loading} onClick={()=>controller.current&&void load(next,controller.current.signal)}>Load More Requests</button>}
  {selected&&<RequestDetail id={selected} onClose={()=>setSelected('')} onChanged={()=>setRefresh(v=>v+1)}/>}
 </section>;
}
export function FeedbackForm(){
 const [view,setView]=useState('new'),[category,setCategory]=useState('Feedback'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<{id:string;status:string;duplicate:boolean}|null>(null);const request=useRef(crypto.randomUUID());
 const name=accountProfile(live()?.user).name;
 async function submit(){
  if(busy)return;setBusy(true);setError('');
  try{const data=await call('dev_submit_support',{p_league:live()?.leagueId,p_category:category,p_message:message.trim(),p_page:location.pathname.slice(0,200),p_request:request.current});setReceipt(data);window.dispatchEvent(new Event('boff-support-updated'));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="feedback-live">
  <div className="segmented" role="group" aria-label="Support Views"><button className={view==='new'?'active':''} onClick={()=>setView('new')}>New Request</button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>My Requests</button></div>
  {view==='history'?<SupportRequests inlineDetails/>:receipt?<div role="status" className="support-receipt">
   <Badge tone="green">{receipt.duplicate?'Existing Request Found':'Request Submitted'}</Badge><p>{receipt.duplicate?'This matches a recent submission. Its original reference is below.':'Your request is saved in the platform owner’s inbox.'}</p>
   <p>Status: <strong>{receipt.status}</strong></p><small>Reference: {receipt.id}</small>
   <button className="button primary" onClick={()=>setView('history')}>View My Requests</button>
   <button className="text-button" onClick={()=>{setReceipt(null);setMessage('');request.current=crypto.randomUUID();}}>Submit Another Request</button>
  </div>:<form className="feedback-preview" onSubmit={e=>{e.preventDefault();void submit();}}>
   <p className="feedback-context">{name}<small>Your league, team and current page attach automatically. Only you and platform owners can view the request.</small></p>
   <label>Category<select aria-label="Support Category" disabled={busy} value={category} onChange={e=>{setCategory(e.target.value);request.current=crypto.randomUUID();}}>{['Feedback','Question','Bug Report','Feature Suggestion'].map(c=><option key={c}>{c}</option>)}</select></label>
   <label>Message<textarea rows={5} minLength={10} maxLength={2000} required disabled={busy} value={message} onChange={e=>{setMessage(e.target.value);request.current=crypto.randomUUID();}} placeholder="Tell us what happened or what you would like to improve."/></label>
   <p className="field-note">{message.trim().length}/2,000 characters · Please leave out passwords and sign-in links.</p>
   {error&&<p className="field-error" role="alert">{error}</p>}
   <button className="button primary" disabled={busy||message.trim().length<10}>{busy?'Submitting…':'Submit Request'}</button>
  </form>}
 </div>;
}
export function OwnerSupportInbox(){return <SupportRequests owner/>;}
