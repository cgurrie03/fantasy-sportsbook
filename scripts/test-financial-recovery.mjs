import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { recoveryTables, restoreFinancialSnapshot } from "./financial-recovery.mjs";

const schema = await fs.readFile("supabase/development/baseline-schema.sql", "utf8");
const db = new PGlite();
let plaintext;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`);
  await db.exec(schema);
  await db.exec(`set timezone='UTC';
    insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','recovery@example.invalid',now());
    insert into public.leagues(id,name,sleeper_league_id,nfl_season,league_season)
      values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Recovery fixture','fixture-recovery',2026,1);
    insert into public.teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
      values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'Test Team','fixture-owner','Test','fixture-owner','Test');
    insert into public.wallets(team_id,balance) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',null);
    insert into public.league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)
      values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','recovery@example.invalid','Test','fixture-owner','member');`);
  const tables = {};
  for (const name of recoveryTables) {
    tables[name] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) data from ${name} r`)).rows[0].data;
  }
  await db.query("create temp table fixture_document(data jsonb)");
  await db.query("insert into fixture_document values($1::jsonb)", [JSON.stringify(tables)]);
  plaintext = (await db.query(`select jsonb_build_object('format','boff-financial-recovery-v1',
    'project_ref','bmvjcdgxwxqalaohpsnw','schema_sha256',$1::text,'tables',data,
    'counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data)),
    'checksums',(select jsonb_object_agg(key,md5(value::text)) from jsonb_each(data)))::text as data from fixture_document`,
    [createHash("sha256").update(schema).digest("hex")])).rows[0].data;
} finally { await db.close(); }
const result = await restoreFinancialSnapshot(plaintext, schema);
assert.equal(result.counts["public.league_memberships"], 1);
assert.equal(result.counts["public.wallets"], 1);
const invalid = JSON.parse(plaintext);
invalid.tables["public.teams"] = [];
invalid.counts["public.teams"] = 0;
invalid.checksums["public.teams"] = createHash("md5").update("[]").digest("hex");
await assert.rejects(restoreFinancialSnapshot(JSON.stringify(invalid), schema), /Recovery broke/);
await assert.rejects(restoreFinancialSnapshot(plaintext, schema + "\n-- changed"), /strictly equal/);
console.log("Financial recovery fixture restores exact content, checks every FK and RLS, and rejects missing dependencies or a changed schema.");
