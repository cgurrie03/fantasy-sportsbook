import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const folder = await fs.mkdtemp(path.resolve("node_modules/.compact-forecast-"));
try {
  for (const file of ["compact-forecast","model-assessment","line-model","settlement","futures-settlement"]) {
    const result=ts.transpileModule(await fs.readFile(`api/_lib/${file}.ts`,"utf8"),
      {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}});
    await fs.writeFile(path.join(folder,`${file}.js`),result.outputText);
  }
  await fs.writeFile(path.join(folder,"package.json"),'{"type":"module"}');
  const { compactForecastPayload }=await import(pathToFileURL(path.join(folder,"compact-forecast.js")).href);
  const { assessWeek,BASELINE }=await import(pathToFileURL(path.join(folder,"model-assessment.js")).href);
  const { highLowProbabilities }=await import(pathToFileURL(path.join(folder,"line-model.js")).href);
  const raw="FORBIDDEN_PROVIDER_BODY".repeat(3000);
  const models=Array.from({length:8},(_,i)=>({id:randomUUID(),roster_id:i+1,mean:100+i*4,sd:15,
    lineup:[{id:`p${i}`,name:raw,stats:{raw}}],roster:{raw}}));
  const pool=models.map((m,i)=>({id:`p${i}`,name:raw,expected:m.mean,sleeper_projection:m.mean-3,positions:["QB"],injury:"",assessment_sd:15,raw}));
  const specials=highLowProbabilities(models,7,models.map(m=>m.mean));
  const quotes=models.map((m,i)=>({id:randomUUID(),market_key:`high:${m.id}`,kind:"weekly_high",side:"high",line:null,
    team_id:m.id,home_team_id:null,away_team_id:null,metadata:{fair_probability:specials.high[i],expected_team_count:8,
      scoring_settings:{pts:1},roster_positions:["QB"],home_lineup:{raw},raw}}));
  const inputs=["Matchups","Weekly Specials"].map(category=>({id:randomUUID(),category,captured_at:"2026-10-07T12:00:00Z",
    phase:"pregame",provenance:"as_of",model_version:"fixture",model_config:BASELINE,
    payload:{models,pool,quotes,specials,model_config:BASELINE,algorithm_version:"fixture",
      source_quality:{source_count:3,unknown_observation_times:2},provider:{raw}}}));
  const outcome={final:true,completed_period:true,confirmed_games_final:true,
    teams:Object.fromEntries(models.map((m,i)=>[m.id,{name:`Test ${i}`,points:m.mean+(i%2?10:-10)}])),
    players:Object.fromEntries(models.map((m,i)=>[`p${i}`,{played:true,points:m.mean+(i%2?10:-10)}])),
    rosters:models.map((m,i)=>({roster_id:m.roster_id,points:m.mean+(i%2?10:-10),starters:[`p${i}`]})),
    sources:{settings:{scoring_settings:{pts:1}}},season_results:{champion:null,last:null,playoffRosters:null}};
  const compact=inputs.map(r=>{const c=compactForecastPayload(r.payload,r.category);return {...r,payload:{...c.payload,model_config:BASELINE,scoring_settings:c.context.scoring_settings}}});
  assert.deepEqual(assessWeek(compact,[],outcome,"2026-10-09T00:15:00Z"),assessWeek(inputs,[],outcome,"2026-10-09T00:15:00Z"));
  assert(!JSON.stringify(compact).includes("FORBIDDEN_PROVIDER_BODY"));
  assert(JSON.stringify(compact).length < JSON.stringify(inputs).length / 100);

  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
      grant usage on schema public,auth to authenticated,anon;`);
    await db.exec(await fs.readFile("supabase/development/baseline-schema.sql","utf8"));
    await db.exec(await fs.readFile("supabase/migrations/20261029013613_compact_model_evaluation_storage.sql","utf8"));
    await db.exec(await fs.readFile("supabase/migrations/20261029021624_compact_capture_order_fence.sql","utf8"));
    await db.exec(await fs.readFile("supabase/migrations/20261029022833_sleeper_baseline_evaluation.sql","utf8"));
    const league=randomUUID();
    await db.query("insert into leagues(id,name,sleeper_league_id,nfl_season,league_season) values($1::uuid,'Compact fixture',$1::text,2026,1)",[league]);
    for(const m of models) await db.query(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
      values($1,$2,$3::integer,'Test Team',$3::text,'Test',$3::text,'Test')`,[m.id,league,m.roster_id]);
    const version=(await db.query("select active_id from model_controls where league_id=$1",[league])).rows[0].active_id;
    await db.exec("set request.jwt.claim.role='service_role'");
    const make=()=>{const id=randomUUID(),c=compactForecastPayload(inputs[0].payload);
      for(const q of c.payload.quotes)q.metadata.assessment_run_id=id;
      c.payload.pregame_cutoff="2030-01-01T00:00:00Z";
      return {id,...c};};
    const save=async(c,category="Matchups")=>db.query("select save_model_forecast($1,$2,2026,7,$3,$4,$5::jsonb,$6::jsonb)",
      [c.id,league,category,version,JSON.stringify(c.context),JSON.stringify(c.payload)]);
    const first=make();first.payload.generated_at=new Date(Date.now()-120000).toISOString();await save(first);await save(first);
    const middle=make();middle.payload.generated_at=new Date(Date.now()-60000).toISOString();await save(middle);
    const last=make();last.payload.generated_at=new Date(Date.now()-30000).toISOString();await save(last);
    await save(first);await save(middle);
    assert.equal((await db.query("select run_id from model_evaluation_samples where horizon='final_pregame'")).rows[0].run_id,last.id,"Delayed retries cannot replace the newest final capture");
    const collision=structuredClone(first);collision.payload.quotes[0].odds=200;await assert.rejects(save(collision),/collision/);
    for(let i=0;i<100;i++)await save(make());
    assert.equal((await db.query("select count(*)::int n from model_evaluation_samples")).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from model_forecast_runs")).rows[0].n,0);
    assert.equal((await db.query("select run_id from model_evaluation_samples where horizon='opening'")).rows[0].run_id,first.id);
    assert.equal((await db.query("select count(*)::int n from model_prediction_contexts")).rows[0].n,1);
    const source=(await db.query("select payload::text p from model_evaluation_samples limit 1")).rows[0].p;
    assert(!source.includes("FORBIDDEN_PROVIDER_BODY"));assert(!source.includes("scoring_settings"));
    assert(source.includes("sleeper_projection"));
    const unknown=make();delete unknown.payload.pregame_cutoff;await save(unknown);
    const after=make();after.payload.pregame_cutoff="2000-01-01";await save(after);
    assert.equal((await db.query("select skipped_requests::int n from model_evaluation_health")).rows[0].n,2);
    assert.equal((await db.query("select eligible_gaps::int n from model_evaluation_coverage")).rows[0].n,1,"Expected post-kickoff refreshes are not failed pregame captures");
    const bad=make();bad.payload.quotes[0].team_id=randomUUID();await assert.rejects(save(bad),/outside league/);
    const context=(await db.query("select id from model_prediction_contexts where league_id=$1",[league])).rows[0].id;
    const filler=async(index,payload)=>db.query(`insert into model_evaluation_samples(run_id,league_id,nfl_season,market_week,category,horizon,
      cutoff,model_version,context_version,payload) values($1,$2,$3,$4,$5,$6,'2030-01-01',$7,$8,$9::jsonb)`,
      [randomUUID(),league,2024+Math.floor(index/144),Math.floor(index/8)%18+1,
        ["Matchups","Player Points","Weekly Specials","Season Futures"][Math.floor(index/2)%4],
        index%2?"final_pregame":"opening",version,context,JSON.stringify(payload)]);
    // Seed pressure only in this disposable database. The normal writer's caps
    // must refuse new optional evidence without removing pending evidence.
    const small=make().payload;delete small.pregame_cutoff;
    for(let i=0;i<254;i++)await filler(i,small);
    await save(make(),"Player Points");
    assert.equal((await db.query("select last_gap_reason from model_evaluation_health")).rows[0].last_gap_reason,"row_budget");
    assert.equal((await db.query("select count(*)::int n from model_evaluation_samples")).rows[0].n,256);
    await db.exec("delete from model_evaluation_samples where nfl_season<>2026");
    let index=0;
    for(;;) {
      const used=Number((await db.query("select sum(payload_bytes)::bigint n from model_evaluation_samples")).rows[0].n);
      if(8388608-used<=500)break;
      const blank={...small,padding:""};
      const overhead=(await db.query("select octet_length(($1::jsonb)::text)::int n",[JSON.stringify(blank)])).rows[0].n;
      const padding=Math.min(250000,8388608-used-500)-overhead;
      if(padding<0)break;
      await filler(index++,{...small,padding:"x".repeat(padding)});
    }
    const beforeBytes=Number((await db.query("select sum(payload_bytes)::bigint n from model_evaluation_samples")).rows[0].n);
    await save(make(),"Player Points");
    assert.equal((await db.query("select last_gap_reason from model_evaluation_health")).rows[0].last_gap_reason,"byte_budget");
    assert.equal(Number((await db.query("select sum(payload_bytes)::bigint n from model_evaluation_samples")).rows[0].n),beforeBytes);
    assert(beforeBytes<=8388608);
    await db.exec("delete from model_evaluation_samples where nfl_season<>2026");
    for(let i=0;i<63;i++)await db.query("insert into model_prediction_contexts(league_id,fingerprint,scoring_settings,roster_positions) values($1,$2,'{}','[]')",[league,`fixture-${i}`]);
    const newContext=make();newContext.context.scoring_settings={pts:2};await save(newContext);
    assert.equal((await db.query("select last_gap_reason from model_evaluation_health")).rows[0].last_gap_reason,"context_budget");
    assert.equal((await db.query("select count(*)::int n from model_evaluation_samples")).rows[0].n,2);
    const metadata=make();metadata.payload.quotes[0].metadata.expected_points={raw};await assert.rejects(save(metadata),/numeric metadata/);
    await db.exec("set row_security=on;set request.jwt.claim.role='authenticated';set role authenticated;");
    for(const table of ["model_evaluation_samples","model_prediction_contexts","sportsbook_evaluation_runs"])
      await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
    await assert.rejects(save(make()),/admin/);
    assert.equal((await db.query("select count(*)::int n from model_evaluation_health")).rows[0].n,0);
    await db.exec("reset role;set role anon;");await assert.rejects(save(make()),/permission denied/);
  } finally {await db.close();}
  console.log("Compact predictions preserve all assessed metrics, omit raw bodies/simulations, keep two slots across 100 refreshes, enforce row/byte/context caps and deny unauthorized access.");
} finally {
  const root=await fs.realpath("node_modules"),target=await fs.realpath(folder);
  assert(target.startsWith(root+path.sep));
  await fs.rm(target,{recursive:true,force:true});
}
