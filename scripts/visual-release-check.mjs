import {spawn} from 'node:child_process';
const scripts=['scripts/release-source-scan.mjs','scripts/test-production-worker.mjs','scripts/test-production-package.mjs',
 'visual/scripts/account-isolation-tests.mjs','visual/scripts/book-request-history-tests.mjs','visual/scripts/live-book-access-tests.mjs',
 'visual/scripts/intake-api-tests.mjs','visual/scripts/member-invitation-api-tests.mjs','visual/scripts/refresh-push-tests.mjs',
 'visual/scripts/live-policy-tests.mjs','visual/scripts/weekly-rollover-tests.mjs','visual/scripts/fantasy-rewards-tests.mjs',
 'visual/scripts/weekly-reward-results-tests.mjs','visual/scripts/playoff-timing-tests.mjs','scripts/test-email-switcher.mjs',
 'visual/scripts/storage-run.mjs'];
for(const script of scripts){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script],{windowsHide:true,stdio:'inherit'});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`${script} failed (${code})`)));
 });
}
console.log('PASS: portable visual/Production-source qualification. Native-backup/browser-hosted/device acceptance remains separate.');
