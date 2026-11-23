import {useState,useRef} from "react";
import {auth} from "./live";
import {BoffScreen} from "./BrandedState";
import {Icon} from "./ui";
function signInError(error:{message:string;status?:number}){
 return !error.status||error.status>=500?"Sign-in is temporarily unavailable. Please try again shortly.":error.message;
}
export function DevSignIn({intro="Sign in to your league with your account email."}:{intro?:string}){
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[message,setMessage]=useState("");
 const [busy,setBusy]=useState<"password"|"link"|null>(null),[failed,setFailed]=useState(false);
 const emailInput=useRef<HTMLInputElement>(null);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy)return;setBusy("password");setMessage("");setFailed(false);
  try{
   const {error}=await auth.auth.signInWithPassword({email:email.trim(),password});
   if(error){setMessage(signInError(error));setFailed(true);}else location.reload();
  }catch{setMessage("Sign-in is temporarily unavailable. Please try again shortly.");setFailed(true);}
  finally{setBusy(null);}
 }
 async function emailLink(){
  if(busy)return;
  if(!email.trim()||!emailInput.current?.checkValidity()){
   setMessage("Enter a valid email address to receive a sign-in link.");setFailed(true);emailInput.current?.focus();return;
  }
  setBusy("link");setMessage("");setFailed(false);
  try{
   const {error}=await auth.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:new URL(location.pathname+location.search,location.origin).href}});
   setMessage(error?signInError(error):"Check your email for a sign-in link.");setFailed(!!error);
  }catch{setMessage("Sign-in is temporarily unavailable. Please try again shortly.");setFailed(true);}
  finally{setBusy(null);}
 }
 return <BoffScreen>
  <h1>Sign In</h1><p className="account-intro">{intro}</p>
  <form className="account-form" onSubmit={event=>void submit(event)}>
   <label htmlFor="sign-in-email">Email<input ref={emailInput} id="sign-in-email" required type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label htmlFor="sign-in-password">Password<input id="sign-in-password" required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button className="button primary" disabled={!!busy}>{busy==="password"?"Signing In…":"Sign In"}</button>
  </form>
  <button className="button secondary account-link-button" disabled={!!busy} onClick={()=>void emailLink()}>{busy==="link"?"Sending Link…":"Email A Sign-In Link"}</button>
  <p className="account-link-note">Prefer email sign-in? No password is needed for a sign-in link.</p>
  {message&&<div className="account-message" data-error={failed} role={failed?"alert":"status"}><Icon name={failed?"info":"message"} size={18}/><span>{message}</span></div>}
 </BoffScreen>;
}
