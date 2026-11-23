import {useEffect,useState,type SyntheticEvent} from "react";
import {auth} from "./live";
import {StatusPanel} from "./BrandedState";
import {Mark} from "./ui";
import {emailTypeLabels} from "../server/notification-templates";
import {isSwitchableEmail,readerDropdown,renderLeagueReport,type LeagueEmail,type LeagueEmailOption} from "../server/email-switcher";

export function EmailReader(){
 const query=new URLSearchParams(location.search),requested=query.get("kind")??"opening";
 const [league,setLeague]=useState(query.get("league")??"");
 const [result,setResult]=useState<{leagues:LeagueEmailOption[];report:LeagueEmail|null}|null>(null);
 const [error,setError]=useState(""),[busy,setBusy]=useState(true);
 const week=query.has("week")?Number(query.get("week")):null;
 const valid=isSwitchableEmail(requested)&&(week===null||(Number.isInteger(week)&&week>=1&&week<=18));
 useEffect(()=>{
  if(!valid){setError("This email report link is invalid.");setBusy(false);return;}
  let active=true;
  setBusy(true);setError("");setResult(null);
  void auth.rpc("dev_email_reader",{p_kind:requested,p_league:league||null,p_week:week,p_details:true}).then(({data,error})=>{
   if(!active)return;
   setBusy(false);
   if(error)setError("This report is unavailable. Confirm you still belong to the league and your email is verified.");
   else {
    setResult(data);
    if(data?.report){
     const url=new URL(location.href);url.searchParams.set("league",data.report.id);url.searchParams.delete("details");
     history.replaceState({},"",url);
    }
   }
  });
  return()=>{active=false;};
 },[league,requested,week,valid]);
 const report=result?.report;
 const html=report&&isSwitchableEmail(requested)?readerDropdown(renderLeagueReport(report,requested,location.origin).html,result!.leagues,report.id):"";
 function loaded(event:SyntheticEvent<HTMLIFrameElement>){
  const frame=event.currentTarget,doc=frame.contentDocument;if(!doc)return;
  const resize=()=>{frame.style.height=Math.ceil(doc.body.getBoundingClientRect().height+24)+"px";};
  resize();doc.querySelectorAll("img").forEach(img=>img.addEventListener("load",resize,{once:true}));
  doc.querySelector<HTMLSelectElement>("#league-focus")?.addEventListener("change",event=>setLeague((event.target as HTMLSelectElement).value));
 }
 return <main className="email-reader">
  <div className="email-reader-toolbar"><a className="boff-screen-brand" href="/" aria-label="Boff Home"><Mark size={28}/><span>boff</span></a><span>{isSwitchableEmail(requested)?emailTypeLabels[requested]:"Email Report"}</span>
   </div>
  <p className="field-note">Web version · Current information for the selected report week.</p>
  {busy?<StatusPanel kind="loading" title="Loading Your League Report">Preparing your league update.</StatusPanel>:error?<StatusPanel kind="error" title="Report Unavailable" action={<a className="button primary" href="/">Open Boff</a>}>{error}</StatusPanel>:report?
   <iframe key={league} title="League Email Report" sandbox="allow-same-origin allow-top-navigation-by-user-activation allow-popups" srcDoc={html} onLoad={loaded}/>:<StatusPanel title="No League Reports Yet" action={<a className="button primary" href="/">Open Boff</a>}>Reports will appear when your linked league has an update.</StatusPanel>}
 </main>;
}
