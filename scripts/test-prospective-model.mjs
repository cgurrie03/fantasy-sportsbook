import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import ts from 'typescript';import {PGlite} from '@electric-sql/pglite';
const dir=await fs.mkdtemp(path.resolve('node_modules/.prospective-'));const db=new PGlite();
try{
 for(const file of ['prospective-model','model-assessment','line-model','settlement','futures-settlement'])
  await fs.writeFile(path.join(dir,file+'.js'),ts.transpileModule(await fs.readFile('api/_lib/'+file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText);
 await fs.writeFile(path.join(dir,'package.json'),'{"type":"module"}');
 const {advanceProspective,prospectiveComparison,initialState}=await import(pathToFileURL(path.join(dir,'prospective-model.js')).href);
 const {BASELINE}=await import(pathToFileURL(path.join(dir,'model-assessment.js')).href);
 const ids=Array.from({length:10},()=>randomUUID()),active=randomUUID(),context='c'.repeat(64);
 const fixture=(i,count=10)=>{
  const period=202400+Math.floor(i/18)*100+i%18+1,at=new Date(Date.UTC(2024,8,1)+i*7*86400000).toISOString();
  const score=ids.slice(0,count).map((id,k)=>({view:'actual_starters',horizon:'opening',team_id:id,model_version:active,model_config:BASELINE,
   predicted:100+k,actual:(100+k)*(i<8?.98:.995)+(i<8?0:k%2?.05:-.05),sleeper_predicted:(100+k)*1.005,sd:15}));
  const models=score.map((r,k)=>({id:r.team_id,roster_id:k+1,mean:r.predicted,sd:15,lineup:[]}));
  const quotes=models.map(m=>({id:randomUUID(),market_key:m.id,kind:'team_total',team_id:m.id,side:'over',line:m.mean+5,metadata:{}}));
  return {active_id:active,context_hash:context,period,current:BASELINE,team_count:count,
   report:{scores:score,cutoff:new Date(Date.parse(at)+3600000).toISOString(),coverage:{missing_families:[]}},
   runs:[{id:'run-'+i,category:'Matchups',captured_at:at,phase:'pregame',provenance:'as_of',model_config:BASELINE,payload:{models,quotes}}],
   outcome:{final:true,teams:Object.fromEntries(score.map(r=>[r.team_id,{points:r.actual,name:'Synthetic'}])),players:{},rosters:score.map((r,k)=>({roster_id:k+1,points:r.actual}))}};
 };
 let state=null;
 for(let i=0;i<8;i++)state=advanceProspective(state,fixture(i));
 assert(state.candidate);assert.equal(state.evidence.length,0);assert.equal(state.frozen_at,null);
 state.frozen_at=new Date(Date.parse(fixture(7).runs[0].captured_at)+86400000).toISOString();
 const frozen=structuredClone(state.candidate);
 for(let i=8;i<24;i++){state=advanceProspective(state,fixture(i));assert.deepEqual(state.candidate,frozen);}
 const pass=prospectiveComparison(state,BASELINE,false,state.last_period);
 assert.equal(pass.passed,true,JSON.stringify(pass));assert.equal(pass.tests[0].weeks,12);assert.equal(pass.tests[1].weeks,4);
 assert.equal(state.evidence.length,16);assert.equal(state.training.length,8);
 assert.equal(prospectiveComparison(state,BASELINE,true,state.last_period).passed,false);
 const betterSleeper=structuredClone(state);betterSleeper.evidence.forEach(w=>w.sleeper=0);
 assert.equal(prospectiveComparison(betterSleeper,BASELINE,false,state.last_period).passed,false);
 const badMarket=structuredClone(state);badMarket.evidence[0].market_ok=false;
 assert.equal(prospectiveComparison(badMarket,BASELINE,false,state.last_period).passed,false);
 const reset=advanceProspective(state,{...fixture(24),context_hash:'d'.repeat(64)});assert.equal(reset.candidate,null);assert.equal(reset.evidence.length,0);
 const old=advanceProspective(state,fixture(1));assert.equal(prospectiveComparison(old,BASELINE,false,fixture(1).period).passed,false);
 const premature=structuredClone(state);premature.frozen_at=fixture(23).runs[0].captured_at;
 assert.equal(prospectiveComparison(premature,BASELINE,false,state.last_period).passed,false);

 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 // Replay the reviewed incremental schema exactly in source order.
 for(const f of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='202610280055'))await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const league=randomUUID(),job=randomUUID();
 await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor) values($1::uuid,'Prospective fixture',$1::text,2026,1,5,now())`,[league]);
 const base=(await q('select active_id from model_controls where league_id=$1',[league]))[0].active_id;
 await q(`insert into automation_jobs(id,league_id,event_key,operation,market_week,status,attempts,lease_until) values($1,$2,'prospective-test','model_review',4,'running',1,now()+interval '5 minutes')`,[job,league]);
 await db.exec("set request.jwt.claim.role='service_role'");
 const first=initialState(base,context);first.last_period=202604;
 const save=async(st,rev,hash,attempt=1)=>(await q('select save_prospective_state($1,$2,$3,$4,$5,$6,$7::jsonb) state',[job,attempt,base,rev,context,hash.repeat(64),JSON.stringify(st)]))[0].state;
 const written=await save(first,0,'a');assert.equal(written.revision,1);assert.equal((await save(first,0,'a')).revision,1);
 await assert.rejects(save(first,0,'b'),/revision/);await assert.rejects(save(first,1,'b',2),/lease/);
 const freeze={...first,training:state.training.map((w,i)=>({...w,period:i===7?202604:202501+i})),candidate:state.candidate,trained_period:202604,training_weeks:8};
 freeze.fit_training=freeze.training;
 const frozenState=await save(freeze,1,'b');assert(frozenState.frozen_at);assert(Date.parse(frozenState.frozen_at)>Date.now()-10000);
 await assert.rejects(save({...frozenState,candidate:{...frozenState.candidate,score_scale:1}},2,'d'),/Frozen candidate/);
 // Seed a complete synthetic future state to exercise the SQL promotion gate;
 // no provider observations or real future performance are fabricated.
 const eligible={...state,active_id:base,last_period:202604,revision:3};
 await q('update model_prospective_state set revision=3,state=$2::jsonb where league_id=$1',[league,JSON.stringify(eligible)]);
 const comparison=prospectiveComparison(eligible,BASELINE,false,202604),outcome=randomUUID(),review=randomUUID();
 await q(`insert into model_outcome_revisions(id,league_id,nfl_season,market_week,outcome_hash,outcome) values($1,$2,2026,4,'fixture','{}')`,[outcome,league]);
 await q(`insert into model_weekly_reviews(id,league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison) values($1,$2,2026,4,$3,'fixture','{"assessment_version":"weekly-review-v3-prospective"}',$4::jsonb)`,[review,league,outcome,JSON.stringify(comparison)]);
 const promoted=(await q("select control_model($1,'promote','Synthetic prospective gates passed',$2,$3) id",[league,review,base]))[0].id;
 assert.notEqual(promoted,base);
 await db.exec('set row_security=on;set role authenticated');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);assert.equal((await q('select * from model_prospective_state')).length,0);
 await assert.rejects(save(first,3,'f'),/permission denied/);
 console.log('Fresh frozen-candidate training/validation/holdout, Sleeper and market holds, context/reset/correction guards, bounded state, server freeze/CAS, SQL promotion and tenant denial passed. Synthetic mechanism evidence only.');
}finally{
 await db.close();const resolved=await fs.realpath(dir),parent=await fs.realpath('node_modules');
 if(!resolved.startsWith(parent+path.sep))throw new Error('Temporary directory escaped workspace');await fs.rm(resolved,{recursive:true,force:true});
}
