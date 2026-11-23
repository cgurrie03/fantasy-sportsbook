import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const root=process.cwd(),output=await fs.mkdtemp(path.resolve('work/production-migration/worker-'));
const pending=['visual/server/live-refresh.ts'],seen=new Set(),files=[];
while(pending.length){
 const name=pending.pop();if(seen.has(name))continue;seen.add(name);
 if(!/^(?:visual\/(?:server|src)|api\/_lib)\/[a-zA-Z0-9_.-]+\.ts$/.test(name))throw Error('Unexpected worker source path: '+name);
 const source=await fs.readFile(name,'utf8');
 const syntax=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
 for(const node of syntax.statements){
  if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;
  if(!node.moduleSpecifier)continue;
  const specifier=node.moduleSpecifier.text;
  if(specifier.startsWith('.'))pending.push(path.relative(root,path.resolve(path.dirname(name),specifier)).replaceAll('\\','/'));
  else if(specifier!=='npm:web-push@3.6.7')throw Error('Unreviewed external worker dependency: '+specifier);
 }
 const target=path.join(output,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);
 files.push({path:name,sha256:createHash('sha256').update(source).digest('hex')});
}
files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest={format:'boff-production-worker-v1',prepared_at:new Date().toISOString(),directory:output,
 function_name:'boff-production-live-refresh',entrypoint:'visual/server/live-refresh.ts',project_ref:'bmvjcdgxwxqalaohpsnw',verify_jwt:false,
 authentication:'Dedicated 256-bit Vault token, hashed control cache and release-runtime comparison; commissioner JWT path uses database authorization',
 environment:{BOFF_RELEASE_TARGET:'production',BOFF_RELEASE_SCHEMA:'boff-person-wallets-2026-11',SUPABASE_URL:'https://bmvjcdgxwxqalaohpsnw.supabase.co'},
 platform_secret_names:['SUPABASE_SERVICE_ROLE_KEY'],files,deployable:false,
 activation:'Explicit approved cutover only; scheduler configured disabled; warmup cannot settle, reward, or notify; mail stays disabled'};
await fs.writeFile(path.resolve('work/production-migration/worker-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(output,'worker-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared:true,files:files.length,directory:output,deployable:false,secrets_exported:false}));
