import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import assert from "node:assert/strict";
import { sqlTokens } from "./lib/sql-tokens.mjs";

// Historical migrations execute only in a disposable local database. The hosted
// artifact is a schema-only pg_dump, never a concatenation of seed/import SQL.
const authStub = `create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`;
const db = new PGlite();
let restored;
try {
  await fs.mkdir("work", { recursive: true });
  await db.exec(authStub);
  const files = (await fs.readdir("supabase/migrations")).filter((f) => f < "202610280055").sort();
  assert.equal(files.length, 54);
  for (const file of files) await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec("set timezone='UTC';set search_path=public");
  const query = await fs.readFile("supabase/development/inspect-contract.sql", "utf8");
  const local = (await db.query(query)).rows[0].fingerprint;
  const compareProduction = process.argv.includes("--compare-production");
  const production = compareProduction ? JSON.parse(await fs.readFile("work/production-schema-fingerprint.json", "utf8")) : local;
  const difference = {};
  for (const key of Object.keys(production)) {
    if (JSON.stringify(production[key]) !== JSON.stringify(local[key]))
      difference[key] = { production: production[key], local: local[key] };
  }
  await fs.writeFile("work/schema-differences.json", JSON.stringify(difference, null, 2));
  await fs.writeFile("work/local-schema-fingerprint.json", JSON.stringify(local));
  console.log("Schema comparison categories requiring review:", Object.keys(difference));
  const liveFunctions = compareProduction ? JSON.parse(await fs.readFile("work/production-function-definitions.json", "utf8")) : [];
  const functionReview = [];
  for (const f of liveFunctions) {
    const localFunction = (await db.query(`select p.prosrc as body,pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=$1 and p.proname=$2 and pg_get_function_identity_arguments(p.oid)=$3`,
      [f.schema, f.name, f.arguments])).rows[0];
    const equal = localFunction && JSON.stringify(sqlTokens(localFunction.body)) === JSON.stringify(sqlTokens(f.body)) &&
      JSON.stringify(sqlTokens(localFunction.definition.replace(localFunction.body, "BODY"))) ===
      JSON.stringify(sqlTokens(f.definition.replace(f.body, "BODY")));
    functionReview.push({ schema: f.schema, name: f.name, arguments: f.arguments, equal });
  }
  await fs.writeFile("work/schema-function-review.json", JSON.stringify(functionReview, null, 2));
  assert(functionReview.every((f) => f.equal), "Function differences require review: " +
    functionReview.filter((f) => !f.equal).map((f) => f.name).join(", "));
  for (const key of ["columns", "constraints", "policies", "triggers", "views"])
    assert.deepEqual(local[key], production[key], `${key} differ from deployed baseline`);
  const dump = await pgDump({ pg: db, args: ["--schema-only", "--no-owner", "--schema=public", "--schema=sportsbook_private"] });
  let sql = (await dump.text()).replace(/^\\(?:un)?restrict .*\r?\n/gm, "")
    .replace("CREATE SCHEMA public;", "CREATE SCHEMA IF NOT EXISTS public;");
  const grants = sql.match(/^(?:GRANT|REVOKE) [^\n]+;$/gm) ?? [];
  const objects = (await db.query(`select format('revoke all on %s %I.%I from public,anon,authenticated,service_role;',
    case c.relkind when 'S' then 'sequence' else 'table' end,n.nspname,c.relname) as statement
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','sportsbook_private') and c.relkind in ('r','v','S')
    union all select format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role;',
    n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','sportsbook_private')
    and p.prokind='f'`)).rows.map((r) => r.statement);
  const defaults = ["tables", "functions", "sequences"].map((kind) =>
    `alter default privileges for role postgres in schema public revoke all on ${kind} from anon,authenticated,service_role;`).join("\n");
  const access = defaults + "\nset search_path=public;\n" + objects.join("\n") + "\n" + grants.join("\n") + `
do $$begin if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke all on function public.rls_auto_enable() from public,anon,authenticated;
end if; end$$;\n`;
  // A hosted Supabase project has additional default grants. pg_dump assumes an
  // empty ACL baseline, so reset each application object's API ACL explicitly.
  sql += "\n-- Explicit application ACL baseline for hosted Supabase defaults.\n" + access;
  assert(!/^COPY |^INSERT INTO /m.test(sql), "Schema-only artifact contains data");
  assert(!/dispatch_weekly_worker|net\.http_post|cron\.schedule|vault\./i.test(sql), "Schema artifact contains production dispatch or secrets");
  await fs.mkdir("supabase/development", { recursive: true });
  await fs.writeFile("supabase/development/baseline-schema.sql", sql);
  await fs.writeFile("supabase/development/baseline-access.sql", access);
  restored = new PGlite();
  await restored.exec(authStub);
  // Reproduce hosted Supabase defaults, which otherwise silently expose newly
  // restored objects even when their source migrations revoked PUBLIC access.
  await restored.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  await restored.exec(sql);
  const accessCheck = (await restored.query(`select
    has_function_privilege('anon','public.claim_memberships()','execute') as anon_claim,
    has_function_privilege('authenticated','public.claim_memberships()','execute') as member_claim,
    has_table_privilege('anon','public.league_memberships','select') as anon_memberships`)).rows[0];
  assert.deepEqual(accessCheck, { anon_claim: false, member_claim: true, anon_memberships: false });
  await restored.exec("set timezone='UTC';set search_path=public");
  const restoredFingerprint = (await restored.query(query)).rows[0].fingerprint;
  assert.deepEqual(restoredFingerprint, local, "Schema-only restoration changed schema contracts");
  const tables = (await restored.query("select schemaname,tablename from pg_tables where schemaname in ('public','sportsbook_private')")).rows;
  for (const t of tables) {
    const count = (await restored.query(`select count(*)::int n from "${t.schemaname}"."${t.tablename}"`)).rows[0].n;
    assert.equal(count, 0, `${t.tablename} unexpectedly contains seed data`);
  }
  console.log(`Schema-only restore passed: ${tables.length} empty application tables; no auth users, seeds, historical tickets or scheduler imported. SQL bytes: ${Buffer.byteLength(sql)}.`);
} finally { await db.close(); await restored?.close(); }
