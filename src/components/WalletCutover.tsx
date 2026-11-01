import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {errorMessage} from '../lib/accounts';
type Review={league_id:string;ready:boolean;blockers:string[];routing_enabled:boolean;approved_accounts:number;funding_pending:number;legacy_open_tickets:number;review_id?:string;expires_at?:string};
export function WalletCutover({leagueId,onActivated}:{leagueId:string;onActivated:()=>Promise<void>}){
 const [review,setReview]=useState<Review|null>(null),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [request]=useState(()=>crypto.randomUUID());
 const alive=useRef(true);
 const valid=(data:unknown):Review=>{const r=data as Review;
  if(!r||r.league_id!==leagueId||!Array.isArray(r.blockers)||typeof r.ready!=='boolean'||typeof r.routing_enabled!=='boolean'||new TextEncoder().encode(JSON.stringify(r)).length>16384)
   throw Error('Cutover review is unavailable for this league.');return r;
 };
 useEffect(()=>{alive.current=true;const controller=new AbortController();
  void(async()=>{try{const result=await supabase!.rpc('user_finance_cutover_preflight',{p_league:leagueId}).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(result.error)throw result.error;const data=valid(result.data);if(!controller.signal.aborted)setReview(data);
  }catch(e){if(!controller.signal.aborted)setNotice(errorMessage(e));}})();
  return()=>{alive.current=false;controller.abort();};
  // League-keyed parent remounts this owner-only review on account/league change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[leagueId]);
 useEffect(()=>{if(!review?.expires_at)return;
  const remaining=Date.parse(review.expires_at)-Date.now();
  const timer=setTimeout(()=>{setReview(r=>r?{...r,review_id:undefined,expires_at:undefined}:r);setAck(false);setNotice('Review expired. Prepare a fresh review.');},Math.max(0,remaining));
  return()=>clearTimeout(timer);
 },[review?.expires_at]);
 async function action(activate:boolean){
  if(busy||!supabase)return;if(reason.trim().length<8){setNotice('Enter a review reason of at least 8 characters.');return;}
  if(activate&&(!ack||!review?.review_id))return;
  setBusy(true);setNotice('');try{
   const result=activate?await supabase.rpc('activate_user_finance_cutover',{p_league:leagueId,p_review:review!.review_id,p_request:request,p_reason:reason.trim()}).abortSignal(AbortSignal.timeout(20000))
    :await supabase.rpc('prepare_user_finance_cutover',{p_league:leagueId,p_reason:reason.trim()}).abortSignal(AbortSignal.timeout(20000));
   if(result.error)throw result.error;if(!alive.current)return;
   if(activate){if(result.data?.league_id!==leagueId||result.data?.activated!==true)throw Error('Cutover receipt is unavailable.');await onActivated();}
   else{const prepared=valid(result.data);if(!prepared.review_id||!prepared.expires_at)throw Error('Cutover approval review is unavailable.');setReview(prepared);setAck(false);}
  }catch(e){if(alive.current)setNotice(errorMessage(e));}finally{if(alive.current)setBusy(false);}
 }
 return <section aria-label="Development wallet cutover">
  <h2>Development wallet cutover</h2>
  <p>Review participant accounts before switching financial routing. Opening funds remain pending until separately approved. Betting and scheduled operations stay disabled.</p>
  {!review&&!notice&&<p role="status">Checking cutover readiness…</p>}
  {review&&<>
   <p>{review.approved_accounts} approved accounts · {review.funding_pending} funding decisions pending · {review.legacy_open_tickets} legacy open tickets</p>
   {review.routing_enabled?<p>Independent wallet routing is already active.</p>:<>
    {review.blockers.length>0&&<ul>{review.blockers.map(b=><li key={b}>{b}</li>)}</ul>}
    <label>Cutover review reason<textarea aria-label="Cutover review reason" minLength={8} maxLength={400} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setAck(false);setReview(r=>r?{...r,review_id:undefined,expires_at:undefined}:r);}}/></label>
    <button className="secondary" disabled={busy||!review.ready||reason.trim().length<8} onClick={()=>void action(false)}>Prepare cutover review</button>
    {review.review_id&&<>
     <p>Review expires {new Date(review.expires_at!).toLocaleTimeString()}. Changed financial state requires another review.</p>
     <label><input type="checkbox" aria-label="Confirm pending funding and disabled operations" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I reviewed the accounts and legacy liabilities. Funding remains pending and operations stay disabled.</label>
     <button className="primary" disabled={busy||!ack} onClick={()=>void action(true)}>Activate independent wallets in development</button>
    </>}
   </>}
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
