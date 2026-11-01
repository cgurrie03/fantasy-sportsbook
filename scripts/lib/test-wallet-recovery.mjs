import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { restoreFinancialSnapshot, snapshotQuery, recoveryTablesV2 } from '../financial-recovery.mjs';

export async function testWalletRecovery(db, { outsider }) {
  const dump = await pgDump({ pg: db, args: ['--schema-only','--no-owner','--schema=public','--schema=sportsbook_private'] });
  const schema = (await dump.text()).replace(/^\\(?:un)?restrict .*\r?\n/gm, '')
    .replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;');
  const projectRef = 'whlcnlacueweaqpsupqs';
  const query = snapshotQuery('-----BEGIN PGP PUBLIC KEY BLOCK-----\nsynthetic query fixture', {
    format: 'boff-financial-recovery-v2', projectRef,
  }).replace('SCHEMA_HASH_PLACEHOLDER', createHash('sha256').update(schema).digest('hex'));
  // Exercise the real read-only, repeatable-read document query. Encryption is
  // separately tested with newly generated synthetic keys by the custody suite.
  const results = await db.exec(query.slice(0, query.indexOf('select encode('))+'select data from document;commit;');
  const plaintext = results.find(r => r.rows?.[0]?.data)?.rows[0].data;
  assert(plaintext);
  const parsed = JSON.parse(plaintext);
  assert.equal(parsed.tables['auth.users'].some(a => a.id===outsider), false, 'unrelated Auth identity omitted');
  assert.equal(Object.keys(parsed.tables).length,recoveryTablesV2.length);
  const restored = await restoreFinancialSnapshot(plaintext, schema, {projectRef});
  assert(restored.foreign_keys_checked>82);
  assert(restored.user_wallet_checks.duplicate_refund_checked, 'restored open user wager refunds once');
  assert(restored.user_wallet_checks.conservation_checked && restored.user_wallet_checks.transfer_pairs_checked);
  assert.equal(restored.counts['public.user_wallets'],3);
  assert(restored.counts['sportsbook_private.user_wallet_approvals']>=3);
  // Recompute content hashes after deliberate tampering. Semantic verification
  // must catch broken finance evidence even if checksums are internally valid.
  async function tamper(sql, expected) {
    await db.query('create temp table if not exists tampered_recovery(data jsonb)');
    await db.query('truncate tampered_recovery');
    await db.query('insert into tampered_recovery values($1::jsonb)',[plaintext]);
    await db.exec(sql);
    const changed=(await db.query(`select jsonb_set(jsonb_set(data,'{counts}',
      (select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data->'tables'))),'{checksums}',
      (select jsonb_object_agg(key,md5(value::text)) from jsonb_each(data->'tables')))::text data from tampered_recovery`)).rows[0].data;
    await assert.rejects(restoreFinancialSnapshot(changed,schema,{projectRef}),expected);
  }
  await tamper(`update tampered_recovery set data=jsonb_set(data,'{tables,public.user_wallets,0,balance}','999.00')`, /conservation/);
  await tamper(`update tampered_recovery set data=jsonb_set(data,'{tables,sportsbook_private.user_wallet_approvals}','[]')`, /approval/);
  await tamper(`update tampered_recovery set data=jsonb_set(data,'{tables,public.wallet_ledger}',
    (select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(data->'tables'->'public.wallet_ledger') e where e->>'kind'<>'account_transfer_out'))`, /transfer pair/);
  await tamper(`update tampered_recovery set data=jsonb_set(data,'{tables,auth.users}','[]')`, /Recovery broke/);
  return restored;
}
