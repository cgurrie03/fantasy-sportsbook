import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {retireRoutinePayloads} from '../../api/_lib/routine-retention.ts';
const db=new PGlite(),q=async(s,a=[])=>(await db.query(s,a)).rows;
const A=randomUUID(),B=randomUUID(),admin=randomUUID(),alertJob=randomUUID(), teams=new Map();
let hardened=false;
try {
 assert.deepEqual(await retireRoutinePayloads({rpc:()=>{throw new Error('offline');}}),{failed:true});
 assert.deepEqual(await retireRoutinePayloads({rpc:(name,args)=>{assert.equal(name,'cleanup_routine_payloads');assert.equal(args.p_limit,10);return {abortSignal:async signal=>{assert(signal instanceof AbortSignal);return {data:{retired_email_bodies:1},error:null};}};}}),{retired_email_bodies:1});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 const files=(await fs.readdir('supabase/migrations')).sort().filter(f=>f>='202610280055'&&f<'20261118');
 for(const f of files.filter(f=>f<'20261030002655'))await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
 for(const id of [A,B])await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)
 values($1,'Routine fixture',($1::uuid)::text,2026,1,5,now())`,[id]);
 for(const league of [A,B]){const team=randomUUID();teams.set(league,team);await q("insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name) values($1,$2,1,'Fixture','x','X','x','X')",[team,league]);await q("insert into league_memberships(league_id,team_id,invited_email,display_name,sleeper_user_id,role) values($1,$2,'fixture@example.test','Fixture','x','admin')",[league,team]);}
 await q("insert into auth.users values($1,'fixture@example.test',now())",[admin]);
 await q('update league_memberships set user_id=$1',[admin]);
 await q("insert into automation_jobs(id,league_id,event_key,operation,market_week,status)values($1,$2,($1::uuid)::text,'recheck',5,'done')",[alertJob,A]);
 const email=async(status='sent',extra={})=>hardened?(await q(`insert into outbound_emails(league_id,event_key,kind,recipient,market_week,payload,status,sent_at,lease_until,provider_id,staff_user_id,staff_context)
 values($1,$2,'attention','fixture@example.test',5,$3,$4,now()-interval '8 days',$5,'provider-immutable',$6,$7)returning id`,
 [extra.league??A,extra.key??randomUUID(),JSON.stringify({to:['fixture@example.test'],html:'original body',text:'original text'}),status,extra.lease??null,admin,
 JSON.stringify({contract:'staff-attention-v1',league_id:extra.league??A,user_id:admin,job_id:alertJob,category:'automation',operation:'recheck',nfl_season:2026,market_week:5,queued_at:new Date().toISOString()})]))[0].id:(await q(`insert into outbound_emails(league_id,event_key,kind,recipient,market_week,payload,status,sent_at,lease_until,provider_id,team_id)
 values($1,$2,'attention','fixture@example.test',5,$3,$4,now()-interval '8 days',$5,'provider-immutable',$6) returning id`,
 [extra.league??A,extra.key??randomUUID(),JSON.stringify({to:['fixture@example.test'],html:'original body',text:'original text'}),status,extra.lease??null,teams.get(extra.league??A)]))[0].id;
 const legacy=await email();
 for(const f of files.filter(f=>f>='20261030002655'))await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
 hardened=true;
 const body=await email(),pending=await email('pending'),failed=await email('failed'),review=await email('needs_review'),sending=await email('sending');
 const leased=await email('sent',{lease:new Date(Date.now()+3600000).toISOString()}),foreign=await email('sent',{league:B});
 const revoked=await email('sent',{league:B});
 const beforeRows=await q('select * from outbound_emails where id=any($1::uuid[])',[ [legacy,pending,failed,review,sending,leased] ]);
 const job=async(status='done',summary={tickets:[1,2],balance:22})=>(await q(`insert into automation_jobs(league_id,event_key,operation,market_week,status,summary,completed_at)
 values($1,$2,'settle',5,$3,$4,now()-interval '31 days') returning id`,[A,randomUUID(),status,JSON.stringify(summary)]))[0].id;
 const done=await job(),retry=await job('failed'),running=await job('running');
 const image=async()=>(await q("insert into promo_images(league_id,png,created_at) values($1,$2,now()-interval '8 days') returning id",[A,'a'.repeat(40)]))[0].id;
 const orphan=await image(),referenced=await image();
 // Minimal scheduled offer; financial references keep its image regardless of age.
 const columns=await q("select column_name,column_default,is_nullable from information_schema.columns where table_name='promo_offers'");
 assert(columns.length>0);
 await q(`insert into promo_offers(league_id,nfl_season,market_week,slot,kind,title,description,image_id,expires_at,status,terms)
 values($1,2026,5,1,'boost','Protected','Protected art',$2,now()+interval '1 day','scheduled','{"criterion":"points_min","count":5,"percent":50,"max_stake":20}')`,[A,referenced]);
 const financial=async()=>(await q(`select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(x)) from wallets x),
 'tickets',(select jsonb_agg(to_jsonb(x)) from tickets x),'ledger',(select jsonb_agg(to_jsonb(x)) from wallet_ledger x),
 'runs',(select jsonb_agg(to_jsonb(x)) from weekly_execution_runs x),'offers',(select jsonb_agg(to_jsonb(x)) from promo_offers x)) r`))[0].r;
 await db.exec(`create or replace function public.application_environment_identity() returns jsonb language sql stable as $$select '{"environment":"development","project_ref":"whlcnlacueweaqpsupqs"}'::jsonb$$`);
 await db.exec(await fs.readFile('visual/server/storage-efficiencies.sql','utf8'));
 // Local historical-art fixtures only; fresh art rejection is tested separately.
 await db.exec('alter table promo_images disable trigger storage_no_persistent_art');
 const beforeFinancial=await financial();
 await q('delete from league_memberships where league_id=$1',[B]);
 await db.exec("set request.jwt.claim.role='service_role';set role service_role;");
 const result=(await q('select cleanup_routine_payloads(1) r'))[0].r;
 assert.equal(result.retired_email_bodies,1);assert.equal(result.retired_job_diagnostics,1);assert.equal(result.removed_orphan_images,1);
 await q('select cleanup_routine_payloads(25)');await db.exec('reset role');
 for(const id of [body,foreign,revoked]){const e=(await q('select * from outbound_emails where id=$1',[id]))[0];assert.equal(e.payload,null);assert(e.body_retired_at);assert.equal(e.provider_id,'provider-immutable');}
 assert.deepEqual(await q('select * from outbound_emails where id=any($1::uuid[])',[[legacy,pending,failed,review,sending,leased]]),beforeRows);
 assert.equal((await q('select summary from automation_jobs where id=$1',[done]))[0].summary.detail_unavailable,true);
 for(const id of [retry,running])assert.deepEqual((await q('select summary from automation_jobs where id=$1',[id]))[0].summary,{tickets:[1,2],balance:22});
 assert.equal((await q('select count(*)::int n from promo_images where id=$1',[orphan]))[0].n,0);
 assert.equal((await q('select count(*)::int n from promo_images where id=$1',[referenced]))[0].n,1);
 assert.deepEqual(await financial(),beforeFinancial);
 await assert.rejects(q("update outbound_emails set status='pending' where id=$1",[body]),/cannot be resent/);
 const key=(await q('select event_key from outbound_emails where id=$1',[body]))[0].event_key;
 await assert.rejects(email('sent',{key}),/duplicate key/);
 await assert.rejects(q('update outbound_emails set payload=$2 where id=$1',[pending,JSON.stringify({to:['fixture@example.test'],html:'x'.repeat(262144)})]),/capacity reached/);
 const largeBody=JSON.stringify({to:['fixture@example.test'],html:'x'.repeat(261900)});
 for(let i=0;i<32;i++){const id=await email('pending');await q('update outbound_emails set payload=$2 where id=$1',[id,largeBody]);}
 const denied=await email('pending');await assert.rejects(q('update outbound_emails set payload=$2 where id=$1',[denied,largeBody]),/capacity reached/);
 const oversized=await job('done',{huge:'x'.repeat(65536)});
 assert((await q('select summary,diagnostic_retired_at from automation_jobs where id=$1',[oversized]))[0].diagnostic_retired_at);
 for(let i=0;i<127;i++)await image();
 await assert.rejects(image(),/capacity reached/);
 assert.deepEqual((await q("select has_table_privilege('boff_routine_retention','wallets','select') financial_select,has_table_privilege('boff_routine_retention','outbound_emails','delete') outbox_delete,has_column_privilege('boff_routine_retention','automation_jobs','status','update') job_status_update"))[0],{financial_select:false,outbox_delete:false,job_status_update:false});

 await db.exec(`set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${admin}';set role authenticated`);
 const health=(await q('select routine_retention_status($1) r',[A]))[0].r;assert(health.logical_bytes_only);assert(health.email.unresolved>30);assert.equal(health.images.count,128);
 await db.exec('reset role;set request.jwt.claim.sub=\'\';set role boff_routine_retention');
 await assert.rejects(q('select * from wallets'),/permission denied|row-level security/);
 await assert.rejects(q('delete from outbound_emails'),/permission denied|row-level security/);
 await assert.rejects(q("update automation_jobs set status='done'"),/permission denied|row-level security/);
 await db.exec("reset role;set request.jwt.claim.role='authenticated';set role authenticated");
 await assert.rejects(q('select routine_retention_status($1)',[A]),/operator only/);
 await assert.rejects(q('select cleanup_routine_payloads(1)'),/permission denied|row-level security/);
 console.log('Passed prospective TTL/batch, unresolved/lease/legacy preservation, immutable duplicate/provider receipts, referenced media, row/image admission, diagnostic fallback, financial equality and restricted-role ACL tests.');
}finally{await db.close();}
