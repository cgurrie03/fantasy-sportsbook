import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {prepareMigration,rehearseFinancialStage,digest,legacyFutureRouting} from './lib/production-migration.mjs';
const dir=path.resolve('work/production-migration');
const snapshot=JSON.parse(await fs.readFile(path.join(dir,'inventory.json'),'utf8'));
const plan=prepareMigration(snapshot);
plan.legacy_future_routing=legacyFutureRouting(snapshot,JSON.parse(await fs.readFile(path.join(dir,'legacy-futures.json'),'utf8')));
const db=new PGlite();
try{plan.rehearsal=await rehearseFinancialStage(db,snapshot,plan);}finally{await db.close();}
const key=(kind,r)=>kind==='columns'?`${r.table_schema}.${r.table_name}.${r.column_name}`:
 kind==='functions'?`${r.schema}.${r.name}(${r.args})`:
 kind==='relations'?`${r.schema}.${r.name}`:
 kind==='policies'?`${r.schemaname}.${r.tablename}.${r.policyname}`:
 kind==='indexes'?`${r.schemaname}.${r.tablename}.${r.indexname}`:`${r.schema}.${r.table}.${r.name}`;
const catalogs=await Promise.all(['production','development'].map(async name=>JSON.parse(await fs.readFile(path.join(dir,`${name}-catalog.json`),'utf8'))));
plan.schema_difference={};
for(const kind of Object.keys(catalogs[0])){
 const before=new Map(catalogs[0][kind].map(r=>[key(kind,r),r])),after=new Map(catalogs[1][kind].map(r=>[key(kind,r),r]));
 const added=[...after.keys()].filter(k=>!before.has(k)),removed=[...before.keys()].filter(k=>!after.has(k));
 const changed=[...after.keys()].filter(k=>before.has(k)&&digest(after.get(k))!==digest(before.get(k)));
 plan.schema_difference[kind]={added,removed,changed};
}
// A file manifest includes untracked round work as well as committed code. No
// environment files, keys, work artifacts, backups or generated dist are bundled.
const candidates=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const sources=[];
for(const name of candidates){
 if(/^supabase\/visual\/migrations\/[a-zA-Z0-9_-]+\.sql$/.test(name)){
  sources.push({path:name,sha256:createHash('sha256').update(await fs.readFile(name)).digest('hex')});continue;
 }
 if(!/^(?:visual\/(?:src|server|api|lib|public)\/|visual\/scripts\/test-production-runtime\.py$|visual\/(?:package(?:-lock)?\.json|vite\.config\.ts|tsconfig\.json|build-league-intake\.mjs|index\.html|vercel\.json)$|supabase\/(?:migrations|production)\/|api\/_lib\/league-intake\.ts$|scripts\/(?:lib\/(?:production-migration|rehearse-production-(?:upgrade|wallets|runtime|browser)|offline-production-gateway|load-offline-worker|sql-statements|sql-tokens)|(?:build-production-upgrade|package-production-upgrade|prepare-production-(?:migration|worker|candidate)|rehearse-native-production-backup|test-production-(?:package|migration|worker)))\.mjs$)/.test(name))continue;
 if(/(?:^|\/)(?:\.env[^/]*|node_modules|dist|\.vercel)(?:\/|$)|\.(?:pem|pfx|p12|key)$/i.test(name))throw Error('Forbidden release path');
 try{sources.push({path:name,sha256:createHash('sha256').update(await fs.readFile(name)).digest('hex')});}catch(e){if(e.code!=='ENOENT')throw e;}
}
plan.source_manifest=sources;
plan.source_manifest_digest=digest(sources);
await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2)+'\n');
await fs.writeFile(path.join(dir,'source-manifest.json'),JSON.stringify(sources,null,2)+'\n');
console.log(JSON.stringify({ready_for_cutover:plan.ready_for_cutover,finance:plan.finance,rehearsal:plan.rehearsal,
 accounts:plan.reservations.reduce((a,r)=>(a[r.account_state]=(a[r.account_state]??0)+1,a),{}),
 schema_difference:Object.fromEntries(Object.entries(plan.schema_difference).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,rows])=>[n,rows.length]))])),
 source_files:sources.length,source_manifest_digest:plan.source_manifest_digest},null,2));
