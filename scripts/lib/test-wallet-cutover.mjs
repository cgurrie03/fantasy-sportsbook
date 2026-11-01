import assert from 'node:assert/strict';

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
 await db.exec('rollback;reset role;');
 console.log('Owner-only DEV preflight rejects production, active operations and ambiguous mail; pending funding stays pending and the review enables nothing.');
}
