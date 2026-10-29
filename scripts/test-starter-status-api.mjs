// No external network: test the real auth -> member config -> service cache ->
// provider display path, including warm-cache revocation and league changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const root=path.resolve('work/starter-api-runtime');await fs.mkdir(path.join(root,'_lib'),{recursive:true});
for(const file of ['active-starters','_lib/active-starters','_lib/starter-cache','_lib/game-status','_lib/server-client','_lib/environment-policy']){
 const source=await fs.readFile('api/'+file+'.ts','utf8');
 await fs.writeFile(path.join(root,file+'.js'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText);
}
await fs.writeFile(path.join(root,'package.json'),' {"type":"module"}');
const originalFetch=globalThis.fetch,originalEnv={...process.env};
for(const key of ['VERCEL','VERCEL_ENV'])delete process.env[key];
Object.assign(process.env,{BOFF_ENVIRONMENT:'test',NODE_ENV:'test',SUPABASE_URL:'https://starter.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'});
const A='aaaaaaaa-1111-4111-8111-111111111111',B='bbbbbbbb-2222-4222-8222-222222222222';
let member=true,signed=true,configId='111',authReads=0,accessReads=0,cacheReads=0,providers=[];
const cache=new Map();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url??input.toString());
 if(url.hostname==='starter.invalid'){
  const endpoint=url.pathname.split('/').at(-1),body=JSON.parse(options.body??'{}');
  if(endpoint==='user'){authReads++;return signed?json({id:'cccccccc-3333-4333-8333-333333333333',email:'fixture@example.test'}):json({message:'Invalid token'},401);}
  if(endpoint==='starter_status_access'){accessReads++;return json(member?{sleeper_league_id:body.p_league===B?'222':configId,nfl_season:2026}:null);}
  const key=JSON.stringify([body.p_scope,body.p_key]);
  if(endpoint==='claim_starter_status'){
   cacheReads++;const row=cache.get(key);
   if(row?.context===body.p_context&&row.payload)return json({state:'hit',payload:row.payload,checked_at:row.checked_at});
   cache.set(key,{context:body.p_context,token:'fixture-token'});return json({state:'claimed',token:'fixture-token'});
  }
  if(endpoint==='publish_starter_status'){
   const row=cache.get(key);if(row.context!==body.p_context)return json(false);
   Object.assign(row,{payload:body.p_payload,checked_at:body.p_checked});return json(true);
  }
  if(endpoint==='fail_starter_status')return json(null);
 }
 providers.push(url.href);
 if(url.hostname==='api.sleeper.app'){
  if(url.pathname==='/v1/state/nfl')return json({season:'2026',season_type:'regular',week:8});
  if(url.pathname==='/v1/players/nfl')return json({p:{team:'BUF',full_name:'Actual starter',raw_provider:'PRIVATE'},bench:{team:'BUF',full_name:'Bench'}});
  if(/\/matchups\/8$/.test(url.pathname))return json([{roster_id:1,starters:['p']}]);
 }
 if(url.hostname==='site.api.espn.com')return json({leagues:[{slug:'nfl'}],season:{year:2026,type:2},events:[{id:'fixture',date:new Date().toISOString(),status:{type:{name:'STATUS_IN_PROGRESS'}},competitions:[{competitors:[{team:{abbreviation:'BUF'}},{team:{abbreviation:'NE'}}]}]}]});
 throw new Error('Unexpected network '+url.href);
};
try{
 const {GET}=await import(pathToFileURL(path.join(root,'active-starters.js')).href);
 const request=(league=A)=>new Request('https://fixture.invalid/api/active-starters?league_id='+league,{headers:{Authorization:'Bearer fixture-user'}});
 const results=await Promise.all(Array.from({length:20},()=>GET(request())));
 assert(results.every(r=>r.status===200),await results[0].clone().text());assert.equal(authReads,20);assert.equal(accessReads,20);
 const bodies=await Promise.all(results.map(r=>r.json()));
 assert(bodies.every(v=>v.rosters[0].playing[0].name==='Actual starter'));
 assert.equal(providers.length,6,'one NFL state, three scoreboard dates, one directory, one league matchup');
 assert.equal(results[0].headers.get('Cache-Control'),'private, no-store');
 assert(!JSON.stringify([...cache.values()]).includes('PRIVATE'));
 const warm=await GET(request());assert.equal(warm.status,200);assert.equal(providers.length,6);
 assert.equal((await warm.json()).observed_at,bodies[0].observed_at);
 assert.equal((await GET(request(B))).status,200);assert.equal(providers.length,7,'second league shares public providers, fetches own lineup');
 configId='333';assert.equal((await GET(request())).status,200);assert.equal(providers.length,8,'configuration changes invalidate the league payload');
 const before=cacheReads;
 member=false;assert.equal((await GET(request())).status,403);assert.equal(cacheReads,before,'revoked membership cannot read a warm private cache');
 signed=false;assert.equal((await GET(request())).status,401);assert.equal(cacheReads,before);
 assert.equal((await GET(new Request('https://fixture.invalid/api/active-starters'))).status,401);
 console.log('Passed intercepted starter API: 20 independently authorized viewers share six provider requests; warm hits preserve source time; second league/config changes isolate lineups; revoked auth/membership never reads cache.');
}finally{
 globalThis.fetch=originalFetch;
 for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];
 Object.assign(process.env,originalEnv);
}
