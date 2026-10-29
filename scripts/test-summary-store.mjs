import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {summarizeEvaluation} from '../api/_lib/evaluation-summary.ts';
const db=new PGlite(),query=async(sql,args=[])=> (await db.query(sql,args)).rows;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 await db.exec(await fs.readFile('supabase/migrations/20261029034008_compact_weekly_summary_store.sql','utf8'));
 const league=randomUUID(),job=randomUUID(),context='c'.repeat(64),outcome=randomUUID();
 await query(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor) values($1::uuid,'Summary test',$1::text,2026,1,2,now())`,[league]);
 const version=(await query('select active_id from model_controls where league_id=$1',[league]))[0].active_id;
 await query(`insert into automation_jobs(id,league_id,event_key,operation,market_week,status,attempts,lease_until)
 values($1,$2,'summary-test','model_review',1,'running',1,now()+interval '5 minutes')`,[job,league]);
 await query(`insert into model_outcome_revisions(id,league_id,nfl_season,market_week,outcome_hash,outcome)
 values($1,$2,2026,1,'test','{"final":true,"completed_period":true,"confirmed_games_final":true}')`,[outcome,league]);
 for(const hash of ['a','b','d'])await query(`insert into model_weekly_reviews(league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison)
 values($1,2026,1,$2,$3,$4::jsonb,'{}')`,[league,outcome,hash.repeat(64),JSON.stringify({status:'complete',summary_context_hash:context})]);
 const report={scores:[{view:'actual_starters',horizon:'opening',model_version:version,predicted:100,actual:102,sd:15,sleeper_predicted:101}],
 players:[],markets:[{kind:'moneyline',horizon:'opening',model_version:version,p:0.6,status:'WON'}],coverage:{selected_runs:1,missing_families:[]}};
 const summary=summarizeEvaluation(report),started=new Date(Date.now()-20000).toISOString();
 await db.exec("set request.jwt.claim.role='service_role'");
 const save=async(hash='a',body=summary,at=started,attempt=1)=> (await query('select save_evaluation_summary($1,$2,$3,$4,$5,$6::jsonb) revision',
 [job,attempt,context,hash.repeat(64),at,JSON.stringify(body)]))[0].revision;
 assert.equal(await save(),1);const first=(await query('select * from model_evaluation_summaries'))[0];
 assert.equal(await save(),1);assert.equal((await query('select known_at from model_evaluation_summaries'))[0].known_at.toISOString(),first.known_at.toISOString());
 const corrected=summarizeEvaluation({...report,scores:[{...report.scores[0],actual:103}]});
 await assert.rejects(save('a',corrected),/identity collision/);
 assert.equal(await save('b',corrected,new Date(Date.now()-10000).toISOString()),2);
 assert.equal(await save('d',summary,new Date(Date.now()-15000).toISOString()),2,'Older correction cannot overwrite newer summary');
 await assert.rejects(save('z'),/Confirmed scoped review/);
 await assert.rejects(save('a',summary,started,2),/lease/);
 await assert.rejects(save('a',{...summary,provider:{raw:'forbidden'}}),/Unexpected summary field/);
 const malformed=structuredClone(summary);malformed.markets[0].totals.bands[0].n=-1;
 await assert.rejects(save('a',malformed),/Invalid/);
 const missingDimension=structuredClone(summary);delete missingDimension.scores[0].model_version;
 await assert.rejects(save('a',missingDimension),/outside league/);
 const wrongVersion=structuredClone(summary);wrongVersion.scores[0].model_version=randomUUID();
 await assert.rejects(save('a',wrongVersion),/outside league/);
 const admin=randomUUID(),team=randomUUID();
 await query("insert into auth.users values($1,'summary-admin@example.test',now())",[admin]);
 await query(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
  values($1,$2,1,'Synthetic','fixture','Synthetic','fixture','Synthetic')`,[team,league]);
 await query("insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role) values($1,$2,$3,'summary-admin@example.test','Synthetic','fixture','admin')",[league,team,admin]);
 await db.exec('set row_security=on;set role authenticated');
 await query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 assert.equal((await query('select * from model_evaluation_summaries')).length,1,'Authorized admin can read compact summaries');
 await query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
 assert.equal((await query('select * from model_evaluation_summaries')).length,0);
 await assert.rejects(save(),/permission denied/);
 await db.exec('reset role;set role anon');
 await assert.rejects(query('select * from model_evaluation_summaries'),/permission denied/);
 console.log('Summary persistence requires a confirmed scoped review and current lease; idempotency, immutable known-at on retry, corrected revisions, stale correction fencing and role/tenant denial passed. No expiry is active.');
}finally{await db.close();}
