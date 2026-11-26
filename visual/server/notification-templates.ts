import {featureCatalog} from "../src/featuredOptions.ts";
import {emailTheme} from './email-theme.ts';
export const notificationEvents = {
 opening: {label:"New Weekly Markets", subject:"The weekly slate is open", message:"This week’s markets are ready to browse.", action:"Open Weekly Slate", page:"matchups"},
 reminder: {label:"Weekly Reminder", subject:"Your weekly slate reminder", message:"Check the slate and any offers before kickoff.", action:"Open Weekly Slate", page:"matchups"},
 recap: {label:"Weekly Recap", subject:"Your week in Boff", message:"The week’s results are ready to review.", action:"View Standings", page:"league"},
 monday_watch: {label:"Monday Night Ticket Watch", subject:"Your Monday ticket watch", message:"There are open selections to follow.", action:"View My Bets", page:"my-bets"},
 reopening: {label:"Market Reopening", subject:"Markets have reopened", message:"The updated board is available.", action:"Browse Markets", page:"matchups"},
 settled: {label:"Ticket Settled", subject:"Your ticket has settled", message:"Your result is ready to view.", action:"View My Bets", page:"my-bets"},
 leg: {label:"Parlay Leg Update", subject:"Your parlay has moved", message:"A selection on your open parlay has won.", action:"View My Bets", page:"my-bets"},
 offers: {label:"New Weekly Offers", subject:"The latest boosts are on the board", message:"Open the Weekly Slate to see this week’s offers and their kickoff deadlines.", action:"Browse Weekly Offers", page:"matchups"},
 reward: {label:"Fantasy Reward Earned", subject:"You earned a fantasy reward", message:"Your fantasy performance earned a boost. Open Earned Boosts to see where you can use it.", action:"View Earned Boosts", page:"matchups?boosts=1"},
 credit: {label:"Credits Ready To Claim", subject:"Credits are ready to claim", message:"Open the balance menu at the top of the Weekly Slate to claim your credits.", action:"Open Weekly Slate", page:"matchups"},
 featured: {label:"Featured Matchup", subject:"A featured matchup is available", message:"See the matchup and its eligible boosted lines.", action:"View Matchups", page:"matchups"},
} as const;
export type NotificationEvent=keyof typeof notificationEvents;
export const notificationKinds=Object.keys(notificationEvents) as NotificationEvent[];
export const emailKinds = ["opening","recap","monday_watch","settled","credit"] as const;
export const emailTypeLabels = {
 opening:"New Weekly Markets",recap:"Weekly Recap",monday_watch:"Monday Night Ticket Watch",settled:"Ticket Settled",
 credit:"Credits Ready To Claim",confirmation:"Bet Confirmation",attention:"Admin Review Needed",signin:"Sign-In Link",
 "invite-existing":"League Invitation · Existing Account","invite-new":"League Invitation · New Account",
} as const;
export type EmailType=keyof typeof emailTypeLabels;
export const capitalizeEmail=(value:string)=>value.replace(/(^|[\s·–—-])([a-z])/g,(_match,prefix,letter)=>prefix+letter.toUpperCase());
export type NotificationDetail=Record<string,string|number>;
export type EmailTicket={
 id:string;status:string;stake:number;odds:number;potentialReturn:number;actualReturn?:number|null;
 legs:{game?:{key:string;current?:boolean;teams:{name:string;avatar?:string|null;score?:number|null}[]}|null;selection:string;status:string;odds:number;market?:string;evidence?:string|null;result?:{label:string;current?:boolean;value?:number|null;teams?:{name:string;avatar?:string|null;score?:number|null}[]}|null}[];
};
type EmailQuote={teamId?:string|null;matchup:string;kind:string;side:string;line?:number|null;odds:number;boost?:number;featured?:string;label?:string;alternate?:boolean};
export type EmailEdition={
 tickets?:EmailTicket[];quotes?:EmailQuote[];openingQuotes?:EmailQuote[];
 offers?:{slot:string;title:string;percent:number;base?:number;picks?:{label:string;odds:number}[]}[];
 rewards?:{label:string;percent:number}[];
 balance?:number;openStakes?:number;futureStakes?:number;claim?:number;
 performance?:Record<string,string|number>;crowd?:Record<string,string|number>;
 marketBets?:{market:string;selection:string;tickets:number}[];leagueBetting?:Record<string,string|number>;
 resultTeams?:EmailTeam[];highlight?:string;
 recapStats?:{
  tiedMatchups?:number;
  highScorer?:{teamId?:string;name:string;score:number;previousRecord?:number|null};
  closestMatchup?:{winner:string;loser:string;margin:number;winnerScore:number;loserScore:number};
  biggestUpset?:{winner:string;loser:string;odds:number;winnerScore:number;loserScore:number};
  largestWin?:{name:string;profit:number;legs:number;odds:number};
 };
 recommendations?:{label:string;odds:number;matchup:string;kind:string;headshot?:string|null;projection?:number;kickoff?:string}[];
};
type EmailTeam={id:string;name:string;avatar?:string|null;matchupId?:string|number;wins?:number;losses?:number;observed?:number;currentProjection?:number;projection?:number;pregameProjection?:number};
type EmailStanding={name:string;teamId:string;balance?:number;profit?:number;tickets?:number};
export type EmailBoard={
 origin:string;path:string;leagueName:string;leagueAvatar?:string|null;
 switcherUrl?:string;
 team?:EmailTeam;matchups?:[EmailTeam,EmailTeam][];standings?:EmailStanding[];teams?:EmailTeam[];
 edition?:EmailEdition;
};
const escape=(text:string)=>text.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
export function createEmailBoard(
 payload:{leagueName?:string;leagueAvatar?:string|null;teams?:EmailTeam[]},wallets:EmailStanding[],
 origin:string,path:string,teamId?:string,leagueName=payload.leagueName??"Your Boff League",
):EmailBoard{
 const teams=payload.teams??[];
 const games=new Map<string|number,EmailTeam[]>();
 for(const team of teams){
  if(team.matchupId==null)continue;
  const pair=games.get(team.matchupId)??[];
  pair.push(team);games.set(team.matchupId,pair);
 }
 const matchups=[...games.values()].filter((pair):pair is [EmailTeam,EmailTeam]=>pair.length===2)
  .sort((a,b)=>Number(b.some(t=>t.id===teamId))-Number(a.some(t=>t.id===teamId)));
 const standings=[...wallets].sort((a,b)=>Number((b.tickets??0)>0)-Number((a.tickets??0)>0)
  ||(b.profit??0)-(a.profit??0)||a.name.localeCompare(b.name)).slice(0,5);
 return {origin,path,leagueName,leagueAvatar:payload.leagueAvatar,team:teams.find(t=>t.id===teamId),teams,matchups,standings};
}
function avatarHtml(name:string,value?:string|null,size=36){
 const url=value&&(/^[\w-]{1,100}$/.test(value)?"https://sleepercdn.com/avatars/thumbs/"+value:
  /^https:\/\/(?:[a-z0-9-]+\.)*sleepercdn\.com\/[\w%./-]+$/i.test(value)?value:null);
 return url?`<img width="${size}" height="${size}" alt="" src="${escape(url)}" style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:#214438">`:
  `<span aria-hidden="true" style="display:inline-block;width:${size}px;text-align:center;line-height:${size}px;background:#214438;border-radius:50%;font-weight:bold;color:#f1f4ee">${escape(name.slice(0,2).toUpperCase())}</span>`;
}
export function renderEmailBoard(board:EmailBoard,detailed:boolean){
 const site=(page:string)=>escape(new URL(board.path+"/"+page,board.origin).href);
 const id=`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#214438" style="border:1px solid #345046;border-radius:8px;margin:0 0 16px"><tr>
  <td width="52" style="padding:10px 0 10px 10px"><a href="${site("league")}" aria-label="Open league">${avatarHtml(board.leagueName,board.leagueAvatar,40)}</a></td>
  <td style="padding:10px;color:#f1f4ee"><!--league-focus--><a href="${board.switcherUrl?escape(board.switcherUrl):site("league")}" style="color:#f1f4ee;text-decoration:none;font-weight:bold">${escape(board.leagueName)}${board.switcherUrl?' <span style="color:#e5c78d">▾</span>':""}</a><!--/league-focus-->
  ${board.team?`<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding:5px 6px 0 0">${avatarHtml(board.team.name,board.team.avatar,20)}</td><td style="padding-top:5px;color:#b2c4b7;font-size:12px">${escape(board.team.name)}</td></tr></table>`:""}</td></tr></table>`;
 if(!detailed)return {identity:id,sections:"",text:[board.leagueName,board.team?.name].filter(Boolean).join(" · ")};
 const score=(value?:number)=>typeof value==="number"&&Number.isFinite(value)?value.toFixed(1):"—";
 const matchups=(board.matchups??[]).map(pair=>`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="border:1px solid #345046;border-radius:8px;margin:0 0 9px">
  ${pair.map(team=>`<tr><td width="40" style="padding:8px 0 8px 10px">${avatarHtml(team.name,team.avatar,30)}</td>
  <td style="padding:8px;color:#f1f4ee"><strong>${escape(team.name)}</strong><br><span style="color:#b2c4b7;font-size:12px">${team.wins??0}–${team.losses??0}</span></td>
  <td align="right" style="padding:8px 10px;font-size:12px;color:#b2c4b7;white-space:nowrap"><strong style="color:#f1f4ee">${score(team.observed)}</strong> Score<br>${score(team.currentProjection??team.projection)} Projected</td></tr>`).join("")}
  <tr><td colspan="3" style="border-top:1px solid #345046;padding:8px 10px"><a href="${site("matchup/"+encodeURIComponent(String(pair[0].matchupId)))}" style="color:#e5c78d;font-weight:bold;font-size:13px">View Matchup</a></td></tr></table>`).join("");
 const standings=(board.standings??[]).map((row,i)=>{const team=board.teams?.find(t=>t.id===row.teamId);return `<tr><td width="29" align="center" style="padding:6px;color:#e5c78d">${i+1}</td>
  <td width="32">${avatarHtml(team?.name??row.name,team?.avatar,24)}</td><td style="padding:6px;color:#f1f4ee">${escape(row.name)}${team?`<br><span style="color:#b2c4b7;font-size:11px">${escape(team.name)}</span>`:""}</td>
  <td align="right" style="padding:6px 10px;color:#f1f4ee;white-space:nowrap;font-size:12px">${score(row.tickets?row.balance:0)} credits<br><span style="color:#b2c4b7">${Number(row.profit)>0?"+":""}${score(row.profit)} net</span></td></tr>`;}).join("");
 const heading=(name:string)=>`<h2 style="margin:14px 0 7px;color:#f1f4ee;font-size:16px;font-weight:bold">${name}</h2>`;
 const sections=(matchups?heading("Around The League")+matchups:"")+(standings?heading("Boff Standings")+`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="border:1px solid #345046;border-radius:8px">${standings}<tr><td colspan="4" style="border-top:1px solid #345046;padding:9px 10px"><a href="${site("league")}" style="color:#e5c78d;font-weight:bold;font-size:13px">View Full Standings</a></td></tr></table>`:"");
 const text=[board.leagueName,board.team?.name,
  ...(board.matchups??[]).map(pair=>pair.map(t=>`${t.name} ${score(t.observed)} (${score(t.currentProjection??t.projection)} projected)`).join(" vs. ")),
  ...(board.standings??[]).map((row,i)=>`#${i+1} ${row.name} · ${score(row.tickets?row.balance:0)} credits · ${score(row.profit)} net`),
  new URL(board.path+"/league",board.origin).href].filter(Boolean).join("\n");
 return {identity:id,sections,text};
}
const palettes = {
 markets: { accent:"#dfbd73", tint:"#faf1da", ink:"#614917" },
 results: { accent:"#a9d5b0", tint:"#e7f4e9", ink:"#205137" },
 watch: { accent:"#d2c6eb", tint:"#f0ebf8", ink:"#4d386f" },
 credit: { accent:"#add7db", tint:"#e8f4f5", ink:"#20505a" },
 loss: { accent:"#efb8ae", tint:"#faede9", ink:"#7e3d35" },
};
const eventPalette:Record<NotificationEvent,keyof typeof palettes> = {
 opening:"markets",reminder:"markets",recap:"results",monday_watch:"watch",reopening:"markets",
 settled:"results",leg:"watch",offers:"markets",reward:"results",credit:"credit",featured:"markets",
};

type PrototypeContent = {
 subject:string; preview:string; label:string; heading:string; message:string; action:string; href:string;
 context?:string;
 board?:EmailBoard; detailed?:boolean;
 sections?:string; sectionText?:string;
 accent:string; tint:string; ink:string; rows:[string,string|number][];
 footerHeading:string; footerText:string; footerLink:string; footerHref:string;
 hideAction?:boolean;
};

function emailAction(label:string,href:string){
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="right" style="padding-top:10px"><table role="presentation" align="right" cellspacing="0" cellpadding="0"><tr><td bgcolor="#dfbd73" style="border-radius:5px;mso-padding-alt:9px 12px"><a href="${escape(href)}" style="display:inline-block;padding:9px 12px;mso-padding-alt:0;color:#16392f;font:700 13px/20px Public Sans,Arial,sans-serif;text-decoration:none">${escape(label)}</a></td></tr></table></td></tr></table>`;
}
function emailIcon(name:string,size=24,origin="https://sportsbook.coopergurrie.com"){
 const src=new URL("/email-icons/v1/"+name+".png",origin).href;
 return `<img width="${size}" height="${size}" src="${escape(src)}" alt="" style="display:block;width:${size}px;height:${size}px;border:0">`;
}
function renderPrototype(content:PrototypeContent){
 const body="Public Sans, Arial, sans-serif";
 const board=content.board?renderEmailBoard(content.board,false):null;
 const fontUrl=content.board?escape(new URL("/fonts/public-sans.woff2",content.board.origin).href):"";
 const footer=`<tr><td bgcolor="#102b24" style="padding:17px 24px 19px;border-top:1px solid #345046;font-family:${body};font-size:13px;line-height:1.55;color:#b2c4b7">
  <p style="margin:0 0 4px;font-weight:bold">${escape(content.footerHeading)}</p>
  <p style="margin:0 0 8px">${escape(content.footerText)}</p>
  <a href="${escape(content.footerHref)}" style="color:#e5c78d;font-weight:bold;text-decoration:underline">${escape(content.footerLink)}</a>
 </td></tr>`;
 const weekBubble=content.heading==="New Weekly Markets"&&/^Week \d+$/.test(content.context??"");
 const details=content.rows.length?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;color:#f1f4ee">
  ${content.rows.map(([label,value])=>`<tr><td style="padding:9px 10px;font-size:14px;line-height:1.5">${escape(label)}</td><td align="right" style="padding:9px 10px;font-size:14px;line-height:1.5;font-weight:bold;overflow-wrap:anywhere">${escape(String(value))}</td></tr>`).join("")}
 </table>`:"";
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(content.subject)}</title>${fontUrl?`<style>@font-face{font-family:Public Sans;src:url('${fontUrl}') format('woff2');font-weight:400 700;font-display:swap}</style>`:""}</head>
 <body style="margin:0;background:#102b24;color:#f1f4ee;font-family:${body}">
  <div aria-hidden="true" style="display:none;mso-hide:all;max-height:0;max-width:0;opacity:0;overflow:hidden">${escape(content.preview)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:12px">
   <!--[if mso]><table role="presentation" width="544" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
   <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#17392f" style="max-width:544px;border:1px solid #345046;text-align:left;color:#f1f4ee;font-family:${body}">
    <tr><td bgcolor="#0d251e" style="padding:12px 24px;color:#f1f4ee;border-bottom:2px solid ${content.accent};font:bold 25px/1.1 ${body}">boff</td></tr>
    <tr><td style="padding:20px 24px 22px;font-family:${body}">
     ${board?.identity??""}
     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px"><tr><td valign="middle"><h1 style="margin:0;font:bold 24px/1.3 ${body}">${escape(capitalizeEmail(content.heading))}</h1></td>${weekBubble?`<td align="right" valign="middle" width="84" style="padding-left:10px"><span style="display:inline-block;padding:5px 9px;border:1px solid #345046;border-radius:20px;background:#214438;color:#b2c4b7;font-size:12px;white-space:nowrap">${escape(content.context!)}</span></td>`:""}</tr></table>
     ${content.context&&!weekBubble?`<p style="margin:0 0 13px;color:#b2c4b7;font-size:14px;line-height:1.45;font-weight:bold">${escape(content.context)}</p>`:""}
     ${content.message?`<p style="margin:0 0 20px;font-size:14px;line-height:1.6">${escape(content.message)}</p>`:""}
     ${details}
     ${content.sections??""}
     ${content.hideAction?"":emailAction(content.action,content.href)}
    </td></tr>
    ${footer}
   </table>
   <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
 </body></html>`;
 const text=[content.heading,content.context,content.message,...content.rows.map(([k,v])=>k+": "+v),content.action+": "+content.href,
  content.sectionText,board?.text,content.footerHeading,content.footerText,content.footerLink+": "+content.footerHref].filter(Boolean).join("\n\n");
 return {subject:content.subject,html:emailTheme(html),text};
}

const formatOdds=(value:number)=>(value>0?"+":"")+value;
const credits=(value:number)=>Number(value).toFixed(2)+" credits";
function quotedOdds(quote:EmailQuote){
 if(!quote.boost)return formatOdds(quote.odds);
 const profit=(quote.odds>0?quote.odds/100:100/Math.abs(quote.odds))*(1+quote.boost/100);
 return formatOdds(Math.round(profit>=1?profit*100:-100/profit))+" ("+quote.boost+"% Boost)";
}
const sectionHeading=(name:string)=>`<h2 style="margin:24px 0 12px;font:700 17px/1.4 Public Sans,Arial,sans-serif;color:#f1f4ee">${escape(capitalizeEmail(name))}</h2>`;
function facts(rows:Record<string,string|number>,highlight?:string,margin=20){
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 ${margin}px">${Object.entries(rows).map(([label,value])=>`<tr><td style="padding:8px 0;color:#b2c4b7;font-size:14px;line-height:1.5">${escape(capitalizeEmail(label))}</td><td align="right" style="padding:8px 0 8px 12px;font-size:14px;line-height:1.5;${label===highlight?"color:#e5c78d;font-weight:bold;":""}">${escape(String(value))}</td></tr>`).join("")}</table>`;
}
function emailLegText(leg:EmailTicket["legs"][number]){
 const result=leg.result;
 const summary=result?.label==="Scores"?(result.teams??[]).map(team=>team.name+" "+Number(team.score).toFixed(2)).join(" · "):
  result&&result.value!=null?result.label+" "+Number(result.value).toFixed(2):(leg.evidence??"").split(";")[0];
 return leg.selection+" · "+formatOdds(leg.odds)+" · "+leg.status+" · "+summary;
}
function ticketLegResult(leg:EmailTicket["legs"][number],hideTeams=false){
 const result=leg.result;
 if(!result)return leg.evidence?`<div style="margin-top:8px;color:#b2c4b7">${escape(leg.evidence.split(";")[0])}</div>`:leg.status.toLowerCase()==="open"?`<div style="margin-top:8px;font-size:12px;color:#b2c4b7">Current progress unavailable</div>`:"";
 const teams=hideTeams?[]:result.teams??[];
 const scores=result.label==="Scores";
 if(scores&&hideTeams)return "";
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">${result.current&&scores?`<tr><td colspan="3" style="padding:0 0 4px;color:#b2c4b7;font-size:11px">Current ${scores?"Scores":escape(result.label)}</td></tr>`:""}${teams.map(team=>`<tr><td width="26" style="padding:4px 6px 4px 0">${avatarHtml(team.name,team.avatar,20)}</td><td style="padding:4px 0;font-size:12px;color:#b2c4b7">${escape(team.name)}</td>${scores&&team.score!=null?`<td align="right" style="padding:4px 0 4px 8px;font-size:14px;font-weight:bold;color:#f1f4ee">${Number(team.score).toFixed(2)}</td>`:""}</tr>`).join("")}${!scores&&result.value!=null?`<tr><td colspan="2" style="padding-top:5px;font-size:12px;color:#b2c4b7">${escape((result.current?"Current ":"")+result.label)}</td><td align="right" style="padding:5px 0 0 8px;font-size:14px;font-weight:bold;color:#f1f4ee">${Number(result.value).toFixed(2)}</td></tr>`:""}</table>`;
}
export function renderEmailTicket(ticket:EmailTicket,board?:EmailBoard,showAction=true,showProgress=true){
 const state=(value:string)=>value.toLowerCase();
 const tones:Record<string,string>={won:"#e5c78d",lost:"#f4a295",push:"#e5c78d",voided:"#b2c4b7",open:"#b2c4b7"};
 const status=state(ticket.status);
 const groups=new Map<string,{game:EmailTicket["legs"][number]["game"];legs:EmailTicket["legs"]}>();
 for(const leg of ticket.legs){
  const game=leg.game??(leg.result?.teams?.length===2&&["Spread","Moneyline","Match Total"].includes(leg.market??"")?{
   key:leg.result.teams.map(team=>team.name).sort().join("|"),current:leg.result.current,teams:leg.result.teams,
  }:undefined);
  const key=game?.key??"other-markets";
  const group=groups.get(key)??{game,legs:[]};
  group.legs.push(leg);groups.set(key,group);
 }
 const legs=[...groups.values()].map(group=>{
  const header=group.game?`<tr><td colspan="2" style="padding:12px;background:#102b24;border-bottom:1px solid #345046"><div style="font-size:11px;color:#b2c4b7;margin-bottom:6px">${showProgress?(group.game.current?"Current Scores":"Final Scores"):"Matchup"}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${group.game.teams.map(team=>`<tr><td width="28" style="padding:4px 6px 4px 0">${avatarHtml(team.name,team.avatar,22)}</td><td style="padding:4px 0;font-size:13px;color:#f1f4ee;font-weight:bold">${escape(team.name)}</td>${showProgress?`<td align="right" style="padding:4px 0 4px 8px;font-size:14px;color:#f1f4ee;font-weight:bold">${team.score!=null?Number(team.score).toFixed(2):"—"}</td>`:""}</tr>`).join("")}</table></td></tr>`:groups.size>1?`<tr><td colspan="2" style="padding:10px 12px;background:#214438;font-size:13px;font-weight:bold">Other Markets</td></tr>`:"";
  return header+group.legs.map(leg=>{
   const status=state(leg.status);
   const sameTeams=["Spread","Moneyline","Match Total","Team Total","Team Milestone","Winning Margin"].includes(leg.market??"")&&!!group.game&&!!leg.result?.teams?.length&&leg.result.teams.every(team=>group.game!.teams.some(member=>member.name===team.name&&member.score===team.score));
   return `<tr><td width="28" valign="top" style="padding:14px 10px 14px 12px;color:${tones[status]??"#b2c4b7"};font-size:18px"><span role="img" aria-label="${escape(capitalizeEmail(status))} Leg">${emailIcon("leg-"+(["won","lost","open","push","voided"].includes(status)?status:"open"),24,board?.origin)}</span></td><td style="padding:14px 12px 14px 0;border-bottom:1px solid #345046;font-size:14px;line-height:1.5">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-weight:bold">${escape(leg.selection)}</td><td align="right" valign="top" style="padding-left:10px;white-space:nowrap">${formatOdds(leg.odds)}</td></tr></table>
    ${leg.market?`<div style="color:#b2c4b7;margin-top:4px">${escape(capitalizeEmail(leg.market.replaceAll("_"," ")))}</div>`:""}
    ${showProgress?ticketLegResult(leg,sameTeams):""}
   </td></tr>`;
  }).join("");
 }).join("");
 const href=board&&showAction?new URL(board.path+"/my-bets?ticket="+encodeURIComponent(ticket.id),board.origin).href:"";
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="margin:0 0 22px;border:1px solid #345046;border-radius:8px;color:#f1f4ee;font:14px/1.5 Public Sans,Arial,sans-serif">
 <tr><td colspan="2" style="padding:14px 12px;border-bottom:1px solid #345046"><strong>${ticket.legs.length>1?ticket.legs.length+"-Leg Parlay":"Single Bet"} · ${formatOdds(ticket.odds)}</strong><span style="float:right;color:${tones[status]??"#b2c4b7"}">${escape(capitalizeEmail(status))}</span></td></tr>
 ${legs}
 <tr><td colspan="2" style="padding:12px">${facts({"Stake":credits(ticket.stake),"Ticket Odds":formatOdds(ticket.odds),
  [status==="open"?"Potential Return":"Return"]:credits(status==="open"?ticket.potentialReturn:ticket.actualReturn??0)},undefined,0)}
 <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td valign="bottom" style="padding:10px 8px 0 0;font-size:11px;color:#b2c4b7;overflow-wrap:anywhere;word-break:break-word">Ticket ${escape(ticket.id)}</td><td align="right" valign="bottom">${href?emailAction("View Your Bet",href):""}</td></tr></table></td></tr></table>`;
}
function mainMatchupQuotes(quotes:EmailQuote[],matchupId:string){
 return quotes.filter(quote=>quote.matchup===matchupId&&!quote.alternate&&
  ["moneyline","spread","match_total"].includes(quote.kind)&&Number.isFinite(quote.odds)&&quote.odds!==0&&
  (quote.kind==="moneyline"||(quote.line!=null&&Number.isFinite(quote.line))));
}
function featureStyle(label:string){
 const feature=Object.values(featureCatalog).find(item=>item.label.toLowerCase()===label.toLowerCase());
 const colors:Record<string,string>={gold:"#e7c98c",sage:"#aed0b8",clay:"#dca38e",lavender:"#c8b7d9",bronze:"#c9b19a"};
 return feature?{icon:feature.icon,color:colors[feature.color]}:null;
}
function matchupEmail(pair:[EmailTeam,EmailTeam],board:EmailBoard,quotes:EmailQuote[],label:string,mode:"opening"|"live"|"final"="live"){
 const href=new URL(board.path+"/matchup/"+encodeURIComponent(String(pair[0].matchupId)),board.origin).href;
 const main=mainMatchupQuotes(quotes,String(pair[0].matchupId));
 const feature=featureStyle(label);
 const heading=feature?`<table role="presentation" cellspacing="0" cellpadding="0" bgcolor="${feature.color}" style="border-radius:5px"><tr><td style="padding:5px 6px">${emailIcon(feature.icon+"-ink",16,board.origin)}</td><td style="padding:5px 7px 5px 0;color:#173d32;font-size:13px;font-weight:bold">${escape(label)}</td></tr></table>`:escape(capitalizeEmail(label));
 const rows=pair.map((team,index)=>{
  const opponent=pair[1-index];
  const spread=main.find(q=>q.kind==="spread"&&q.teamId===team.id);
  const moneyline=main.find(q=>q.kind==="moneyline"&&q.teamId===team.id);
  const total=main.find(q=>q.kind==="match_total"&&q.side===(index===0?"over":"under"));
  const lineCell=(quote:EmailQuote|undefined,title:string)=>{
   let outcome:string|undefined;
   if(mode==="final"&&quote&&team.observed!=null&&opponent.observed!=null){
    const difference=quote.kind==="moneyline"?team.observed-opponent.observed:
     quote.kind==="spread"?team.observed-opponent.observed+Number(quote.line):
     (team.observed+opponent.observed-Number(quote.line))*(quote.side==="over"?1:-1);
    outcome=Math.abs(difference)<0.001?"push":difference>0?"won":"lost";
   }
   return `<td width="33.33%" valign="top" style="padding:0 3px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#17392f" style="border:1px solid ${outcome==="won"?"#e5c78d":"#345046"};border-radius:6px"><tr><td align="center" valign="middle" height="64" style="height:64px;padding:5px 2px;font-size:12px;line-height:1.45;color:#f1f4ee"><span style="color:#b2c4b7">${escape(title)}</span><br>${quote?.boost?`<del style="color:#b2c4b7;margin-right:4px">${formatOdds(quote.odds)}</del>`:""}<strong style="color:${quote?.boost||outcome==="won"?"#e5c78d":"#f1f4ee"}">${quote?escape(quote.boost?quotedOdds(quote).split(" (")[0]:formatOdds(quote.odds)):"—"}</strong>${quote?.boost?`<div style="margin-top:3px;font-size:10px;white-space:nowrap;color:#e5c78d">${quote.boost}% Boost</div>`:""}${outcome?`<table role="presentation" align="center" cellspacing="0" cellpadding="0"><tr><td style="padding-top:4px;font-size:11px;color:${outcome==="won"?"#e5c78d":"#b2c4b7"}">${capitalizeEmail(outcome)}</td></tr></table>`:""}</td></tr></table></td>`;
  };
  const projection=mode==="opening"?team.pregameProjection??team.projection:team.currentProjection??team.projection;
  return `<tr><td style="padding:12px 10px 7px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
   <td width="40" valign="top">${avatarHtml(team.name,team.avatar,32)}</td>
   <td valign="top" style="font-size:14px;line-height:1.5"><strong>${escape(team.name)}</strong>
    ${team.wins!=null&&team.losses!=null?`<div style="color:#b2c4b7;margin-top:3px">${team.wins}–${team.losses}</div>`:""}
    ${projection!=null?`<div style="color:#b2c4b7;margin-top:3px;font-size:12px">Projected ${Number(projection).toFixed(1)}</div>`:""}</td>
   ${mode!=="opening"?`<td align="right" valign="top" width="54" style="font-size:12px;line-height:1.5;color:#b2c4b7">${mode==="final"?"Final":"Score"}<br><strong style="font-size:18px;color:#f1f4ee">${Number(team.observed??0).toFixed(1)}</strong></td>`:""}
  </tr></table></td></tr>
  <tr><td style="padding:0 7px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
   ${lineCell(spread,spread?"Spread "+(Number(spread.line)>0?"+":"")+spread.line:"Spread")}
   ${lineCell(moneyline,"Moneyline")}
   ${lineCell(total,total?(total.side==="over"?"Over ":"Under ")+total.line:"Total")}
  </tr></table></td></tr>`;
 }).join("");
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="margin:0 0 20px;border:1px solid #345046;border-radius:8px"><tr><td style="padding:9px 10px;background:#214438"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;font-weight:bold;color:#e5c78d">${heading}</td><td align="right" style="padding-left:8px;font-size:12px;white-space:nowrap"><a href="${escape(href)}" style="color:#e5c78d;font-weight:bold">View Matchup</a></td></tr></table></td></tr>${rows}</table>`;
}
function offerEmail(offer:NonNullable<EmailEdition["offers"]>[number],board:EmailBoard){
 const decimal=offer.base??(offer.picks?.length?offer.picks.reduce((value,pick)=>value*(1+(pick.odds>0?pick.odds/100:100/Math.abs(pick.odds))),1):undefined);
 const american=(value:number)=>Math.round(value>=2?(value-1)*100:-100/(value-1));
 const prices=decimal&&decimal>1?`<del style="color:#b2c4b7;font-size:12px">${formatOdds(american(decimal))}</del><br><strong style="color:#e5c78d;font-size:17px">${formatOdds(american(1+(decimal-1)*(1+offer.percent/100)))}</strong>`:"";
 const href=new URL(board.path+"/matchups?offer="+encodeURIComponent(offer.slot),board.origin).href;
 return `<a href="${escape(href)}" aria-label="${escape("View "+offer.title)}" style="display:block;text-decoration:none;color:#f1f4ee;margin-bottom:16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="border:1px solid #345046;border-radius:8px"><tr><td style="padding:14px;font-size:14px;line-height:1.5;color:#f1f4ee"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="30" valign="top">${emailIcon("gift-gold",24,board.origin)}</td><td valign="top" style="color:#f1f4ee"><strong>${escape(offer.title)}</strong><div style="color:#e5c78d;font-size:12px">${offer.percent}% Profit Boost</div></td><td align="right" valign="top" style="padding-left:10px;white-space:nowrap">${prices}</td></tr></table>${(offer.picks??[]).map(p=>`<div style="margin-top:10px;color:#f1f4ee">${escape(p.label)} <span style="color:#b2c4b7">${formatOdds(p.odds)}</span></div>`).join("")}</td></tr></table></a>`;
}
function openingBalance(edition:EmailEdition){
 if(edition.balance==null)return "";
 const amount=(value:number,gold=false)=>`<span style="color:${gold?"#e5c78d":"#f1f4ee"};font-weight:bold;white-space:nowrap"><span aria-label="Credits" style="padding-right:6px">◈</span>${Number(value).toFixed(2)}</span>`;
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px"><tr><td style="padding:8px 0;font-size:14px;color:#b2c4b7">Current Balance</td><td align="right" style="padding:8px 0;font-size:16px">${amount(edition.balance)}</td></tr>${Number(edition.claim)>0?`<tr><td style="padding:4px 0 8px;font-size:13px;color:#e5c78d">Ready To Claim</td><td align="right" style="padding:4px 0 8px;font-size:15px">${amount(edition.claim!,true)}</td></tr>`:""}</table>`;
}
type RecapFact={id:string;title:string;body:string;priority:number;personal:boolean};
type HighlightDetails={teams:{name:string;avatar?:string|null;score?:number}[];metrics:Record<string,string|number>};
function recapFactDetails(fact:RecapFact,board:EmailBoard):HighlightDetails{
 const edition=board.edition??{},context=edition.recapStats??{};
 const findTeam=(name:string,id?:string)=>{
  const team=[...(board.teams??[]),...(edition.resultTeams??[])].find(team=>id?team.id===id:team.name===name);
  return {name,avatar:team?.avatar};
 };
 const details:HighlightDetails={teams:[],metrics:{}};
 const scorer=context.highScorer;
 if((fact.id==="scoring-record"||fact.id==="high-scorer")&&scorer){
  details.teams=[{...findTeam(scorer.name,scorer.teamId),score:scorer.score}];
  if(fact.id==="scoring-record"&&scorer.previousRecord!=null)
   details.metrics={"Previous Record":scorer.previousRecord.toFixed(2),"Record Increase":(scorer.score-scorer.previousRecord).toFixed(2)+" points"};
 }
 if(fact.id==="underdog-win"){
  const own=edition.resultTeams?.find(team=>team.id===board.team?.id);
  const opponent=edition.resultTeams?.find(team=>team.id!==board.team?.id);
  const quote=edition.openingQuotes?.find(quote=>quote.kind==="moneyline"&&quote.teamId===own?.id);
  details.teams=(edition.resultTeams??[]).map(team=>({...findTeam(team.name,team.id),score:team.observed}));
  if(own?.observed!=null&&opponent?.observed!=null)
   details.metrics={"Winning Margin":(own.observed-opponent.observed).toFixed(2)+" points",...(quote?{"Moneyline Benchmark":formatOdds(quote.odds)}:{})};
 }
 const game=fact.id==="league-upset"?context.biggestUpset:fact.id==="close-matchup"?context.closestMatchup:undefined;
 if(game){
  details.teams=[{...findTeam(game.winner),score:game.winnerScore},{...findTeam(game.loser),score:game.loserScore}];
  details.metrics={"Winning Margin":(game.winnerScore-game.loserScore).toFixed(2)+" points",
   ...("odds" in game?{"Moneyline Benchmark":formatOdds(game.odds)}:{})};
 }
 if(["long-parlay","longshot","near-miss"].includes(fact.id)){
  const tickets=edition.tickets??[];
  const ticket=fact.id==="long-parlay"?[...tickets].filter(ticket=>ticket.status.toLowerCase()==="won"&&ticket.legs.every(leg=>leg.status.toLowerCase()==="won")).sort((a,b)=>b.legs.length-a.legs.length)[0]:
   fact.id==="longshot"?[...tickets].filter(ticket=>ticket.status.toLowerCase()==="won"&&ticket.legs.every(leg=>leg.status.toLowerCase()==="won")).sort((a,b)=>b.odds-a.odds)[0]:
   tickets.find(ticket=>ticket.status.toLowerCase()==="lost"&&ticket.legs.filter(leg=>leg.status.toLowerCase()==="lost").length===1&&ticket.legs.filter(leg=>leg.status.toLowerCase()==="won").length>=2&&ticket.legs.every(leg=>leg.status.toLowerCase()!=="open"));
  if(ticket){
   const seen=new Map<string,{name:string;avatar?:string|null}>();
   for(const leg of ticket.legs)for(const team of leg.game?.teams??leg.result?.teams??[])seen.set(team.name,{name:team.name,avatar:team.avatar});
   details.teams=[...seen.values()].slice(0,4);
   details.metrics=fact.id==="near-miss"?{"Winning Legs":ticket.legs.filter(leg=>leg.status.toLowerCase()==="won").length,"Lost Legs":ticket.legs.filter(leg=>leg.status.toLowerCase()==="lost").length}:
    {"Stake":credits(ticket.stake),"Net Profit":credits((ticket.actualReturn??ticket.potentialReturn)-ticket.stake)};
  }
 }
 if(fact.id==="unbeaten"){
  if(board.team)details.teams=[findTeam(board.team.name,board.team.id)];
  details.metrics={"Tickets Won":Number(edition.performance?.Won??0),"Net Profit":String(edition.performance?.["Net Profit"]??"—")};
 }
 if(fact.id==="tied-matchup"){
  details.teams=[{name:board.leagueName,avatar:board.leagueAvatar}];
  details.metrics={"Tied Matchups":context.tiedMatchups??0};
 }
 if(fact.id==="big-ticket"&&context.largestWin){
  details.metrics={"Winning Legs":context.largestWin.legs,"Accepted Odds":formatOdds(context.largestWin.odds),"Net Profit":credits(context.largestWin.profit)};
 }
 return details;
}
export function buildRecapFacts(board:EmailBoard){
 const edition=board.edition??{},context=edition.recapStats??{},tickets=edition.tickets??[];
 const candidates:RecapFact[]=[];
 const wins=tickets.filter(ticket=>ticket.status.toLowerCase()==="won");
 const longParlay=[...wins].filter(ticket=>ticket.legs.length>=5&&ticket.legs.every(leg=>leg.status.toLowerCase()==="won")).sort((a,b)=>b.legs.length-a.legs.length)[0];
 const longshot=[...wins].filter(ticket=>ticket.odds>=500&&ticket.legs.every(leg=>leg.status.toLowerCase()==="won")).sort((a,b)=>b.odds-a.odds)[0];
 const won=Number(edition.performance?.Won),lost=Number(edition.performance?.Lost),open=Number(edition.performance?.["Still Open"]??0);
 if(longParlay)candidates.push({id:"long-parlay",title:"Five Or More Legs",body:`Your ${longParlay.legs.length}-leg parlay won at ${formatOdds(longParlay.odds)}.`,priority:90,personal:true});
 if(longshot&&longshot.id!==longParlay?.id)candidates.push({id:"longshot",title:"Longshot Win",body:`You hit a winning ticket at ${formatOdds(longshot.odds)}, returning ${credits(longshot.actualReturn??longshot.potentialReturn)}.`,priority:85,personal:true});
 if(won>=3&&lost===0&&open===0)candidates.push({id:"unbeaten",title:"Unbeaten Betting Week",body:`You won ${won} tickets without a loss this week.`,priority:80,personal:true});
 const nearMiss=!wins.length?tickets.find(ticket=>ticket.status.toLowerCase()==="lost"&&ticket.legs.every(leg=>leg.status.toLowerCase()!=="open")&&ticket.legs.filter(leg=>leg.status.toLowerCase()==="lost").length===1&&ticket.legs.filter(leg=>leg.status.toLowerCase()==="won").length>=2):undefined;
 if(nearMiss)candidates.push({id:"near-miss",title:"Parlay Near Miss",body:`One leg lost on a ${nearMiss.legs.length}-leg ticket with ${nearMiss.legs.filter(leg=>leg.status.toLowerCase()==="won").length} winning selections.`,priority:65,personal:true});
 const own=edition.resultTeams?.find(team=>team.id===board.team?.id),opponent=edition.resultTeams?.find(team=>team.id!==board.team?.id);
 const ownMoneyline=edition.openingQuotes?.find(quote=>quote.kind==="moneyline"&&quote.teamId===own?.id);
 if(own?.observed!=null&&opponent?.observed!=null&&own.observed>opponent.observed&&ownMoneyline&&ownMoneyline.odds>0)
  candidates.push({id:"underdog-win",title:"Your Team Beat The Odds",body:`${own.name} won ${own.observed.toFixed(2)}–${opponent.observed.toFixed(2)} against a ${formatOdds(ownMoneyline.odds)} moneyline benchmark.`,priority:75,personal:true});
 const scorer=context.highScorer;
 const record=!!scorer&&scorer.previousRecord!=null&&scorer.score>scorer.previousRecord;
 if(record)candidates.push({id:"scoring-record",title:"New Season Scoring Record",body:`${scorer!.name} scored ${scorer!.score.toFixed(2)}, passing the previous season high of ${scorer!.previousRecord!.toFixed(2)}.`,priority:100,personal:scorer!.teamId===board.team?.id});
 if(scorer&&!record)candidates.push({id:"high-scorer",title:"Weekly High Scorer",body:`${scorer.name} led the league with ${scorer.score.toFixed(2)}.`,priority:scorer.teamId===board.team?.id?70:35,personal:scorer.teamId===board.team?.id});
 const upset=context.biggestUpset;
 if(upset&&!candidates.some(fact=>fact.id==="underdog-win"&&upset.winner===own?.name))candidates.push({id:"league-upset",title:"Upset Of The Week",body:`${upset.winner} beat ${upset.loser} ${upset.winnerScore.toFixed(2)}–${upset.loserScore.toFixed(2)} against a ${formatOdds(upset.odds)} moneyline benchmark.`,priority:78,personal:false});
 const close=context.closestMatchup;
 if(close&&close.margin>0&&close.margin<=5)candidates.push({id:"close-matchup",title:"Closest Matchup",body:`${close.winner} edged ${close.loser} ${close.winnerScore.toFixed(2)}–${close.loserScore.toFixed(2)}, a ${close.margin.toFixed(2)}-point margin.`,priority:50,personal:false});
 if(Number(context.tiedMatchups)>0)candidates.push({id:"tied-matchup",title:"A Tie On The Slate",body:`${context.tiedMatchups} matchup${context.tiedMatchups===1?"":"s"} finished level this week.`,priority:82,personal:false});
 const largest=context.largestWin;
 if(largest&&largest.profit>=50)candidates.push({id:"big-ticket",title:"Biggest Ticket Profit",body:`${largest.name} earned ${credits(largest.profit)} in net profit from a ${largest.legs}-leg ticket. Accepted odds ${formatOdds(largest.odds)}.`,priority:60,personal:false});
 let personal=0;
 return candidates.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).filter(fact=>!fact.personal||++personal<=2).slice(0,3);
}
function recapHighlights(board:EmailBoard){
 const highlights=buildRecapFacts(board);
 if(!highlights.length)return "";
 return sectionHeading("Week Highlights")+highlights.map(fact=>{
  const details=recapFactDetails(fact,board);
  const teams=details.teams.length?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0">${details.teams.map(team=>`<tr><td width="40" style="padding:5px 8px 5px 0">${avatarHtml(team.name,team.avatar,32)}</td><td style="padding:5px 0;font-size:14px;color:#f1f4ee;font-weight:bold">${escape(team.name)}</td>${team.score!=null?`<td align="right" style="padding:5px 0 5px 10px;font-size:14px;font-weight:bold;color:#f1f4ee">${team.score.toFixed(2)}</td>`:""}</tr>`).join("")}</table>`:"";
  const metrics=Object.keys(details.metrics).length?facts(details.metrics,undefined,0):"";
  const body=teams&&metrics&&["scoring-record","underdog-win","league-upset","close-matchup"].includes(fact.id)?"":`<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#e2e9df">${escape(fact.body)}</p>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="margin:0 0 14px;border:1px solid #345046;border-radius:8px"><tr><td style="padding:14px;font-size:14px;line-height:1.5;color:#f1f4ee"><strong style="color:#e5c78d">${escape(fact.title)}</strong>${teams}${metrics}${body}</td></tr></table>`;
 }).join("");
}
function editionSections(kind:NotificationEvent,board:EmailBoard){
 const edition=board.edition??{},quotes=(edition.quotes??[]).filter(q=>["moneyline","spread","match_total"].includes(q.kind)&&!q.alternate);
 const own=board.matchups?.find(pair=>pair.some(t=>t.id===board.team?.id));
 const featured=board.matchups?.filter(pair=>quotes.some(q=>q.matchup===String(pair[0].matchupId)&&q.featured));
 if(kind==="settled")return (edition.tickets??[]).map(t=>renderEmailTicket(t,board,false)).join("");
 if(kind==="credit")return facts({
  ...(edition.claim!=null?{"Available Claim":credits(edition.claim)}:{}),
  ...(edition.balance!=null?{"Current Balance":credits(edition.balance)}:{}),
  ...(edition.openStakes!=null?{"Open Non-Future Stakes":credits(edition.openStakes)}:{}),
  ...(edition.futureStakes!=null?{"Open Future Stakes":credits(edition.futureStakes)}:{}),
 },"Available Claim");
 if(kind==="opening"){
  const featuredCards=(featured??[]).slice(0,2).map(pair=>matchupEmail(pair,board,quotes,quotes.find(q=>q.matchup===String(pair[0].matchupId)&&q.featured)?.featured??"Featured Matchup","opening")).join("");
  const offers=(edition.offers??[]).slice(0,2).map(offer=>offerEmail(offer,board)).join("");
  const rewards=(edition.rewards??[]).map(reward=>`<a href="${escape(new URL(board.path+"/matchups?boosts=1",board.origin).href)}" aria-label="${escape("View "+reward.label+" Reward")}" style="display:block;text-decoration:none;color:#f1f4ee;margin-bottom:16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="border:1px solid #345046;border-radius:8px"><tr><td width="32" style="padding:14px 0 14px 14px">${emailIcon("gift-gold",24,board.origin)}</td><td style="padding:14px;font-size:14px;line-height:1.5;color:#f1f4ee"><strong>${escape(reward.label)}</strong></td><td align="right" style="padding:14px;font-size:14px;color:#e5c78d">${reward.percent}% Profit Boost</td></tr></table></a>`).join("");
  return openingBalance(edition)+
   (own?matchupEmail(own,board,quotes,"Your Matchup","opening"):"")+
   (featuredCards?sectionHeading("Featured Matchups")+featuredCards:"")+
   (offers?sectionHeading("This Week’s Offers")+offers:"")+
   (rewards?sectionHeading("Your Fantasy Rewards")+rewards:"");
 }
 const tickets=edition.tickets??[];
 if(kind==="monday_watch"){
  const ordered=["open","won","lost","push","voided"];
  return ordered.map(status=>{
   const group=tickets.filter(t=>t.status.toLowerCase()===status);
   if(!group.length)return "";
   const remaining=group.reduce((sum,t)=>sum+t.legs.filter(l=>l.status.toLowerCase()==="open").length,0);
   const blurb=status==="open"?`You have ${group.length} open ticket${group.length===1?"":"s"} with ${remaining} open selection${remaining===1?"":"s"}. ${group.some(t=>t.legs.some(l=>l.status.toLowerCase()==="lost"))?"A lost leg prevents a parlay win. Remaining outcomes may still need confirmation.":"The remaining selections must hit for their tickets to win. Pushes can change the return."}`:"";
   return sectionHeading(status==="open"?"Your Open Tickets":status==="won"?"Tickets Won":status==="lost"?"Tickets Lost":"Stakes Returned")+
    (blurb?`<p style="margin:0 0 16px;font-size:14px;line-height:1.6">${blurb}</p>`:"")+group.map(t=>renderEmailTicket(t,board)).join("");
  }).join("")+(own&&Math.abs(Number(own[0].observed??0)-Number(own[1].observed??0))<=10?matchupEmail(own,board,quotes,"Your Matchup"):"")+
   (edition.recommendations?.length?sectionHeading("Available Monday Markets")+edition.recommendations.map(p=>`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="border:1px solid #345046;border-radius:8px;margin-bottom:16px"><tr><td style="padding:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="48" valign="top">${p.headshot?avatarHtml(p.label,p.headshot,36):emailIcon("user-gold",32,board.origin)}</td><td style="font-size:14px;line-height:1.5"><strong>${escape(p.label)}</strong><div style="color:#b2c4b7;margin-top:5px">${escape(capitalizeEmail(p.kind.replaceAll("_"," ")))}${p.projection!=null?" · Projected "+Number(p.projection).toFixed(1):""}</div><div style="margin-top:5px;color:#e5c78d">${formatOdds(p.odds)}</div>${p.kickoff?`<div style="color:#b2c4b7;font-size:12px;margin-top:5px">${escape(new Date(p.kickoff).toLocaleString("en-US",{timeZone:"America/New_York",weekday:"short",hour:"numeric",minute:"2-digit",timeZoneName:"short"}))}</div>`:""}</td></tr></table>${emailAction("View Market",new URL(board.path+"/matchups?tab="+encodeURIComponent(p.kind==="player_h2h"?"Player Head-To-Head":"Player Points & Milestones"),board.origin).href)}</td></tr></table>`).join(""):"")+
   ((edition.offers??[]).length?sectionHeading("Monday Offers")+(edition.offers??[]).slice(0,2).map(o=>offerEmail(o,board)).join(""):"");
 }
 if(kind==="recap"){
  const wins=tickets.filter(t=>t.status.toLowerCase()==="won").sort((a,b)=>(b.actualReturn??0)-b.stake-((a.actualReturn??0)-a.stake));
  const closest=[...tickets].filter(t=>t.status.toLowerCase()!=="open").sort((a,b)=>a.legs.filter(l=>l.status.toLowerCase()!=="won").length-b.legs.filter(l=>l.status.toLowerCase()!=="won").length);
  const highlight=wins[0]??closest[0];
  const results=edition.resultTeams;
  const finalPair=results?.length===2?results as [EmailTeam,EmailTeam]:null;
  return (edition.performance?sectionHeading("Your Betting Performance")+facts(edition.performance):"")+
   (highlight?sectionHeading(wins.length?"Your Best Win":"Your Closest Ticket")+(!wins.length?`<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Selected by the fewest unsuccessful legs.</p>`:"")+renderEmailTicket(highlight,board):"")+
   (finalPair?sectionHeading("Your Sleeper Matchup")+matchupEmail(finalPair,board,edition.openingQuotes??[],"Final Score And Opening Odds","final"):"")+
   (edition.crowd&&Object.keys(edition.crowd).length?sectionHeading("Betting On Your Matchup")+facts(edition.crowd):"")+
   (edition.marketBets?.length?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px">${edition.marketBets.map(row=>`<tr><td style="padding:8px 8px 8px 0;font-size:14px;line-height:1.5"><strong>${escape(row.selection)}</strong><div style="color:#b2c4b7;font-size:12px">${escape(row.market)}</div></td><td align="right" style="font-size:14px;white-space:nowrap">${row.tickets} ticket${row.tickets===1?"":"s"}</td></tr>`).join("")}</table>`:"")+
   (edition.leagueBetting?sectionHeading("League Betting")+facts(edition.leagueBetting):"")+
   recapHighlights(board);
 }
 return "";
}

export function renderSignInPrototype(origin:string,minutes:number,withDetails:boolean,leagueName?:string,board?:EmailBoard){
 withDetails=true; // Compatibility with old callers; emails now have one full format.
 const signIn=new URL("/sign-in",origin).href;
 return renderPrototype({
  subject:"Your Boff Sign-In Link",preview:"Open Boff with a single-use sign-in link.",label:"Account Access",
  heading:"Sign in to Boff",context:board?undefined:leagueName,board,message:"Open the link in the browser where you want to use Boff.",
  action:"Sign In To Boff",href:signIn,...palettes.credit,
  rows:withDetails?[["Link Valid For",minutes+" minutes"],["Access","Approved league account"]]:[],
  footerHeading:"About this link",
  footerText:`The sign-in link expires after ${minutes} minutes and can be used once. If you did not request a sign-in, do not open the link.`,
  footerLink:"Request A New Link",footerHref:signIn,
 });
}

export function renderLeagueInvitation(input:{
 leagueName:string; teamName:string; role:"Manager"|"Primary Manager"|"Co-Manager"; url:string; existingAccount:boolean;
 commissioner?:string; expires?:string; board?:EmailBoard;
}){
 const destination=new URL(input.url);
 if(destination.protocol!=="https:" && !(destination.protocol==="http:" && destination.hostname==="127.0.0.1"))
  throw Error("League invitation requires a secure link.");
 const openLeague=input.existingAccount;
 return renderPrototype({
  ...palettes.markets,subject:`You’ve Been Invited To Boff · ${input.leagueName}`,
  preview:`Your commissioner linked you to ${input.teamName} on Boff.`,label:"League Invitation",
  heading:openLeague?"Join your league on Boff":"Join your league on Boff",context:input.board?undefined:input.leagueName,board:input.board,
  message:openLeague?"Your commissioner invited you to join this team. Sign in with the email address that received this message and accept your invitation.":`Your fantasy league has its own virtual-credit sportsbook. Verify your email and accept your invitation to connect to ${input.teamName}.`,
  sections:openLeague?"":[
   {title:"Back Your Team",accent:"#e5c78d",body:"Pick moneylines, spreads, and totals for "+input.teamName+" and the rest of your league.",tags:"Moneyline &nbsp; · &nbsp; Spread &nbsp; · &nbsp; Total"},
   {title:"Build Your Ticket",accent:"#add7db",body:"Choose a single bet or combine picks into a parlay. Explore player head-to-head bets and fantasy scoring milestones based on real NFL player results, plus eligible profit boosts.",tags:"Single Bets &nbsp; · &nbsp; Parlays &nbsp; · &nbsp; Boosts"},
   {title:"Follow The Season",accent:"#aed0b8",body:"Explore season futures, from league champion and playoff chances to season win totals. Available markets follow your league’s format and rules.",tags:"Season Futures &nbsp; · &nbsp; Playoff Markets"},
   {title:"Compete With Your Leaguemates",accent:"#d2c6eb",body:"Follow your tickets as games unfold. Track your credits and net profit on the Boff standings.",tags:"Live Results &nbsp; · &nbsp; Boff Standings"},
  ].map(card=>`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#102b24" style="margin:0 0 16px;border:1px solid #345046;border-left:3px solid ${card.accent};border-radius:6px"><tr><td style="padding:16px;font-size:14px;line-height:1.6"><h2 style="margin:0 0 8px;font-size:17px;color:${card.accent}">${card.title}</h2><p style="margin:0 0 12px">${escape(card.body)}</p><div style="color:${card.accent};font-size:13px">${card.tags}</div></td></tr></table>`).join("")+sectionHeading("Get Started")+`<p style="font-size:14px;line-height:1.7;margin:0 0 20px">Accept your invitation, verify your email, and open your league. The Guide walks you through choosing picks and placing your first ticket.</p>`,
  sectionText:openLeague?undefined:"Matchup Markets · Moneylines, spreads and totals for your league.\nPlayer Fantasy Results · Player head-to-head bets and fantasy scoring milestones based on real NFL results.\nSeason Futures · League champion, playoffs and season win totals, where supported by your league rules.\nBoff Standings · Follow your credits and net profit against your leaguemates.",
  rows:[["Sleeper Team",input.teamName],["Role",input.role],
   ...(input.commissioner?[["Commissioner",input.commissioner] as [string,string]]:[]),
   ...(input.expires?[["Invitation Expires",input.expires] as [string,string]]:[])],
  action:"Accept Invitation",href:destination.href,
  footerHeading:"About League Access",
  footerText:"Boff uses virtual credits. Wallet approval is separate. If you weren’t expecting this invitation, contact your commissioner.",
  footerLink:"Open Boff",footerHref:new URL("/",destination).href,
 });
}

export function renderNotificationEmail(kind:NotificationEvent,withDetails:boolean,details:NotificationDetail,origin:string,pathPrefix:string,leagueName="Your Boff league",board?:EmailBoard){
 withDetails=true; // Retain the call signature without retaining a brief template.
 const event=notificationEvents[kind];
 const href=new URL(pathPrefix+"/"+event.page,origin).href;
 const preferences=new URL(pathPrefix+"/profile?section=communications",origin).href;
 const rows=withDetails?Object.entries(details).filter(([key,value])=>key!=="Week"&&value!=null):[];
 const palette=palettes[kind==="settled"&&rows.some(([label,value])=>label==="Result"&&String(value).toLowerCase()==="lost")?"loss":eventPalette[kind]];
 const context=details.Week!=null?[board?null:leagueName,`Week ${details.Week}`].filter(Boolean).join(" · "):board?undefined:leagueName;
 return renderPrototype({
  ...palette,subject:capitalizeEmail(emailTypeLabels[kind as keyof typeof emailTypeLabels]??event.subject)+" · "+leagueName,preview:event.message,label:event.label,
  heading:emailTypeLabels[kind as keyof typeof emailTypeLabels]??event.subject,context,
  board:board?{...board,matchups:[],standings:[]}:undefined,detailed:withDetails,
  message:["opening","settled","credit","recap","monday_watch"].includes(kind)?"":event.message,
  action:event.action,href,rows:board?.edition?[]:rows,
  sections:withDetails&&board?editionSections(kind,board):"",
  sectionText:withDetails&&board?.edition?[
   ...(board.edition.tickets??[]).map(t=>`Ticket ${t.id} · ${t.status} · Stake ${credits(t.stake)}\n${t.legs.map(l=>emailLegText(l)).join("\n")}`),
   ...(board.edition.offers??[]).map(o=>o.title+" · "+o.percent+"% Profit Boost\n"+(o.picks??[]).map(p=>p.label+" · "+formatOdds(p.odds)).join("\n")+"\n"+new URL(board.path+"/matchups?offer="+encodeURIComponent(o.slot),board.origin).href),
   ...(board.edition.rewards??[]).map(r=>r.label+" · "+r.percent+"% Profit Boost"),
   ...(kind==="opening"||kind==="monday_watch"?(board.matchups??[]).filter(pair=>pair.some(t=>t.id===board.team?.id)||(board.edition?.quotes??[]).some(q=>q.featured&&q.matchup===String(pair[0].matchupId))).map(pair=>pair.map(t=>t.name+(kind==="opening"?" · Projected "+Number(t.pregameProjection??t.projection??0).toFixed(1):" · Score "+Number(t.observed??0).toFixed(1))).join(" vs. ")+"\n"+(board.edition?.quotes??[]).filter(q=>q.matchup===String(pair[0].matchupId)).map(q=>(q.label??q.kind)+" · "+quotedOdds(q)).join("\n")):[]),
   ...(board.edition.resultTeams??[]).map(t=>t.name+" · Final Score "+Number(t.observed??0).toFixed(1)),
   ...(board.edition.openingQuotes??[]).map(q=>(q.label??q.kind)+" · Opening Odds "+formatOdds(q.odds)),
   ...Object.entries(board.edition.performance??{}).map(([key,value])=>key+": "+value),
   ...Object.entries(board.edition.crowd??{}).map(([key,value])=>key+": "+value),
   ...(board.edition.marketBets??[]).map(row=>row.selection+" · "+row.tickets+" tickets"),
   ...Object.entries(board.edition.leagueBetting??{}).map(([key,value])=>key+": "+value),
   ...(kind==="recap"?buildRecapFacts(board).map(fact=>fact.title+": "+fact.body):[]),
   ...(board.edition.balance!=null?["Current Balance: "+(kind==="opening"?"◈ "+Number(board.edition.balance).toFixed(2):credits(board.edition.balance))]:[]),
   ...(["opening","credit"].includes(kind)&&Number(board.edition.claim)>0?[(kind==="opening"?"Ready To Claim: ":"Available Claim: ")+credits(board.edition.claim!)]:[]),
   ...(kind==="credit"?["Open Non-Future Stakes: "+credits(board.edition.openStakes??0),"Open Future Stakes: "+credits(board.edition.futureStakes??0)]:[]),
  ].join("\n\n"):undefined,
  footerHeading:"About This Email",
  footerText:`You received this because ${event.label} emails are enabled for this league. Boff uses virtual credits.`,
  footerLink:"Manage Email Preferences",footerHref:preferences,
 });
}

export function renderAccountEmail(kind:"confirmation"|"attention",board:EmailBoard,details:Record<string,string|number>,ticket?:EmailTicket){
 const admin=kind==="attention";
 const identity=admin?{...board,team:undefined}:board;
 const href=new URL(board.path+(admin?"/commissioner":"/my-bets"+(ticket?"?ticket="+encodeURIComponent(ticket.id):"")),board.origin).href;
 return renderPrototype({
  ...palettes[admin?"loss":"results"],subject:(admin?"Admin Review Needed":"Bet Confirmation")+" · "+board.leagueName,
  preview:admin?"An issue in your league needs review.":"Your ticket has been accepted.",
  label:"",heading:admin?"Admin Review Needed":"Bet Confirmation",message:admin?String(details.Context??details.Issue??""):"",board:identity,
  action:admin?"Review Issue":"View Your Bet",href,context:details.Week!=null?`Week ${details.Week}`:undefined,
  hideAction:!admin&&!!ticket,
  rows:ticket?[]:Object.entries(details).filter(([key])=>!["Context","Issue"].includes(key)),
  sections:ticket?renderEmailTicket(ticket,board,!admin,admin):"",
  sectionText:ticket?[ticket.id,...ticket.legs.map(l=>emailLegText(l))].join("\n"):undefined,
  footerHeading:board.leagueName,footerText:"Boff uses virtual credits.",
  footerLink:"Open League",footerHref:new URL(board.path+"/league",board.origin).href,
 });
}
