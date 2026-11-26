import {createEmailBoard,renderNotificationEmail,type EmailBoard,type EmailEdition} from "./notification-templates.ts";
import {emailTheme} from './email-theme.ts';

export const switchableEmailKinds=["opening","recap","monday_watch","credit"] as const;
export type SwitchableEmailKind=typeof switchableEmailKinds[number];
export type LeagueEmail={id:string;name:string;path:string;week:number;details:boolean;teamId?:string;payload:Parameters<typeof createEmailBoard>[0];edition?:EmailEdition};
export type LeagueEmailOption={id:string;name:string;path:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export const isSwitchableEmail=(kind:string):kind is SwitchableEmailKind=>(switchableEmailKinds as readonly string[]).includes(kind);
export function emailReaderUrl(origin:string,kind:string,league:string,week:number){
 const url=new URL("/communications",origin);
 url.search=new URLSearchParams({kind,league,week:String(week)}).toString();
 return url.href;
}
export function leagueEmailBoard(row:LeagueEmail,origin:string):EmailBoard{
 return {...createEmailBoard(row.payload,[],origin,row.path,row.teamId,row.name),edition:row.edition,
  switcherUrl:emailReaderUrl(origin,"opening",row.id,row.week)};
}
export function renderLeagueReport(row:LeagueEmail,kind:SwitchableEmailKind,origin:string){
 const board=leagueEmailBoard(row,origin);
 board.switcherUrl=emailReaderUrl(origin,kind,row.id,row.week);
 return renderNotificationEmail(kind,true,{Week:row.week},origin,row.path,row.name,board);
}
export function readerDropdown(html:string,options:LeagueEmailOption[],selected:string){
 const select=`<label style="display:block;font-size:11px;color:#b2c4b7;margin-bottom:4px" for="league-focus">League</label><select id="league-focus" aria-label="League Of Focus" style="box-sizing:border-box;width:100%;max-width:100%;padding:8px 28px 8px 10px;border:1px solid #527364;border-radius:6px;background:#17392f;color:#f1f4ee;font:700 14px Public Sans,Arial,sans-serif">${options.map(option=>`<option value="${escape(option.id)}"${option.id===selected?" selected":""}>${escape(option.name)}</option>`).join("")}</select>`;
 return html.replace("<head>",'<head><base target="_top">').replace(/<!--league-focus-->[\s\S]*?<!--\/league-focus-->/,emailTheme(select,false));
}
function ampBody(html:string){
 return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)![1]
  .replace(/<!--[\s\S]*?-->/g,"")
  .replace(/<img\b([^>]*)>/gi,(_all,attrs:string)=>`<amp-img${attrs} layout="fixed"></amp-img>`)
  .replace(/mso-[\w-]+:[^;"}]+;?/g,"")
  .replace(/<a\b(?![^>]*\btarget=)/g,'<a target="_blank"');
}
/** No live/private-data endpoint in the email: only the recipient's authorized report sections. */
export function renderLeagueSwitcherEmail(rows:LeagueEmail[],kind:SwitchableEmailKind,origin:string,primaryId:string){
 const ordered=[...rows].sort((a,b)=>Number(b.id===primaryId)-Number(a.id===primaryId));
 if(!ordered.length||ordered[0].id!==primaryId)throw Error("No authorized primary league report");
 const primary=ordered[0],fallback=renderLeagueReport(primary,kind,origin);
 // Keep the AMP part under its 200 KB limit. Every league remains available in the web reader.
 let bytes=0;
 const reports=ordered.slice(0,12).map(row=>{
  const message=renderLeagueReport(row,kind,origin);
  const full={...row,details:true};
  if(new TextEncoder().encode(message.html).length<=120000)return {row:full,message};
  // Preserve rich content for large reports instead of reverting to a brief email.
  const bounded={...full,edition:{...row.edition,tickets:row.edition?.tickets?.slice(0,1),offers:row.edition?.offers?.slice(0,2),recommendations:row.edition?.recommendations?.slice(0,3)}};
  return {row:bounded,message:renderLeagueReport(bounded,kind,origin)};
 }).filter(({message},index)=>{
  const size=new TextEncoder().encode(message.html).length;
  if(bytes+size>120000&&index>0)return false;
  bytes+=size;return true;
 });
 const options=(selected:number)=>reports.map(({row},index)=>`<div role="option" option="${index}"${index===selected?" selected":""} style="padding:10px 12px;border-bottom:1px solid #345046">${escape(row.name)}</div>`).join("");
 const state=JSON.stringify({league:"0",menu:false}).replaceAll("<","\\u003c");
 const panels=reports.map(({row,message},index)=>{
  const selector=`<button type="button" aria-label="Switch League" on="tap:AMP.setState({focus:{menu: !focus.menu}})" style="display:block;width:100%;border:0;padding:6px 0;background:#214438;color:#f1f4ee;text-align:left;font:700 15px Public Sans,Arial,sans-serif">${escape(row.name)} <span style="color:#e5c78d">▾</span></button><div hidden [hidden]="!focus.menu" style="margin-top:8px;background:#17392f;border:1px solid #527364;border-radius:6px"><amp-selector role="listbox" aria-label="League Of Focus" on="select:AMP.setState({focus:{league:event.targetOption,menu:false}})">${options(index)}</amp-selector><a href="${escape(emailReaderUrl(origin,kind,row.id,row.week))}" style="display:block;padding:10px 12px;color:#e5c78d">Open Web Version</a></div>`;
  return `<section${index?" hidden":""} [hidden]="focus.league != '${index}'">${ampBody(message.html.replace(/<!--league-focus-->[\s\S]*?<!--\/league-focus-->/,selector))}</section>`;
 }).join("");
 const amp=`<!doctype html><html amp4email data-css-strict lang="en"><head><meta charset="utf-8"><script async src="https://cdn.ampproject.org/v0.js"></script><script async custom-element="amp-bind" src="https://cdn.ampproject.org/v0/amp-bind-0.1.js"></script><script async custom-element="amp-selector" src="https://cdn.ampproject.org/v0/amp-selector-0.1.js"></script><style amp4email-boilerplate>body{visibility:hidden}</style><style amp-custom>body{margin:0;background:#102b24;color:#f1f4ee;font-family:Public Sans,Arial,sans-serif}button{cursor:pointer}amp-selector [option]{cursor:pointer}amp-selector [option]:focus{outline:2px solid #dfbd73}amp-selector [selected]{color:#dfbd73}section[hidden],[hidden]{display:none}</style></head><body><amp-state id="focus"><script type="application/json">${state}</script></amp-state>${panels}</body></html>`;
 return {...fallback,text:fallback.text+"\n\nSwitch Leagues: "+emailReaderUrl(origin,kind,primary.id,primary.week),amp,leagues:reports.map(({row})=>({id:row.id,details:row.details}))};
}
