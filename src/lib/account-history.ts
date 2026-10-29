import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorMessage} from './accounts';
import type {Ticket,TicketLeg,TicketPromotion} from './accounts';
export type TicketFilterState={status:string;week:string;sort:string;direction:string;query:string;team:string;personal:boolean;season?:number;market_week?:number;ticket?:string;details?:boolean};
export type TicketPage={tickets:Ticket[];legs:TicketLeg[];ticketPromotions:TicketPromotion[];total:number;next:Record<string,unknown>|null;as_of:string};
export type RemoteTicketScope={leagueId:string;personal?:boolean;revision?:unknown;details?:boolean};
export function useTicketPage(scope:RemoteTicketScope|undefined,filters:TicketFilterState){
 const signature=JSON.stringify([scope?.leagueId,filters]);
 const [navigation,setNavigation]=useState<{signature:string;revision?:unknown;cursors:(Record<string,unknown>|null)[]}>({signature:'',cursors:[null]});
 const cursors=navigation.signature===signature&&navigation.revision===scope?.revision?navigation.cursors:[null];
 const cursor=cursors[cursors.length-1],key=signature+JSON.stringify(cursor);
 const [result,setResult]=useState<{key:string;data:TicketPage|null;error:string;busy:boolean}>({key:'',data:null,error:'',busy:false});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!scope?.leagueId||!supabase)return;
  const controller=new AbortController();let current=true;
  setResult(s=>({key,data:s.key===key?s.data:null,error:'',busy:true}));
  void(async()=>{try{
   const response=await supabase!.rpc('account_ticket_page',{p_league:scope.leagueId,p_filters:filters,p_cursor:cursor,p_limit:20})
    .abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
   if(response.error)throw response.error;
   const page=response.data as TicketPage;
   if(!page||!Array.isArray(page.tickets)||page.tickets.length>20||!Array.isArray(page.legs)||!Array.isArray(page.ticketPromotions)
    ||!Number.isFinite(page.total)||page.tickets.some(t=>t.league_id!==scope.leagueId))throw new Error('Ticket history response is incomplete.');
   if(current)setResult({key,data:page,error:'',busy:false});
  }catch(e){if(current)setResult({key,data:null,error:errorMessage(e),busy:false});}})();
  return()=>{current=false;controller.abort();};
  // The signature contains the complete serialized filter and tenant scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[signature,key,scope?.revision,retry]);
 const data=result.key===key?result.data:null;
 return {data,error:result.key===key?result.error:'',busy:result.key!==key||result.busy,page:cursors.length,
  retry:()=>setRetry(n=>n+1),previous:()=>setNavigation({signature,revision:scope?.revision,cursors:cursors.slice(0,-1)}),
  next:()=>{if(data?.next)setNavigation({signature,revision:scope?.revision,cursors:[...cursors,data.next]});}};
}
export type BalanceEntry={id:string;ticketId:string|null;title:string;reason:string;amount:number;date:string;imported:boolean;balanceAfter:number|null};
type BalancePage={entries:BalanceEntry[];total:number;next:Record<string,unknown>|null;as_of:string};
export function useBalancePage(scope:{leagueId:string;teamId:string;revision?:unknown}|undefined){
 const signature=JSON.stringify([scope?.leagueId,scope?.teamId]);
 const [navigation,setNavigation]=useState<{signature:string;revision?:unknown;cursors:(Record<string,unknown>|null)[]}>({signature:'',cursors:[null]});
 const cursors=navigation.signature===signature&&navigation.revision===scope?.revision?navigation.cursors:[null];
 const cursor=cursors[cursors.length-1],key=signature+JSON.stringify(cursor);
 const [result,setResult]=useState<{key:string;data:BalancePage|null;error:string;busy:boolean}>({key:'',data:null,error:'',busy:false});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!scope||!supabase)return;
  const controller=new AbortController();let current=true;
  setResult(s=>({key,data:s.key===key?s.data:null,error:'',busy:true}));
  void(async()=>{try{
   const response=await supabase!.rpc('account_balance_page',{p_league:scope.leagueId,p_team:scope.teamId,p_cursor:cursor,p_limit:30})
    .abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
   if(response.error)throw response.error;
   const page=response.data as BalancePage;
   if(!page||!Array.isArray(page.entries)||page.entries.length>30||!Number.isFinite(page.total))throw new Error('Balance history response is incomplete.');
   if(current)setResult({key,data:page,error:'',busy:false});
  }catch(e){if(current)setResult({key,data:null,error:errorMessage(e),busy:false});}})();
  return()=>{current=false;controller.abort();};
  // The key contains the complete team/league scope and cursor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[signature,key,scope?.revision,retry]);
 const data=result.key===key?result.data:null;
 return {data,error:result.key===key?result.error:'',busy:result.key!==key||result.busy,page:cursors.length,
  retry:()=>setRetry(n=>n+1),previous:()=>setNavigation({signature,revision:scope?.revision,cursors:cursors.slice(0,-1)}),
  next:()=>{if(data?.next)setNavigation({signature,revision:scope?.revision,cursors:[...cursors,data.next]});}};
}
