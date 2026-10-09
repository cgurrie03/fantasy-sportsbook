import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { communicationIdentity, validateDeliveryScope, validatePayloadRecipient } from '../api/_lib/league-communications.ts';
const db = new PGlite();
const A='13121261-5398-4391-8240-000000000003', B=randomUUID(), shared=randomUUID(), adminB=randomUUID(), outsider=randomUUID();
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const act=async(user)=>db.exec(`reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${user}';set role authenticated;`);
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`);
 for(const file of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
 await rows('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[shared,'cooper.gurrie@gmail.com',adminB,'b-admin@example.test',outsider,'outsider@example.test']);
 await rows('insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,sportsbook_url,email_sender) values($1,$2,$3,2026,9,$4,$5)',[B,'Disconnected League B','overlapping-provider-test','https://b.example.test/','b@example.test']);
 for(const t of await rows('select * from teams where league_id=$1 order by roster_id',[A])) {
  await rows(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name) values($1,$2,$3,$4,$5,$6,$5,$6)`,[randomUUID(),B,t.roster_id,t.team_name,t.sleeper_owner_id,t.owner_name]);
 }
 const aTeam=(await rows('select id from teams where league_id=$1 and roster_id=1',[A]))[0].id;
 const bTeams=await rows('select id,roster_id from teams where league_id=$1 order by roster_id',[B]);
 await rows(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role) values($1,$2,$3,$4,'Shared Identity','same-owner','member'),($1,$5,$6,$7,'B Admin','other-owner','admin')`,[B,bTeams[0].id,shared,'cooper.gurrie@gmail.com',bTeams[1].id,adminB,'b-admin@example.test']);
 await rows('insert into wallets(team_id,balance) select id,100 from teams where league_id=$1',[B]);
 await act(shared);await rows('select claim_memberships()');
 assert.equal((await rows('select id from leagues')).length,2);
 assert.equal((await rows('select * from wallets')).length,13); // all A as admin; own B only
 await assert.rejects(rows('select set_team_balance($1,999,$2,gen_random_uuid())',[bTeams[1].id,'Cross-league attack']),/Admin access/);
 await assert.rejects(rows('select save_report_results($1,2026,5,true,$2)',[B,'{}']),/admin/);
 await assert.rejects(rows('select review_admin_exception($1,$2,$3,$4)',[B,'key','acknowledge','Cross-league attack']),/admin/);
 await db.exec('reset role');
 await rows('insert into weekly_schedule(league_id) values($1)',[B]);
 await assert.rejects(rows('update weekly_schedule set automation_enabled=true where league_id=$1',[B]),/disabled/);
 // The default gate also blocks direct acceptance, even when an admin publishes a board.
 const boardA=randomUUID(),boardB=randomUUID(),qA=randomUUID(),qB=randomUUID();
 const quote=id=>JSON.stringify([{id,market_key:'weekly:isolation',kind:'weekly_any_200',label:'Any 200?',subject:'League',side:'yes',odds:200,metadata:{expected_team_count:12}}]);
 const save=async(board,league,q)=>rows("select save_market_board($1,$2,5,now()-interval '1 hour',now()+interval '1 day',$3,'published')",[board,league,quote(q)]);
 await act(shared);await save(boardA,A,qA);
 await act(adminB);await save(boardB,B,qB);
 await act(shared);
 const revision=async(board)=>(await rows('select revision from sportsbook_boards where id=$1',[board]))[0].revision;
 const bet=async(board,q,request=randomUUID())=>(await rows('select place_sportsbook_ticket($1,$2,$3,10,$4) as result',[board,await revision(board),[q],request]))[0].result;
 await assert.rejects(bet(boardB,qB),/disabled/);
 await db.exec('reset role');
 await assert.rejects(rows('update leagues set operations_enabled=true where id=$1',[B]),/owner approval/);
 const owner=(await rows('select membership_id from sportsbook_private.platform_owner'))[0].membership_id;
 await assert.rejects(rows('update league_memberships set invited_email=$1 where id=$2',['b-admin@example.test',owner]),/cannot be reassigned/);
 await assert.rejects(rows('update league_memberships set user_id=$1 where id=$2',[adminB,owner]),/cannot be reassigned/);
 await act(adminB);
 await assert.rejects(rows('insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note) values($1,$2,$3)',[B,owner,'In-memory verification only']),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(rows('insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note) values($1,$2,$3)',[B,owner,'In-memory verification only']),/Only the platform owner/);
 await act(shared);await db.exec('reset role');
 // Simulate a future secured owner RPC in memory; no such API or menu exists yet.
 await rows('insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note) values($1,$2,$3)',[B,owner,'In-memory isolation fixture verified']);
 await rows('update leagues set operations_enabled=true where id=$1',[B]);
 await act(shared);
 await assert.rejects(bet(boardB,qA),/unavailable|board|selection/i);
 await assert.rejects(bet(boardA,qB),/unavailable|board|selection/i);
 const request=randomUUID(), accepted=await bet(boardB,qB,request);
 assert.equal((await bet(boardB,qB,request)).duplicate,true);
 assert.equal((await rows('select balance from wallets where team_id=$1',[bTeams[0].id]))[0].balance,'90.00');
 await assert.rejects(rows('select void_sportsbook_ticket($1,$2)',[accepted.ticket_id,'A admin cannot refund B']),/admin/);
 await act(adminB);await rows('select void_sportsbook_ticket($1,$2)',[accepted.ticket_id,'Fixture cancellation']);
 await rows('select void_sportsbook_ticket($1,$2)',[accepted.ticket_id,'Fixture cancellation']);
 assert.equal((await rows('select balance from wallets where team_id=$1',[bTeams[0].id]))[0].balance,'100.00');
 assert.equal((await rows("select * from wallet_ledger where ticket_id=$1 and kind='void_refund'",[accepted.ticket_id])).length,1);
 assert.equal((await rows('select id from sportsbook_boards where league_id=$1',[A])).length,0);
 assert.equal((await rows('select id from forecast_snapshots where league_id=$1',[A])).length,0);
 assert.equal((await rows('select id from outbound_emails where league_id=$1',[A])).length,0);
 await db.exec('reset role');
 await assert.rejects(rows('update sportsbook_markets set team_id=$1 where id=$2',[aTeam,qB]),/belong/);
 await assert.rejects(rows('insert into league_result_weeks(league_id,nfl_season,market_week,final,results) values($1,2026,5,true,$2)',[A,JSON.stringify({[bTeams[0].id]:{points:999}})]),/belong/);
 await assert.rejects(rows('update wallet_ledger set team_id=$1 where ticket_id=$2',[aTeam,accepted.ticket_id]),/foreign key/);
 const outbox=(await rows('select * from outbound_emails where ticket_id=$1',[accepted.ticket_id]))[0];
 await assert.rejects(rows('update outbound_emails set league_id=$1 where id=$2',[A,outbox.id]),/recipient|foreign key/);
 await assert.rejects(rows('update outbound_emails set recipient=$1 where id=$2',['b-admin@example.test',outbox.id]),/recipient/);
 await assert.rejects(rows('update outbound_emails set payload=$1 where id=$2',[JSON.stringify({to:['wrong@example.test']}),outbox.id]),/recipient/);
 const cycle=randomUUID();await rows('insert into line_refresh_cycles(id,league_id,market_week,slot,weekly_board) values($1,$2,5,987,$3)',[cycle,A,boardA]);
 await assert.rejects(rows("insert into automation_jobs(league_id,event_key,operation,market_week,refresh_cycle_id) values($1,'cross-cycle','interval_matchups',5,$2)",[B,cycle]),/foreign key/);
 await db.exec("set request.jwt.claim.role='service_role';set role service_role;");
 const scoped=await rows('select * from claim_scoped_outbound_emails($1)',[accepted.ticket_id]);
 assert(scoped.every(r=>r.ticket_id===accepted.ticket_id));
 await act(outsider);for(const table of ['leagues','teams','wallets','tickets','ticket_legs','sportsbook_boards','sportsbook_markets','outbound_emails','automation_jobs','forecast_snapshots','league_result_weeks']) assert.equal((await rows(`select * from ${table}`)).length,0,table);
 await db.exec('reset role;set role anon');await assert.rejects(rows('select claim_scoped_outbound_emails(null)'));
} finally {await db.close()}

assert.throws(()=>communicationIdentity({name:'B'}),/incomplete/);
assert.throws(()=>communicationIdentity({name:'B',sportsbook_url:'http://b.test',email_sender:'b@b.test'}),/HTTPS/);
assert.equal(communicationIdentity({name:'B',sportsbook_url:'https://b.test/',email_sender:'b@b.test'}).brand,'B · Fantasy Sportsbook');
assert.throws(()=>validatePayloadRecipient({to:['b@b.test'],bcc:['a@a.test']},'b@b.test'),/mismatch/);
// Mock reads verify final send-time validation, including cached payloads; no provider calls.
const mock=({member=true,ticket=true}={})=>({from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:(table==='tickets'?ticket:member)?{id:'fixture',role:'member'}:null,error:null}}};return q}});
await validateDeliveryScope(mock(),{league_id:'B',team_id:'same-roster',ticket_id:'B-ticket',recipient:'b@b.test',payload:{to:['b@b.test']}});
await assert.rejects(validateDeliveryScope(mock({member:false}),{recipient:'b@b.test'}),/membership/);
await assert.rejects(validateDeliveryScope(mock({ticket:false}),{ticket_id:'A-ticket',recipient:'b@b.test'}),/mismatch/);
await assert.rejects(validateDeliveryScope(mock(),{kind:'attention',recipient:'b@b.test'}),/membership/);
console.log('Passed: two disconnected leagues with shared identity/roster numbers; scoped roles, wallets, quotes, idempotent debit/refund, reports, recipients, cached payloads, jobs and default-off rollout. In-memory only; no emails sent.');
