import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const failures=[];
for(const path of paths){
 if(/(?:^|\/)(?:node_modules|dist|work|\.vercel|\.supabase)(?:\/|$)|(?:^|\/)\.env(?:\.|$)/.test(path)&&!path.endsWith('.example'))failures.push({path,reason:'Private/generated path in release source'});
 const data=await fs.readFile(path);if(data.includes(0))continue;
 const text=data.toString();
 if(/^supabase\/migrations\/.*\.sql$/.test(path)&&/\bboff_dev_internal\b/.test(text))failures.push({path,reason:'Hosted visual-app migration belongs in an environment profile, not the shared core migration chain'});
 if(/sb_secret_[A-Za-z0-9_-]{16,}|\bre_[A-Za-z0-9]{24,}|-----BEGIN (?:PGP PRIVATE KEY BLOCK|RSA PRIVATE KEY|EC PRIVATE KEY|PRIVATE KEY)-----/.test(text))failures.push({path,reason:'Possible private credential material'});
 for(const jwt of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{20,}/g)){
  try{if(JSON.parse(Buffer.from(jwt[1],'base64url')).role==='service_role')failures.push({path,reason:'Embedded service-role JWT'});}catch{}
 }
}
assert.deepEqual(failures,[],'Release secret/path scan failed; only paths and rule names are reported');
console.log(`PASS: ${paths.length} source paths checked for private/generated files and high-confidence credential patterns. Not a comprehensive secret-detection guarantee.`);
