import assert from 'node:assert/strict';
import handler from '../api/live-book.mjs';
const originalFetch=globalThis.fetch,env={...process.env};
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',SUPABASE_URL:'https://whlcnlacueweaqpsupqs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'});
async function run({token='user-token',valid=true,verified=true,member=false,co=false,lookupFailure=false,method='GET'}={}){
 let reads=0,requests=[];globalThis.fetch=async(url,options)=>{
  requests.push({url,options});const u=new URL(url);
  if(u.pathname==='/auth/v1/user'){assert.equal(options.headers.Authorization,'Bearer '+token);return Response.json(valid?{id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:verified?'2026-01-01':null}:{error:'invalid token'},{status:valid?200:401});}
  assert.equal(options.headers.Authorization,'Bearer fixture-service');
  if(u.pathname.endsWith('league_memberships'))return Response.json(member?[{id:'member'}]:[],{status:lookupFailure?503:200});
  if(u.pathname.endsWith('dev_co_manager_account'))return Response.json(co?{id:'co-member'}:null);
  if(u.pathname.endsWith('dev_live_cache')){reads++;return Response.json([{key:'nfl',payload:{activeGames:1}},{key:'league:1312126153980391424',fetched_at:'2026-11-18',payload:{metadata:{season:2026,leagueName:'Fixture',teams:[{rosterId:1,ownerId:'private-owner'}]},matchups:[]}}]);}
  throw Error('Unexpected request');
 };
 let status,body;const response={setHeader(){},status(s){status=s;return this},json(data){body=data;return this}};
 await handler({method,headers:{authorization:token?'Bearer '+token:''}},response);return {status,body,reads,requests};
}
try{
 for(const options of [{token:''},{token:'fixture-service'},{valid:false},{verified:false}]){const r=await run(options);assert.equal(r.status,401);assert.equal(r.reads,0);}
 for(const label of ['unrelated account','removed member']){const r=await run();assert.equal(r.status,403,label);assert.equal(r.reads,0);}
 for(const options of [{member:true},{co:true}]){const r=await run(options);assert.equal(r.status,200);assert.equal(r.reads,1);assert.equal(r.body.payload.teams[0].ownerId,undefined);}
 const failure=await run({lookupFailure:true});assert.equal(failure.status,503);assert.equal(failure.reads,0);
 assert.equal((await run({method:'POST'})).status,405);
 console.log('PASS legacy source access: missing/service/invalid/unverified tokens denied; unrelated or removed membership denied before cache read; primary/co-manager allowed; lookup failures fail closed; owner IDs stripped');
}finally{globalThis.fetch=originalFetch;process.env=env;}
