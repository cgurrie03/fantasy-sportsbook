import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const dir='work/production-migration/';
const [source,before,after]=await Promise.all(['development-schema-source.json','production-catalog.json','development-catalog.json'].map(async p=>JSON.parse(await fs.readFile(dir+p,'utf8'))));
const qi=s=>'"'+s.replaceAll('"','""')+'"',qs=s=>"'"+s.replaceAll("'","''")+"'",rel=(s,t)=>qi(s)+'.'+qi(t);
const hash=s=>createHash('sha256').update(s).digest('hex');
// The empty legacy capture relation remains for historic email-log joins. Its
// Development-only capture writer is not installed or enabled in Production.
const omittedTables=new Set(['boff_dev_internal.production_import_log','boff_dev_internal.production_import_stage']);
const omittedFunctions=new Set(['boff_dev_internal.import_production_history','boff_dev_internal.request_live_refresh','public.capture_development_email',
 'public.claim_outbound_emails','public.claim_scoped_outbound_emails']);
const portedFunctions=new Set(['boff_dev_internal.storage_maintenance','public.archive_dev_result_week','public.claim_dev_pricing_refresh',
 'public.dev_credit_claim','public.dev_futures_rules','public.place_dev_future','public.place_dev_reward','public.place_dev_ticket',
 'public.publish_dev_book','public.publish_dev_futures','public.record_dev_fantasy_rewards','public.settle_dev_ticket']);
const activeWriters=new Set(['public.place_dev_future','public.place_dev_reward','public.place_dev_ticket','public.publish_dev_futures','public.record_dev_fantasy_rewards','public.settle_dev_ticket']);
const sql=[],review={source_sha256:hash(JSON.stringify(source)),ports:[],omitted_tables:[...omittedTables],omitted_functions:[...omittedFunctions],production_preserved:['notification suppression trigger','legacy data and accepted receipts','legacy outbound queue claim suppression']};
sql.push(`-- Production release schema expansion only. No users, balances, tickets, caches, mail, jobs or secrets copied from Development.
BEGIN;
SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='120s';SET LOCAL check_function_bodies=off;
SELECT pg_advisory_xact_lock(20261101,17);
LOCK TABLE public.wallets,public.wallet_ledger,public.tickets,public.ticket_legs IN SHARE ROW EXCLUSIVE MODE;
DO $$DECLARE legacy_scheduler_active boolean;BEGIN
 IF NOT EXISTS(SELECT FROM public.leagues WHERE id='13121261-5398-4391-8240-000000000003' AND sleeper_league_id='1312126153980391424') THEN RAISE EXCEPTION 'Production league identity mismatch';END IF;
 IF to_regprocedure('public.application_environment_identity()') IS NOT NULL THEN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'bmvjcdgxwxqalaohpsnw' THEN RAISE EXCEPTION 'Production project required';END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='suppress_production_notifications' AND tgrelid='public.outbound_emails'::regclass) THEN RAISE EXCEPTION 'Production mail suppression must remain installed';END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT FROM cron.job WHERE jobname=''sportsbook-weekly-worker'' AND active)' INTO legacy_scheduler_active;
  IF legacy_scheduler_active THEN RAISE EXCEPTION 'Pause the legacy Production scheduler before schema upgrade';END IF;
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS boff_dev_internal;
REVOKE ALL ON SCHEMA boff_dev_internal FROM PUBLIC,anon,authenticated,service_role;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='boff_evaluation_retention') THEN CREATE ROLE boff_evaluation_retention NOLOGIN NOINHERIT;END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='boff_routine_retention') THEN CREATE ROLE boff_routine_retention NOLOGIN NOINHERIT;END IF;
END $$;
GRANT USAGE ON SCHEMA public,sportsbook_private TO authenticated,boff_evaluation_retention,boff_routine_retention;
CREATE TABLE IF NOT EXISTS sportsbook_private.production_release_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 release_schema text NOT NULL CHECK(release_schema='boff-person-wallets-2026-11'),state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','active')));
ALTER TABLE sportsbook_private.production_release_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sportsbook_private.production_release_control FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO sportsbook_private.production_release_control(singleton,release_schema) VALUES(true,'boff-person-wallets-2026-11') ON CONFLICT DO NOTHING;`);
const oldColumns=new Map(before.columns.map(c=>[`${c.table_schema}.${c.table_name}.${c.column_name}`,c]));
for(const sequence of JSON.parse(await fs.readFile(dir+'development-sequences.json','utf8'))){
 if(sequence.identity_owned)continue;
 for(const field of ['start_value','min_value','max_value','increment_by','cache_size'])assert(/^-?\d+$/.test(sequence[field]));
 sql.push(`CREATE SEQUENCE IF NOT EXISTS ${rel(sequence.schema,sequence.name)} AS bigint INCREMENT BY ${sequence.increment_by} MINVALUE ${sequence.min_value} MAXVALUE ${sequence.max_value} START WITH ${sequence.start_value} CACHE ${sequence.cache_size} ${sequence.cycle?'CYCLE':'NO CYCLE'};`);
}
const oldTables=new Set(before.relations.filter(r=>r.kind==='r').map(r=>r.schema+'.'+r.name));
const tables=new Map();for(const c of source.columns){const key=c.schema+'.'+c.table;if(omittedTables.has(key))continue;if(!tables.has(key))tables.set(key,[]);tables.get(key).push(c);}
const columnDDL=c=>qi(c.name)+' '+c.type+(c.identity?' GENERATED '+(c.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY':c.generated?' GENERATED ALWAYS AS ('+c.default+') STORED':c.default?' DEFAULT '+c.default:'')+(c.not_null?' NOT NULL':'');
for(const [name,cols] of tables){
 const table=rel(cols[0].schema,cols[0].table);
 if(!oldTables.has(name))sql.push(`CREATE TABLE IF NOT EXISTS ${table} (${cols.map(columnDDL).join(',\n')});`);
 else for(const c of cols){
  const old=oldColumns.get(name+'.'+c.name);
  if(!old)sql.push(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnDDL(c)};`);
  else if(old.is_nullable==='NO'&&!c.not_null)sql.push(`ALTER TABLE ${table} ALTER COLUMN ${qi(c.name)} DROP NOT NULL;`);
 }
}
// Explicitly widen this legacy boost restriction; no other missing target constraint is dropped.
sql.push('ALTER TABLE public.sportsbook_markets DROP CONSTRAINT IF EXISTS sportsbook_markets_boost_pct_check;');
const oldConstraints=new Map(before.constraints.map(c=>[c.schema+'.'+c.table+'.'+c.name,c]));
// Constraint triggers are emitted from pg_get_triggerdef below, not ALTER TABLE.
const constraints=after.constraints.filter(c=>!omittedTables.has(c.schema+'.'+c.table)&&!c.definition.startsWith('TRIGGER ')).map(c=>c.schema==='public'&&c.name==='wallet_ledger_kind_check'?
 {...c,definition:c.definition.replace("'account_transfer_out'::text","'account_transfer_out'::text, 'legacy_payout_transfer'::text")}:
 c.schema==='public'&&c.name==='automation_jobs_status_check'?{...c,definition:c.definition.replace("'failed'::text","'failed'::text, 'canceled'::text")}:c);
const constraintSQL=[];
for(const c of [...constraints.filter(c=>!c.definition.startsWith('FOREIGN KEY')),...constraints.filter(c=>c.definition.startsWith('FOREIGN KEY'))]){
 const old=oldConstraints.get(c.schema+'.'+c.table+'.'+c.name),table=rel(c.schema,c.table);
 if(old?.definition===c.definition)continue;
 const change=old?`IF current_definition IS DISTINCT FROM ${qs(old.definition)} AND current_definition IS DISTINCT FROM ${qs(c.definition)} THEN RAISE EXCEPTION 'Constraint drift: ${c.name}';END IF;
 IF current_definition=${qs(old.definition)} THEN ALTER TABLE ${table} DROP CONSTRAINT ${qi(c.name)};current_definition:=NULL;END IF;`:'';
 constraintSQL.push(`DO $$DECLARE current_definition text;BEGIN SELECT pg_get_constraintdef(oid) INTO current_definition FROM pg_constraint WHERE conrelid=${qs(c.schema+'.'+c.table)}::regclass AND conname=${qs(c.name)};
 ${change} IF current_definition IS NULL THEN ALTER TABLE ${table} ADD CONSTRAINT ${qi(c.name)} ${c.definition};END IF;END $$;`);
}
sql.push(`CREATE OR REPLACE FUNCTION sportsbook_private.release_environment_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM sportsbook_private.application_environment e,sportsbook_private.production_release_control r WHERE e.singleton AND r.singleton
 AND e.environment='production' AND e.project_ref='bmvjcdgxwxqalaohpsnw' AND e.app_origin='https://sportsbook.coopergurrie.com' AND r.release_schema='boff-person-wallets-2026-11')$$;
CREATE OR REPLACE FUNCTION sportsbook_private.release_writes_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sportsbook_private.release_environment_ready() AND EXISTS(SELECT FROM sportsbook_private.production_release_control WHERE singleton AND state='active')$$;
REVOKE ALL ON FUNCTION sportsbook_private.release_environment_ready(),sportsbook_private.release_writes_enabled() FROM PUBLIC,anon,authenticated,service_role;`);
const roles=new Set(['PUBLIC','anon','authenticated','service_role','boff_evaluation_retention','boff_routine_retention']);
function grants(object,acl){return acl.filter(a=>roles.has(a.grantee)).map(a=>`GRANT ${a.privilege??a.privilege_type} ON ${object} TO ${a.grantee==='PUBLIC'?'PUBLIC':qi(a.grantee)}${a.grantable?' WITH GRANT OPTION':''};`).join('\n');}
for(const f of source.functions){
 const name=f.schema+'.'+f.name;if(omittedFunctions.has(name))continue;
 let definition=f.definition.replaceAll('\r','');
 if(portedFunctions.has(name)){
  let count=0;
  definition=definition.replace(/public\.application_environment_identity\(\)\s*->>\s*'project_ref'\s*(IS\s+DISTINCT\s+FROM|<>|!=)\s*'whlcnlacueweaqpsupqs'/gi,()=>{count++;return `NOT sportsbook_private.${activeWriters.has(name)?'release_writes_enabled':'release_environment_ready'}()`;});
  assert(count>0&& !definition.includes('whlcnlacueweaqpsupqs'),`Unreviewed environment guard: ${name}`);
  if(name==='public.publish_dev_book'){
   const anchor='quote_valid_until=deadline,suspension_reason=NULL';
   assert.equal(definition.split(anchor).length-1,2,'Publisher window anchors changed');
   definition=definition.replaceAll(anchor,"quote_valid_until=deadline,closes_at=(p_book->>'closes_at')::timestamptz,opens_at=LEAST(opens_at,clock_timestamp()),suspension_reason=NULL");
   const validate="deadline:=(p_book->>'valid_until')::timestamptz;";
   assert(definition.includes(validate));
   definition=definition.replace(validate,validate+"\n IF nullif(p_book->>'closes_at','') IS NULL OR (p_book->>'closes_at')::timestamptz<=clock_timestamp() OR (p_book->>'closes_at')::timestamptz>clock_timestamp()+interval '10 days' THEN RAISE EXCEPTION 'Invalid weekly board window';END IF;");
  }
  review.ports.push({name,guard_replacements:count,source_hash:hash(f.definition),target_hash:hash(definition)});
 }
 if(['public.replenish_weekly_balances','public.claim_automation_job'].includes(name))definition=definition.replace(/AS \$function\$[\s\S]*?\$function\$/,`AS $function$ BEGIN RAISE EXCEPTION 'Legacy weekly automation is retired; use the release worker and credit claims';END $function$`);
 const signature=rel(f.schema,f.name)+'('+f.args+')';
 const acl=f.schema==='public'?f.acl:f.acl.filter(a=>!['PUBLIC','anon'].includes(a.grantee));
 sql.push(definition+';\n'+`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;\n`+grants('FUNCTION '+signature,acl));
}
for(const v of source.views)sql.push(`CREATE OR REPLACE VIEW ${rel(v.schema,v.name)}${v.options?.length?' WITH ('+v.options.join(',')+')':''} AS ${v.definition};`);
sql.push(...constraintSQL);
sql.push(`INSERT INTO sportsbook_private.application_environment(singleton,environment,project_ref,app_origin)
 VALUES(true,'production','bmvjcdgxwxqalaohpsnw','https://sportsbook.coopergurrie.com') ON CONFLICT(singleton) DO NOTHING;`);
for(const i of after.indexes){
 if(omittedTables.has(i.schemaname+'.'+i.tablename))continue;
 sql.push(i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /,'CREATE $1INDEX IF NOT EXISTS ')+';');
}
for(const r of after.relations){
 const name=r.schema+'.'+r.name;if(omittedTables.has(name)||!['r','v','S'].includes(r.kind))continue;
 const object=(r.kind==='S'?'SEQUENCE ':'TABLE ')+rel(r.schema,r.name);
 if(r.kind==='r')sql.push(`ALTER TABLE ${rel(r.schema,r.name)} ENABLE ROW LEVEL SECURITY;`);
 sql.push(`REVOKE ALL ON ${object} FROM PUBLIC,anon,authenticated,service_role;`);
 sql.push(grants(object,source.grants.filter(g=>g.schema===r.schema&&g.name===r.name)));
}
for(const p of after.policies){
 if(omittedTables.has(p.schemaname+'.'+p.tablename))continue;
 const table=rel(p.schemaname,p.tablename);
 sql.push(`DROP POLICY IF EXISTS ${qi(p.policyname)} ON ${table};CREATE POLICY ${qi(p.policyname)} ON ${table} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':qi(r)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`);
}
for(const t of after.triggers){if(omittedTables.has(t.schema+'.'+t.table))continue;sql.push(`DROP TRIGGER IF EXISTS ${qi(t.name)} ON ${rel(t.schema,t.table)};${t.definition};`);}
sql.push(`CREATE OR REPLACE FUNCTION public.application_environment_identity() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('environment',e.environment,'project_ref',e.project_ref,'app_origin',e.app_origin,'release_schema',r.release_schema,'release_state',r.state)
 FROM sportsbook_private.application_environment e,sportsbook_private.production_release_control r WHERE e.singleton AND r.singleton$$;
REVOKE ALL ON FUNCTION public.application_environment_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.application_environment_identity() TO anon,authenticated,service_role;
-- Bootstrap only the existing verified Production platform owner, never a Dev UUID.
INSERT INTO sportsbook_private.platform_owners(user_id)
 SELECT m.user_id FROM sportsbook_private.platform_owner p JOIN public.league_memberships m ON m.id=p.membership_id
 JOIN auth.users a ON a.id=m.user_id WHERE a.email_confirmed_at IS NOT NULL ON CONFLICT DO NOTHING;
-- Preserve suppression; never resurrect pending/failed/sending historic emails.
REVOKE ALL ON FUNCTION public.claim_outbound_emails(),public.claim_scoped_outbound_emails(uuid) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid),public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid),public.place_fixed_ticket(uuid,numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;`);
const artifact=sql.join('\n\n')+'\n';
await fs.writeFile(dir+'upgrade-schema.sql',artifact);
await fs.writeFile(dir+'upgrade-schema-review.json',JSON.stringify({...review,artifact_sha256:hash(artifact),bytes:Buffer.byteLength(artifact),deployable:false},null,2)+'\n');
console.log(JSON.stringify({artifact:dir+'upgrade-schema.sql',bytes:Buffer.byteLength(artifact),ports:review.ports.length,deployable:false}));
