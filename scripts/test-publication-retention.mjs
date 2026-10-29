import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {settleLeg} from '../api/_lib/settlement.ts';
import {scoreRows,deduplicateForecasts} from '../src/lib/reporting.ts';
const db=new PGlite(),rows=async(q,p=[])=> (await db.query(q,p)).rows;
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const migration of ['20261028210237_bounded_model_review_reads','20261029013613_compact_model_evaluation_storage',
  '20261029021624_compact_capture_order_fence','20261029022833_sleeper_baseline_evaluation','20261029030255_compact_published_forecasts',
  '20261029031348_observed_publication_sample_budget'])
  await db.exec(await fs.readFile(`supabase/migrations/${migration}.sql`,'utf8'));
 const league=randomUUID(),other=randomUUID(),admin=randomUUID();
 for(const id of [league,other])await rows(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor) values($1::uuid,'Publication test',$1::text,2026,1,1,now())`,[id]);
 await rows('insert into auth.users(id,email,email_confirmed_at) values($1,\'synthetic@example.test\',now())',[admin]);
 const home=randomUUID(),away=randomUUID();
 for(const [i,id] of [home,away].entries())await rows(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
  values($1,$2,$3::integer,'Synthetic',$3::text,'Synthetic',$3::text,'Synthetic')`,[id,league,i+1]);
 await rows("insert into league_memberships(league_id,user_id,team_id,role,display_name,invited_email,sleeper_user_id) values($1,$2,$3,'admin','Synthetic','synthetic@example.test','1')",[league,admin,home]);
 const board=randomUUID(),future=randomUUID();
 for(const [id,type] of [[board,'weekly'],[future,'future']])await rows(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)
 values($1,$2,1,2026,1,now()-interval '1 hour',now()+interval '1 day','published',$3)`,[id,league,type]);
 const run=randomUUID(),metadata={assessment_run_id:run,simulated_probability:0.6,fair_probability:0.6,model_version:'synthetic',
  home_eligible_players:[{id:'p',positions:['QB']}],roster_positions:['QB'],home_lineup:'FORBIDDEN_BODY'.repeat(10000),
  player_id:'p',expected_team_count:2,projection_targets:{[home]:100,[away]:90},win_distribution:{7:0.5,8:0.5},roster_id:1};
 for(const [id,kind] of [[board,'moneyline'],[future,'future_champion']])await rows(`insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,home_team_id,away_team_id,home_projection,away_projection,metadata)
 values($1,$2,$3,$3,'Synthetic label','Synthetic subject',$4,-110,$5,$6,100,90,$7::jsonb)`,[randomUUID(),id,kind,kind==='moneyline'?'home':'win',home,away,JSON.stringify(metadata)]);
 for(let i=1;i<=100;i++){
  await rows('update sportsbook_boards set revision=$2 where id=$1',[board,i]);
  await rows('update sportsbook_markets set home_projection=$2 where board_id=$1',[board,99+i]);
  await rows('select sportsbook_private.capture_forecast($1)',[board]);
 }
 await rows('select sportsbook_private.capture_forecast($1)',[board]);
 const sample=await rows('select * from published_forecast_samples where board_id=$1 order by revision',[board]);
 assert.equal(sample.length,2);assert.deepEqual(sample.map(r=>r.revision),[1,100]);
 assert.equal(sample[0].quotes[0].home_projection,100);assert.equal(sample[1].quotes[0].home_projection,199);
 assert(!JSON.stringify(sample).includes('FORBIDDEN_BODY'));assert(!('home_eligible_players' in sample[0].quotes[0].metadata));
 assert.equal((await rows('select count(*)::int n from forecast_snapshots'))[0].n,0);
 const full={...sample[0].quotes[0],metadata},outcome={final:true,teams:{[home]:{points:110,name:'H'},[away]:{points:90,name:'A'}},players:{}};
 assert.deepEqual(settleLeg({id:'leg',accepted_line:null,settlement_context:full},outcome),
  settleLeg({id:'leg',accepted_line:null,settlement_context:sample[0].quotes[0]},outcome));
 const scores=[{nfl_season:2026,market_week:1,final:true,results:{[home]:{points:110,projection:90,matchup_id:1}}}];
 assert.deepEqual(scoreRows(scores,[sample[0]]),scoreRows(scores,[{...sample[0],quotes:[full]}]));
 assert.equal(deduplicateForecasts(sample)[0].revision,1);
 await rows("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 const replacement={...sample[1].quotes[0],home_projection:201};
 await rows("select save_market_board($1,$2,1,now()-interval '1 hour',now()+interval '1 day',$3::jsonb,'published')",[board,league,JSON.stringify([replacement])]);
 assert.equal((await rows('select count(*)::int n from published_forecast_samples where board_id=$1',[board]))[0].n,2);
 assert.equal((await rows("select quotes->0->>'home_projection' as projection from published_forecast_samples where board_id=$1 and horizon='latest_pregame'",[board]))[0].projection,'201.00');
 assert.equal((await rows('select count(*)::int n from forecast_snapshots'))[0].n,0,'Real board save invokes only compact capture');
 await rows('select sportsbook_private.capture_forecast($1)',[future]);
 assert.equal((await rows('select * from published_forecast_samples where board_id=$1',[future])).length,2);
 // Advance the authoritative week: the same futures board gets two new horizon slots.
 await rows('update leagues set active_week=2,week_anchor=now() where id=$1',[league]);
 await rows('update sportsbook_boards set revision=2 where id=$1',[future]);
 await rows('select sportsbook_private.capture_forecast($1)',[future]);
 assert.equal((await rows('select * from published_forecast_samples where board_id=$1',[future])).length,4);
 await rows('update sportsbook_boards set phase=\'live\',revision=102 where id=$1',[board]);
 await rows('select sportsbook_private.capture_forecast($1)',[board]);
 assert.equal((await rows('select max(revision)::int n from published_forecast_samples where board_id=$1',[board]))[0].n,101);
 // A legacy opening is selected before JSON expansion, and remains immutable.
 await rows(`insert into forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,opens_at,closes_at,captured_at,quotes)
 values($1,$2,1,2026,1,'weekly',now(),now()+interval '1 day',now()-interval '1 hour',$3::jsonb),
 ($1,$2,2,2026,1,'weekly',now(),now()+interval '1 day',now()+interval '1 hour',$3::jsonb)`,[league,board,JSON.stringify([full])]);
 assert.equal((await rows('select count(*)::int n from sportsbook_report_forecasts where board_id=$1',[board]))[0].n,3);
 await assert.rejects(rows("update forecast_snapshots set quotes='[]'"),/append-only/i);
 // Admission pressure never removes pending samples or prevents current state.
 await rows('update sportsbook_boards set phase=\'pregame\',revision=103 where id=$1',[board]);
 await rows(`update published_forecast_samples set quotes=jsonb_build_array(repeat('x',524280)) where board_id=$1`,[future]);
 await rows(`insert into published_forecast_samples(league_id,board_id,revision,nfl_season,market_week,board_type,horizon,captured_at,opens_at,closes_at,quotes)
 select $1,$2,1,1900+s,1,'weekly','opening',now(),now(),now()+interval '1 day',jsonb_build_array(repeat('x',524280)) from generate_series(1,28) s`,[league,board]);
 await rows('select sportsbook_private.capture_forecast($1)',[board]);
 assert.equal((await rows('select last_gap_reason from published_forecast_health where league_id=$1',[league]))[0].last_gap_reason,'byte_budget');
 assert.equal((await rows('select revision from sportsbook_boards where id=$1',[board]))[0].revision,103);
 await rows(`insert into published_forecast_samples(league_id,board_id,revision,nfl_season,market_week,board_type,horizon,captured_at,opens_at,closes_at,quotes)
 select $1,$2,1,1000+s,1,'weekly','opening',now(),now(),now()+interval '1 day','[]'::jsonb from generate_series(1,222) s`,[league,board]);
 await rows('update sportsbook_boards set market_week=2 where id=$1',[board]);
 await rows('select sportsbook_private.capture_forecast($1)',[board]);
 assert.equal((await rows('select last_gap_reason from published_forecast_health where league_id=$1',[league]))[0].last_gap_reason,'row_budget');
 assert.equal((await rows('select count(*)::int n from published_forecast_samples where league_id=$1',[league]))[0].n,256);
 await db.exec('set row_security=on;set role authenticated');
 await rows("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 assert((await rows('select id from sportsbook_report_forecasts where league_id=$1',[league])).length>0);
 assert.equal((await rows('select id from sportsbook_report_forecasts where league_id=$1',[other])).length,0);
 await rows("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
 assert.equal((await rows('select * from sportsbook_report_forecasts')).length,0);
 await assert.rejects(rows('select sportsbook_private.capture_forecast($1)',[board]),/permission denied/);
 await db.exec('reset role;set role anon');
 await assert.rejects(rows('select * from sportsbook_report_forecasts'),/permission denied/);
 console.log('Publication capture: 100 refreshes -> two bounded horizons; numeric/settlement parity, no raw/roster bodies, futures week slots, retry, live exclusion, legacy immutability, budget pressure and tenant permissions passed.');
}finally{await db.close();}
