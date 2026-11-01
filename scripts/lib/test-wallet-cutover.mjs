import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testWalletCutover(db,{owner,primary,A,B}) {
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const act=id=>db.exec(`reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`);
 await act(primary);await assert.rejects(q('select user_finance_cutover_preflight($1)',[A]),/owner/);
 await act(owner);await assert.rejects(q('select user_finance_cutover_preflight($1)',[A]),/development environment/);
 await db.exec(`reset role;insert into sportsbook_private.application_environment(environment,project_ref,app_origin)
  values('production','bmvjcdgxwxqalaohpsnw','https://sportsbook.coopergurrie.com')`);
 await act(owner);await assert.rejects(q('select user_finance_cutover_preflight($1)',[A]),/development environment/);
 await db.exec(`reset role;update sportsbook_private.application_environment set environment='development',
  project_ref='whlcnlacueweaqpsupqs',app_origin='https://dev.sportsbook.coopergurrie.com'`);
 await act(owner);
 const blocked=(await q('select user_finance_cutover_preflight($1) r',[A]))[0].r;
 assert.equal(blocked.ready,false);assert(blocked.blockers.some(b=>b.includes('mail')));assert(blocked.blockers.some(b=>b.includes('operations')));
 await db.exec('reset role;begin;set local session_replication_role=replica');
 await q('update leagues set operations_enabled=false where id=$1',[A]);
 await q("update outbound_emails set status='captured' where league_id=$1",[A]);
 await db.exec('set local session_replication_role=origin');await act(owner);
 const ready=(await q('select user_finance_cutover_preflight($1) r',[A]))[0].r;
 assert.equal(ready.ready,true);assert(ready.legacy_open_tickets===0,'new wallet tickets are not legacy liabilities');
 assert.equal(ready.activation_performed,false);assert.equal(ready.opening_funds_moved,false);
 const pending=(await q('select user_finance_cutover_preflight($1) r',[B]))[0].r;
 assert.equal(pending.ready,true);assert.equal(pending.routing_enabled,false);assert.equal(pending.funding_pending,1);
 assert.equal((await q('select league_capabilities($1) r',[B]))[0].r.wallet_model,'legacy');
 const reject=async(fn,pattern)=>{await db.exec('savepoint expected_denial');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to expected_denial;release expected_denial');}};
 const reason='Synthetic owner-reviewed development cutover';
 const prepare=()=>q('select prepare_user_finance_cutover($1,$2) r',[B,reason]);
 const activate=(review,request=randomUUID(),league=B)=>q('select activate_user_finance_cutover($1,$2,$3,$4) r',[league,review,request,reason]);
 const review=(await prepare())[0].r;
 assert.equal(review.funding_pending,1);assert(review.review_id&&review.expires_at);
 await act(primary);await reject(()=>activate(review.review_id),/owner/);
 await act(owner);await reject(()=>activate(review.review_id,randomUUID(),A),/selected league/);
 await db.exec('reset role');
 await q('update user_wallets set display_name=$2 where league_id=$1',[B,'Changed after review']);
 await act(owner);await reject(()=>activate(review.review_id),/state changed/);
 const expired=(await prepare())[0].r;
 await db.exec('reset role');await q("update admin_change_log set after_value=jsonb_build_object('expires_at',clock_timestamp()-interval '1 second') where id=$1",[expired.review_id]);
 await act(owner);await reject(()=>activate(expired.review_id),/expired/);
 const final=(await prepare())[0].r,request=randomUUID();
 assert.equal((await activate(final.review_id,request))[0].r.duplicate,false);
 assert.equal((await activate(final.review_id,request))[0].r.duplicate,true);
 await reject(()=>activate(final.review_id),/state changed|already active/);
 assert.equal((await q('select league_capabilities($1) r',[B]))[0].r.wallet_model,'user');
 await db.exec('reset role');
 assert.equal((await q('select balance from user_wallets where league_id=$1',[B]))[0].balance,null);
 assert.equal((await q('select operations_enabled from leagues where id=$1',[B]))[0].operations_enabled,false);
 assert.equal((await q("select count(*)::int n from admin_change_log where league_id=$1 and category='user_finance_cutover'",[B]))[0].n,1);
 // Every money-routing entry point must take the shared lock before its body.
 const fenced=await q(`select proname,prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and proname in ('place_sportsbook_ticket','place_boosted_ticket','place_fixed_ticket','settle_weekly_ticket','void_sportsbook_ticket',
  'replenish_weekly_balances','approve_user_wallet','initialize_user_wallet','set_user_wallet_balance','set_user_wallet_status','set_team_balance')`);
 assert.equal(fenced.length,11);assert(fenced.every(f=>/\bbegin perform pg_advisory_xact_lock_shared\(20261101,17\);/i.test(f.prosrc)));
 
 await db.exec('rollback;reset role;');
 console.log('DEV owner cutover rejects production, operators, cross-league/stale/expired reviews; exactly-once activation keeps funds pending and operations disabled, with shared writer fencing.');
}
