import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceIdentity,createEvidence,verifyEvidence,reviewManifest} from './release-evidence.mjs';
const root=mkdtempSync(path.join(tmpdir(),'boff-release-evidence-'));
if(path.dirname(root)!==tmpdir()||!path.basename(root).startsWith('boff-release-evidence-'))throw Error('Unsafe fixture cleanup path');
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe',encoding:'utf8'});
try {
 git('init','--initial-branch=main');git('config','user.email','fixture@example.test');git('config','user.name','Release fixture');
 mkdirSync(path.join(root,'supabase/migrations'),{recursive:true});
 writeFileSync(path.join(root,'supabase/migrations/20261030000000_fixture.sql'),'select 1;\n');
 writeFileSync(path.join(root,'app.txt'),'initial\n');git('add','.');git('commit','-m','Fixture');
 const current=sourceIdentity(root),suites=['critical'],results=[{suite:'critical',passed:true,seconds:1}];
 const clock=new Date().toISOString(),args={start:current,end:current,results,suites,startedAt:clock,finishedAt:clock};
 const evidence=createEvidence(args);assert(evidence.valid);assert(verifyEvidence(evidence,results,current,suites));
 const manifest=reviewManifest(evidence,results,current,suites);assert.equal(manifest.status,'unapproved');assert.equal(manifest.owner_approval,null);
 assert(Object.values(manifest.required_gates).every(x=>x===false));
 for(const mutant of [{...evidence,valid:false},{...evidence,finished_at:'2001-01-01T00:00:00Z'},
  {...evidence,finished_at:new Date(Date.now()+86400000).toISOString()},
  {...evidence,source:{...current,dirty:true}}, {...evidence,results_sha256:'0'.repeat(64)}])
  assert.throws(()=>verifyEvidence(mutant,results,current,suites),/exact clean commit/);
 for(const modified of [[],[{...results[0],passed:false}],[...results,...results],[{...results[0],suite:'other'}],[{...results[0],seconds:NaN}]])
  assert.throws(()=>verifyEvidence(evidence,modified,current,suites),/exact clean commit/);
 assert.throws(()=>verifyEvidence(evidence,results,current,['critical','added']),/exact clean commit/);
 writeFileSync(path.join(root,'app.txt'),'dirty\n');assert(sourceIdentity(root).dirty);
 assert.throws(()=>verifyEvidence(evidence,results,sourceIdentity(root),suites),/exact clean commit/);
 assert.equal(createEvidence({...args,end:sourceIdentity(root)}).valid,false);
 git('restore','app.txt');writeFileSync(path.join(root,'untracked.txt'),'untracked');assert(sourceIdentity(root).dirty);
 rmSync(path.join(root,'untracked.txt'));
 writeFileSync(path.join(root,'supabase/migrations/20261030000000_fixture.sql'),'select 2;\n');
 git('add','.');git('commit','-m','Changed migration');
 const changed=sourceIdentity(root);assert.notDeepEqual(changed.migrations,current.migrations);
 assert.throws(()=>verifyEvidence(evidence,results,changed,suites),/exact clean commit/);
 assert.equal(createEvidence({...args,end:changed}).valid,false);
 console.log('Passed clean-source evidence, dirty/untracked/commit/migration drift, suite/result tampering, expiry and unapproved review gates.');
}finally{
 // This is a newly created fixture, never a user checkout.
 rmSync(root,{recursive:true,force:true});
}
