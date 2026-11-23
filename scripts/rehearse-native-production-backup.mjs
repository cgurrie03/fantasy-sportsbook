import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import * as openpgp from 'openpgp';
import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {protect,recoveryTables} from './financial-recovery.mjs';

// Offline application restore only. pg_restore ALWAYS writes to stdout, never
// a database. Plaintext lives in memory; no password/hash/session data is logged.
if(process.env.VERCEL||process.platform!=='win32')throw Error('Local Windows rehearsal only');
const root=path.resolve('work/platform-backups');
const names=(await fs.readdir(root)).filter(n=>/^production-\d{4}-\d\d-\d\dT/.test(n)).sort();
const folder=path.join(root,names.at(-1));
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
assert.equal(manifest.project_ref,'bmvjcdgxwxqalaohpsnw');assert.equal(manifest.warnings_present,false);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let phase='decrypt',table,db,upgrade;
try{
 const keyDir=path.resolve('work/financial-recovery-20261028');
 const privateKey=await openpgp.decryptKey({privateKey:await openpgp.readPrivateKey({armoredKey:await fs.readFile(path.join(keyDir,'private.asc'),'utf8')}),
  passphrase:protect(await fs.readFile(path.join(keyDir,'passphrase.dpapi')),'unprotect').toString()});
 const encrypted=await fs.readFile(path.join(folder,'database.dump.pgp'));
 assert.equal(hash(encrypted),manifest.artifacts.database.ciphertext_sha256);
 const decrypted=await openpgp.decrypt({message:await openpgp.readMessage({binaryMessage:encrypted}),decryptionKeys:privateKey,format:'binary'});
 const archive=Buffer.from(decrypted.data);
 assert.equal(hash(archive),manifest.artifacts.database.plaintext_sha256);assert.equal(archive.subarray(0,5).toString(),'PGDMP');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG|^BOFF_|^NODE_OPTIONS$|^DATABASE_URL$/.test(k)));
 const restore=args=>new Promise((resolve,reject)=>{
  const child=spawn(path.resolve('work/postgres-client-17.11/bin/pg_restore.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let size=0;
  child.on('error',reject);
  // Selective archive reads can exit successfully before consuming all stdin.
  child.stdin.on('error',error=>{if(!['EPIPE','EOF'].includes(error.code))reject(error);});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>128*1024*1024){child.kill();reject(Object.assign(Error('Archive output limit'),{code:'ARCHIVE_OUTPUT_LIMIT'}));}else chunks.push(chunk);});
  child.stderr.resume();
  child.on('close',code=>code===0?resolve(Buffer.concat(chunks).toString('utf8')):reject(Object.assign(Error('Archive extraction failed'),{code:'NATIVE_RESTORE_FAILED'})));
  child.stdin.end(archive);
 });
 phase='archive inventory';const toc=await restore(['--list']);
 assert(toc.includes('TABLE DATA auth users'),'Auth identity data missing');
 phase='application schema extraction';
 let schema=await restore(['--schema-only','--schema=public','--schema=sportsbook_private','--no-owner','--file=-']);
 schema=schema.replace(/^\\(?:un)?restrict .*\r?\n/gm,'').replace(/^CREATE SCHEMA (public|sportsbook_private);$/gm,'CREATE SCHEMA IF NOT EXISTS $1;');
 function unescapeCopy(cell){
  if(cell==='\\N')return null;
  return cell.replace(/\\([0-7]{1,3}|[btnrfv\\]|.)/g,(_,v)=>/^[0-7]+$/.test(v)?String.fromCharCode(parseInt(v,8)):({b:'\b',t:'\t',n:'\n',r:'\r',f:'\f',v:'\v','\\':'\\'}[v]??v));
 }
 function blocks(sql){
  const lines=sql.split('\n'),out=[];
  for(let i=0;i<lines.length;i++){
   const m=/^COPY ([\w]+)\.([\w]+) \(([^\n]+)\) FROM stdin;\r?$/.exec(lines[i]);if(!m)continue;
   const columns=m[3].split(', ').map(c=>c.replace(/^"|"$/g,'')),rows=[];
   while(++i<lines.length&&lines[i].replace(/\r$/,'')!=='\\.'){
    const row=lines[i].replace(/\r$/,'').split('\t').map(unescapeCopy);assert.equal(row.length,columns.length,'COPY column count differs');rows.push(row);
   }
   out.push({schema:m[1],name:m[2],columns,rows});
  }
  return out;
 }
 phase='Auth identity extraction';
 const auth=blocks(await restore(['--data-only','--schema=auth','--table=users','--file=-']));
 assert.equal(auth.length,1);const authData=auth[0];
 const identities=authData.rows.map(r=>['id','email','email_confirmed_at'].map(c=>r[authData.columns.indexOf(c)]));
 // Drop references to all other Auth fields before application restoration.
 authData.rows.length=0;
 phase='application data extraction';
 // Bound the rehearsal to financial/access dependencies; bulky forecast/model
 // archives remain in the encrypted full export, not in this memory fixture.
 const coreTables=[...new Set([...recoveryTables,'sportsbook_private.platform_owner','sportsbook_private.league_launch_approvals','public.weekly_schedule','public.automation_jobs','public.line_refresh_cycles'])];
 const selected=coreTables.filter(name=>name!=='auth.users').map(name=>'--table='+name.split('.')[1]);
 const data=blocks(await restore(['--data-only','--schema=public','--schema=sportsbook_private',...selected,'--file=-']));
 phase='isolated schema restore';db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create role supabase_admin bypassrls;create role authenticator;create role dashboard_user;create role supabase_auth_admin;
  create schema extensions;create schema sportsbook_private;
  create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
  create function extensions.uuid_generate_v4() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
  create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
  grant usage on schema auth,public to anon,authenticated,service_role;
  set check_function_bodies=off;`);
 await db.exec(schema);
 await db.exec("set search_path=public;set timezone='UTC';set row_security=on");
 phase='isolated data restore';await db.exec('begin;set local session_replication_role=replica');
 for(const r of identities)await db.query('insert into auth.users values($1,$2,$3)',r);
 const ident=name=>'"'+name.replaceAll('"','""')+'"';
 for(const block of data){
  table=block.schema+'.'+block.name;
  for(let i=0;i<block.rows.length;i+=100){
   const rows=block.rows.slice(i,i+100),values=rows.flat();
   const tuples=rows.map((r,n)=>'('+r.map((_,c)=>'$'+(n*r.length+c+1)).join(',')+')').join(',');
   await db.query(`insert into ${ident(block.schema)}.${ident(block.name)} (${block.columns.map(ident).join(',')}) overriding system value values ${tuples}`,values);
  }
 }
 await db.exec('commit');
 phase='row count verification';let rowCount=0;
 for(const block of data){
  table=block.schema+'.'+block.name;
  assert.equal(Number((await db.query(`select count(*) n from ${ident(block.schema)}.${ident(block.name)}`)).rows[0].n),block.rows.length);
  rowCount+=block.rows.length;
 }
 phase='foreign key verification';
 const keys=(await db.query(`select k.conrelid::regclass::text child,k.confrelid::regclass::text parent,
  array(select a.attname from unnest(k.conkey) with ordinality x(num,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.num order by x.ord) cols,
  array(select a.attname from unnest(k.confkey) with ordinality x(num,ord) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.num order by x.ord) parent_cols
  from pg_constraint k join pg_namespace n on n.oid=k.connamespace where k.contype='f' and n.nspname in ('public','sportsbook_private')`)).rows;
 for(const key of keys){
  table=key.child;
  const present=key.cols.map(c=>'c.'+ident(c)+' is not null').join(' and '),match=key.cols.map((c,i)=>'c.'+ident(c)+'=p.'+ident(key.parent_cols[i])).join(' and ');
  assert.equal(Number((await db.query(`select count(*) n from ${key.child} c where ${present} and not exists(select 1 from ${key.parent} p where ${match})`)).rows[0].n),0);
 }
 phase='financial verification';
 const finance=(await db.query(`select (select count(*)::int from tickets) tickets,(select count(*)::int from ticket_legs) legs,
  (select count(*)::int from tickets where status='OPEN') open_tickets,(select sum(stake)::text from tickets where status='OPEN') open_stakes,
  (select sum(balance)::text from wallets) available,(select count(*)::int from wallet_ledger) ledger`)).rows[0];
 phase='accepted financial content verification';
 for(const block of data.filter(b=>['tickets','ticket_legs','wallet_ledger'].includes(b.name))){
  table=block.name;const idIndex=block.columns.indexOf('id');assert(idIndex>=0);
  const original=new Map(block.rows.map(row=>[row[idIndex],row]));
  const restored=(await db.query(`select array[${block.columns.map(c=>ident(c)+'::text').join(',')}] cells from public.${ident(block.name)}`)).rows;
  for(const row of restored)assert.equal(hash(JSON.stringify(row.cells)),hash(JSON.stringify(original.get(row.cells[idIndex]))),'Financial content differs');
 }
 if(process.argv.includes('--upgrade')){
  phase='isolated Production schema upgrade';
  const {rehearseProductionUpgrade}=await import('./lib/rehearse-production-upgrade.mjs');
  upgrade=await rehearseProductionUpgrade(db);
 }
 phase='outsider access verification';
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
 await db.exec("set request.jwt.claim.role='authenticated';set role authenticated");
 for(const name of ['wallets','tickets','ticket_legs','league_memberships']){
  table=name;
  try{assert.equal(Number((await db.query(`select count(*) n from public.${name}`)).rows[0].n),0);}
  catch(error){if(error.code!=='42501')throw error;}
 }
 await db.exec('reset role');
 const receipt={format:'boff-native-application-restore-v1',verified_at:new Date().toISOString(),project_ref:manifest.project_ref,
  backup_finished_at:manifest.finished_at,plaintext_checksum_verified:true,archive_readable:true,
  application_schema_restored:true,application_tables:data.length,application_rows:rowCount,foreign_keys_checked:keys.length,
  finance,upgrade,accepted_financial_content_verified:true,outsider_denied:true,auth_identities_restored:identities.length,
  auth_credentials_sessions_restored:false,full_platform_restore_verified:false,
  scope:'Offline PGlite application schema and core financial/access dependencies, with Auth identity stubs. Optional runtime/browser fields attest actual API/worker and candidate code over simulated HTTP/Auth/Vault/cron/net transports. Forecast/model archive data, real Auth credentials/sessions, hosted services and hosted runtime acceptance are not covered. Not a full platform restore.',
  production_modified:false,plaintext_dump_written:false};
 await fs.writeFile(path.join(folder,upgrade?'application-upgrade-verification.json':'application-restore-verification.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({...receipt,upgrade:upgrade?{...upgrade,runtime:upgrade.runtime?{...upgrade.runtime,browser:upgrade.runtime.browser?{...upgrade.runtime.browser,results:undefined}:undefined}:undefined}:undefined},null,2));
}catch(error){
 const missingSchema=error.code==='3F000'?/schema "([a-zA-Z0-9_]+)" does not exist/.exec(error.message)?.[1]:undefined;
 console.error(JSON.stringify({status:'rehearsal_failed',phase,table,code:error.code??'local_check_failed',missing_schema:missingSchema,
  schema_diagnostic:phase==='isolated Production schema upgrade'?String(error.message).slice(0,220):undefined,
  migration_statement:error.migration_statement,migration_head:error.migration_head,
  production_modified:false,detail:'Detailed data/query output suppressed to protect backup contents.'}));process.exitCode=1;
}finally{if(db)await db.close();}
