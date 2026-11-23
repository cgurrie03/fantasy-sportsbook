import assert from 'node:assert/strict';
import handler from '../dist/api/league-intake.mjs';
const originalFetch=fetch,env={...process.env};
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',SUPABASE_URL:'https://whlcnlacueweaqpsupqs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service'});
const id='1234567890123456789',request_key='11111111-1111-4111-8111-111111111111';
const source={league_id:id,name:'Test League',sport:'nfl',season_type:'regular',season:'2026',status:'in_season',total_rosters:8,scoring_settings:{rec:1},roster_positions:['QB','BN'],settings:{playoff_teams:4,playoff_week_start:15}};
async function run({owner=true,token='user-token',linked=false,action,users=[{id:'987654321012345678'}],prior=false}={}){
 let providerCalls=0,saves=0;const urls=[];
 globalThis.fetch=async(url,opts)=>{
  const u=new URL(url);urls.push(u.href);
  if(u.hostname==='api.sleeper.app'){
   providerCalls++;
   if(u.pathname.includes('/user/'))return Response.json([source]);
   if(u.pathname.endsWith('/rosters'))return Response.json(Array.from({length:8},(_,i)=>({league_id:id,roster_id:i+1,owner_id:null,co_owners:[],settings:{wins:0,losses:0,ties:0}})));
   if(u.pathname.endsWith('/users'))return Response.json([]);
   return Response.json(source);
  }
  assert.equal(opts.headers.Authorization,'Bearer user-token');
  if(u.pathname.endsWith('application_environment_identity'))return Response.json({environment:'development',project_ref:'whlcnlacueweaqpsupqs'});
  if(u.pathname.endsWith('league_intake_owner'))return Response.json(owner);
  if(u.pathname.endsWith('dev_league_intake_context'))return Response.json({season:2026,sleeperUsers:users,linked:linked?[{sleeperId:id,name:'Already Linked'}]:[]});
  if(u.pathname.endsWith('league_intake_drafts'))return Response.json(prior?[{id:'saved',source_league_id:id,state:'draft',expires_at:'2099-01-01'}]:[]);
  if(u.pathname.endsWith('save_league_intake_draft')){saves++;return Response.json({id:'saved',state:'draft'});}
  throw Error('Unexpected fetch '+u.href);
 };
 let status,data;const res={setHeader(){},status(s){status=s;return this},json(d){data=d;return this}};
 await handler({method:'POST',headers:{authorization:token?'Bearer '+token:'',host:'dev.sportsbook.coopergurrie.com'},body:{sleeper_league_id:id,request_key,...(action?{action}:{}),sleeperUserId:'attacker-supplied-id'}},res);
 return {status,data,providerCalls,saves,urls};
}
try{
 assert.equal((await run({token:''})).status,401);
 const denied=await run({owner:false});assert.equal(denied.status,403);assert.equal(denied.providerCalls,0);
 const duplicate=await run({linked:true});assert.equal(duplicate.status,409);assert.equal(duplicate.providerCalls,0);assert.equal(duplicate.saves,0);
 const replay=await run({prior:true});assert.equal(replay.status,200);assert.equal(replay.providerCalls,0);
 const discovered=await run({action:'discover',linked:true});assert.equal(discovered.status,200);assert.equal(discovered.data.leagues[0].linked,true);assert.equal(discovered.providerCalls,1);assert.equal(discovered.urls.some(u=>u.includes('attacker-supplied-id')),false);
 const noId=await run({action:'discover',users:[]});assert.equal(noId.data.hasSleeperAccount,false);assert.equal(noId.providerCalls,0);
 const preview=await run();assert.equal(preview.status,200);assert.equal(preview.providerCalls,3);assert.equal(preview.saves,1);
 console.log('PASS: owner-only intake, early duplicate rejection, idempotent preview, trusted-account discovery, missing-link fallback and provider preview');
}finally{globalThis.fetch=originalFetch;process.env=env;}
