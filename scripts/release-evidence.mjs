import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const hash=value=>createHash('sha256').update(value).digest('hex');
export function sourceIdentity(cwd=process.cwd()) {
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024}).trimEnd();
 const sha=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const dirty=git('status','--porcelain=v1','--untracked-files=all').length>0;
 const migrations=git('ls-tree','-r','HEAD','--','supabase/migrations','supabase/visual/migrations','supabase/production').split('\n').filter(Boolean).map(line=>{
  const [,blob,file]=/^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line)??[];
  if(!file?.endsWith('.sql'))throw Error('Unexpected migration entry.');
  return {file,blob};
 });
 return {sha,tree,dirty,migrations};
}
export function validateResults(results,suites) {
 return Array.isArray(results)&&results.length===suites.length&&results.every((r,i)=>
  r.suite===suites[i]&&r.passed===true&&Number.isFinite(r.seconds)&&r.seconds>=0);
}
export function createEvidence({start,end,results,suites,startedAt,finishedAt}) {
 const valid=!!start&&!start.dirty&&!end.dirty&&start.sha===end.sha&&start.tree===end.tree
  &&JSON.stringify(start.migrations)===JSON.stringify(end.migrations)&&validateResults(results,suites);
 return {format:'boff-release-evidence-v1',valid,started_at:startedAt,finished_at:finishedAt,
  source:start,final_source:end,suites,results_sha256:hash(JSON.stringify(results)),
  scope:'Local/CI test evidence only. Does not attest owner approval, recovery, capacity or production deployment.'};
}
export function verifyEvidence(evidence,results,current,suites,now=Date.now()) {
 const timestamp=Date.parse(evidence?.finished_at),began=Date.parse(evidence?.started_at);
 if(evidence?.format!=='boff-release-evidence-v1'||evidence.valid!==true||current.dirty||
  !Number.isFinite(timestamp)||!Number.isFinite(began)||began>timestamp||timestamp>now+60000||now-timestamp>7*86400000||
  !validateResults(results,suites)||JSON.stringify(evidence.suites)!==JSON.stringify(suites)||
  evidence.results_sha256!==hash(JSON.stringify(results))||
  JSON.stringify(evidence.source)!==JSON.stringify(current)||JSON.stringify(evidence.final_source)!==JSON.stringify(current))
  throw Error('Fresh passing evidence for this exact clean commit/tree/migration set is required. Run npm run test:release.');
 return true;
}
export function reviewManifest(evidence,results,current,suites) {
 verifyEvidence(evidence,results,current,suites);
 return {format:'boff-release-review-v1',source:current,results_sha256:evidence.results_sha256,
  evidence_sha256:hash(JSON.stringify(evidence)),created_at:new Date().toISOString(),
  production:{vercel_project:'prj_xQNaH7f1SPr8bgn2GV92a9MODQu8',supabase_project:'bmvjcdgxwxqalaohpsnw',origin:'https://sportsbook.coopergurrie.com'},
  status:'unapproved',owner_approval:null,
  required_gates:{full_recovery:false,capacity:false,residual_audit:false,production_publication_controls:false,exact_migration_plan:false,rollback_plan:false},
  warning:'Review preparation only; this file neither authorizes nor executes production changes. Owner approval and externally enforced publication controls are separate requirements.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try {
  const {releaseSuites}=await import('./release-suite-plan.mjs');
  const evidence=JSON.parse(readFileSync('work/release-checks/provenance.json','utf8'));
  const results=JSON.parse(readFileSync('work/release-checks/results.json','utf8'));
  const current=sourceIdentity(),manifest=reviewManifest(evidence,results,current,releaseSuites);
  const folder=path.join('work','release-reviews',current.sha);mkdirSync(folder,{recursive:true});
  writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(`Prepared unapproved exact-source review: ${folder}/manifest.json. No production action performed.`);
 }catch(e){console.error(e instanceof Error?e.message:'Release review preparation failed.');process.exitCode=1;}
}
