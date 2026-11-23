import { useEffect, useState } from "react";
import { auth, live } from "./live";
import { emailKinds, notificationEvents, notificationKinds, type NotificationEvent } from "../server/notification-templates";

const browserEvents = [
  ["settled","Ticket Settled"],
  ["leg","Parlay Leg Won"],
  ["opening","New Weekly Markets"],
  ["offers","New Weekly Offers"],
  ["reward","Fantasy Reward Earned"],
  ["credit","Credits Ready to Claim"],
  ["featured","New Featured Matchup"],
] as const;
type BrowserEvent = typeof browserEvents[number][0];
const browserKey = () => `boff-browser-notifications:${live()?.user.id ?? "preview"}`;
function deviceChoices(): Partial<Record<BrowserEvent,boolean>> {
  try{
    const saved=localStorage.getItem(browserKey());
    return saved==="on"?{settled:true}:JSON.parse(saved??"{}");
  }catch{return {};}
}
export function sendBrowserNotification(event:BrowserEvent,title:string,tag:string){
  if(typeof Notification==="undefined" || Notification.permission!=="granted" || !deviceChoices()[event])return;
  const key=`boff-notified:${tag}`;
  if(sessionStorage.getItem(key))return;
  sessionStorage.setItem(key,"1");
  if("serviceWorker" in navigator){
    void navigator.serviceWorker.register("/notifications-sw.js").then(async registration=>{
      if(!await registration.pushManager?.getSubscription())await registration.showNotification(title,{tag});
    }).catch(()=>{sessionStorage.removeItem(key);});
  }else{
    try{new Notification(title,{tag});}catch{sessionStorage.removeItem(key);}
  }
}

type Choice = {email?:boolean; push?:boolean; details?:boolean};
type Choices = Partial<Record<NotificationEvent, Choice>>;
type Routine = {revision:number; available:Record<string,boolean>; overrides:Record<string,boolean|null>};
const routineOnly = new Set<NotificationEvent>(["reminder","recap","monday_watch","reopening"]);

export function CommunicationsSettings(){
 const leagueId=live()?.leagueId;
 const [choices,setChoices]=useState<Choices>({});
 const [routine,setRoutine]=useState<Routine|null>(null);
 const [status,setStatus]=useState("");
 const [ready,setReady]=useState(false);
 const [saving,setSaving]=useState(false);
 const [subscribed,setSubscribed]=useState(false);
 const canPush="serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
 useEffect(()=>{
  if(!canPush)return;
  void navigator.serviceWorker.getRegistration().then(async worker=>{
    setSubscribed(!!(await worker?.pushManager.getSubscription()));
  }).catch(()=>{});
 },[canPush]);
 useEffect(()=>{
  if(!leagueId)return;
  let active=true;
  void Promise.all([
   auth.rpc("dev_notification_choices",{p_league:leagueId}),
   auth.rpc("my_notification_preferences",{p_league:leagueId}),
  ]).then(([eventResult,routineResult])=>{
   if(!active)return;
   if(eventResult.error){setStatus(eventResult.error.message);return;}
   const stored=eventResult.data as Choices;
   const scheduled=routineResult.data as Routine|null;
   const previous=deviceChoices();
   const next:Choices={...stored};
   for(const [event] of browserEvents){
    next[event]={...stored[event],email:stored[event]?.email??true,push:stored[event]?.push??previous[event]??true};
   }
   setChoices(next);setRoutine(scheduled);setReady(true);
  });
  return()=>{active=false;};
 },[leagueId]);
 function change(event:NotificationEvent,field:keyof Choice,checked:boolean){
  setChoices(previous=>({...previous,[event]:{...previous[event],[field]:checked}}));
 }
 async function save(){
  setSaving(true);
  const {data,error}=await auth.rpc("dev_save_communications",{
   p_league:leagueId,p_choices:Object.fromEntries(notificationKinds.map(event=>[event,{...choices[event],details:true}])),
   p_revision:routine?.revision??null,p_routine:routine?.overrides??null,
  });
  setSaving(false);
  if(error){setStatus(error.message);return;}
  setChoices(data.choices);
  setRoutine(data.routine);
  localStorage.removeItem(browserKey());
  setStatus("Notification preferences saved.");
 }
 async function toggleDevice(){
  setSaving(true);
  try{
   if(!canPush)throw new Error("Push is unavailable here. On iPhone, open Boff from your Home Screen.");
   if(!subscribed&&await Notification.requestPermission()!=="granted")
    throw new Error("Allow notifications in browser settings to enable push.");
   const worker=await navigator.serviceWorker.register("/notifications-sw.js");
   await navigator.serviceWorker.ready;
   const current=await worker.pushManager.getSubscription();
   if(subscribed&&current){
    const {error}=await auth.rpc("dev_push_device",{p_league:leagueId,p_endpoint:current.endpoint});
    if(error)throw error;
    await current.unsubscribe();
    setSubscribed(false);
    localStorage.removeItem(browserKey());
    setStatus("Push disabled on this device.");
   }else{
    const {data,error}=await auth.rpc("dev_push_device",{p_league:leagueId});
    if(error)throw error;
    if(!data?.publicKey)throw new Error("Push is starting up. Try again after the next live refresh.");
    const subscription=current??await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:data.publicKey});
    const registered=await auth.rpc("dev_push_device",{p_league:leagueId,p_endpoint:subscription.endpoint,p_keys:subscription.toJSON().keys});
    if(registered.error){
     if(!current)await subscription.unsubscribe();
     throw registered.error;
    }
    setSubscribed(true);
    setStatus("Push enabled on this device.");
   }
  }catch(error){
   setStatus((error as {message?:string}).message??"Unable to update push on this device.");
  }finally{setSaving(false);}
 }

 return <section className="panel form-panel communications-settings" id="communication-preferences">
  <h3>Communications</h3>
  <div className="notification-settings-list">
   <div className="notification-email-row notification-column-head" aria-hidden="true">
    <span>Event</span><span>Email</span><span>Push</span>
   </div>
   {notificationKinds.map(event=>{
    const scheduled=routineOnly.has(event);
    const hasEmail=(emailKinds as readonly string[]).includes(event)&&(!scheduled||!!routine?.available[event]);
    const hasPush=browserEvents.some(([key])=>key===event);
    const label=notificationEvents[event].label;
    if(!hasEmail&&!hasPush)return null;
    return <div className="notification-email-row" key={event}>
     <strong>{label}</strong>
      {hasEmail?<label className="toggle-row"><input type="checkbox" aria-label={label+" email"} disabled={!ready||saving}
       checked={scheduled?routine?.overrides[event]!==false:choices[event]?.email===true}
       onChange={e=>{
        const checked=e.target.checked;
        if(scheduled)setRoutine(previous=>previous&&({...previous,overrides:{...previous.overrides,[event]:checked}}));
        else change(event,"email",checked);
       }}/><span className="switch" aria-hidden="true" /></label>:<span/>}
      {hasPush&&<label className="toggle-row"><input type="checkbox" aria-label={label+" push"} disabled={!ready||saving}
       checked={choices[event]?.push===true} onChange={e=>change(event,"push",e.target.checked)}/><span className="switch" aria-hidden="true" /></label>}
    </div>;
   })}
  </div>
  <div className="notification-controls communication-actions">
   <button className="button primary" disabled={!ready||saving} onClick={()=>void save()}>Save Preferences</button>
   {canPush&&<button className="button secondary" disabled={!ready||saving} onClick={()=>void toggleDevice()}>
    {subscribed?"Disable Push On This Device":"Set Up Push On This Device"}
   </button>}
  </div>
  {!canPush&&<p className="field-note">On iPhone (iOS 16.4 or later), open Boff in Safari, tap Share → Add to Home Screen, then open that icon and set up push here. No App Store download is needed.</p>}
  {status&&<p role="status">{status}</p>}
 </section>;
}
