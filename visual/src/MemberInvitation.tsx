import {useEffect,useState} from "react";
import {auth} from "./live";
import {DevSignIn} from "./DevSignIn";
import {BoffScreen,StatusPanel} from "./BrandedState";
import {Icon} from "./ui";
type Invitation={league:string;team:string;leaguePath:string;accepted:boolean;managerStatus?:string};
export function MemberInvitation(){
 const token=new URL(location.href).searchParams.get("invitation")??"";
 const [signedIn,setSignedIn]=useState<boolean|null>(null),[invitation,setInvitation]=useState<Invitation|null>(null);
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[password,setPassword]=useState("");
 useEffect(()=>{let active=true;void(async()=>{
  try{
   const {data:{session}}=await auth.auth.getSession();if(!active)return;setSignedIn(!!session);
   if(!session)return;
   const {data,error}=await auth.rpc("dev_accept_member_invitation",{p_token:token});
   if(active){if(error)setMessage(error.message);else setInvitation(data);}
  }catch{if(active)setMessage("We couldn’t load your invitation. Check your connection and try again.");}
 })();return()=>{active=false;};},[token]);
 async function accept(){
  if(busy)return;setBusy(true);setMessage("");
  try{
   if(password){const saved=await auth.auth.updateUser({password});if(saved.error)throw saved.error;}
   const {data,error}=await auth.rpc("dev_accept_member_invitation",{p_token:token,p_accept:true});
   if(error)throw error;location.assign(data.leaguePath);
  }catch(error){setMessage(error instanceof Error?error.message:"Invitation could not be accepted");}
  finally{setBusy(false);}
 }
 const signOut=<button className="button secondary" onClick={async()=>{await auth.auth.signOut();location.reload();}}>Use Another Account</button>;
 if(signedIn===false)return <DevSignIn intro="Sign in with the email address that received your league invitation."/>;
 if(!invitation)return <BoffScreen><StatusPanel title={message?"Invitation Unavailable":"Checking Your Invitation"} kind={message?"error":"loading"} heading="h1"
  action={message?<><button className="button primary" onClick={()=>location.reload()}>Retry</button>{signedIn&&signOut}</>:undefined}>
  {message||"Confirming your league and manager details."}
 </StatusPanel></BoffScreen>;
 return <BoffScreen>
  <h1>Join Your Boff League</h1><p className="account-intro">Confirm your invitation to connect with your league.</p>
  <section className="invitation-context" aria-label="Invitation Details"><h2>{invitation.league}</h2><p>{invitation.team}</p><p>{invitation.managerStatus}</p></section>
  <form className="account-form" onSubmit={event=>{event.preventDefault();void accept();}}>
   <label>Set A Password (Optional)<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={event=>setPassword(event.target.value)}/></label>
   <p className="field-note">Choose at least 12 characters, or continue using email sign-in links. Your platform owner handles wallet approval.</p>
   <button className="button primary" disabled={busy}>{busy?"Joining…":invitation.accepted?"Open League":"Accept Invitation"}</button>
  </form>
  {message&&<div className="account-message" data-error="true" role="alert"><Icon name="info" size={18}/><span>{message}</span></div>}
  <div className="account-signout">{signOut}</div>
 </BoffScreen>;
}
