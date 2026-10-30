import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import * as openpgp from 'openpgp';
import {portableRecoveryKey} from './recovery-custody.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {protect,recoveryTables} from './financial-recovery.mjs';
const oldPassphrase='synthetic-old-password-only',newPassphrase='synthetic-owner-password-only',plaintext='Synthetic financial checkpoint; no real accounts.';
const keys=await openpgp.generateKey({type:'ecc',curve:'curve25519Legacy',userIDs:[{name:'Synthetic custody test'}],passphrase:oldPassphrase});
const publicKey=await openpgp.readKey({armoredKey:keys.publicKey});
const ciphertext=await openpgp.encrypt({message:await openpgp.createMessage({text:plaintext}),encryptionKeys:publicKey,format:'binary'});
const args={encryptedPrivateKey:keys.privateKey,oldPassphrase,newPassphrase,ciphertext,expectedPlaintextSha:createHash('sha256').update(plaintext).digest('hex')};
const result=await portableRecoveryKey(args);
assert.equal(result.receipt.fingerprint,publicKey.getFingerprint());assert(result.receipt.portable_key_decrypt_verified);
assert.equal(result.receipt.password_manager_import_confirmed,false);assert.equal(result.receipt.independent_device_restore_confirmed,false);
await assert.rejects(openpgp.decryptKey({privateKey:await openpgp.readPrivateKey({armoredKey:result.armored}),passphrase:oldPassphrase}));
await assert.rejects(portableRecoveryKey({...args,newPassphrase:'short'}),/password/);
await assert.rejects(portableRecoveryKey({...args,expectedPlaintextSha:'0'.repeat(64)}),/digest mismatch/);
await assert.rejects(portableRecoveryKey({...args,oldPassphrase:'wrong-synthetic-password'}));
assert(!JSON.stringify(result.receipt).includes(newPassphrase));assert(!JSON.stringify(result.receipt).includes(plaintext));
// Exercise the owner CLI using synthetic keys/empty financial relations only.
// Nothing reads the real recovery directory or an actual password-manager key.
await fs.mkdir('work',{recursive:true});const folder=await fs.mkdtemp(path.resolve('work/custody-fixture-'));
try{
 const schema=await fs.readFile('supabase/development/baseline-schema.sql','utf8');
 const document=JSON.stringify({format:'boff-financial-recovery-v1',project_ref:'bmvjcdgxwxqalaohpsnw',
  schema_sha256:createHash('sha256').update(schema).digest('hex'),tables:Object.fromEntries(recoveryTables.map(t=>[t,[]])),
  counts:Object.fromEntries(recoveryTables.map(t=>[t,0])),checksums:Object.fromEntries(recoveryTables.map(t=>[t,createHash('md5').update('[]').digest('hex')]))});
 const cipher=await openpgp.encrypt({message:await openpgp.createMessage({text:document}),encryptionKeys:publicKey,format:'binary'});
 await fs.writeFile(path.join(folder,'snapshot.pgp'),cipher);await fs.writeFile(path.join(folder,'offsite-readback.pgp'),cipher);
 await fs.writeFile(path.join(folder,'schema.sql'),schema);
 await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({format:'boff-financial-recovery-v1',plaintext_sha256:createHash('sha256').update(document).digest('hex')}));
 const secret=Buffer.from(JSON.stringify({passphrase:newPassphrase,confirmation:newPassphrase})).toString('base64');
 const cipherDigest=createHash('sha256').update(cipher).digest('hex');
 const run=(mode,key)=>execFileSync(process.execPath,['scripts/recovery-custody.mjs',mode,folder,...(key?[key,cipherDigest]:[])],{input:secret,encoding:'utf8',windowsHide:true});
 const portablePath=path.join(folder,'portable-private-key.asc');
 if(process.platform==='win32'){
  await fs.writeFile(path.join(folder,'private.asc'),keys.privateKey);
  await fs.writeFile(path.join(folder,'passphrase.dpapi'),protect(Buffer.from(oldPassphrase),'protect'));
  assert(run('export').includes('verified locally'));
  const receipt=JSON.parse(await fs.readFile(path.join(folder,'custody-export-receipt.json'),'utf8'));assert(receipt.offsite_readback_used);
  const before=await fs.readFile(portablePath,'utf8');
  const repeat=spawnSync(process.execPath,['scripts/recovery-custody.mjs','export',folder],{input:secret,encoding:'utf8',windowsHide:true});
  assert.equal(repeat.status,1);assert.equal(await fs.readFile(portablePath,'utf8'),before,'existing key is never overwritten');
 }else await fs.writeFile(portablePath,result.armored);
 assert(run('verify-portable',portablePath).includes('without DPAPI'));
 const restored=JSON.parse(await fs.readFile(path.join(folder,'portable-restore-result.json'),'utf8'));
 assert.equal(restored.used_dpapi,false);assert(restored.outsider_denied&&restored.anonymous_denied);assert(restored.foreign_keys_checked>0);
 await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({format:'boff-financial-recovery-v1',plaintext_sha256:'0'.repeat(64)}));
 const tampered=spawnSync(process.execPath,['scripts/recovery-custody.mjs','verify-portable',folder,portablePath,cipherDigest],{input:secret,encoding:'utf8',windowsHide:true});
 assert.equal(tampered.status,1);assert(!tampered.stderr.includes(newPassphrase));
}finally{
 const resolved=await fs.realpath(folder),root=await fs.realpath('work');
 assert(resolved.startsWith(root+path.sep+'custody-fixture-'),'delete only this test-created fixture under the workspace');
 await fs.rm(resolved,{recursive:true});
}
console.log('Passed synthetic portable-key re-encryption/decryption, original fingerprint, wrong/weak password and tampered checkpoint rejection; receipt makes no password-manager/independent-device custody claim.');
