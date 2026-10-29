import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorMessage} from './accounts';
import type {BettingTotal,Ticket} from './accounts';
export type FinancialScope={leagueId:string;report:8|9|10|11;season:number;week:number;team:string;revision?:unknown};
export type FinancialPage={totals?:BettingTotal[];rows?:any[];top?:any[];tickets?:Ticket[];total?:number;appearances?:number;maximum?:number;
 by_team?:{team_id:string;credits:number;debits:number}[];next?:Record<string,unknown>|null;as_of?:string;revision?:string;checked_at?:string};
export async function fetchFinancialPage(scope:FinancialScope,cursor:Record<string,unknown>|null,signal:AbortSignal,limit=40):Promise<FinancialPage>{
 if(!supabase)throw new Error('Account service is unavailable.');
 const common={p_league:scope.leagueId,p_team:scope.team||null,p_cursor:cursor,p_limit:limit};
 const result=scope.report===8?await supabase.rpc('account_betting_totals',{p_league:scope.leagueId,p_season:scope.season,p_week:scope.week||null}).abortSignal(signal):
  scope.report===9?await supabase.rpc('account_wallet_report',common).abortSignal(signal):
  await supabase.rpc(scope.report===10?'account_selection_report':'account_open_ticket_report',{...common,p_season:scope.season,p_week:scope.week||null}).abortSignal(signal);
 if(result.error)throw result.error;
 const data:FinancialPage=scope.report===8?{totals:result.data as BettingTotal[]}:result.data as FinancialPage;
 if(!data||(scope.report===8&&!Array.isArray(data.totals))||(scope.report!==8&&(!Number.isSafeInteger(data.total)||Number(data.total)<0))
  ||(scope.report===11?(!Array.isArray(data.tickets)||data.tickets.length>limit||!Array.isArray(data.totals)):
   scope.report!==8&&(!Array.isArray(data.rows)||data.rows.length>limit)))throw new Error('Financial report response is incomplete.');
 if(data.totals&&data.totals.length>128||scope.report===9&&!Array.isArray(data.by_team)||scope.report===10&&(!Array.isArray(data.top)||!Number.isFinite(data.appearances)||!Number.isFinite(data.maximum)))
  throw new Error('Financial report summary is incomplete.');
 return {...data,checked_at:new Date().toISOString()};
}
export function useFinancialReport(scope:FinancialScope|undefined){
 const signature=JSON.stringify(scope?[scope.leagueId,scope.report,scope.report===9?null:scope.season,scope.report===9?null:scope.week,scope.team]:null);
 const [retry,setRetry]=useState(0);const navigationKey=signature+':'+retry;
 const [navigation,setNavigation]=useState<{key:string;revision?:unknown;cursors:(Record<string,unknown>|null)[]}>({key:'',cursors:[null]});
 const cursors=navigation.key===navigationKey&&navigation.revision===scope?.revision?navigation.cursors:[null];
 const cursor=cursors[cursors.length-1],key=navigationKey+JSON.stringify(cursor);
 const [result,setResult]=useState<{key:string;data:FinancialPage|null;busy:boolean;error:string}>({key:'',data:null,busy:false,error:''});
 useEffect(()=>{
  if(!scope)return;
  const controller=new AbortController();let current=true,pending=false;
  const read=async()=>{if(pending)return;pending=true;
   setResult(s=>({key,data:s.key===key?s.data:null,busy:true,error:''}));
   try{const data=await fetchFinancialPage(scope,cursor,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),scope.report===11?20:40);
    if(current)setResult({key,data,busy:false,error:''});
   }catch(e){if(current)setResult({key,data:null,busy:false,error:errorMessage(e)});}finally{pending=false;}
  };
  void read();const interval=setInterval(()=>{if(!document.hidden)void read();},60000);
  return()=>{current=false;controller.abort();clearInterval(interval);};
  // The signature includes every filter; revision restarts at page one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[signature,key,scope?.revision]);
 return {data:result.key===key?result.data:null,busy:result.key!==key||result.busy,error:result.key===key?result.error:'',page:cursors.length,
  refresh:()=>setRetry(n=>n+1),previous:()=>setNavigation({key:navigationKey,revision:scope?.revision,cursors:cursors.slice(0,-1)}),
  next:()=>{if(result.key===key&&result.data?.next)setNavigation({key:navigationKey,revision:scope?.revision,cursors:[...cursors,result.data.next]});}};
}
