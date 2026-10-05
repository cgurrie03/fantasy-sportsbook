import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const member = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const outsider = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values ('${admin}','cooper.gurrie@gmail.com',now()),('${member}','test-member@example.com',now()),('${outsider}','test-outsider@example.com',now());`)
for (const file of ['202610050001_accounts.sql', '202610050002_league_seed.sql']) {
  await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'))
}
const rows = async (sql, args=[]) => (await db.query(sql,args)).rows
const [team1,team2] = await rows('select id,league_id,roster_id from public.teams order by roster_id limit 2')
const act = async id => db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`)
const deny = async fn => assert.rejects(fn)
await act(admin)
await rows('select public.claim_memberships()')
assert.equal((await rows('select * from public.teams')).length,12)
assert.equal((await rows('select balance from public.wallets where team_id=$1',[team1.id]))[0].balance,null)
await rows('select public.approve_member($1,$2,$3,$4)',[team2.id,'test-member@example.com','Test Member','1133611823862906880'])
const req = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
await rows('select public.set_team_balance($1,125.25,$2,$3)',[team1.id,'Approved test opening',req])
await rows('select public.set_team_balance($1,125.25,$2,$3)',[team1.id,'Approved test opening',req])
assert.equal((await rows('select * from public.balance_events where team_id=$1',[team1.id])).length,1)
await deny(()=>rows('select public.set_team_balance($1,130,$2,$3)',[team1.id,'Different request',req]))
await deny(()=>rows('select public.set_team_balance($1,-1,$2,gen_random_uuid())',[team1.id,'Invalid amount']))
await deny(()=>rows('select public.set_team_balance($1,1.001,$2,gen_random_uuid())',[team1.id,'Invalid precision']))
await rows('select public.set_team_balance($1,130,$2,gen_random_uuid())',[team1.id,'Approved correction'])
const event = (await rows('select * from public.balance_events where team_id=$1 order by created_at desc,id',[team1.id])).find(x=>x.new_balance==='130.00')
assert.equal(event.previous_balance,'125.25')
assert.equal(event.kind,'admin_adjustment')
await act(member)
await rows('select public.claim_memberships()')
assert.equal((await rows('select * from public.wallets')).length,1)
assert.equal((await rows('select * from public.league_memberships')).length,1)
assert.equal((await rows('select * from public.balance_events')).length,0)
await deny(()=>rows('update public.wallets set balance=999'))
await deny(()=>rows('select public.set_team_balance($1,999,$2,gen_random_uuid())',[team1.id,'Unauthorized']))
await deny(()=>rows('select public.approve_member($1,$2,$3,$4)',[team1.id,'other@example.com','Other','1133609065776775168']))
await act(outsider)
await rows('select public.claim_memberships()')
for (const table of ['leagues','teams','wallets','league_memberships','balance_events']) {
  assert.equal((await rows(`select * from public.${table}`)).length,0)
}
await db.exec('reset role; set role anon;')
await deny(()=>rows('select * from public.teams'))
await deny(()=>rows('select public.claim_memberships()'))
await db.exec('reset role;')
const [shared] = await rows('select sportsbook_owner_name from public.teams where roster_id=8')
assert.equal(shared.sportsbook_owner_name,'nellyknowsball')
await db.close()
console.log('Passed: approved identity claiming, private member access, admin-only writes, unset opening balances, exact amounts, duplicate protection, adjustment history, and shared-owner choice. Test records existed only in memory.')
