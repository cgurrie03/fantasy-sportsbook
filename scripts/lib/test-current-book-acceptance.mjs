import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testCurrentBookAcceptance(db,{league,board,user,quote}) {
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('reset role;begin');
 try {
  // Use the real per-user engine, exactly as the hosted wrapper clones it.
  await db.exec(`create schema boff_dev_internal;
   create or replace function public.application_environment_identity() returns jsonb language sql as $$select '{"project_ref":"bmvjcdgxwxqalaohpsnw"}'::jsonb$$;
   create table public.dev_current_book(league_id uuid,board_id uuid,observed_at timestamptz,valid_until timestamptz,last_error text);`);
  let source=(await q("select pg_get_functiondef('sportsbook_private.user_place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) body"))[0].body;
  source=source.replace('sportsbook_private.user_place_sportsbook_ticket','boff_dev_internal.place_ticket');
  source=source.replace('if exists(select 1 from public.line_refresh_runtime r',"if v_board.board_type<>'future' and exists(select 1 from public.line_refresh_runtime r");
  await db.exec(source);
  await db.exec(source.replace('boff_dev_internal.place_ticket','boff_dev_internal.place_reward_ticket').replace('p_request uuid)','p_request uuid, p_reward_percent numeric)'));
  const migration=await fs.readFile('visual/server/current-book-acceptance.sql','utf8');
  assert.equal(await fs.readFile('supabase/production/migrations/20261125151500_current_book_acceptance.sql','utf8'),migration);
  assert.equal(await fs.readFile('supabase/development/migrations/20261125151500_current_book_acceptance.sql','utf8'),migration);
  await db.exec(migration);await db.exec(migration);
  await q("update public.sportsbook_boards set source_observed_at=clock_timestamp(),quote_valid_until=clock_timestamp()+interval '1 hour' where id=$1",[board]);
  await q('insert into public.dev_current_book select league_id,id,source_observed_at,quote_valid_until,null from public.sportsbook_boards where id=$1',[board]);
  await q(`insert into public.line_refresh_runtime(league_id,market_week,observed_at,week_started,last_error)
   values($1,5,clock_timestamp()-interval '1 day',true,'Retired worker')
   on conflict(league_id) do update set market_week=5,observed_at=excluded.observed_at,week_started=true,last_error=excluded.last_error`,[league]);
  const revision=(await q('select revision from public.sportsbook_boards where id=$1',[board]))[0].revision;
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);
  const place=(engine,revisionOverride=revision)=>q(`select boff_dev_internal.${engine}($1,$2,$3::uuid[],1,$4${engine==='place_reward_ticket'?',25':''}) result`,[board,revisionOverride,[quote],randomUUID()]);
  for(const engine of ['place_ticket','place_reward_ticket']) {
   await db.exec('savepoint accepted_fixture');
   assert((await place(engine))[0].result.ticket_id,'Fresh current board rejected by stale legacy record');
   await db.exec('rollback to accepted_fixture;release accepted_fixture');
   for(const mutation of ["valid_until=clock_timestamp()-interval '1 second'","last_error='Source failed'","observed_at=observed_at-interval '1 second'","valid_until=valid_until+interval '1 minute'"]) {
    await db.exec('savepoint invalid_fixture');
    await q(`update public.dev_current_book set ${mutation} where board_id=$1`,[board]);
    await assert.rejects(()=>place(engine),/Published prices are out of date/);
    await db.exec('rollback to invalid_fixture;release invalid_fixture');
   }
   await db.exec('savepoint revision_fixture');
   await assert.rejects(()=>place(engine,revision+1),/Lines have changed/);
   await db.exec('rollback to revision_fixture;release revision_fixture');
  }
  console.log('Current-board acceptance: regular and reward engines accept fresh prices despite retired-worker state; expired, failed, mismatched timestamps/expiry and wrong revisions rejected; migration repeat-safe.');
 } finally { await db.exec('rollback;reset role'); }
}
