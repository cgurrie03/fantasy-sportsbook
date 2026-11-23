import {useEffect,useState} from "react";
import {auth,live} from "./live";
import {Badge,Modal,InfoPopover} from "./ui";
import {routeUrl} from "./routing";
import {managerStatus} from '../../api/_lib/manager-status';

type CoManager={id:string;name:string;avatar?:string;accountId?:string;member?:string;walletStatus?:string;walletInitialized?:boolean;departed?:boolean};
type TeamMapping={teamId:string;team:string;memberId:string|null;member:string|null;role:string|null;
  hasAccount:boolean; avatar?:string; coManagers?:CoManager[]; coManager?:CoManager;
  mappedSleeperId:string|null;sleeperId:string|null;sleeperName:string|null;walletInitialized:boolean;walletStatus:string|null};
type PendingInvitation={id:string;teamId:string;team:string;sleeperId:string;email:string;expires:string;managerStatus?:string};

export function CommissionerMembers(){
  const leagueId=live().leagueId;
  const [rows,setRows]=useState<TeamMapping[]>([]);
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState<TeamMapping|null>(null);
  const [action,setAction]=useState("replace");
  const [email,setEmail]=useState("");
  const [reason,setReason]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [verifications,setVerifications]=useState<{id:string;team:string;emailHint:string}[]>([]);
  const [resending,setResending]=useState<string|null>(null);
  const [pending,setPending]=useState<PendingInvitation[]>([]);
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [canceling,setCanceling]=useState<PendingInvitation|null>(null);
  useEffect(()=>{
    let active=true;
    void auth.rpc("dev_commissioner_members",{p_league:leagueId}).then(({data,error})=>{
      if(!active)return;
      if(error)setMessage(error.message);else setRows(data.teams);
    });
    void auth.rpc("dev_commissioner_verifications",{p_league:leagueId}).then(({data,error})=>{
      if(active&&!error)setVerifications(data??[]);
    });
    void auth.rpc('dev_pending_member_invitations',{p_league:leagueId}).then(({data,error})=>{if(active&&!error)setPending(data??[]);});
    return()=>{active=false;};
  },[leagueId]);
  async function inviteRequest(input:Record<string,unknown>){
    const {data:{session}}=await auth.auth.getSession();
    if(!session)throw Error('Sign in as commissioner');
    const response=await fetch('/api/membership',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
    const result=await response.json();if(!response.ok)throw Error(result.error??'Invitation unavailable');
    const list=await auth.rpc('dev_pending_member_invitations',{p_league:leagueId});
    if(!list.error)setPending(list.data??[]);
    return result;
  }
  async function resendInvitation(id:string){
    if(resending)return;setResending(id);setMessage('');
    try{const result=await inviteRequest({action:'resend',invitationId:id,requestId:crypto.randomUUID()});setMessage(result.message);}
    catch(error){setMessage(error instanceof Error?error.message:'Invitation unavailable');}
    finally{setResending(null);}
  }
  const people=rows.flatMap(row=>[row,...(row.coManagers??[]).map(person=>({...row,coManager:person,member:person.member??null,
    hasAccount:!!person.accountId,avatar:person.avatar,sleeperName:person.name,sleeperId:person.id,
    walletStatus:person.walletStatus??null,walletInitialized:!!person.walletInitialized,role:"member"}))]);
  const personKey=(row:TeamMapping)=>row.teamId+":"+(row.coManager?.id??"primary");
  const roleLabel=(row:TeamMapping)=>managerStatus(!!row.coManager,row.coManagers?.filter(person=>!person.departed).length??0,!!row.sleeperId);
  async function resendVerification(account:string){
    if(resending)return;
    setMessage("");setResending(account);
    try{
      const target=await auth.rpc("dev_member_verification_resend",{p_league:leagueId,p_account:account});
      if(target.error||!target.data)throw new Error(target.error?.message??"Pending verification unavailable.");
      const sent=await auth.auth.resend({type:"signup",email:target.data,
        options:{emailRedirectTo:new URL(routeUrl("matchups"),location.origin).href}});
      if(sent.error)throw new Error(sent.error.message);
      setMessage("Verification email requested.");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not resend verification.");}
    finally{setResending(null);}
  }
  async function save(){
    if(!editing||busy)return;
    setBusy(true);
    if(action!=='remove'){
      try{
        const result=await inviteRequest({action:'invite',requestId,teamId:editing.teamId,sleeperId:editing.coManager?.id??editing.sleeperId,
          coManager:!!editing.coManager,expected:editing.coManager?editing.coManager.accountId??null:editing.memberId,email:email.trim(),reason:reason.trim()});
        setEditing(null);setAdding(false);setMessage(result.message);
      }catch(error){setMessage(error instanceof Error?error.message:'Invitation unavailable');}
      finally{setBusy(false);}
      return;
    }
    const args={p_league:leagueId,p_team:editing.teamId,p_email:action==="remove"?null:email.trim(),p_reason:reason.trim()};
    const {data,error}=editing.coManager
      ?await auth.rpc("dev_change_co_manager",{...args,p_sleeper:editing.coManager.id,p_expected:editing.coManager.accountId??null})
      :await auth.rpc("dev_change_commissioner_member",{...args,p_expected:editing.memberId});
    setBusy(false);
    if(error){setMessage(error.message);return;}
    setRows(data.teams);setEditing(null);setAdding(false);setMessage("Membership updated.");
  }
  function start(row:TeamMapping|null, nextAction:string){
    setMessage("");setEmail("");setReason("");setAction(nextAction);setEditing(row);setRequestId(crypto.randomUUID());
  }
  function avatar(name:string, image?:string){
    return image?<img className="member-avatar" alt="" src={/^https:\/\//.test(image)?image:"https://sleepercdn.com/avatars/thumbs/"+encodeURIComponent(image)}/>
      : <span className="member-avatar member-avatar-fallback" aria-hidden="true">{name.slice(0,1)}</span>;
  }
  const addable=people.filter(row=>!row.hasAccount&&row.role!=="admin"&&row.sleeperId);
  return <section className="panel form-panel commissioner-members">
    <div className="split"><h2>League Members</h2><button className="button primary" onClick={()=>{start(addable[0]??null,"replace");setAdding(true);}}>Add Member</button></div>
    <p className="field-note">Each manager can link their own Boff account for the same Sleeper team. Wallet approval is per person.</p>
    {pending.length>0&&<section aria-label="Pending League Invitations"><h3>Pending League Invitations</h3>
      {pending.map(invitation=><div className="member-row" key={invitation.id}><div><strong>{invitation.team}</strong>
        <small>{invitation.managerStatus} · {invitation.email}</small><small>Awaiting Acceptance · Expires {new Date(invitation.expires).toLocaleDateString()}</small></div>
        <button className="button secondary" disabled={resending!==null} onClick={()=>void resendInvitation(invitation.id)}>{resending===invitation.id?'Preparing…':'Resend Invitation'}</button>
        <button className="text-button" onClick={()=>setCanceling(invitation)}>Cancel Invitation</button>
      </div>)}
    </section>}
    {verifications.length>0&&<section aria-label="Pending Email Verifications">
      <h3>Pending Email Verifications</h3>
      {verifications.map(row=><div className="member-row" key={row.id}>
        <div><strong>{row.team}</strong><small>{row.emailHint}</small></div>
        <button className="button secondary" disabled={resending!==null} onClick={()=>void resendVerification(row.id)}>
          {resending===row.id?"Requesting…":"Resend Verification"}
        </button>
      </div>)}
    </section>}
    {people.map(row=>{
      const changed=!!row.coManager?.departed||!row.coManager&&row.hasAccount&&row.sleeperId&&row.sleeperId!==row.mappedSleeperId;
      const status=row.coManager?.departed?"No longer a Sleeper co-manager":changed?"Sleeper owner changed":!row.hasAccount?"No linked Boff account":
        row.walletStatus==="revoked"?"Wallet revoked":row.walletStatus!=="approved"?"Wallet approval pending":!row.walletInitialized?"Wallet funding pending":"Active";
      const name=row.member??row.sleeperName??row.team;
      return <div className="member-row" key={personKey(row)}>
        <div className="commissioner-person">{avatar(name,row.avatar)}<span><strong>{name}</strong>
          <small>{row.team} · {roleLabel(row)}</small>
          <small>Sleeper · {row.sleeperName??"Awaiting sync"}</small>
        </span></div>
        <div className="member-status"><Badge tone={changed?"gold":"neutral"}>{status}</Badge>
          {row.hasAccount&&row.walletStatus!=="approved"&&<InfoPopover title="Wallet access"><p>The platform owner approves betting wallets separately from league access.</p></InfoPopover>}</div>
        {row.role!=="admin"&&row.hasAccount&&<div className="member-row-actions">
          {!row.coManager?.departed&&<button className="button secondary" onClick={()=>start(row,"replace")}>{changed?"Review Owner Change":"Replace"}</button>}
          <button className="text-button" onClick={()=>start(row,"remove")}>Remove access</button>
        </div>}
      </div>;
    })}
    {message&&!editing&&<p role="status">{message}</p>}
    {canceling&&<Modal title="Cancel Invitation" onClose={()=>setCanceling(null)}><p>Cancel the invitation for {canceling.email} to join {canceling.team}? This link will stop working.</p>
      <button className="button primary" disabled={busy} onClick={async()=>{
        setBusy(true);const result=await auth.rpc('dev_revoke_member_invitation',{p_id:canceling.id});setBusy(false);
        if(result.error)setMessage(result.error.message);else{setPending(pending.filter(row=>row.id!==canceling.id));setMessage('Invitation canceled.');}setCanceling(null);
      }}>Confirm Cancellation</button></Modal>}
    {(adding||editing)&&<Modal title={adding?"Add Member":action==="remove"?"Remove League Access":"Replace Boff Account"} onClose={()=>{if(!busy){setEditing(null);setAdding(false);}}}>
      {!editing?<p>No unlinked Sleeper managers are available to add.</p>:<form className="member-edit-form" onSubmit={event=>{event.preventDefault();void save();}}>
        {adding&&<label>Sleeper manager<select value={personKey(editing)} onChange={event=>setEditing(addable.find(row=>personKey(row)===event.target.value)??null)}>
          {addable.map(row=><option value={personKey(row)} key={personKey(row)}>{row.sleeperName} — {row.team} · {roleLabel(row)}</option>)}
        </select></label>}
        <div className="member-mapping-summary"><span><small>{editing.team}</small><strong>{editing.hasAccount?editing.member:"No Boff account linked"}</strong></span>
          <span><small>{roleLabel(editing)}</small><strong>{editing.sleeperName??"Awaiting sync"}</strong></span></div>
        {action==="replace"&&<label>Invitation Email<input type="email" required value={email} onChange={event=>{setEmail(event.target.value);setRequestId(crypto.randomUUID());}}/></label>}
        <p className="field-note">{action==="remove"?"The departing member loses league access. Their tickets and wallet history are preserved.":
          "Invite an existing or new Boff account. The recipient verifies their email and accepts before the mapping changes. The platform owner approves and funds betting wallets separately."}</p>
        <label>Reason for the audit log<textarea rows={3} required minLength={8} maxLength={400} value={reason} onChange={event=>{setReason(event.target.value);setRequestId(crypto.randomUUID());}}/></label>
        {message&&<p role="alert">{message}</p>}
        <div className="member-edit-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setEditing(null);setAdding(false);}}>Cancel</button>
          <button className="button primary" disabled={busy}>{action==="remove"?"Revoke League Access":"Send Invitation"}</button></div>
      </form>}
    </Modal>}
  </section>;
}
