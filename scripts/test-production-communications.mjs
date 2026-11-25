import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import handler from '../visual/api/notification-delivery.mjs';
const originalEnv={...process.env},originalFetch=globalThis.fetch;
const token='a'.repeat(64),claims=[],sent=[],completed=[];
Object.assign(process.env,{BOFF_RELEASE_TARGET:'production',BOFF_RELEASE_SCHEMA:'boff-person-wallets-2026-11',VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_xQNaH7f1SPr8bgn2GV92a9MODQu8',SUPABASE_URL:'https://bmvjcdgxwxqalaohpsnw.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'offline-only',RESEND_API_KEY:'offline-only'});
let providerFailure=false;
globalThis.fetch=async(url,options)=>{
 const body=options.body?JSON.parse(options.body):null;
 if(String(url).endsWith('/production_refresh_runtime'))return Response.json({tokenHash:createHash('sha256').update(token).digest('hex'),notificationsEnabled:true});
 if(String(url).endsWith('/production_claim_communications')){claims.push(body);return Response.json([{id:'test-id',sender:'sender@example.invalid',recipient:'verified@example.invalid',subject:'Test',html:'<p>Test</p>',plain_text:'Test'}]);}
 if(String(url)==='https://api.resend.com/emails'){sent.push(options);return Response.json(providerFailure?{message:'private provider detail'}:{id:'provider-id'},{status:providerFailure?429:200});}
 if(String(url).endsWith('/production_finish_communication')){completed.push(body);return new Response(null,{status:204});}
 throw Error('Unexpected network request');
};
async function run(authorization,body={}){const result={headers:{},statusCode:0};const res={setHeader(k,v){result.headers[k]=v},status(code){result.statusCode=code;return this},json(data){result.data=data;return result}};return handler({method:'POST',headers:{authorization},body},res);}
try{
 assert.equal((await run('Bearer invalid')).statusCode,401);assert.equal(claims.length,0);
 assert.equal((await run('Bearer '+'b'.repeat(64))).statusCode,401);assert.equal(claims.length,0);
 assert.equal((await run('Bearer '+token,{action:'health'})).data.status,'ready');assert.equal(claims.length,0);
 const good=await run('Bearer '+token);assert.equal(good.data.sent,1);assert.equal(sent[0].headers['Idempotency-Key'],'boff-communication-test-id');assert.equal(completed[0].p_provider,'provider-id');
 providerFailure=true;const retry=await run('Bearer '+token);assert.equal(retry.data.failed,1);assert.equal(completed[1].p_error,'provider_http_429');assert.equal(completed[1].p_provider,null);
 assert.equal(sent[1].headers['Idempotency-Key'],sent[0].headers['Idempotency-Key']);
 assert.equal(good.headers['Cache-Control'],'private, no-store');
 console.log('PASS: worker-only delivery, no-claim health check, stable provider idempotency, receipt logging and sanitized retry failures. No external requests.');
}finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);}
