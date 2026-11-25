import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {targets,targetHeaders} from '../visual/lib/release-target.mjs';
// Build only. No Vercel/Supabase deployment client, token, or hosted write.
const target=targets[process.argv.includes('--development')?'development':'production'];
const repo=process.cwd(),base=path.resolve(repo,target.name==='production'?'work/production-migration':'work/development-sync');
await fs.mkdir(base,{recursive:true});
const require=createRequire(path.resolve('visual/package.json'));
for(const [script,args] of [[path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc'),['--noEmit']],
 [path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),['build']],
 [path.resolve('visual/build-league-intake.mjs'),[]]])
 execFileSync(process.execPath,[script,...args],{cwd:path.resolve('visual'),
  env:{...process.env,BOFF_BUILD_TARGET:target.name},stdio:'inherit',windowsHide:true});
// Exclusive directory prevents a second run from mixing old release files.
const output=await fs.mkdtemp(path.join(base,'candidate-'));
const staticRoot=path.join(output,'public');
await fs.mkdir(staticRoot);
for(const entry of await fs.readdir(path.resolve('visual/dist'))){
 if(entry==='vercel.json')continue;
 // Functions and their relative server dependencies are deployment inputs, never CDN assets.
 const destination=entry==='api'||entry==='lib'?output:staticRoot;
 await fs.cp(path.resolve('visual/dist',entry),path.join(destination,entry),{recursive:true,errorOnExist:true,force:false});
}
const config=targetHeaders(JSON.parse(await fs.readFile('visual/vercel.json','utf8')),target);
config.outputDirectory='public';
// The new refresh worker lives in Supabase; do not silently retain the old
// Vercel worker route in this candidate. Scheduled job replacement is a gate.
delete config.functions['api/weekly-worker.mjs'];
await fs.writeFile(path.join(output,'vercel.json'),JSON.stringify(config,null,2)+'\n');
const publicFiles=[];
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){
 const full=path.join(dir,item.name);if(item.isDirectory())await walk(full);else{
  const relative=path.relative(output,full).replaceAll('\\','/');
  if(/(?:^|\/)(?:\.env[^/]*|\.vercel|work|node_modules)(?:\/|$)|\.(?:pem|key|pgp|dump)$/i.test(relative))throw Error('Private file in build');
  const data=await fs.readFile(full);
  if(relative.startsWith('public/assets/')&&relative.endsWith('.js')){
   const other=target.name==='production'?targets.development:targets.production;
   if(data.includes(Buffer.from(other.projectRef)))throw Error('Other environment backend in browser bundle');
   if(data.includes(Buffer.from(other.publishableKey)))throw Error('Other environment auth key in browser bundle');
  }
  publicFiles.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
 }
}}
await walk(output);publicFiles.sort((a,b)=>a.path.localeCompare(b.path));
if(publicFiles.some(file=>/^public\/(api|lib)\//.test(file.path)))throw Error('Server source in public output');
const metadata={format:'boff-production-candidate-v1',built_at:new Date().toISOString(),candidate_directory:output,target:target.name,
 project_ref:target.projectRef,vercel_project:target.vercelProject,origin:target.origin,
 deployable:false,reason:'Hosted Auth, worker/source/IO acceptance, final source freeze, recovery checkpoint and release approval remain required.',files:publicFiles};
await fs.writeFile(path.resolve(output,'../candidate-manifest.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({candidate:output,files:publicFiles.length,deployable:false,production_backend:target.projectRef,development_backend_excluded:true}));
