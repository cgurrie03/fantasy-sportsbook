// Owner-run local key custody. Never call export with a password in command
// arguments/environment/chat. The PowerShell wrapper supplies hidden stdin.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as openpgp from 'openpgp';
import {protect,restoreFinancialSnapshot} from './financial-recovery.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');

export async function portableRecoveryKey({encryptedPrivateKey,oldPassphrase,newPassphrase,ciphertext,expectedPlaintextSha}){
 if(typeof newPassphrase!=='string'||newPassphrase.length<20||newPassphrase.length>1024||newPassphrase===oldPassphrase)
  throw new Error('Use a new owner-controlled password of 20–1024 characters.');
 if(!/^[a-f0-9]{64}$/.test(expectedPlaintextSha))throw new Error('A verified snapshot digest is required.');
 const original=await openpgp.decryptKey({privateKey:await openpgp.readPrivateKey({armoredKey:encryptedPrivateKey}),passphrase:oldPassphrase});
 const locked=await openpgp.encryptKey({privateKey:original,passphrase:newPassphrase});
 const armored=locked.armor();
 const reopened=await openpgp.decryptKey({privateKey:await openpgp.readPrivateKey({armoredKey:armored}),passphrase:newPassphrase});
 const decrypted=await openpgp.decrypt({message:await openpgp.readMessage({binaryMessage:ciphertext}),decryptionKeys:reopened,format:'binary'});
 if(digest(decrypted.data)!==expectedPlaintextSha)throw new Error('Portable-key recovery digest mismatch.');
 return {armored,receipt:{format:'boff-portable-key-custody-v1',fingerprint:reopened.getFingerprint(),
  encrypted_key_sha256:digest(armored),snapshot_sha256:digest(ciphertext),snapshot_plaintext_sha256:expectedPlaintextSha,
  portable_key_decrypt_verified:true,password_manager_import_confirmed:false,independent_device_restore_confirmed:false}};
}

async function localFolder(input){
 const project=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=await fs.realpath(path.join(project,'work'));
 const folder=await fs.realpath(path.resolve(input));
 if(!folder.startsWith(root+path.sep))throw new Error('Use an existing ignored recovery folder under this project work directory.');
 return folder;
}
async function main(){
 if(process.env.VERCEL||process.env.VERCEL_ENV)throw new Error('Recovery custody must never run on hosting.');
 const [mode,input]=process.argv.slice(2);if(!input)throw new Error('An existing recovery folder is required.');
 const folder=await localFolder(input);
 if(mode==='inspect'){
  const publicKey=await openpgp.readKey({armoredKey:await fs.readFile(path.join(folder,'public.asc'),'utf8')});
  const cipher=await fs.readFile(path.join(folder,'snapshot.pgp'));
  console.log(JSON.stringify({fingerprint:publicKey.getFingerprint(),ciphertext_sha256:digest(cipher),ciphertext_bytes:cipher.length,
   scope:'Financial checkpoint only; independent password-manager custody and full platform recovery are separate gates.'}));return;
 }
 if(!['export','verify-portable'].includes(mode)||process.stdin.isTTY)throw new Error('Run through export-recovery-key.ps1; do not supply a password in command arguments.');
 let inputBytes=0;const chunks=[];
 for await(const chunk of process.stdin){inputBytes+=Buffer.byteLength(chunk);if(inputBytes>16384)throw new Error('Custody input exceeds its limit.');chunks.push(chunk);}
 const transport=Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8').replace(/^\uFEFF/,'').trim();
 const secret=JSON.parse(Buffer.from(transport,'base64').toString('utf8'));
 if(secret.passphrase!==secret.confirmation)throw new Error('Recovery passwords do not match.');
 if(mode==='verify-portable'){
  const keyPath=process.argv[4];if(!keyPath)throw new Error('The independently obtained encrypted key attachment is required.');
  const key=await openpgp.decryptKey({privateKey:await openpgp.readPrivateKey({armoredKey:await fs.readFile(keyPath,'utf8')}),passphrase:secret.passphrase});
  const cipher=await fs.readFile(path.join(folder,'snapshot.pgp'));
  const expectedCipher=process.argv[5];
  if(!/^[a-f0-9]{64}$/.test(expectedCipher??'')||digest(cipher)!==expectedCipher)
   throw new Error('The independently held ciphertext digest is required and must match.');
  const plaintext=(await openpgp.decrypt({message:await openpgp.readMessage({binaryMessage:cipher}),decryptionKeys:key})).data;
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  if(digest(plaintext)!==manifest.plaintext_sha256)throw new Error('Portable recovery digest mismatch.');
  const result=await restoreFinancialSnapshot(plaintext,await fs.readFile(path.join(folder,'schema.sql'),'utf8'));
  await fs.writeFile(path.join(folder,'portable-restore-result.json'),JSON.stringify({...result,fingerprint:key.getFingerprint(),
   ciphertext_sha256:digest(cipher),verified_at:new Date().toISOString(),used_dpapi:false,
   scope:'Financial-only local restore; not full platform/Auth recovery or a proof of password-manager import.'},null,2),{flag:'wx',mode:0o600});
  console.log('Portable financial restore passed without DPAPI. Original financial/FK/privacy/refund checks passed; full platform recovery remains separate.');return;
 }
 for(const file of ['portable-private-key.asc','custody-export-receipt.json']){
  try{await fs.access(path.join(folder,file));throw new Error('Existing custody output must not be overwritten.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
 if(manifest.format!=='boff-financial-recovery-v1')throw new Error('Unexpected checkpoint format.');
 const originalCipher=await fs.readFile(path.join(folder,'snapshot.pgp'));
 const readback=await fs.readFile(path.join(folder,'offsite-readback.pgp')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(readback&&digest(readback)!==digest(originalCipher))throw new Error('Off-site readback differs from original ciphertext.');
 const result=await portableRecoveryKey({
  encryptedPrivateKey:await fs.readFile(path.join(folder,'private.asc'),'utf8'),
  oldPassphrase:protect(await fs.readFile(path.join(folder,'passphrase.dpapi')),'unprotect').toString(),
  newPassphrase:secret.passphrase,ciphertext:readback??originalCipher,expectedPlaintextSha:manifest.plaintext_sha256,
 });
 // This attachment remains separate from the Drive backup and must be imported
 // into the owner's password manager. Exclusive creation preserves older keys.
 const output=path.join(folder,'portable-private-key.asc');
 await fs.writeFile(output,result.armored,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(folder,'custody-export-receipt.json'),JSON.stringify({...result.receipt,
  created_at:new Date().toISOString(),offsite_readback_used:!!readback},null,2),{flag:'wx',mode:0o600});
 console.log('Portable encrypted key created and verified locally. Import portable-private-key.asc into your password manager with its password. Never upload this key beside the Drive backup or send it in chat.');
 console.log('Fingerprint: '+result.receipt.fingerprint);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await main();}catch{console.error('Recovery custody failed. No password/key contents were logged. Check folder, password confirmation, existing output files and the independent verified checkpoint.');process.exitCode=1;}
}
