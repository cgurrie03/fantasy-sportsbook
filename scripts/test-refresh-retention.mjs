import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema sportsbook_private;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    create table line_refresh_cycles(id uuid primary key,status text not null,created_at timestamptz not null,completed_at timestamptz);
    create table line_refresh_sources(cycle_id uuid references line_refresh_cycles,path text,payload jsonb);
    create table line_refresh_stages(cycle_id uuid references line_refresh_cycles,family text,quotes jsonb);
    create table automation_jobs(id uuid primary key,refresh_cycle_id uuid references line_refresh_cycles,status text,attempts integer);
    create function observe_line_refresh(jsonb,text) returns void language plpgsql as $$begin
      delete from public.line_refresh_sources where cycle_id in (select id from public.line_refresh_cycles where status<>'staging' or created_at<now()-interval '20 minutes');
    end$$;`);
  await db.exec(fs.readFileSync("supabase/migrations/202610280059_terminal_refresh_cleanup.sql", "utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const make = async (state, completed, job) => {
    const id = randomUUID();
    await rows("insert into line_refresh_cycles values($1,'staging',now()-interval '48 hours',null)", [id]);
    await rows("insert into line_refresh_stages values($1,'matchups','[]')", [id]);
    await rows("insert into line_refresh_sources values($1,'synthetic-provider','{}')", [id]);
    if (state !== "staging") await rows("update line_refresh_cycles set status=$2,completed_at=case when $3::text is null then null else now()-$3::interval end where id=$1", [id, state, completed]);
    if (job) await rows("insert into automation_jobs values($1,$2,$3,$4)", [randomUUID(), id, job.status, job.attempts]);
    return id;
  };
  const eligible = await Promise.all([make("published", "2 hours"), make("superseded", "3 hours"), make("skipped", "4 hours")]);
  const recent = await make("published", "30 minutes");
  const active = await make("staging", null);
  const pending = await make("published", "2 hours", { status: "pending", attempts: 0 });
  const running = await make("suspended", "2 hours", { status: "running", attempts: 1 });
  const retry = await make("suspended", "2 hours", { status: "failed", attempts: 1 });
  const undated = await make("published", null);
  await db.exec("set role authenticated;set request.jwt.claim.role='authenticated'");
  await assert.rejects(rows("select cleanup_terminal_refresh_payloads(2)"));
  await db.exec("reset role;set request.jwt.claim.role='service_role';set role service_role");
  await assert.rejects(rows("select cleanup_terminal_refresh_payloads(0)"));
  const first = (await rows("select cleanup_terminal_refresh_payloads(2) result"))[0].result;
  assert.equal(first.cycles, 2); assert.equal(first.stages, 2); assert.equal(first.sources, 2);
  assert.equal(first.stuck_cycles, 1);
  const second = (await rows("select cleanup_terminal_refresh_payloads(2) result"))[0].result;
  assert.equal(second.cycles, 1);
  assert.equal((await rows("select cleanup_terminal_refresh_payloads(2) result"))[0].result.cycles, 0);
  await db.exec("reset role");
  const kept = (await rows("select cycle_id from line_refresh_stages")).map((r) => r.cycle_id);
  assert.deepEqual(kept.toSorted(), [recent, active, pending, running, retry, undated].toSorted());
  for (const id of eligible) {
    assert.equal((await rows("select * from line_refresh_cycles where id=$1", [id])).length, 1);
    await assert.rejects(rows("insert into line_refresh_stages values($1,'players','[]')", [id]), /no longer active/);
    await assert.rejects(rows("insert into line_refresh_sources values($1,'late','{}')", [id]), /no longer active/);
  }
  assert.equal((await rows("select count(*)::int n from automation_jobs"))[0].n, 3);
  assert.equal((await rows("select count(*)::int n from sportsbook_private.refresh_cleanup_health"))[0].n, 1);
  const definition = (await rows("select pg_get_functiondef('observe_line_refresh(jsonb,text)'::regprocedure) d"))[0].d;
  assert(!definition.includes("20 minutes"));
  console.log("Passed bounded terminal cleanup, recovery window, active/stuck and retry preservation, idempotency, late-write fencing, retained job/cycle identities and private singleton heartbeat. In-memory only; no physical-size savings claimed.");
} finally { await db.close(); }
