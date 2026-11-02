import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {summarizeEvaluation,archivedReview} from '../api/_lib/evaluation-summary.ts';
const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const f of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='202610280055'))await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
 const A=randomUUID(),B=randomUUID(),team=randomUUID(),job=randomUUID();
 const summaries=new Map();
 for(const league of [A,B]){
  await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor) values($1::uuid,'Expiry fixture',$1::text,2026,1,5,now())`,[league]);
  const version=(await q('select active_id from model_controls where league_id=$1',[league]))[0].active_id;
  const board=randomUUID(),futureBoard=randomUUID(),context=randomUUID(),outcome=randomUUID(),review=randomUUID();
  await q(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status) values($1,$2,4,2026,1,now()-interval '20 days',now()-interval '19 days','closed')`,[board,league]);
  await q(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type) values($1,$2,1,2026,1,now()-interval '20 days',now()-interval '19 days','closed','future')`,[futureBoard,league]);
  await q(`insert into model_prediction_contexts(id,league_id,fingerprint,scoring_settings,roster_positions,created_at) values($1,$2,'fixture','{}','[]',now()-interval '20 days')`,[context,league]);
  await q(`insert into forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,captured_at,opens_at,closes_at,quotes)
   values($1,$2,999,2026,4,'weekly',now()-interval '30 days',now()-interval '30 days',now()-interval '29 days','[{"raw":"LEGACY_MUST_REMAIN"}]')`,[league,board]);
  await q(`insert into model_forecast_runs(id,league_id,nfl_season,market_week,category,phase,provenance,model_version,model_config,source_hash,sources,payload)
   values(gen_random_uuid(),$1,2026,4,'Matchups','pregame','as_of',$2,'{"score_scale":1,"variance_scale":1}','legacy','{"raw":"LEGACY_MUST_REMAIN"}','{"models":[],"pool":[],"quotes":[]}')`,[league,version]);
  const payload={retention_format:'compact-forecast-v1',models:[],pool:[],quotes:[{kind:'moneyline',metadata:{}}]};
  for(const category of ['Matchups','Season Futures'])await q(`insert into model_evaluation_samples(run_id,league_id,nfl_season,market_week,category,horizon,captured_at,cutoff,model_version,context_version,payload)
   values($1,$2,2026,4,$3,'opening',now()-interval '20 days',now()-interval '19 days',$4,$5,$6::jsonb)`,[randomUUID(),league,category,version,context,JSON.stringify(payload)]);
  if(league===A)await q(`insert into model_evaluation_samples(run_id,league_id,nfl_season,market_week,category,horizon,captured_at,cutoff,model_version,context_version,payload)
   values($1,$2,2026,3,'Matchups','opening',now()-interval '20 days',now()-interval '19 days',$3,$4,$5::jsonb)`,[randomUUID(),league,version,context,JSON.stringify(payload)]);
  for(const type of ['weekly','future'])await q(`insert into published_forecast_samples(league_id,board_id,revision,nfl_season,market_week,board_type,horizon,captured_at,opens_at,closes_at,quotes)
   values($1,$2,1,2026,4,$3,'opening',now()-interval '20 days',now()-interval '20 days',now()-interval '19 days','[]')`,[league,type==='future'?futureBoard:board,type]);
  const cycle=randomUUID();await q('insert into line_refresh_cycles(id,league_id,market_week,slot) values($1,$2,4,1)',[cycle,league]);
  await q(`insert into live_forecast_samples(league_id,nfl_season,market_week,horizon,cycle_id,captured_at,observed_at,model_version,payload)
   values($1,2026,4,2,$2,now()-interval '20 days',now()-interval '20 days','fixture','{}')`,[league,cycle]);
  await q(`insert into model_outcome_revisions(id,league_id,nfl_season,market_week,outcome_hash,outcome) values($1,$2,2026,4,'fixture','{"retention_format":"transient-evaluation-v1","raw":"RAW_OUTCOME_BODY"}')`,[outcome,league]);
  await q(`insert into model_weekly_reviews(id,league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison,created_at)
   values($1,$2,2026,4,$3,repeat('a',64),'{"status":"complete","retention_format":"transient-evaluation-v1","raw":"RAW_REVIEW_BODY"}','{"audit":"unchanged"}',now()-interval '9 days')`,[review,league,outcome]);
  const summary=summarizeEvaluation({scores:[{view:'actual_starters',horizon:'opening',model_version:version,predicted:100,actual:102,sd:15,sleeper_predicted:101}],players:[],markets:[],coverage:{selected_runs:1}});
  const pinned=randomUUID();
  await q(`insert into model_weekly_reviews(id,league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison,created_at)
   values($1,$2,2026,4,$3,repeat('b',64),$4::jsonb,'{"audit":"older-unchanged"}',now()-interval '10 days')`,[pinned,league,outcome,
    JSON.stringify({retention_format:'transient-evaluation-v1',raw:'RAW_REVIEW_BODY',score_views:[{mae:2}]})]);
  await q("insert into model_change_events(league_id,kind,from_id,to_id,review_id,reason) values($1,'promote',$2,$2,$3,'Synthetic audit reference')",[league,version,pinned]);
  const futureReport=summarizeEvaluation({futures:{opening_by_origin_week:[{kind:'future_champion',p:.5,y:league===B?1:null}]}});
  summary.future_final=futureReport.future_final;summary.futures=futureReport.futures;summaries.set(league,summary);
  await q(`insert into model_evaluation_summaries(league_id,nfl_season,market_week,context_hash,input_hash,read_started_at,known_at,summary)
   values($1,2026,4,$2,repeat('a',64),now()-interval '9 days',now()-interval '8 days',$3::jsonb)`,[league,'c'.repeat(64),JSON.stringify(summary)]);
 }
 // Both tenants have independent, confirmed synthetic summary checkpoints.
 const count=(await q('select count(*)::int n from model_evaluation_summaries'))[0].n;
 assert.equal(count,2);
 await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
  values($1,$2,1,'Financial fixture','fixture','Fixture','fixture','Fixture')`,[team,A]);
 await q('insert into wallets(team_id,balance) values($1,42)',[team]);
 await q(`insert into wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason) values($1,'fixture','historical_opening',42,null,42,'Synthetic')`,[team]);
 await q("insert into sportsbook_private.import_batches(id,source_url) values('synthetic-retention-import','https://example.invalid/synthetic')");
 const ticket=randomUUID();await q(`insert into tickets(id,league_id,team_id,source_batch,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
  values($1,$2,$3,'synthetic-retention-import',1,2026,7,7,now(),100,5,10,'OPEN',0)`,[ticket,A,team]);
 await q(`insert into ticket_legs(ticket_id,leg_number,selection,market_type,accepted_odds,accepted_line,status,result_evidence,settlement_context)
 values($1,1,'Synthetic target','Team Total',100,100,'OPEN','Saved terms','{"kind":"team_total","side":"over","metadata":{"accepted":"unchanged"}}')`,[ticket]);
 const financial=async()=>JSON.stringify(await q(`select (select jsonb_agg(to_jsonb(t) order by id) from tickets t) tickets,
  (select jsonb_agg(to_jsonb(t) order by id) from ticket_legs t) legs,(select jsonb_agg(to_jsonb(t) order by team_id) from wallets t) wallets,
  (select jsonb_agg(to_jsonb(t) order by id) from wallet_ledger t) ledger`));
 const before=await financial();
 await q(`insert into automation_jobs(id,league_id,event_key,operation,market_week,status,attempts,lease_until) values($1,$2,'active-review','model_review',4,'running',1,now()+interval '5 minutes')`,[job,A]);
 await db.exec("set request.jwt.claim.role='service_role'");
 const clean=async()=> (await q('select cleanup_evaluated_samples(10) result'))[0].result;
 assert.equal((await clean()).retired_periods,1,'Active A lease is visible to the restricted cleanup role');
 assert.equal((await q('select retired_at from model_evaluation_summaries where league_id=$1',[A]))[0].retired_at,null);
 await q("update automation_jobs set status='done',lease_until=null where id=$1",[job]);
 assert.equal((await clean()).retired_periods,1);
 assert.equal((await clean()).retired_periods,0,'Retirement is idempotent');
 assert.equal((await q("select count(*)::int n from model_evaluation_samples where league_id=$1 and category='Season Futures'",[A]))[0].n,1,'Unresolved long futures are retained');
 assert.equal((await q('select count(*)::int n from model_evaluation_samples where league_id=$1',[B]))[0].n,0,'Final evaluated futures expire');
 for(const row of await q('select report,comparison from model_weekly_reviews')){
  assert(!JSON.stringify(row.report).includes('RAW_REVIEW_BODY'));assert(['unchanged','older-unchanged'].includes(row.comparison.audit));
  assert.equal(row.report.summary?archivedReview(row.report.summary).score_views[0].mae:row.report.score_views[0].mae,2);
 }
 assert.equal((await q('select count(*)::int n from model_change_events'))[0].n,2,'Referenced decisions remain intact');
 assert(!JSON.stringify(await q('select outcome from model_outcome_revisions')).includes('RAW_OUTCOME_BODY'));
 assert.equal((await q('select unresolved_periods from evaluation_retention_health where league_id=$1',[A]))[0].unresolved_periods,2);
 assert.equal((await q('select count(*)::int n from forecast_snapshots'))[0].n,2);
 assert(JSON.stringify(await q('select sources from model_forecast_runs')).includes('LEGACY_MUST_REMAIN'));
 await assert.rejects(q("update forecast_snapshots set quotes='[]'"),/append-only/);
 assert.equal(await financial(),before,'Accepted terms, ticket status, balances and ledger remain byte-identical');
 await q("update automation_jobs set status='running',lease_until=now()+interval '5 minutes' where id=$1",[job]);
 assert((await q('select evaluation_review_checkpoint($1,1) checkpoint',[job]))[0].checkpoint.retired_at,'Retired periods use a summary-only checkpoint');
 await assert.rejects(q("select save_model_assessment($1,1,$2,$3::jsonb,$4::jsonb,'{}')",[job,'f'.repeat(64),JSON.stringify({final:true,completed_period:true,confirmed_games_final:true}),JSON.stringify({status:'complete',retention_format:'transient-evaluation-v1'})]),/correction window closed/);
 assert.equal((await q("select has_table_privilege('boff_evaluation_retention','public.wallets','DELETE') allowed"))[0].allowed,false);
 await db.exec('set row_security=on;set role boff_evaluation_retention');await assert.rejects(q('delete from wallets'),/permission denied/);await db.exec('reset role');
 await db.exec('set role authenticated');await assert.rejects(clean(),/permission denied/);await db.exec('reset role');
 console.log('Seven-day expiry, active-lease exclusion under RLS, bounded idempotent retirement, pending/final futures and exact financial preservation passed.');
}finally{await db.close();}
