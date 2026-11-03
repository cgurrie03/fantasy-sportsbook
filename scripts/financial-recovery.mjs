import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import * as openpgp from "openpgp";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { verifyUserFinancialRecovery } from "./lib/recovery-wallet-checks.mjs";

// Local-only financial recovery drill. No hosted database client or credentials.
// The exported auth relation contains identities only, never passwords/sessions.
export const recoveryTables = [
  "auth.users", "public.admin_change_log", "public.admin_exception_reviews",
  "public.balance_events", "public.email_deliveries", "public.league_memberships",
  "public.leagues", "public.outbound_emails", "public.promo_claims", "public.promo_events",
  "public.promo_images", "public.promo_offers", "public.sportsbook_boards",
  "public.sportsbook_markets", "public.sportsbook_reopening_reviews", "public.teams",
  "public.ticket_legs", "public.ticket_promotions", "public.tickets", "public.wallet_ledger",
  "public.wallets", "public.weekly_execution_runs", "sportsbook_private.import_batches",
];
// Keep v1 immutable: the owner's existing off-site checkpoint uses this contract.
export const recoveryTablesV2 = [...recoveryTables,
  "public.user_wallets", "public.user_wallet_entries", "public.league_staff_grants",
  "public.league_staff_audit", "sportsbook_private.user_wallet_approvals",
  "sportsbook_private.user_finance_modes", "sportsbook_private.platform_owners",
  "sportsbook_private.platform_owner", "sportsbook_private.league_launch_approvals",
];
// v3 preserves the new effective financial policy; v1/v2 remain readable.
export const recoveryTablesV3=[...recoveryTablesV2,"sportsbook_private.league_policy_versions"];
export const recoveryTablesV4=[...recoveryTablesV3,"sportsbook_private.sportsbook_policy_versions","sportsbook_private.provider_capability_state","sportsbook_private.provider_capability_decisions"];
export function tablesForFormat(format) {
  if (format === "boff-financial-recovery-v1") return recoveryTables;
  if (format === "boff-financial-recovery-v2") return recoveryTablesV2;
  if (format === "boff-financial-recovery-v3") return recoveryTablesV3;
  if (format === "boff-financial-recovery-v4") return recoveryTablesV4;
  throw new Error("Unsupported financial recovery format.");
}
const authStub = `create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
  grant usage on schema public,auth to authenticated,anon;
  grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`;
export function protect(value, mode) {
  if (process.platform !== "win32") throw new Error("This local key wrapper requires Windows DPAPI.");
  const method = mode === "protect" ? "Protect" : "Unprotect";
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;
    $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());
    $resultBytes=[Security.Cryptography.ProtectedData]::${method}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);
    [Console]::Out.Write([Convert]::ToBase64String($resultBytes));`;
  return Buffer.from(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: value.toString("base64"), encoding: "utf8", windowsHide: true }).trim(), "base64");
}
const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
const relation = (name) => name.split(".").map(ident).join(".");
export function snapshotQuery(publicKey, { format = "boff-financial-recovery-v1", projectRef = "bmvjcdgxwxqalaohpsnw" } = {}) {
  const tableNames = tablesForFormat(format);
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Explicit Supabase project reference required.");
  if (!publicKey.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----") || publicKey.includes("$recovery$"))
    throw new Error("A public recovery key is required.");
  const entries = tableNames.map((name, i) => {
    const source = name === "auth.users" ? `(select id,email,email_confirmed_at from auth.users${(format !== "boff-financial-recovery-v1") ? " where false" : ""})` : relation(name);
    const where = name === "public.sportsbook_markets"
      ? "where r.id in (select market_quote_id from public.ticket_legs where market_quote_id is not null)" : "";
    return `t${i} as materialized (select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) as rows from ${source} r ${where})`;
  });
  const pairs = tableNames.map((name, i) => `'${name}',(select rows from t${i})`).join(",");
  // v2 exports only identities referenced by financial/access records. The FK
  // catalogue discovers actor/subject/owner columns without exporting Auth secrets.
  const scopedData = (format !== "boff-financial-recovery-v1") ? `, scoped_tables as materialized (
    select jsonb_set(data,'{auth.users}',coalesce((select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text)
      from (select id,email,email_confirmed_at from auth.users) a where a.id::text in (
        select r.value->>att.attname from pg_constraint k
        join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        join pg_attribute att on att.attrelid=k.conrelid and att.attnum=k.conkey[1]
        cross join lateral jsonb_array_elements(coalesce(data->(n.nspname||'.'||c.relname),'[]')) r(value)
        where k.contype='f' and k.confrelid='auth.users'::regclass and cardinality(k.conkey)=1
      )),'[]'::jsonb)) as data from tables)` : "";
  return `begin isolation level repeatable read read only;
set local timezone='UTC';
with ${entries.join(",\n")}, tables as materialized (select jsonb_build_object(${pairs}) as data)${scopedData},
document as materialized (select jsonb_build_object('format','${format}',
 'project_ref','${projectRef}','captured_at',statement_timestamp(),
 'schema_sha256','SCHEMA_HASH_PLACEHOLDER','tables',data,
 'checksums',(select jsonb_object_agg(key,md5(value::text)) from jsonb_each(data)),
 'counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data)))::text as data from ${scopedData ? "scoped_tables" : "tables"})
select encode(extensions.pgp_pub_encrypt(data,extensions.dearmor($recovery$${publicKey}$recovery$),
 'cipher-algo=aes256,compress-algo=1,compress-level=6'),'base64') as encrypted_snapshot,
 octet_length(data) as plaintext_bytes,encode(extensions.digest(data,'sha256'),'hex') as plaintext_sha256 from document;
commit;`;
}
export async function restoreFinancialSnapshot(plaintext, schema, { projectRef = "bmvjcdgxwxqalaohpsnw" } = {}) {
  const snapshot = JSON.parse(plaintext);
  const tableNames = tablesForFormat(snapshot.format);
  assert.equal(snapshot.project_ref, projectRef);
  assert.equal(createHash("sha256").update(schema).digest("hex"), snapshot.schema_sha256);
  for (const field of ["tables", "counts", "checksums"])
    assert.deepEqual(Object.keys(snapshot[field]).sort(), [...tableNames].sort());
  const db = new PGlite();
  try {
    await db.exec(authStub);
    if ((snapshot.format !== "boff-financial-recovery-v1")) await db.exec("create role boff_evaluation_retention nologin noinherit;create role boff_routine_retention nologin noinherit;");
    await db.exec(schema);
    await db.exec("set timezone='UTC';set search_path=public;create temp table recovery_input(data jsonb);");
    // Keep the original JSON text: JS number conversion could change stored
    // high-precision quote probabilities or bigint IDs during a recovery.
    await db.query("insert into recovery_input values($1::jsonb)", [plaintext]);
    await db.exec("begin;set local session_replication_role=replica;");
    for (const name of tableNames) {
      const [schemaName, tableName] = name.split(".");
      const cols = (await db.query(`select a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2
        and a.attnum>0 and not a.attisdropped and a.attgenerated='' order by a.attnum`, [schemaName, tableName])).rows;
      const columns = cols.map((c) => ident(c.attname)).join(",");
      await db.query(`insert into ${relation(name)} (${columns}) overriding system value
        select ${columns} from jsonb_populate_recordset(null::${relation(name)},
          (select data->'tables'->$1 from recovery_input))`, [name]);
    }
    await db.exec("commit;");
    const counts = {};
    for (const name of tableNames) {
      const check = (await db.query(`select count(*)::int as n,
        md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text) as hash
        from ${relation(name)} r`)).rows[0];
      assert.equal(check.n, snapshot.counts[name], `${name}: row count differs`);
      assert.equal(check.hash, snapshot.checksums[name], `${name}: restored content differs`);
      counts[name] = check.n;
    }
    // Triggers/FKs were suppressed during import, so independently check every
    // application's FK, including the circular board/reopening dependency.
    const keys = (await db.query(`select n.nspname as child_schema,c.relname as child,
      pn.nspname as parent_schema,p.relname as parent,k.conname,
      array(select a.attname from unnest(k.conkey) with ordinality x(num,ord)
        join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.num order by x.ord) as child_cols,
      array(select a.attname from unnest(k.confkey) with ordinality x(num,ord)
        join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.num order by x.ord) as parent_cols
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_class p on p.oid=k.confrelid join pg_namespace pn on pn.oid=p.relnamespace
      where k.contype='f' and n.nspname in ('public','sportsbook_private')`)).rows;
    for (const fk of keys) {
      const present = fk.child_cols.map((c) => `c.${ident(c)} is not null`).join(" and ");
      const match = fk.child_cols.map((c, i) => `c.${ident(c)}=p.${ident(fk.parent_cols[i])}`).join(" and ");
      const result = await db.query(`select count(*)::int n from ${relation(fk.child_schema + "." + fk.child)} c
        where ${present} and not exists(select 1 from ${relation(fk.parent_schema + "." + fk.parent)} p where ${match})`);
      assert.equal(result.rows[0].n, 0, `Recovery broke ${fk.conname}`);
    }
    const userChecks = (snapshot.format !== "boff-financial-recovery-v1") ? await verifyUserFinancialRecovery(db) : null;
    let refundChecked = false;
    const open = (await db.query(`select t.id,t.team_id,t.stake,m.user_id,w.balance
      from public.tickets t join public.wallets w on w.team_id=t.team_id
      join public.league_memberships m on m.league_id=t.league_id and m.role='admin' and m.user_id is not null
      where t.status='OPEN' and t.source_batch is null and w.balance is not null
      ${userChecks ? "and t.user_wallet_id is null" : ""} order by t.id limit 1`)).rows[0];
    if (open) {
      const before = (await db.query("select count(*)::int n from wallet_ledger where ticket_id=$1 and kind='void_refund'", [open.id])).rows[0].n;
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [open.user_id]);
      await db.exec("set row_security=on;set request.jwt.claim.role='authenticated';set role authenticated;");
      for (let attempt=0; attempt<2; attempt++)
        await db.query("select public.void_sportsbook_ticket($1,'Disposable local recovery drill only')", [open.id]);
      await db.exec("reset role;");
      assert.equal((await db.query("select count(*)::int n from wallet_ledger where ticket_id=$1 and kind='void_refund'", [open.id])).rows[0].n, before+1);
      assert.equal((await db.query("select balance=($2::numeric+$3::numeric) as correct from wallets where team_id=$1", [open.team_id,open.balance,open.stake])).rows[0].correct, true);
      refundChecked = true;
    }
    await db.exec("set row_security=on;set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';set role authenticated;");
    for (const table of ["wallets", "wallet_ledger", "tickets", "ticket_legs", "teams", "league_memberships"])
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0, `Outsider sees ${table}`);
    await db.exec("reset role;set role anon;");
    await assert.rejects(db.query("select * from public.wallets"));
    await db.exec("reset role");
    let policyCount=null;
    if(["boff-financial-recovery-v3","boff-financial-recovery-v4"].includes(snapshot.format)) {
      const policies=(await db.query("select overrides from sportsbook_private.league_policy_versions")).rows;
      for(const row of policies)await db.query("select sportsbook_private.validate_wallet_policy($1)",[JSON.stringify(row.overrides)]);
      policyCount=policies.length;
    }
    let pricingCount=null;
    if(snapshot.format==='boff-financial-recovery-v4'){
      const rows=(await db.query('select overrides from sportsbook_private.sportsbook_policy_versions')).rows;
      for(const row of rows)await db.query('select sportsbook_private.validate_sportsbook_policy($1)',[JSON.stringify(row.overrides)]);
      pricingCount=rows.length;
    }
    return { pricing_policy_versions_checked:pricingCount,policy_versions_checked:policyCount,format: snapshot.format, counts, foreign_keys_checked: keys.length, duplicate_refund_checked: refundChecked,
      user_wallet_checks: userChecks,
      outsider_denied: true, anonymous_denied: true };
  } finally { await db.close(); }
}

async function main() {
  if (process.env.VERCEL) throw new Error("Recovery tooling must never run on hosting.");
  const [mode, target = "work/financial-recovery", schemaFile] = process.argv.slice(2);
  const folder = path.resolve(target);
  if (["prepare","prepare-v2","prepare-v3","prepare-v4"].includes(mode)) {
    if (mode !== "prepare" && !schemaFile) throw new Error("Versioned recovery requires an explicit reviewed schema-only recovery artifact.");
    const schema = await fs.readFile(schemaFile ?? "supabase/development/baseline-schema.sql", "utf8");
    await fs.mkdir(folder, { recursive: true });
    // Exclusive creation prevents replacing a key needed for an existing export.
    const guard = await fs.open(path.join(folder, "key-created.lock"), "wx");
    await guard.close();
    const passphrase = randomBytes(48).toString("base64");
    const keys = await openpgp.generateKey({ type: "rsa", rsaBits: 3072,
      userIDs: [{ name: "BOFF one-time financial recovery" }], passphrase,
      config: { v6Keys: false } });
    const wrappedPassphrase = protect(Buffer.from(passphrase), "protect");
    await fs.writeFile(path.join(folder, "public.asc"), keys.publicKey);
    await fs.writeFile(path.join(folder, "private.asc"), keys.privateKey, { mode: 0o600 });
    await fs.writeFile(path.join(folder, "passphrase.dpapi"), wrappedPassphrase, { mode: 0o600 });
    await fs.writeFile(path.join(folder, "schema.sql"), schema);
    await fs.writeFile(path.join(folder, "export.sql"), snapshotQuery(keys.publicKey, {
      format: mode === "prepare-v4" ? "boff-financial-recovery-v4" : mode === "prepare-v3" ? "boff-financial-recovery-v3" : mode === "prepare-v2" ? "boff-financial-recovery-v2" : "boff-financial-recovery-v1",
    })
      .replace("SCHEMA_HASH_PLACEHOLDER", createHash("sha256").update(schema).digest("hex")));
    console.log("Prepared public-key encrypted financial export. Private key and DPAPI-wrapped passphrase remain local; no secrets logged.");
  } else if (mode === "verify") {
    const cipher = await fs.readFile(path.join(folder, "snapshot.pgp"));
    const privateKey = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: await fs.readFile(path.join(folder, "private.asc"), "utf8") }),
      passphrase: protect(await fs.readFile(path.join(folder, "passphrase.dpapi")), "unprotect").toString(),
    });
    const decrypted = await openpgp.decrypt({ message: await openpgp.readMessage({ binaryMessage: cipher }), decryptionKeys: privateKey });
    const manifest = JSON.parse(await fs.readFile(path.join(folder, "manifest.json"), "utf8"));
    assert.equal(createHash("sha256").update(decrypted.data).digest("hex"), manifest.plaintext_sha256);
    const result = await restoreFinancialSnapshot(decrypted.data, await fs.readFile(path.join(folder, "schema.sql"), "utf8"));
    await fs.writeFile(path.join(folder, "restore-result.json"), JSON.stringify({
      ...result, captured_at: JSON.parse(decrypted.data).captured_at,
      encrypted_sha256: createHash("sha256").update(cipher).digest("hex"),
      scope: "Financial records and FK dependencies; auth identities only, not Auth credentials or a full platform backup.",
    }, null, 2));
    console.log(JSON.stringify(result));
  } else throw new Error("Use prepare, prepare-v2/prepare-v3/prepare-v4 (with a reviewed schema file), or verify with a local recovery directory.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error("Financial recovery check failed:", error.message); process.exitCode = 1; }
}
