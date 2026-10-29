import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {AccountRequest} from '../src/lib/account-request.ts';
const calls=[],totalCalls=[];let fail=false,failDirectory=false,overflow=false,largeBody=false,claims=0;
const leagues=[{id:'A'},{id:'B'}],teams=[{id:'TA',league_id:'A'},{id:'TB',league_id:'B'}];
globalThis.__accountFixture={rpc(name,args){
 if(name==='claim_memberships')claims++;
 else {assert.equal(name,'account_betting_totals');totalCalls.push(args);}
 return{abortSignal:()=>Promise.resolve(name==='claim_memberships'?{data:1,error:null}:fail?{data:null,error:new Error('Synthetic totals outage')}:
  {data:[{team_id:'T'+args.p_league,open:20,open_future:10,stake:30}],error:null})};},from(table){
 const record={table,filters:[],columns:''};calls.push(record);
 const query={select(columns){record.columns=columns;return query;},eq(key,value){record.filters.push([key,value]);return query;},
  in(key,value){record.filters.push([key,value]);return query;},order(){return query;},range(){return query;},limit(value){record.limit=value;return query;},abortSignal(signal){record.signal=signal;return query;},
  then(resolve,reject){const core={leagues,teams,league_memberships:[],wallets:[]};
   assert(table in core,'account bootstrap cannot read raw financial history');
   let data=core[table];if(overflow&&table==='leagues')data=Array.from({length:129},(_,i)=>({id:'overflow-'+i}));
   if(largeBody&&table==='teams')data=[{id:'TA',league_id:'A',team_name:'x'.repeat(600000)}];
   return Promise.resolve(failDirectory?{data:null,error:new Error('Synthetic directory outage')}:{data,error:null}).then(resolve,reject);
  }};return query;
}};
let source=fs.readFileSync('src/lib/accounts.ts','utf8').replace('import { supabase } from "./supabase";','const supabase=globalThis.__accountFixture;');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {loadAccounts}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
await loadAccounts(undefined,undefined,{claim:true,coreOnly:true});
assert.equal(claims,1);assert(calls.every(c=>['leagues','teams','league_memberships','wallets'].includes(c.table)));
calls.length=0;
const paged=await loadAccounts(undefined,undefined,{leagueId:'A',history:'tickets'});
assert(paged.history_remote);assert.deepEqual(paged.tickets,[]);
assert(calls.every(c=>['leagues','teams','league_memberships','wallets'].includes(c.table)),'paged ticket screens do not start background full-history reads');
calls.length=0;
const aggregate=await loadAccounts(undefined,undefined,{leagueId:'A',history:'aggregate'});
assert.equal(aggregate.betting_totals[0].open,20);assert.equal(totalCalls.length,1);assert.equal(totalCalls[0].p_league,'A');
assert(calls.every(c=>['leagues','teams','league_memberships','wallets'].includes(c.table)),'aggregate screens do not traverse financial histories');
fail=true;
assert.equal((await loadAccounts(aggregate,undefined,{leagueId:'A',history:'aggregate'})).betting_totals[0].open,20);
const missedB=await loadAccounts(aggregate,undefined,{leagueId:'B',history:'aggregate'});assert.equal(missedB.betting_totals,undefined);assert(missedB.betting_error);fail=false;
calls.length=0;
const a=await loadAccounts(undefined,undefined,{leagueId:'A'});
assert.equal(a.history_league_id,'A');assert.equal(claims,1);
assert.equal(calls.length,4);assert(calls.every(c=>c.columns!=='*'&&c.limit<=513));
const b=await loadAccounts(a,core=>assert.deepEqual(core.tickets,[]),{leagueId:'B'});
assert.deepEqual(b.tickets,[]);assert.equal(claims,1);
assert.deepEqual((await loadAccounts({...a,tickets:[{id:'old-raw-history'}]},undefined,{leagueId:'A'})).tickets,[],'ordinary bootstrap cannot reuse legacy raw financial histories');
failDirectory=true;await assert.rejects(loadAccounts(a),/directory outage/);failDirectory=false;
overflow=true;await assert.rejects(loadAccounts(),/read budget/);overflow=false;
largeBody=true;await assert.rejects(loadAccounts(),/read budget/);largeBody=false;
await assert.rejects(loadAccounts(a,undefined,{leagueId:'C'}),/access/);
const fence=new AccountRequest();const first=fence.start(),second=fence.start();
assert(first.signal.aborted);assert(!first.current());assert(second.current());
fence.cancel();assert(second.signal.aborted);assert(!second.current());
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(loadAccounts(a,undefined,{leagueId:'A',signal:cancelled.signal}),e=>e.name==='AbortError');
delete globalThis.__accountFixture;
console.log('Passed bootstrap-only membership claims, selected-league financial reads, scoped outage fallback, revoked access and superseded/canceled account requests.');
