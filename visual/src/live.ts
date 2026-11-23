import {createClient} from '@supabase/supabase-js';
import {environment} from './environment';
export const auth=createClient(`https://${environment.projectRef}.supabase.co`,environment.publishableKey);
export const live=()=>typeof window!=='undefined'?(window as any).__boffLive:null;
export async function bookSection(parameters:Record<string,string>,signal?:AbortSignal){
 const {data:{session}}=await auth.auth.getSession();if(!session)throw Error('Sign in to your account');
 const r=await fetch('/api/book?'+new URLSearchParams(parameters),{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal});
 const data=await r.json();if(!r.ok)throw Error(data.error??'Unable to load history');return data;
}
export async function bookRequest(body?:unknown,pricesOnly=false,ticketId="",account=false,offersVersion?:string){
 const {data:{session}}=await auth.auth.getSession();if(!session)throw Error('Sign in to your account');
 const query=new URLSearchParams();
 if(ticketId)query.set("ticket",ticketId);
 if(pricesOnly){
  query.set("prices","1");
  const current=live();
  if(current?.version)query.set("version",current.version);
  const futures=current?.futuresBoard;
  if(futures)query.set("futures",`${futures.id}:${futures.revision}:${futures.status}`);
  if(account)query.set("account","1");
  if(offersVersion)query.set("offers",offersVersion);
 }
 const r=await fetch('/api/book'+(query.size?'?'+query:''),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',...(!body?{signal:AbortSignal.timeout(30000)}:{})});
 const result=await r.json();
 if(!r.ok)throw Error(result.error||'Unable to connect');
 return result;

}
function mergeRows(rows:any[],changes:{upsert:any[];remove:string[]}){
 const byId=new Map(rows.map(row=>[String(row.id),row]));
 for(const id of changes.remove)byId.delete(id);
 for(const row of changes.upsert)byId.set(String(row.id),row);
 return [...byId.values()];
}
export function mergeBookUpdate(before:any, update:any){
 if(!update.mode || update.mode==="snapshot")return {...before,...update,futuresQuotes:update.futuresQuotes??before.futuresQuotes};
 const delta=update.changes;
 const payload={...before.book.payload,...delta?.payload};
 if(delta){
  for(const key of delta.payloadRemove)delete payload[key];
  payload.teams=mergeRows(payload.teams,delta.teams);
  payload.players=mergeRows(payload.players,delta.players);
 }
 const {changes,mode,lightweight,futures,...rest}=update;
 return {...before,...rest,book:{...before.book,...update.book,payload},
  quotes:delta?mergeRows(before.quotes,delta.quotes):before.quotes,
  futuresBoard:lightweight?futures:rest.futuresBoard,
  futuresQuotes:rest.futuresQuotes??before.futuresQuotes};
}
export function receipt(t:any,data:any){
 const state=(s:string)=>({WON:'Won',LOST:'Lost',PUSH:'Push',OPEN:'Open',VOIDED:'Voided'}[s]||s);
 const team=data.book.payload.teams.find((x:any)=>x.id===t.team_id);
 return {id:t.id,walletId:t.user_wallet_id,label:t.ticket_legs.length===1?'Single':`${t.ticket_legs.length}-Leg Parlay`,stake:Number(t.stake),odds:t.accepted_combined_odds,status:state(t.status),participant:t.bettor_display_name||team?.manager||team?.name,season:String(t.nfl_season),week:t.market_week,placedAt:Date.parse(t.placed_at),created:`Week ${t.market_week} · ${new Date(t.placed_at).toLocaleString()}`,actualReturn:Number(t.actual_payout),potentialReturn:Number(t.accepted_potential_payout),picks:t.ticket_legs.sort((a:any,b:any)=>a.leg_number-b.leg_number).map((l:any)=>{const c=l.settlement_context||{},future=c.kind?.startsWith('future_');return {id:l.id,label:l.selection,detail:l.market_type,odds:l.accepted_odds,line:l.accepted_line,side:c.side,teamId:c.team_id,group:c.home_team_id&&c.away_team_id?c.home_team_id+':'+c.away_team_id:'specials',family:c.kind,kind:future?'future':c.kind?.startsWith('player_')?'player':'weekly',matchupId:t.market_week===data.board.market_week&&c.home_team_id?String(data.book.payload.teams.find((t:any)=>t.id===c.home_team_id)?.matchupId):undefined,matchupLabel:l.matchup||undefined,result:{status:state(l.status),summary:l.status==='OPEN'?'':l.result_evidence||''}};})};
}
export function currentPick(p:any,data=live()){
 if(p.kind==="future"){
  const q=data?.futuresQuotes?.find((row:any)=>row.id===p.id||row.metadata?.quote_key===p.quoteKey);
  if(!q?.active||data.futuresBoard?.status!=="published"||Date.parse(data.futuresBoard.quote_valid_until)<=Date.now()||Date.parse(q.metadata.cutoff)<=Date.now())return null;
  return {...p,id:q.id,label:q.label,line:q.line??undefined,odds:q.odds,quoteKey:q.metadata.quote_key,decimalOdds:q.odds>0?1+q.odds/100:1+100/Math.abs(q.odds)};
 }
 const q=data?.quotes.find((q:any)=>q.id===p.id||q.metadata?.ui_id===p.id||(q.metadata?.quote_key||q.metadata?.ui_id)===p.quoteKey)
   || (p.detail==="Team Totals"?data?.quotes.find((q:any)=>q.kind==="team_total"&&q.matchup_key===p.matchupId&&p.id.includes(q.team_id)&&p.label.endsWith(q.label)):null)
   || (p.id.startsWith("alternate-")?data?.quotes.find((q:any)=>!q.metadata.alternate&&p.id===`alternate-${q.matchup_key}-${q.kind}-${q.side}-${q.line}`):null);
 if(!q||(q.metadata?.cutoff&&Date.parse(q.metadata.cutoff)<=Date.now()))return null;
 const multiplier=q.odds>0?1+q.odds/100:1+100/Math.abs(q.odds);const boosted=1+(multiplier-1)*(1+(q.boost_pct||0)/100);const odds=boosted>=2?Math.round((boosted-1)*100):-Math.round(100/(boosted-1));
 return {...p,id:q.id,label:q.label,family:q.kind==="player_h2h"?"player_h2h":p.family,quoteKey:q.metadata?.quote_key||q.metadata?.ui_id,odds,decimalOdds:boosted,line:q.line??undefined,originalOdds:q.boost_pct?q.odds:undefined};
}
