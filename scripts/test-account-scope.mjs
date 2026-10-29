import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {AccountRequest} from '../src/lib/account-request.ts';
const calls=[];let fail=false,claims=0;
const leagues=[{id:'A'},{id:'B'}],teams=[{id:'TA',league_id:'A'},{id:'TB',league_id:'B'}];
globalThis.__accountFixture={rpc(){claims++;return{abortSignal:()=>Promise.resolve({data:1,error:null})};},from(table){
 const record={table,filters:[],columns:''};calls.push(record);
 const query={select(columns){record.columns=columns;return query;},eq(key,value){record.filters.push([key,value]);return query;},
  in(key,value){record.filters.push([key,value]);return query;},order(){return query;},range(){return query;},abortSignal(signal){record.signal=signal;return query;},
  then(resolve,reject){const core={leagues,teams,league_memberships:[],wallets:[]};
   if(table in core)return Promise.resolve({data:core[table],error:null}).then(resolve,reject);
   const scope=record.filters.find(([k])=>k==='league_id'||k==='ticket.league_id')?.[1]??record.filters.find(([k])=>k==='team_id')?.[1][0]?.slice(1);
   return Promise.resolve(fail?{data:null,error:new Error('Synthetic history outage')}:{data:[{id:table+'-'+scope,team_id:'T'+scope,league_id:scope}],error:null}).then(resolve,reject);
  }};return query;
}};
let source=fs.readFileSync('src/lib/accounts.ts','utf8').replace('import { supabase } from "./supabase";','const supabase=globalThis.__accountFixture;')
 .replace('from "./pagination"',`from ${JSON.stringify(pathToFileURL(process.cwd()+'/src/lib/pagination.ts').href)}`);
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {loadAccounts}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
await loadAccounts(undefined,undefined,{claim:true,coreOnly:true});
assert.equal(claims,1);assert(calls.every(c=>['leagues','teams','league_memberships','wallets'].includes(c.table)));
calls.length=0;
const paged=await loadAccounts(undefined,undefined,{leagueId:'A',history:'tickets'});
assert(paged.history_remote);assert.deepEqual(paged.tickets,[]);
assert(calls.every(c=>['leagues','teams','league_memberships','wallets'].includes(c.table)),'paged ticket screens do not start background full-history reads');
calls.length=0;
const a=await loadAccounts(undefined,undefined,{leagueId:'A'});
assert.equal(a.history_league_id,'A');assert.equal(claims,1);
for(const c of calls.slice(4)){assert.equal(c.filters.length,1);assert(c.filters[0][1]==='A'||JSON.stringify(c.filters[0][1])==='["TA"]');}
for(const c of calls.filter(c=>['ticket_legs','ticket_promotions'].includes(c.table)))assert(c.columns.includes('tickets!inner(league_id)'));
const b=await loadAccounts(a,core=>assert.deepEqual(core.tickets,[]),{leagueId:'B'});
assert.equal(b.tickets[0].id,'tickets-B');assert.equal(claims,1);
fail=true;const original=console.error;console.error=()=>{};
try{const failedB=await loadAccounts(a,undefined,{leagueId:'B'});assert.deepEqual(failedB.tickets,[]);assert(failedB.history_error);
 const failedA=await loadAccounts(a,undefined,{leagueId:'A'});assert.deepEqual(failedA.tickets,a.tickets);
}finally{console.error=original;}
await assert.rejects(loadAccounts(a,undefined,{leagueId:'C'}),/access/);
const fence=new AccountRequest();const first=fence.start(),second=fence.start();
assert(first.signal.aborted);assert(!first.current());assert(second.current());
fence.cancel();assert(second.signal.aborted);assert(!second.current());
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(loadAccounts(a,undefined,{leagueId:'A',signal:cancelled.signal}),e=>e.name==='AbortError');
delete globalThis.__accountFixture;
console.log('Passed bootstrap-only membership claims, selected-league financial reads, scoped outage fallback, revoked access and superseded/canceled account requests.');
