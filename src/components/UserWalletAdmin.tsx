import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {supabase} from '../lib/supabase';
import {errorMessage,money} from '../lib/accounts';
import type {AccountData,Membership} from '../lib/accounts';
import {WalletCutover} from './WalletCutover';
const rpc=(name:string,args:Record<string,unknown>)=>supabase!.rpc(name,args).abortSignal(AbortSignal.timeout(20000));
type Row={id:string;league_id:string;user_id:string;team_id:string;display_name:string;balance:number|string|null;status:'approved'|'revoked';revision:number};
export function UserWalletAdmin({data,leagueId,refresh,preparing=false,onBack}:{data:AccountData;leagueId:string;refresh:()=>Promise<void>;preparing?:boolean;onBack?:()=>void}){
 const [state,setState]=useState<{rows:Row[];legacy:Map<string,number|string|null>;ready:boolean;owner:boolean;active:boolean;error:string}>({rows:[],legacy:new Map(),ready:false,owner:false,active:false,error:''});
 const [reload,setReload]=useState(0),[selected,setSelected]=useState(''),[reason,setReason]=useState(''),[amount,setAmount]=useState(''),[mode,setMode]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const nonce=useRef(crypto.randomUUID()),alive=useRef(true);
 const ownerHint=!!data.access?.find(a=>a.league_id===leagueId)?.configure;
 const teamIds=data.teams.filter(t=>t.league_id===leagueId).map(t=>t.id);
 const teamKey=teamIds.join(',');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!supabase)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);let current=true;
  setState(s=>({...s,ready:false,error:''}));
  void(async()=>{try{
   const [cap,rows,legacy]=await Promise.all([
    rpc('league_capabilities',{p_league:leagueId}).abortSignal(signal),
    supabase!.from('user_wallets').select('id,league_id,user_id,team_id,display_name,balance,status,revision').eq('league_id',leagueId).order('display_name').order('id').limit(129).abortSignal(signal),
    ownerHint&&teamIds.length?supabase!.from('wallets').select('team_id,balance').in('team_id',teamIds).limit(129).abortSignal(signal):Promise.resolve({data:[],error:null}),
   ]);
   for(const r of [cap,rows,legacy])if(r.error)throw r.error;
   if(cap.data?.admin!==true||(cap.data?.wallet_model!=='user'&&!(preparing&&cap.data?.configure===true)))throw Error('Financial administration access changed. Refresh your account.');
   if(!Array.isArray(rows.data)||rows.data.length>128||!Array.isArray(legacy.data)||legacy.data.length>128||
      new TextEncoder().encode(JSON.stringify([rows.data,legacy.data])).length>65536||
      rows.data.some(w=>w.league_id!==leagueId||!teamIds.includes(w.team_id))||legacy.data.some(w=>!teamIds.includes(w.team_id)))throw Error('Financial account response exceeds its scope or budget.');
   if(current)setState({rows:rows.data as Row[],legacy:new Map(legacy.data.map(w=>[w.team_id,w.balance])),ready:true,owner:cap.data.configure===true,active:cap.data.wallet_model==='user',error:''});
  }catch(e){if(current)setState({rows:[],legacy:new Map(),ready:true,owner:false,active:false,error:errorMessage(e)});}})();
  return()=>{current=false;controller.abort();};
  // teamKey identifies the bounded current-league directory.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[leagueId,teamKey,ownerHint,reload,preparing]);
 const wallet=state.rows.find(w=>w.id===selected)??state.rows[0];
 const primary=wallet&&data.memberships.some(m=>m.league_id===leagueId&&m.team_id===wallet.team_id&&m.user_id===wallet.user_id);
 const legacyBalance=wallet?state.legacy.get(wallet.team_id):undefined;
 const unprepared=data.memberships.filter(m=>m.league_id===leagueId&&m.user_id&&!state.rows.some(w=>w.user_id===m.user_id));
 const resetRequest=()=>{nonce.current=crypto.randomUUID();};
 async function run(action:()=>PromiseLike<{error:unknown}>,message:string){
  if(busy||!supabase)return;
  if(reason.trim().length<8){setNotice('Enter a review reason of at least 8 characters.');return;}
  setBusy(true);setNotice('');
  try{const result=await action();if(result.error)throw result.error;if(!alive.current)return;
   await refresh();if(!alive.current)return;setReload(n=>n+1);setNotice(message);setReason('');setAmount('');setMode('');resetRequest();
  }catch(e){if(alive.current)setNotice(errorMessage(e));}finally{if(alive.current)setBusy(false);}
 }
 function prepare(m:Membership){void run(()=>rpc('approve_user_wallet',{p_league:leagueId,p_user:m.user_id,p_team:m.team_id,p_reason:reason.trim(),p_display_name:m.display_name}),'Financial account approved. Funding remains pending.');}
 function save(event:FormEvent){event.preventDefault();if(!wallet)return;
  if(wallet.balance===null){
   if(!state.owner||!['zero','transfer_legacy'].includes(mode))return;
   void run(()=>rpc('initialize_user_wallet',{p_league:leagueId,p_user:wallet.user_id,p_mode:mode,p_expected_legacy:mode==='transfer_legacy'?Number(legacyBalance):null,p_reason:reason.trim(),p_request:nonce.current}),'Opening decision recorded once.');
  }else{
   if(!amount.trim()||!Number.isFinite(Number(amount)))return;
   void run(()=>rpc('set_user_wallet_balance',{p_wallet:wallet.id,p_expected:Number(wallet.balance),p_balance:Number(amount),p_reason:reason.trim(),p_request:nonce.current}),'Balance adjustment recorded.');
  }
 }
 return <section className="admin-layout">
  <div className="page-heading"><h1>{preparing?'Wallet preparation':'Users'}</h1><p>Each approved participant has a separate wallet in this league.</p></div>
  {onBack&&<button className="secondary" disabled={busy} onClick={onBack}>Back to legacy accounts</button>}
  {!state.ready&&<p role="status">Loading financial accounts…</p>}
  {state.error&&<p role="alert">{state.error}</p>}
  <button className="secondary" disabled={busy||!state.ready} onClick={()=>setReload(n=>n+1)}>Refresh financial accounts</button>
  {state.ready&&!state.error&&<>
   {state.rows.length?<label>Participant account<select aria-label="Participant account" value={wallet?.id??''} disabled={busy} onChange={e=>{setSelected(e.target.value);setAmount('');setMode('');setNotice('');resetRequest();}}>
    {state.rows.map(w=><option key={w.id} value={w.id}>{w.display_name} · {data.teams.find(t=>t.id===w.team_id)?.team_name} · {w.balance===null?'Funding pending':money(w.balance)}</option>)}
   </select></label>:<p>No financial accounts have been approved yet.</p>}
   {wallet&&<form onSubmit={save}>
    <h2>{wallet.display_name}</h2><p>{data.teams.find(t=>t.id===wallet.team_id)?.team_name}</p>
    <p>Current balance: <strong>{wallet.balance===null?'Funding pending':money(wallet.balance)}</strong> · {wallet.status}</p>
    {!state.active&&<p>Opening decisions are available after the reviewed cutover.</p>}
    {wallet.balance===null?<>
     {!state.owner&&<p>Only the platform owner can approve opening funds.</p>}
     {primary&&state.owner&&<p>Recorded legacy team cash: {legacyBalance==null?'Pending':money(legacyBalance)}. Open legacy bets must settle before transferring cash.</p>}
     <label>Opening decision<select aria-label="Opening decision" required value={mode} disabled={busy||!state.owner||!state.active||wallet.status!=='approved'} onChange={e=>{setMode(e.target.value);resetRequest();}}>
      <option value="">Choose after review</option>
      <option value="zero" disabled={!!primary&&Number(legacyBalance)>0}>Initialize at $0</option>
      {primary&&legacyBalance!=null&&<option value="transfer_legacy">Transfer exactly {money(legacyBalance)} from the legacy team wallet</option>}
     </select></label>
    </>:<label>New balance<input aria-label="New participant balance" type="number" min="0" max="9999999999.99" step="0.01" required value={amount} disabled={busy||wallet.status!=='approved'} onChange={e=>{setAmount(e.target.value);resetRequest();}}/></label>}
    <label>Review reason<textarea aria-label="Financial review reason" minLength={8} maxLength={400} required value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);resetRequest();}}/></label>
    <button className="primary" disabled={busy||!state.active||wallet.status!=='approved'||(wallet.balance===null&&!state.owner)}>{wallet.balance===null?'Confirm opening decision':'Save participant balance'}</button>
    {state.owner&&<button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>rpc('set_user_wallet_status',{p_wallet:wallet.id,p_expected:wallet.revision,p_status:wallet.status==='approved'?'revoked':'approved',p_reason:reason.trim()}),wallet.status==='approved'?'Financial access revoked; records and money retained.':'Financial access restored.')}>{wallet.status==='approved'?'Revoke financial access':'Restore financial access'}</button>}
   </form>}
   {!wallet&&<label>Review reason<textarea aria-label="Financial review reason" minLength={8} maxLength={400} value={reason} onChange={e=>{setReason(e.target.value);resetRequest();}}/></label>}
   {state.owner&&unprepared.length>0&&<section><h2>Verified primary participants</h2><p>Preparing an account does not copy money or authorize opening funds.</p>{unprepared.map(m=><p key={m.id}>{m.display_name} · {data.teams.find(t=>t.id===m.team_id)?.team_name} <button disabled={busy} onClick={()=>prepare(m)}>Prepare account for {m.display_name}</button></p>)}</section>}
   {preparing&&state.owner&&!state.active&&<WalletCutover key={leagueId+':'+reload} leagueId={leagueId} onActivated={async()=>{await refresh();setReload(n=>n+1);}}/>}
   <p>Additional participants are admitted through owner-reviewed team claims. Approval never gives access to another participant’s wallet.</p>
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
