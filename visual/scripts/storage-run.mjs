import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await fs.mkdir(path.join(root,'visual/test-results/storage'),{recursive:true});
for(const name of ['receipts','retention','wallet-regression','routine-regression','compression']) {
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[`visual/scripts/storage-${name}.mjs`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b);});
    child.on('error',reject);
    child.on('close',async code=>{
      await fs.writeFile(path.join(root,`visual/test-results/storage/${name}.log`),log);
      code===0?resolve():reject(Error(`${name} failed (${code})`));
    });
  });
}
console.log('All storage checks passed. No hosted data is used or modified by this runner.');
