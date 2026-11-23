import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {cents} from './production-migration.mjs';

export async function rehearseProductionWallets(db){
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 // Exercise the bridge already installed by the exact packaged transaction.
 const owner=(await q('select user_id from sportsbook_private.platform_owners order by user_id'))[0].user_id;
 const member=(await q("select m.user_id from public.league_memberships m join auth.users u on u.id=m.user_id where m.user_id<>$1 and u.email_confirmed_at is not null order by m.id limit 1",[owner]))[0].user_id;
 const act=async user=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("set request.jwt.claim.role='authenticated';set role authenticated");};
 const league='13121261-5398-4391-8240-000000000003';
 const funds=async()=> (await q(`select ((select coalesce(sum(w.balance),0) from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=$1)+
  (select coalesce(sum(balance),0) from public.user_wallets where league_id=$1))::text total`,[league]))[0].total;
 const beforeFunds=await funds();
 const accepted=(await q("select md5(jsonb_agg(to_jsonb(t) order by id)::text) fingerprint from public.tickets t"))[0].fingerprint;
 const oldUsers=(await q('select count(*)::int n from auth.users'))[0].n;
 await db.exec('begin');
 const rejected=async(fn,pattern)=>{await db.exec('savepoint expected_rejection');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to expected_rejection;release expected_rejection');}};
 await act(member);await rejected(()=>q('select public.prepare_production_wallet_migration($1)',[league]),/platform owner/i);
 await act(owner);await db.exec('reset role');
 await q('update public.leagues set operations_enabled=false where id=$1',[league]);
 await q('update public.weekly_schedule set automation_enabled=false where league_id=$1',[league]);
 await act(owner);
 const jobs=(await q('select public.review_production_jobs($1) r',[league]))[0].r;
 if(jobs.count){
  await rejected(()=>q('select public.prepare_production_wallet_migration($1)',[league]),/resolve old jobs/);
  await db.exec('savepoint active_job;reset role');
  await q("update public.automation_jobs set status='running',lease_until=clock_timestamp()+interval '1 hour' where id=(select id from public.automation_jobs where league_id=$1 and status not in('done','canceled') order by id limit 1)",[league]);
  await act(owner);
  const activeReview=(await q('select public.review_production_jobs($1) r',[league]))[0].r;
  await rejected(()=>q('select public.retire_production_jobs($1,$2,$3,$4)',[league,activeReview.digest,randomUUID(),'Local active lease denial verification']),/active or unknown lease/);
  await db.exec('rollback to active_job;release active_job');await act(owner);
  const retirementRequest=randomUUID();
  const retirement=(await q('select public.retire_production_jobs($1,$2,$3,$4) r',[league,jobs.digest,retirementRequest,'Local rehearsal of reviewed legacy worker retirement']))[0].r;
  assert.equal(retirement.retired,jobs.count);
  assert.equal((await q('select public.retire_production_jobs($1,$2,$3,$4) r',[league,jobs.digest,retirementRequest,'Local rehearsal of reviewed legacy worker retirement']))[0].r.duplicate,true);
  await db.exec('reset role');
  await rejected(()=>q("update public.automation_jobs set status='pending' where id=(select job_id from sportsbook_private.production_retired_jobs limit 1)"),/cannot be restarted/);
  await act(owner);
 }
 const review=(await q('select public.prepare_production_wallet_migration($1) r',[league]))[0].r;
 assert.equal(review.verifiedAccounts,8);assert.equal(review.openFutures,9);assert.equal(review.fundsMoved,false);
 assert.equal((await q('select public.prepare_production_wallet_migration($1) r',[league]))[0].r.reviewId,review.reviewId,'Repeated review stored a duplicate snapshot');
 await db.exec('reset role');const expired=randomUUID();
 await q("insert into sportsbook_private.production_wallet_reviews(id,league_id,actor,source_digest,snapshot,expires_at) select $1,league_id,actor,source_digest,snapshot,clock_timestamp()-interval '1 second' from sportsbook_private.production_wallet_reviews where id=$2",[expired,review.reviewId]);
 await act(owner);await rejected(()=>q('select public.apply_production_wallet_migration($1,$2)',[expired,randomUUID()]),/expired/);
 await db.exec('savepoint stale_identity;reset role');
 await q("update public.league_memberships set display_name=display_name||' Test' where user_id=$1",[member]);
 await act(owner);await rejected(()=>q('select public.apply_production_wallet_migration($1,$2)',[review.reviewId,randomUUID()]),/changed/);
 await db.exec('rollback to stale_identity;release stale_identity');
 await act(owner);
 const request=randomUUID();
 const applied=(await q('select public.apply_production_wallet_migration($1,$2) r',[review.reviewId,request]))[0].r;
 assert.equal(applied.walletsTransferred,8);assert.equal(applied.futuresRouted,9);assert.equal(applied.coManagersPreserved,1);assert.equal(applied.pendingEntitlements,4);assert.equal(applied.bettingActivated,false);
 assert.equal((await q('select public.apply_production_wallet_migration($1,$2) r',[review.reviewId,request]))[0].r.duplicate,true);
 await rejected(()=>q('select public.apply_production_wallet_migration($1,$2)',[review.reviewId,randomUUID()]),/consumed/);
 await db.exec('reset role');
 assert.equal(await funds(),beforeFunds,'Migration lost or minted cash');
 assert.equal((await q('select count(*)::int n from auth.users'))[0].n,oldUsers,'Migration fabricated accounts');
 assert.equal((await q('select md5(jsonb_agg(to_jsonb(t) order by id)::text) fingerprint from public.tickets t'))[0].fingerprint,accepted,'Original tickets changed');
 assert.equal((await q('select sum(balance)::text n from public.wallets'))[0].n,'400.00','Pending legacy entitlements changed');
 assert.equal((await q('select count(*)::int n from public.user_wallets w join auth.users a on a.id=w.user_id where a.email_confirmed_at is null'))[0].n,0);
 // A previously unverified person can receive only their original reserved cash.
 const pending=(await q(`select p.*,u.id user_id,m.id membership_id,m.display_name from sportsbook_private.production_pending_wallets p
  join public.league_memberships m on m.team_id=p.team_id join auth.users u on lower(u.email)=p.recipient_email where u.email_confirmed_at is null limit 1`))[0];assert(pending);
 await db.exec('savepoint pending_verification');
 await q('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[pending.user_id]);
 await q('update public.league_memberships set user_id=$1 where id=$2',[pending.user_id,pending.membership_id]);
 await act(owner);
 await q('select public.approve_user_wallet($1,$2,$3,$4,$5)',[league,pending.user_id,pending.team_id,'Local original pending identity verification',pending.display_name]);
 await rejected(()=>q('select public.initialize_user_wallet($1,$2,$3,$4,$5,$6)',[league,pending.user_id,'zero',null,'Local original pending balance must not be bypassed',randomUUID()]),/Existing primary cash/);
 const pendingRequest=randomUUID();
 assert.equal(Number((await q('select public.initialize_user_wallet($1,$2,$3,$4,$5,$6) r',[league,pending.user_id,'transfer_legacy',pending.amount,'Local original pending balance release',pendingRequest]))[0].r.balance),Number(pending.amount));
 assert.equal((await q('select public.initialize_user_wallet($1,$2,$3,$4,$5,$6) r',[league,pending.user_id,'transfer_legacy',pending.amount,'Local original pending balance release',pendingRequest]))[0].r.duplicate,true);
 await db.exec('reset role');assert.equal(await funds(),beforeFunds);
 await db.exec('rollback to pending_verification;release pending_verification;reset role');
 // Explicit local replacement fixture: no real Auth service or email is used.
 await db.exec('savepoint replacement_identity');const replacement=randomUUID(),replacementEmail='replacement-fixture@example.invalid';
 await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[replacement,replacementEmail]);
 await q("update public.teams set sleeper_owner_id='999999999999999999' where id=$1",[pending.team_id]);
 await q("update public.league_memberships set user_id=$1,invited_email=$2,sleeper_user_id='999999999999999999' where id=$3",[replacement,replacementEmail,pending.membership_id]);
 await act(owner);
 await q('select public.approve_user_wallet($1,$2,$3,$4,$5)',[league,replacement,pending.team_id,'Local replacement manager isolation fixture','Replacement Fixture']);
 await rejected(()=>q('select public.initialize_user_wallet($1,$2,$3,$4,$5,$6)',[league,replacement,'transfer_legacy',pending.amount,'Local replacement cannot inherit reserved credits',randomUUID()]),/reserved for the original/);
 assert.equal(Number((await q('select public.initialize_user_wallet($1,$2,$3,$4,$5,$6) r',[league,replacement,'zero',null,'Local replacement separate zero opening',randomUUID()]))[0].r.balance),0);
 await db.exec('reset role');assert.equal(Number((await q('select balance from public.wallets where team_id=$1',[pending.team_id]))[0].balance),Number(pending.amount));
 await db.exec('rollback to replacement_identity;release replacement_identity;reset role');
 const nelson=(await q("select user_id from boff_dev_internal.co_manager_links where sleeper_user_id='1269136771011055616'"))[0];assert(nelson);
 await act(nelson.user_id);assert.equal((await q('select sportsbook_private.is_member($1) allowed',[league]))[0].allowed,true);
 await rejected(()=>q('select public.dev_credit_claim($1,$2)',[league,randomUUID()]),/paused/);
 await db.exec('reset role');
 const routes=await q(`select r.ticket_id,r.wallet_id,t.team_id,t.stake,t.accepted_potential_payout from sportsbook_private.production_legacy_routes r join public.tickets t on t.id=r.ticket_id order by t.id`);
 await act(owner);
 // Each outcome runs in its own rolled-back scenario against actual old tickets.
 for(const status of ['WON','LOST','PUSH']){
  await db.exec('savepoint outcome_case');
  const ticket=routes[0];
  const before=(await q('select balance from public.user_wallets where id=$1',[ticket.wallet_id]))[0].balance;
  const legs=await q('select id from public.ticket_legs where ticket_id=$1 order by leg_number',[ticket.ticket_id]);
  const results=legs.map(l=>({id:l.id,status,actual_value:status==='WON'?1:0,evidence:'Local migration rehearsal outcome'}));
  const outcome=(await q('select public.settle_weekly_ticket($1,$2) r',[ticket.ticket_id,JSON.stringify(results)]))[0].r;
  assert.equal(outcome.status,status);
  assert.equal((await q('select public.settle_weekly_ticket($1,$2) r',[ticket.ticket_id,JSON.stringify(results)]))[0].r.duplicate,true);
  await db.exec('reset role');
  const amounts=(await q(`select (select balance from public.user_wallets where id=$1) balance,(select balance from public.wallets where team_id=$2) legacy`,[ticket.wallet_id,ticket.team_id]))[0];
  assert.equal(cents(amounts.balance),cents(before)+cents(outcome.payout));assert.equal(Number(amounts.legacy),0,'Legacy payout orphaned');
  assert.equal((await q('select count(*)::int n from sportsbook_private.production_legacy_payments where ticket_id=$1',[ticket.ticket_id]))[0].n,status==='LOST'?0:1);
  await db.exec('rollback to outcome_case;release outcome_case');await act(owner);
 }
 await db.exec('savepoint partial_case');
 const multi=routes.find(t=>t.ticket_id==='01f096c3-9ff2-4522-a136-76cf8adde753');assert(multi);
 const multiLegs=await q('select id,accepted_decimal_odds from public.ticket_legs where ticket_id=$1 order by leg_number',[multi.ticket_id]);
 const partial=multiLegs.map((l,i)=>({id:l.id,status:i===0?'WON':'OPEN',actual_value:null,evidence:'Local partial parlay verification'}));
 assert.equal((await q('select public.settle_weekly_ticket($1,$2) r',[multi.ticket_id,JSON.stringify(partial)]))[0].r.pending,true);
 await db.exec('reset role');assert.equal((await q('select count(*)::int n from sportsbook_private.production_legacy_payments where ticket_id=$1',[multi.ticket_id]))[0].n,0);
 await act(owner);
 const mixed=multiLegs.map((l,i)=>({...partial[i],status:i===0?'WON':'PUSH'}));
 const mixedResult=(await q('select public.settle_weekly_ticket($1,$2) r',[multi.ticket_id,JSON.stringify(mixed)]))[0].r;
 assert.equal(cents(mixedResult.payout),BigInt(Math.round(Number(multi.stake)*Number(multiLegs[0].accepted_decimal_odds)*100)));
 await db.exec('rollback to partial_case;release partial_case');await act(owner);
 await db.exec('savepoint void_case');
 const ticket=routes[1];
 const refund=(await q('select public.void_sportsbook_ticket($1,$2) r',[ticket.ticket_id,'Local migration duplicate refund verification']))[0].r;
 await q('select public.void_sportsbook_ticket($1,$2)',[ticket.ticket_id,'Local migration duplicate refund verification']);
 await db.exec('reset role');
 assert.equal((await q('select count(*)::int n from sportsbook_private.production_legacy_payments where ticket_id=$1',[ticket.ticket_id]))[0].n,1);
 assert.equal(Number((await q('select amount from sportsbook_private.production_legacy_payments where ticket_id=$1',[ticket.ticket_id]))[0].amount),Number(ticket.stake));
 await db.exec('rollback to void_case;release void_case;reset role');
 // Read each reviewed user's open future stakes and personal history via the public RPCs.
 for(const user of await q('select id,user_id from public.user_wallets order by id')){
  const expected=Number((await q(`select coalesce(sum(t.stake),0) n from sportsbook_private.production_legacy_routes r join public.tickets t on t.id=r.ticket_id where r.wallet_id=$1`,[user.id]))[0].n);
  await act(user.user_id);
  const claim=(await q('select public.dev_credit_claim($1) r',[league]))[0].r;
  assert.equal(Number(claim.openFutures),expected);assert.equal(Number(claim.openNonFutures),0);
  const history=(await q('select public.dev_ticket_history_page($1,true) r',[league]))[0].r;
  assert.equal(Number(history.summary.openStake),expected);
  await db.exec('reset role');
 }
 await db.exec('rollback;reset role');
 return {verified_wallets:8,pending_entitlements_preserved:4,legacy_futures_routed:9,co_manager_preserved:true,
  cash_conserved:true,no_auth_accounts_created:true,original_tickets_unchanged:true,idempotent_apply:true,
  pending_recipient_binding_verified:true,verified_pending_release_once:true,replacement_cannot_inherit_pending_cash:true,
  stale_review_denied:true,nonowner_denied:true,legacy_jobs_retired_with_audit:jobs.count,claims_paused_before_activation:true,
  active_jobs_cannot_be_canceled:true,retired_jobs_cannot_restart:true,expired_review_denied:true,
  won_lost_push_and_void_routed_once:true,partial_and_mixed_push_verified:true,legacy_stakes_and_personal_history_verified:true,scenarios_rolled_back:true};
}
