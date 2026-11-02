import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {marketCategories,marketCategory} from '../src/lib/market-categories.ts';
const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const owner=randomUUID(),member=randomUUID(),A=randomUUID(),B=randomUUID(),weekly=randomUUID(),future=randomUUID(),foreign=randomUUID();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const file of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='202610280055'))await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
 for(const [id,email]of[[owner,'category-owner@example.test'],[member,'category-member@example.test']])await q('insert into auth.users values($1,$2,now())',[id,email]);
 for(const league of [A,B])await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)
  values($1::uuid,'Category fixture',($1::uuid)::text,2026,1,5,now())`,[league]);
 for(const [user,role,i]of[[owner,'admin',1],[member,'member',2]]){const team=randomUUID();
  await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
   values($1,$2,$3,'Category team','fixture','Fixture','fixture','Fixture')`,[team,A,i]);
  await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)
   values($1,$2,$3,$4,'Fixture user','fixture',$5)`,[A,team,user,user===owner?'category-owner@example.test':'category-member@example.test',role]);
 }
 for(const [id,league,type]of[[weekly,A,'weekly'],[future,A,'future'],[foreign,B,'weekly']])await q(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)
  values($1,$2,$3,2026,1,now()-interval '1 hour',now()+interval '1 hour','published',$4)`,[id,league,type==='future'?1:5,type]);

 const service=()=>db.exec('reset role;set role service_role;');
 const context='a'.repeat(64),other='b'.repeat(64);
 const claim=async(scope='league',key=A,c=context)=>(await q('select claim_starter_status($1,$2,$3) value',[scope,key,c]))[0].value;
 const publish=async(scope,key,c,token,payload,checked=new Date().toISOString())=>(await q('select publish_starter_status($1,$2,$3,$4,$5::jsonb,$6) value',[scope,key,c,token,JSON.stringify(payload),checked]))[0].value;
 await db.exec(`set row_security=on;select set_config('request.jwt.claim.sub','${member}',false);set role authenticated;`);
 assert.equal((await q('select starter_status_access($1) value',[A]))[0].value.nfl_season,2026);
 assert.equal((await q('select starter_status_access($1) value',[B]))[0].value,null);
 await assert.rejects(claim(),/permission/);await assert.rejects(q('select * from starter_status_cache'),/permission/);
 await service();
 const first=await claim();assert.equal(first.state,'claimed');assert.equal((await claim()).state,'busy');
 assert.equal(await publish('league',A,context,randomUUID(),{safe:true}),false);
 assert.equal(await publish('league',A,context,first.token,{safe:true}),true);
 const hit=await claim();assert.deepEqual(hit.payload,{safe:true});assert.equal(hit.state,'hit');
 const changed=await claim('league',A,other);assert.equal(changed.state,'claimed');
 assert.equal(await publish('league',A,context,first.token,{old:true}),false);
 await q('select fail_starter_status($1,$2,$3,$4)',['league',A,other,changed.token]);
 assert.equal((await claim('league',A,other)).state,'unavailable');
 await db.exec(`update starter_status_cache set retry_after=now()-interval '1 second';`);
 const retry=await claim('league',A,other);assert.equal(retry.state,'claimed');
 await assert.rejects(publish('league',A,other,retry.token,{blob:'x'.repeat(32768)}),/check constraint/);
 assert.equal(await publish('league',A,other,retry.token,{old:true},new Date(Date.now()-60000).toISOString()),false);
 await db.exec(`update starter_status_cache set lease_until=now()-interval '1 second';`);
 assert.equal(await publish('league',A,other,retry.token,{late:true}),false);
 const next=await claim('league',A,other);assert.notEqual(next.token,retry.token);
 assert.equal(await publish('league',A,other,next.token,{fresh:true}),true);
 const publicClaim=await claim('players','current');assert.equal(await publish('players','current',context,publicClaim.token,{one:{team:'BUF'}}),true);
 const ttl=(await q("select extract(epoch from expires_at-checked_at) ttl from starter_status_cache where scope='players'"))[0].ttl;assert.equal(Number(ttl),86400);
 // Fixed admission ceiling includes both live payloads and outstanding leases.
 for(let i=0;i<129;i++)await claim('league',randomUUID());
 await assert.rejects(claim('league',randomUUID()),/admission budget/);
 await db.exec(`update starter_status_cache set lease_until=now()-interval '1 second',expires_at=now()-interval '1 second';`);
 assert.equal((await claim('league',randomUUID())).state,'claimed');
 assert((await q('select count(*)::int n from starter_status_cache'))[0].n<=131);
 for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(claim(),/permission/);}
 console.log('Passed service-only starter cache, member config access, lease coalescing/fencing, failure backoff, source-time TTLs, row/byte admission and expired-slot reclamation.');
}finally{await db.close();}
