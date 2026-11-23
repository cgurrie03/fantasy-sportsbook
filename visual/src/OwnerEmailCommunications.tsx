import {useEffect,useState,type SyntheticEvent} from "react";
import {auth,live} from "./live";
import {Badge} from "./ui";
import {routeUrl} from "./routing";
import {createEmailBoard,emailTypeLabels,renderAccountEmail,renderNotificationEmail,renderSignInPrototype,renderLeagueInvitation,type NotificationEvent,type EmailType,type EmailTicket} from "../server/notification-templates";
import {isSwitchableEmail,readerDropdown,renderLeagueReport,renderLeagueSwitcherEmail,type LeagueEmail} from "../server/email-switcher";
import {SIGN_IN_LINK_MINUTES} from "../../api/_lib/auth-policy";
import {emailLabels,type EmailKind} from "../../api/_lib/email-templates";

const exampleDetails:Record<NotificationEvent,Record<string,string>>={
 opening:{Week:"10",Markets:"Matchups, player markets and specials"},reminder:{Week:"10",Kickoff:"Sunday afternoon"},
 recap:{"Credits Won":"120",Record:"3–1"},monday_watch:{"Open Tickets":"2","Remaining Selections":"3"},
 reopening:{Week:"10","Updated Market":"Matchup Moneyline"},
 settled:{Result:"Won",Return:"120 credits",Week:"10","Leg 1":"Hellbean Moneyline · Won","Leg 2":"Over 250.5 · Won","Leg 3":"Brock Purdy 15+ Points · Won"},
 leg:{"Winning Legs":"2","Total Legs":"3","Leg 1":"Hellbean Moneyline · Won","Leg 2":"Over 250.5 · Won","Leg 3":"Brock Purdy 15+ Points · Open"},
 offers:{"Offer 1":"The Scoreboard Sprint · 50% Profit Boost","Offer 2":"Sunday Spotlight · 25% Profit Boost",Week:"10"},reward:{"Profit Boost":"25%",Achievement:"Top Scorer Of The Week"},
 credit:{Claim:"10 credits"},featured:{Matchup:"The 20 Year Rebuild vs. Hellbean",Feature:"Game Of The Week",Week:"10"},
};
const statusLabels:Record<string,string>={
 pending:"Queued",sending:"Sending",sent:"Sent",captured:"Captured In Dev",failed:"Failed",
 needs_review:"Needs Review",skipped:"Skipped",
};
const titleCase=(value:string)=>value.replaceAll("_"," ").replace(/\p{L}+/gu,word=>word[0].toUpperCase()+word.slice(1));
type Log={id:string;source:string;kind:string;subject:string|null;recipient:string|null;status:string;attempts:number;error:string|null;time:string;hasPreview:boolean};
type League={id:string;name:string;season:number};
type Member={id:string;name:string};

function fitPreview(event:SyntheticEvent<HTMLIFrameElement>){
 const frame=event.currentTarget;
 const body=frame.contentDocument?.body;
 if(!body)return;
 frame.style.height=Math.min(1800,Math.ceil(body.getBoundingClientRect().height)+26)+"px";
 body.addEventListener("click",click=>{
  if(!(click.target instanceof body.ownerDocument.defaultView!.Element))return;
  const link=click.target.closest("a");
  if(!link)return;
  click.preventDefault();
  if(frame.title==="Email Template Preview" && new URL(link.href).origin===location.origin)
   window.open(link.href,"_blank","noopener,noreferrer");
 });
}

export function OwnerEmailCommunications(){
 const [leagueId,setLeagueId]=useState<string>(live()?.leagueId??"");
 const [leagues,setLeagues]=useState<League[]>([]);
 const [member,setMember]=useState("");
 const [statusFilter,setStatusFilter]=useState("");
 const [members,setMembers]=useState<Member[]>([]);
 const [template,setTemplate]=useState("settled");
 const detailed=true;
 const [switcherPreview,setSwitcherPreview]=useState(false);
 const [previewLeague,setPreviewLeague]=useState("primary");
 const [logs,setLogs]=useState<Log[]>([]);
 const [capture,setCapture]=useState<{subject:string;html:string}|null>(null);
 const [status,setStatus]=useState("");
 const [loading,setLoading]=useState(false);
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;
  void auth.rpc("dev_owner_leagues").then(({data,error})=>{
   if(!active)return;
   if(error)setStatus(error.message);
   else{
    const available=(data??[]) as League[];
    setLeagues(available);
    setLeagueId(current=>current||available[0]?.id||"");
   }
  });
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  if(!leagueId)return;
  let active=true;
  setLoading(true);
  setStatus("");
  setCapture(null);
  setLogs([]);
  void auth.rpc("dev_owner_filtered_email_log",{p_league:leagueId,p_member:member||null,p_status:statusFilter||null}).then(({data,error})=>{
   if(!active)return;
   setLoading(false);
   if(error)setStatus(error.message);
   else {setMembers(data.members??[]);setLogs(data.logs??[]);}
  });
  return()=>{active=false;};
 },[leagueId,member,statusFilter,refresh]);
 async function openCapture(log:Log){
  setCapture(null);
  setStatus("");
  const {data,error}=await auth.rpc("dev_owner_captured_email",{p_league:leagueId,p_source:log.source,p_id:log.id});
  if(error)setStatus(error.message);
  else if(!data)setStatus("This email body is no longer available.");
  else setCapture({subject:log.subject??log.kind,html:data});
 }
 const kind=template as NotificationEvent;
 const leagueName=leagues.find(league=>league.id===leagueId)?.name??live()?.book.payload.leagueName??"Your Boff League";
 const active=live();
 const path=routeUrl("matchups").replace(/\/matchups$/,"");
 const current=active?.leagueId===leagueId;
 const board=createEmailBoard(current?active?.book.payload??{}:{},current?active?.standingsWallets??[]:[],location.origin,path,current?active?.user.teamId:undefined,leagueName);
 const selectedTeam=board.team?.name??"Team A";
 const opponent=board.matchups?.find(pair=>pair.some(t=>t.id===board.team?.id))?.find(t=>t.id!==board.team?.id)?.name??"Team B";
 const resultTeams=[{name:selectedTeam,avatar:board.team?.avatar,score:142.6},{name:opponent,avatar:board.matchups?.find(pair=>pair.some(t=>t.id===board.team?.id))?.find(t=>t.id!==board.team?.id)?.avatar,score:133.4}];
 const sampleGame={key:"sample-game",current:false,teams:resultTeams};
 const otherPair=board.matchups?.find(pair=>!pair.some(team=>team.id===board.team?.id));
 const otherTeams=(otherPair??[{name:"Team C",avatar:null},{name:"Team D",avatar:null}]).map((team,index)=>({name:team.name,avatar:team.avatar,score:index===0?130.2:110}));
 const sampleTicket:EmailTicket={
  id:"preview-ticket",status:template==="confirmation"?"OPEN":"WON",stake:20,odds:264,potentialReturn:72.8,actualReturn:72.8,
  legs:[
   {game:sampleGame,selection:selectedTeam+" -3.5",market:"Spread",status:template==="confirmation"?"OPEN":"WON",odds:-110,
    result:template==="confirmation"?undefined:{label:"Scores",teams:resultTeams},evidence:template==="confirmation"?undefined:`${selectedTeam} 142.6 – ${opponent} 133.4. Winning margin 9.2; needed more than 3.5.`},
   {game:sampleGame,selection:"Over 275.5",market:"Match Total",status:template==="confirmation"?"OPEN":"WON",odds:-110,
    result:template==="confirmation"?undefined:{label:"Match Total",value:276,teams:resultTeams},evidence:template==="confirmation"?undefined:"Combined final score 276.0; over 275.5 by 0.5."},
  ],
 };
 const quotes=(current?active?.quotes??[]:[]).filter((q:any)=>["moneyline","spread","match_total"].includes(q.kind)&&q.metadata?.alternate!==true&&q.metadata?.alternate!=="true").map((q:any)=>({
  teamId:q.team_id,matchup:String(q.matchup_key),kind:q.kind,side:q.side,line:q.line,odds:q.odds,boost:q.boost_pct,featured:q.featured,label:q.label,alternate:q.metadata?.alternate===true||q.metadata?.alternate==="true",
 }));
 const availableOffers=current?active?.offerUpdate?.offers??[]:[];
 const offers=availableOffers.length?availableOffers:[
  {slot:"sample-spotlight",title:"Sunday Spotlight",percent:25,picks:[{label:"Sample Favorite Moneyline",odds:-150},{label:"Sample Underdog +6.5",odds:-110},{label:"Over 250.5",odds:-110}]},
  {slot:"sample-monday",title:"Monday Spotlight",percent:25,picks:[{label:"Sample Player 15+ Points",odds:-130}]},
 ];
 const own=board.matchups?.find(pair=>pair.some(team=>team.id===board.team?.id));
 board.edition={
  tickets:template==="monday_watch"?[
   {...sampleTicket,id:"open-preview",status:"OPEN",legs:[sampleTicket.legs[0],{
    game:{key:"sample-other-game",current:true,teams:otherTeams},selection:"Over 250.5",market:"Match Total",odds:-110,status:"OPEN",
    result:{label:"Match Total",value:240.2,current:true,teams:otherTeams},
   }]},
   sampleTicket,{...sampleTicket,id:"lost-preview",status:"LOST",actualReturn:0,legs:sampleTicket.legs.map((leg,index)=>({...leg,
    selection:index===0?opponent+" +3.5":leg.selection,status:index===0?"LOST":"WON",
   }))},
  ]:[sampleTicket],
  balance:current?Number(active.balance):undefined,openStakes:40,futureStakes:25,claim:current&&Number(active.balance)+40>=100?0:50,quotes,offers,
  rewards:[{label:"Top Scorer Of The Week",percent:25}],
  performance:{Won:1,Lost:2,"Net Profit":"60.00 credits"},resultTeams:own?.map(t=>({...t,observed:t.id===board.team?.id?142.6:133.4})),
  recommendations:[{label:"Sample Player 15+ Points",odds:-130,matchup:"sample",kind:"player_milestone",headshot:current?active?.book.payload.players?.find((p:{kickoff?:string;headshot?:string})=>p.kickoff)?.headshot:undefined,projection:17.5,kickoff:"2026-11-24T01:15:00Z"}],openingQuotes:quotes,recapStats:{highScorer:{teamId:board.team?.id,name:selectedTeam,score:142.6,previousRecord:140},closestMatchup:{winner:otherTeams[0].name,loser:otherTeams[1].name,winnerScore:140,loserScore:138.2,margin:1.8}},marketBets:[{market:"Moneyline",selection:selectedTeam+" Moneyline",tickets:3},{market:"Spread",selection:opponent+" +3.5",tickets:2},{market:"Match Total",selection:"Under 275.5",tickets:1}],leagueBetting:{"Bets Placed":35,"Winning Tickets":12,"Credits Wagered":"650.00 credits","Most Bets Placed":"Sample Manager · 8 bets","Most Credits Lost":"Sample Manager · 80.00 credits","Longest Winning Ticket":"Sample Manager · 5-leg · +1200"},crowd:{"Members On Your Matchup":4,"Tickets Backing You":3,"Tickets Backing Your Opponent":2,"Tickets Taking The Under":1},
 };
 const identityOnly={...board,matchups:[],standings:[]};
 const invitation=template==="invite-existing"||template==="invite-new";
 const prototype=invitation?renderLeagueInvitation({
  leagueName,teamName:board.team?.name??"Sample Sleeper Team",role:"Co-Manager",url:new URL(routeUrl("matchups"),location.origin).href,board:identityOnly,
  existingAccount:template==="invite-existing",commissioner:detailed?"Sample Commissioner":undefined,
  expires:detailed&&template==="invite-new"?"7 days after issue":undefined,
 }):template==="signin"?renderSignInPrototype(location.origin,SIGN_IN_LINK_MINUTES,detailed,leagueName,identityOnly):null;
 const account=template==="confirmation"||template==="attention"?renderAccountEmail(template,identityOnly,
  {"Issue":"The result evidence is incomplete for this ticket.","Ticket":"preview-ticket","Operation":"Settlement Review"},
  template==="confirmation"?sampleTicket:undefined):null;
 const notification=prototype||account?null:renderNotificationEmail(kind,detailed,exampleDetails[kind]??{Week:"10"},location.origin,path,leagueName,board);
 const rendered=prototype??account??notification!;
 const row:LeagueEmail={id:leagueId||"00000000-0000-4000-8000-000000000001",name:leagueName,path,week:10,details:detailed,teamId:board.team?.id,
  payload:{teams:board.teams,leagueAvatar:board.leagueAvatar,leagueName},edition:board.edition};
 const sample=JSON.parse(JSON.stringify(row).replaceAll(selectedTeam,"Seaside Sharks").replaceAll(opponent,"Copper Owls")) as LeagueEmail;
 sample.id="00000000-0000-4000-8000-000000000002";sample.name="Harbor League (Sample)";sample.path="/sample-league";
 sample.edition={...sample.edition,balance:82,claim:50};
 const previewRows=[row,sample];
 const selectedRow=previewRows.find(row=>row.id===previewLeague)??row;
 const switchable=isSwitchableEmail(template);
 const switching=switchable&&switcherPreview;
 const switched=switching?renderLeagueReport(selectedRow,template,location.origin):null;
 const html=switching?readerDropdown(switched!.html,previewRows,selectedRow.id):switchable?renderLeagueSwitcherEmail(previewRows,template,location.origin,row.id).html:rendered.html;
 const subject=switched?.subject??rendered.subject;
 function previewLoaded(event:SyntheticEvent<HTMLIFrameElement>){
  fitPreview(event);
  event.currentTarget.contentDocument?.querySelector<HTMLSelectElement>("#league-focus")?.addEventListener("change",event=>setPreviewLeague((event.target as HTMLSelectElement).value));
 }
 function downloadAmp(){
  if(!isSwitchableEmail(template))return;
  const message=renderLeagueSwitcherEmail(previewRows,template,location.origin,row.id);
  const url=URL.createObjectURL(new Blob([message.amp],{type:"text/html"}));
  const a=document.createElement("a");a.href=url;a.download="boff-"+template+"-amp.html";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <div className="owner-communications">
  <section className="panel form-panel">
   <h2>Email Templates</h2>
   <div className="owner-email-toolbar">
    <label>Email Type<select aria-label="Email Type" value={template} onChange={e=>setTemplate(e.target.value)}>
     {Object.entries(emailTypeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    {switchable&&<><div className="segmented" role="group" aria-label="League Switching Preview">
     <button type="button" className={!switcherPreview?"active":""} onClick={()=>setSwitcherPreview(false)}>Standard Email</button>
     <button type="button" className={switcherPreview?"active":""} onClick={()=>setSwitcherPreview(true)}>League Switcher</button>
    </div><button className="button secondary" onClick={downloadAmp}>Download AMP Template</button></>}
   </div>
   {switchable&&<p className="field-note">League Switcher demonstrates two sample league reports. Standard Email opens the secure web reader from its league header. In-email switching requires a supported inbox and approved sender.</p>}
   <div className="owner-email-preview">
    <div className="owner-email-envelope"><small>Subject</small><strong>{subject}</strong><Badge>Sample Data</Badge></div>
    <iframe title="Email Template Preview" className="owner-email-frame" sandbox="allow-same-origin" srcDoc={html} onLoad={previewLoaded}/>
   </div>
  </section>
  <section className="panel form-panel">
   <div className="split"><h2>Email Sending Log</h2><button className="button secondary" disabled={loading||!leagueId} onClick={()=>setRefresh(value=>value+1)}>Refresh Log</button></div>
   <p className="field-note">Dev captures messages for preview. Queued messages are awaiting the mail worker.</p>
   <div className="owner-email-toolbar owner-email-filters">
    <label>League<select aria-label="League" value={leagueId} onChange={e=>{setMember("");setMembers([]);setLeagueId(e.target.value);}}>
     {leagues.map(league=><option key={league.id} value={league.id}>{league.name} · {league.season}</option>)}
    </select></label>
    <label>Member<select aria-label="Member" value={member} onChange={e=>setMember(e.target.value)}>
     <option value="">All Members</option>
     {members.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <label>Status<select aria-label="Status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
     <option value="">All Statuses</option>
     {Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
   </div>
   {status&&<p role="status">{status}</p>}
   {loading?<p role="status">Loading email log…</p>:logs.length===0?<p>No email activity matches these filters.</p>:
    <div className="table-wrap"><table className="owner-email-log"><thead><tr>
     <th>Time</th><th>Email</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Details</th>
    </tr></thead><tbody>{logs.map(log=><tr key={log.source+log.id}>
     <td>{new Date(log.time).toLocaleString()}</td><td><strong>{titleCase(emailTypeLabels[log.kind as EmailType]??emailLabels[log.kind as EmailKind]??log.kind)}</strong>
     {log.subject&&<small>{log.subject}</small>}</td>
     <td>{log.recipient??"—"}</td><td><Badge tone={log.status==="failed"?"red":log.status==="sent"||log.status==="captured"?"green":undefined}>{statusLabels[log.status]??titleCase(log.status)}</Badge></td><td>{log.attempts}</td>
     <td>{log.error??(log.hasPreview?<button className="text-button" onClick={()=>void openCapture(log)}>View Email</button>:"—")}</td>
    </tr>)}</tbody></table></div>}
   {capture&&<><div className="split"><h3>{capture.subject}</h3><button className="button secondary" onClick={()=>setCapture(null)}>Close Email</button></div>
    <iframe title="Captured Email" className="owner-email-frame" sandbox="allow-same-origin" tabIndex={-1} srcDoc={capture.html} onLoad={fitPreview}/></>}
  </section>
 </div>;
}
