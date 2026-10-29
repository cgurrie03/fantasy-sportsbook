import assert from 'node:assert/strict';
import {cachedStarter,starterContext,projectStarterPlayers} from '../api/_lib/starter-cache.ts';
const rows=new Map(),calls=[];let token=0;
const db={rpc(name,args){return {abortSignal(){return (async()=>{
 calls.push(name);const key=JSON.stringify([args.p_scope,args.p_key]),row=rows.get(key);
 if(name==='claim_starter_status'){
  if(row?.context===args.p_context&&row.payload)return {data:{state:'hit',payload:row.payload,checked_at:row.checked_at}};
  const next={context:args.p_context,token:++token};rows.set(key,next);return {data:{state:'claimed',token:next.token}};
 }
 if(name==='publish_starter_status'){
  if(row.token!==args.p_token||row.context!==args.p_context)return {data:false};
  Object.assign(row,{payload:args.p_payload,checked_at:args.p_checked});return {data:true};
 }
 if(name==='fail_starter_status')return {data:null};
 throw new Error('Unexpected RPC');
 })();}};}};
let loads=0;let release;
const held=new Promise(r=>{release=r;});
const source=async()=>{loads++;await held;return {payload:{playing:['one']},checked_at:'2026-10-29T19:00:00Z'};};
const context=starterContext('league-v1');
const requests=Array.from({length:32},()=>cachedStarter(db,'test-project','league','A',context,source));
await Promise.resolve();release();const results=await Promise.all(requests);
assert.equal(loads,1);assert(results.every(r=>r.checked_at==='2026-10-29T19:00:00Z'));
assert.equal(calls.filter(n=>n==='claim_starter_status').length,1);
const hit=await cachedStarter(db,'test-project','league','A',context,()=>{throw new Error('Hit cannot refetch');});
assert.equal(hit.checked_at,results[0].checked_at,'cache read never invents a fresh observation timestamp');
await cachedStarter(db,'test-project','league','A',starterContext('league-v2'),async()=>({payload:{changed:true},checked_at:'2026-10-29T19:00:01Z'}));
await cachedStarter(db,'test-project','league','B',context,async()=>({payload:{other:true},checked_at:'2026-10-29T19:00:01Z'}));
assert.equal(rows.size,2);
const now=new Date().toISOString(),beforePlayers=calls.length;
for(let i=0;i<60;i++)await cachedStarter(db,'directory-memory','players','current',context,async()=>({payload:{p:{team:'BUF'}},checked_at:now}));
assert.equal(calls.length-beforePlayers,2,'warm refreshes do not redownload the directory from database egress: one claim and publish');
const broken={rpc(){return {abortSignal:async()=>({error:{message:'private provider data'}})}}};
await assert.rejects(cachedStarter(broken,'broken','state','current',context,()=>{throw new Error('No cache bypass');}),/cache is unavailable/);
assert.deepEqual(projectStarterPlayers({p:{team:'BUF',full_name:'One',injury_status:'Out',raw_secret:'private'},fa:{team:null,full_name:'Unused'}}),
 {p:{team:'BUF',full_name:'One',injury_status:'Out'},fa:{team:null}});
assert.throws(()=>projectStarterPlayers({p:{team:'BUF',full_name:'x'.repeat(1048576)}}),/budget/);
console.log('Passed 32-way request coalescing, persistent hits, 60 warm directory reuses without repeated DB egress, context/league separation, original observation timestamps, fail-closed cache errors and bounded directory projection.');
