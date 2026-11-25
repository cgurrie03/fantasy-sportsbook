import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sqlStatements} from './sql-statements.mjs';
import {sqlTokens} from './sql-tokens.mjs';
import {createHash} from 'node:crypto';
export async function rehearseProductionUpgrade(db){
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const financial=()=>q(`select (select count(*)::int from public.tickets) tickets,(select count(*)::int from public.ticket_legs) legs,
  (select sum(balance)::text from public.wallets) available,(select count(*)::int from public.wallet_ledger) ledger`);
 const before=await financial();
 const artifact=await fs.readFile('supabase/production/migrations/20261120152909_production_release_schema_and_legacy_routing.sql','utf8');
 const artifactHash=createHash('sha256').update(artifact).digest('hex');
 const packaged=JSON.parse(await fs.readFile('work/production-migration/packaged-upgrade.json','utf8'));
 assert.equal(packaged.sha256,artifactHash,'Package changed after assembly');
 for(const item of packaged.source_file_hashes)assert.equal(createHash('sha256').update(await fs.readFile(item.path)).digest('hex'),item.sha256,'Package source changed after assembly');
 const apply=async(commit=true)=>{for(const [index,statement] of sqlStatements(artifact).entries()){
  if(!commit&&sqlTokens(statement).join('')==='commit;')continue;
  try{await db.exec(statement);}catch(error){error.migration_statement=index;error.migration_head=statement.slice(0,160);throw error;}
 }};
 await db.exec("create schema cron;create table cron.job(jobname text,active boolean);insert into cron.job values('sportsbook-weekly-worker',true)");
 await assert.rejects(apply(),/Pause the legacy Production scheduler/);await db.exec('rollback');
 await db.exec('drop schema cron cascade');
 // Fail after all DDL but before commit, then prove the original state survived.
 await apply(false);
 await assert.rejects(db.exec("DO $$BEGIN RAISE EXCEPTION 'Controlled upgrade rollback';END $$"),/Controlled upgrade rollback/);
 await db.exec('rollback');
 assert.deepEqual(await financial(),before);
 assert.equal((await q("select to_regclass('public.user_wallets') t"))[0].t,null);
 await apply();
 assert.deepEqual(await financial(),before,'Schema expansion altered financial records');
 const marker=(await q('select public.application_environment_identity() marker'))[0].marker;
 assert.equal(marker.project_ref,'bmvjcdgxwxqalaohpsnw');assert.equal(marker.release_state,'prepared');
 assert.equal(marker.release_schema,'boff-person-wallets-2026-11');
 assert.equal((await q('select sportsbook_private.release_writes_enabled() allowed'))[0].allowed,false);
 assert.equal((await q('select count(*)::int n from public.user_wallets'))[0].n,0,'Schema copied test wallets');
 assert.equal((await q('select count(*)::int n from public.dev_live_cache'))[0].n,0,'Schema copied refresh tokens or caches');
 // Reapply the exact expansion: schema retries must not copy funds or seed mail.
 await apply();assert.deepEqual(await financial(),before);
 assert.equal((await q("select count(*)::int n from pg_trigger where tgname='suppress_production_notifications' and tgrelid='public.outbound_emails'::regclass"))[0].n,1);
 const exposed=(await q(`select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('boff_dev_internal','sportsbook_private') and has_function_privilege('anon',p.oid,'execute')`));
 assert.equal(exposed.length,0,'Private function exposed to anonymous API');
 const roots=['place_dev_ticket(uuid,integer,uuid[],numeric,uuid)','dev_credit_claim(uuid,uuid)','dev_notification_choices(uuid,jsonb)',
 'dev_commissioner_members(uuid)','read_dev_futures(uuid,integer)'];
 for(const root of roots)assert((await q('select to_regprocedure($1) fn',['public.'+root]))[0].fn,'Required runtime function missing: '+root);
 const {rehearseProductionWallets}=await import('./rehearse-production-wallets.mjs');
 await db.exec(await fs.readFile('visual/server/current-book-acceptance.sql','utf8'));
 await db.exec(await fs.readFile('visual/server/current-book-acceptance.sql','utf8'));
 const walletRouting=await rehearseProductionWallets(db);
 let runtime;
 if(process.argv.includes('--runtime')){
  const {rehearseProductionRuntime}=await import('./rehearse-production-runtime.mjs');
  runtime=await rehearseProductionRuntime(db);
 }
 return {artifact_sha256:artifactHash,schema_expansion_verified:true,active_legacy_scheduler_denied:true,atomic_rollback_verified:true,repeat_safe:true,financial_records_unchanged:true,production_marker:true,
  writes_remain_disabled:true,private_functions_deny_anon:true,legacy_mail_suppression_preserved:true,
  runtime_function_signatures_checked:roots.length,legacy_wallet_cutover_verified:true,walletRouting,runtime};
}
