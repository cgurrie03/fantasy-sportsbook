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
 for(const file of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='20261028210237'))await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
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


 const staff=member,unverified=randomUUID(),C=randomUUID();
 await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season) values($1,'Foreign league',$2,2026,1)`,[C,C]);
 for(let i=1;i<=2;i++)await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name) values($1,$2,$3,'Unclaimed fantasy team','fixture','Fixture','fixture','Fixture')`,[randomUUID(),B,i]);
 await q('insert into auth.users values($1,$2,null)',[unverified,'unverified@example.test']);
 await assert.rejects(q('insert into sportsbook_private.platform_owners(user_id) values($1)',[unverified]),/verified/);
 await q('insert into sportsbook_private.platform_owners(user_id) values($1)',[owner]);
 await assert.rejects(q('delete from sportsbook_private.platform_owners where user_id=$1',[owner]),/last platform owner/);
 const act=user=>db.exec(`reset role;set row_security=on;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 const caps=async league=>(await q('select league_capabilities($1) value',[league]))[0].value;
 const grant=async(role='operator',active=true,expected=null)=>(await q('select set_league_staff($1,$2,$3,$4,$5,$6) revision',[B,staff,role,active,'Verified oversight access',expected]))[0].revision;
 await act(owner);
 assert.equal((await caps(B)).configure,true,'platform owner can oversee the second league without joining it');
 assert.equal((await caps(B)).team_id,null);assert.equal((await caps(B)).bet,false);
 assert.equal(await grant(),1);
 await assert.rejects(grant('operator',false,0),/changed/);
 await act(staff);
 assert.equal((await caps(B)).admin,true);assert.equal((await caps(B)).configure,false);assert.equal((await caps(B)).bet,false);assert.equal((await caps(B)).team_id,null);
 assert.equal(await caps(C),null,'staff grant does not reveal another tenant');
 assert.equal((await caps(A)).team_id!==null,true,'participant A is distinct from staff-only B');
 assert.equal((await q('select count(*)::int n from teams where league_id=$1',[B]))[0].n,2,'unclaimed fantasy teams remain visible');
 await assert.rejects(q('select place_sportsbook_ticket($1,1,array[$2::uuid],10,$3)',[foreign,randomUUID(),randomUUID()]),/approved league account/);
 assert.equal((await q('select count(*)::int n from league_memberships where league_id=$1',[B]))[0].n,0,'staff user has no fabricated membership');
 await assert.rejects(q("select save_league_identity($1,'Changed league','','Trying an unauthorized edit')",[B]),/platform owner/);
 await assert.rejects(q('select set_weekly_automation($1,true)',[B]),/platform owner/);
 await assert.rejects(q("select configure_weekly_schedule($1,false,true,true,true,'10:00','11:00','12:00')",[B]),/platform owner/);
 await assert.rejects(q("select control_model($1,'pause','Trying a model policy change')",[B]),/owner/);
 await assert.rejects(grant(),/owner/);
 await assert.rejects(q('insert into sportsbook_private.platform_owners(user_id) values($1)',[staff]),/permission/);
 await assert.rejects(q('delete from league_staff_audit'),/permission/);
 await act(owner);assert.equal(await grant('viewer',true,1),2);
 await act(staff);assert.equal((await caps(B)).view,true);assert.equal((await caps(B)).admin,false);
 await act(owner);assert.equal(await grant('viewer',false,2),3);
 await act(staff);assert.equal(await caps(B),null,'revocation takes effect at the next database request');
 await act(owner);assert.equal((await q('select count(*)::int n from league_staff_audit'))[0].n,3);
 assert((await q('select actor_id from league_staff_audit')).every(r=>r.actor_id===owner));
 await db.exec('reset role;');
 assert.equal((await q('select count(*)::int n from league_memberships where user_id=$1 and league_id=$2',[staff,B]))[0].n,0);
 assert.equal((await q('select count(*)::int n from wallets w join teams t on t.id=w.team_id where t.league_id=$1',[B]))[0].n,0);
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(q('select league_capabilities($1)',[B]),/permission/);}
 console.log('Passed explicit verified owner binding/last-owner protection, teamless owner/operator/viewer capabilities, no fabricated memberships/wallets, owner-only configuration/admission, versioned grant/revocation, immutable audit and cross-tenant/role denials. Local foundation only; milestone 16 UI/API/import/policy integration remains.');
}finally{await db.close();}
