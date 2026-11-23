import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareMigration,rehearseFinancialStage,cents,creditString,legacyFutureRouting} from './lib/production-migration.mjs';
import {targets,serverTarget,buildTarget,releaseSchema,targetHeaders} from '../visual/lib/release-target.mjs';
import {workerTarget} from '../visual/server/runtime-target.ts';
const s=JSON.parse(await fs.readFile('work/production-migration/inventory.json','utf8'));
const original=JSON.stringify(s),p=prepareMigration(s);
assert.equal(JSON.stringify(s),original,'Planner mutated the source');
assert.equal(p.ready_for_cutover,false);
assert.equal(p.reservations.filter(r=>r.user_id).length,8);
assert(p.reservations.filter(r=>!r.user_id).every(r=>!r.routine_mail_allowed));
assert.equal(p.finance.open_future_stakes,'225.00');assert.equal(p.finance.open_nonfuture_stakes,'0.00');
const contexts=JSON.parse(await fs.readFile('work/production-migration/legacy-futures.json','utf8'));
const routes=legacyFutureRouting(s,contexts);
assert.equal(routes.length,18);assert.equal(new Set(routes.map(r=>r.ticket_id)).size,9);
assert(routes.some(r=>r.subject_team_id!==r.bettor_team_id),'Payout recipient confused with selected team');
assert.throws(()=>legacyFutureRouting(s,contexts.slice(1)),/Missing/);
const badContext=structuredClone(contexts);badContext[0].settlement_context.metadata.roster_id=999;
assert.throws(()=>legacyFutureRouting(s,badContext),/identity mismatch/);
assert.equal(p.reservations.find(r=>r.sleeper_user_id==='1269136771011055616')?.account_state,'verified');
assert.equal(creditString(cents('396.44')+cents('136.08')),'532.52');
for(const bad of ['0.001','Infinity',null,undefined])assert.throws(()=>cents(bad));
for(const mutate of [v=>v.project_ref='whlcnlacueweaqpsupqs',v=>v.tickets.push(v.tickets[0]),
 v=>v.legs[0].ticket_id='missing',v=>v.members[0].matched_auth_id='different',v=>v.wallets.push(v.wallets[0])]){
 const copy=structuredClone(s);mutate(copy);assert.throws(()=>prepareMigration(copy));
}
const db=new PGlite();try {
 const changed=structuredClone(s);changed.wallets[0].balance+=1;
 await assert.rejects(()=>rehearseFinancialStage(db,changed,p),/Snapshot changed/);
 const result=await rehearseFinancialStage(db,s,p);assert(result.available_funds_conserved&&result.retry_idempotent&&result.rollback);
}finally{await db.close();}
assert.throws(()=>buildTarget('staging'));assert.equal(buildTarget().name,'development');
for(const target of Object.values(targets)){
 const valid={BOFF_RELEASE_TARGET:target.name,VERCEL_ENV:target.vercelEnvironment,VERCEL_PROJECT_ID:target.vercelProject,
  SUPABASE_URL:`https://${target.projectRef}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key',BOFF_RELEASE_SCHEMA:releaseSchema};
 assert.equal(serverTarget(valid),target);
 assert.equal(workerTarget({target:target.name,url:valid.SUPABASE_URL,schema:releaseSchema})?.projectRef,target.projectRef);
 assert.equal(workerTarget({target:target.name,url:'https://evil.invalid',schema:releaseSchema}),null);
 for(const [key,value] of [['SUPABASE_URL','https://evil.invalid'],['SUPABASE_URL',valid.SUPABASE_URL+'/'],['VERCEL_PROJECT_ID','wrong'],['VERCEL_ENV','wrong'],['SUPABASE_SERVICE_ROLE_KEY','']])
  assert.equal(serverTarget({...valid,[key]:value}),null);
 if(target.name==='production'){
  const {BOFF_RELEASE_TARGET,...implicit}=valid;assert.equal(serverTarget(implicit),null);
  assert.equal(serverTarget({...valid,BOFF_RELEASE_SCHEMA:''}),null);
  assert.equal(workerTarget({target:target.name,url:valid.SUPABASE_URL}),null);
 }
 const config=JSON.parse(await fs.readFile('visual/vercel.json','utf8'));
 const headers=targetHeaders(config,target),policy=headers.headers.flatMap(g=>g.headers).find(h=>h.key==='Content-Security-Policy').value;
 assert(policy.includes(`${target.projectRef}.supabase.co`));
 const other=targets[target.name==='production'?'development':'production'];assert(!policy.includes(other.projectRef));
 assert(policy.includes("frame-ancestors 'none'"));
 assert(!JSON.stringify(target).includes('synthetic-server-key'));
}
console.log('PASS: live financial staging conserves credits/accepted records, rolls back and retries once; wrong source, identity conflicts, duplicate/orphan rows and changed snapshot rejected; target/project/URL/schema fences and target CSP verified. No hosted writes or email.');
