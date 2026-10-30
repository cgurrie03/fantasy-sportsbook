import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const owner=randomUUID(),member=randomUUID(),A=randomUUID(),B=randomUUID(),weekly=randomUUID(),future=randomUUID(),foreign=randomUUID();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const file of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='20261028210237'&&(!process.argv.includes('--baseline')||f<'20261029235622')))await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
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



 const staff=member,participant=randomUUID(),teamB=(await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name) values(gen_random_uuid(),$1,1,'Actual B Team','b','B','b','B') returning id`,[B]))[0].id;
 await q('insert into auth.users values($1,$2,now())',[participant,'participant-b@example.test']);
 await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role) values($1,$2,$3,'participant-b@example.test','B participant','b','member')`,[B,teamB,participant]);
 await q('insert into wallets(team_id,balance) values($1,11.25) on conflict(team_id) do update set balance=excluded.balance',[teamB]);
 await q('insert into sportsbook_private.platform_owners(user_id) values($1)',[owner]);
 const act=user=>db.exec(`reset role;set row_security=on;select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.role','authenticated',false);set role authenticated;`);
 const before=(await q("select md5(jsonb_agg(to_jsonb(w) order by team_id)::text) hash from wallets w"))[0].hash;
 await act(owner);await q("select set_league_staff($1,$2,'operator',true,'Approved independent oversight',null)",[B,staff]);
 await act(staff);
 assert.equal((await q('select count(*)::int n from wallets where team_id=$1',[teamB]))[0].n,1,'operator reads legitimate B wallet');
 assert.equal((await q('select count(*)::int n from league_memberships where league_id=$1 and user_id=$2',[B,staff]))[0].n,0);
 const report=(await q('select account_wallet_report($1) r',[B]))[0].r;assert.equal(report.total,0);
 await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false);set role service_role;");
 const image=(await q("select store_promo_image($1,$2,$3) id",[B,staff,'x'.repeat(32)]))[0].id;assert(image);
 await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false);set role service_role;");
 assert.equal((await q("select worker_operation($1,'resolve_futures','{\"kinds\":[]}'::jsonb) result",[B]))[0].result,0,'worker can use verified owner without a B participant-admin');
 await act(owner);await q("select set_league_staff($1,$2,'viewer',true,'Downgraded to view-only access',1)",[B,staff]);
 await act(staff);assert.equal((await q('select count(*)::int n from wallets where team_id=$1',[teamB]))[0].n,0,'viewer cannot inspect B wallet');
 await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false);set role service_role;");
 await assert.rejects(q('select store_promo_image($1,$2,$3)',[B,staff,'x'.repeat(32)]),/operator/);
 await assert.rejects(q('select store_promo_image($1,$2,$3)',[A,participant,'x'.repeat(32)]),/operator/);
 await db.exec('reset role;');
 assert.equal((await q("select md5(jsonb_agg(to_jsonb(w) order by team_id)::text) hash from wallets w"))[0].hash,before,'permissions change no balances');
 assert.equal((await q('select count(*)::int n from wallet_ledger'))[0].n,0);
 console.log('Passed operator/owner wallet visibility, viewer/foreign denial, service-only verified image storage, worker teamless-owner fallback, no fabricated membership and unchanged wallet/ledger data.');
}finally{await db.close();}
