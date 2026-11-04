import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  dispatchDatabaseProbe,
  pausedDispatchConcurrencyProbe,
} from "./lib/dispatch-database-probe.mjs";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated",
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  const owner = "00000000-0000-4000-8000-000000000001",
    league = "00000000-0000-4000-8000-000000000002",
    team = "00000000-0000-4000-8000-000000000003";
  await q("insert into auth.users values($1,'owner@example.invalid',now())", [
    owner,
  ]);
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  await q(
    "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week)values($1,'Local owner context','99887766001',2026,1,5)",
    [league],
  );
  await q(
    "insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)values($1,$2,1,'Local owner team','1','Owner','1','Owner')",
    [team, league],
  );
  await q(
    "insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)values($1,$2,$3,'owner@example.invalid','Owner','1','admin')",
    [league, team, owner],
  );
  await q(
    "insert into sportsbook_private.application_environment(environment,project_ref,app_origin)values('development','whlcnlacueweaqpsupqs','https://dev.sportsbook.coopergurrie.com')",
  );
  const md5 = (
    await q(
      "select md5(prosrc)hash from pg_proc where oid='claim_automation_job()'::regprocedure",
    )
  )[0].hash;
  assert.throws(() => dispatchDatabaseProbe("not-a-hash"), /MD5/);
  const rows = await db.exec(dispatchDatabaseProbe(md5));
  const result = rows.at(-1).rows[0].result;
  assert.equal(result.claims, 97);
  assert.equal(result.peer_first_turn, 2);
  assert.equal(result.equal_peer_claims, 32);
  assert.equal(result.fixture_rollback_verified, true);
  assert.equal((await q("select count(*)::int n from leagues"))[0].n, 1);
  assert.equal(
    (
      await q("select count(*)::int n from sportsbook_private.platform_owner")
    )[0].n,
    0,
  );
  assert.equal(
    (await q("select count(*)::int n from automation_jobs"))[0].n,
    0,
  );
  assert.equal(
    (
      await q(
        "select is_called from sportsbook_private.automation_dispatch_order",
      )
    )[0].is_called,
    true,
    "sequence allocation is explicitly nontransactional",
  );
  await assert.rejects(
    db.exec(dispatchDatabaseProbe("0".repeat(32))),
    /source changed/,
  );
  await q(
    "update sportsbook_private.application_environment set environment='production',project_ref='bmvjcdgxwxqalaohpsnw',app_origin='https://sportsbook.coopergurrie.com'",
  );
  await assert.rejects(
    db.exec(dispatchDatabaseProbe(md5)),
    /Development identity required/,
  );
  await q(
    "update sportsbook_private.application_environment set environment='development',project_ref='whlcnlacueweaqpsupqs',app_origin='https://dev.sportsbook.coopergurrie.com'",
  );
  const beforeSequence = (
    await q(
      "select last_value from sportsbook_private.automation_dispatch_order",
    )
  )[0].last_value;
  const empty = (await db.exec(pausedDispatchConcurrencyProbe(md5))).at(-1)
    .rows[0].result;
  assert.equal(empty.claimed, 0);
  assert.equal(empty.intentional_transaction_hold_ms, 100);
  assert.equal(
    (
      await q(
        "select last_value from sportsbook_private.automation_dispatch_order",
      )
    )[0].last_value,
    beforeSequence,
  );
  assert.throws(() => pausedDispatchConcurrencyProbe("invalid"), /MD5/);
  await fs.mkdir("work", { recursive: true });
  await fs.writeFile(
    "work/paused-dispatch-probe.sql",
    pausedDispatchConcurrencyProbe(md5),
  );
  await fs.writeFile(
    "work/dispatch-database-probe.sql",
    dispatchDatabaseProbe(md5),
  );
  await fs.writeFile(
    "work/dispatch-database-probe-local.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Rollback dispatch probe: actual calendar/claim SQL, 65-job backlog and 32 alternating peers; exact source/DEV fences; all fixture rows/flags rolled back; sequence gaps documented. Local fixture timing is not hosted capacity.",
  );
} finally {
  await db.close();
}
