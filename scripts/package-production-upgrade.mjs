import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {sqlStatements} from './lib/sql-statements.mjs';
import {sqlTokens} from './lib/sql-tokens.mjs';
const output='supabase/production/migrations/20261120152909_production_release_schema_and_legacy_routing.sql';
const sourceFiles=['work/production-migration/upgrade-schema.sql','supabase/production/legacy-wallet-routing.sql','supabase/production/worker-runtime.sql'];
const sources=await Promise.all(sourceFiles.map(p=>fs.readFile(p,'utf8')));
const parts=sources.flatMap(sqlStatements).filter(s=>!['begin;','commit;'].includes(sqlTokens(s).join('')));
const sql='-- REVIEWED PRODUCTION PROFILE ONLY. Not part of Development migrations.\n-- Expansion installs a prepared release; separate owner review moves balances.\nBEGIN;\n'+parts.join('\n\n')+'\nCOMMIT;\n';
assert.equal(sqlStatements(sql).filter(s=>sqlTokens(s).join('')==='begin;').length,1);
assert.equal(sqlStatements(sql).filter(s=>sqlTokens(s).join('')==='commit;').length,1);
await fs.mkdir('supabase/production/migrations',{recursive:true});
await fs.writeFile(output,sql);
const receipt={profile:'production',path:output,sha256:createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql),
 source_files:sourceFiles,source_file_hashes:sourceFiles.map((path,i)=>({path,sha256:createHash('sha256').update(sources[i]).digest('hex')})),automatic_funding:false,automatic_betting_activation:false,deployable:false,
 reason:'Local upgrade rehearsal is not final hosted runtime, worker, UI or release approval.'};
await fs.writeFile('work/production-migration/packaged-upgrade.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
