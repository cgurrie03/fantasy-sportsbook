import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const baseline = process.argv.includes("--baseline");
const owner = uuid(),
  B = uuid();
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid(),auth.role()to anon,authenticated,service_role;",
  );
  for (const f of (await fs.readdir("supabase/migrations")).sort()) {
    if (baseline && f >= "20261104152355") continue;
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  }
  await q("insert into auth.users values($1,'cooper.gurrie@gmail.com',now())", [
    owner,
  ]);
  await db.exec(
    `set request.jwt.claim.sub='${owner}';set request.jwt.claim.role='authenticated';set role authenticated;select claim_memberships();reset role`,
  );
  if (baseline)
    await fs.writeFile(
      "work/dispatch-claim-before.sql",
      (
        await q(
          "select pg_get_functiondef('public.claim_automation_job()'::regprocedure)definition",
        )
      )[0].definition,
    );
  const A = (
    await q(
      "select m.league_id from sportsbook_private.platform_owner o join league_memberships m on m.id=o.membership_id",
    )
  )[0].league_id;
  await q(
    "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Synthetic queue B','9999988776655',2026,1,5,now())",
    [B],
  );
  await q(
    "insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note)select $1,membership_id,'Disposable local queue fairness fixture only'from sportsbook_private.platform_owner",
    [B],
  );
  await q("update leagues set operations_enabled=true where id=any($1)", [
    [A, B],
  ]);
  await q(
    "insert into weekly_schedule(league_id)values($1)on conflict do nothing",
    [B],
  );
  await q(
    "update weekly_schedule set automation_enabled=true where league_id=any($1)",
    [[A, B]],
  );
  // Controlled queue arrivals isolate dispatch from the wall-clock calendar planner.
  await db.exec(
    "create or replace function sportsbook_private.enqueue_weekly_jobs(p_now timestamptz)returns void language plpgsql set search_path=''as $$begin return;end$$;delete from automation_jobs;set request.jwt.claim.role='service_role'",
  );
  const add = async (league, op, age = 0, extra = {}) => {
    const id = uuid();
    await q(
      "insert into automation_jobs(id,league_id,event_key,operation,market_week,created_at,scheduled_for,expires_at,status,attempts,lease_until)values($1::uuid,$2,$1::text,$3,5,now()-($4::int*interval '1 minute'),$5,$6,$7,$8,$9)",
      [
        id,
        league,
        op,
        age,
        extra.scheduled ?? null,
        extra.expires ?? null,
        extra.status ?? "pending",
        extra.attempts ?? 0,
        extra.lease ?? null,
      ],
    );
    return id;
  };
  const claim = () => q("select * from claim_automation_job()");
  const done = (id) =>
    q(
      "update automation_jobs set status='done',completed_at=now(),lease_until=null where id=$1",
      [id],
    );
  for (let i = 0; i < 64; i++) await add(A, "settlement", (60 - i / 2) | 0);
  const target = await add(B, "settlement", 1);
  let position = 0;
  const began = performance.now();
  while (position < 65) {
    const rows = await claim();
    assert.equal(rows.length, 1);
    position++;
    await done(rows[0].id);
    if (rows[0].id === target) break;
  }
  const result = {
    format: "boff-synthetic-dispatch-fairness-v1",
    synthetic: true,
    queue_a: 64,
    queue_b: 1,
    b_first_claim_position: position,
    local_dispatch_loop_ms: Math.round(performance.now() - began),
    actual_worker_or_billing_measurement: false,
  };
  await fs.mkdir("work", { recursive: true });
  await fs.writeFile(
    "work/dispatch-fairness-" + (baseline ? "baseline" : "verified") + ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  if (baseline) {
    const future = await add(A, "settlement", 60, {
      scheduled: new Date(Date.now() + 3600000).toISOString(),
      expires: new Date(Date.now() + 7200000).toISOString(),
    });
    await add(B, "settlement", 1);
    result.future_job_claimed_early = (await claim())[0].id === future;
    await fs.writeFile(
      "work/dispatch-fairness-baseline.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        baseline_future_job_claimed_early: result.future_job_claimed_early,
      }),
    );
  }
  if (!baseline)
    assert(
      position <= 2,
      "A single league backlog must not consume all same-priority dispatch slots before the other league gets one",
    );
  if (!baseline) {
    await db.exec(
      "delete from automation_jobs;delete from sportsbook_private.automation_dispatch_state",
    );
    for (let i = 0; i < 32; i++) {
      await add(A, "settlement", 60);
      await add(B, "settlement", 1);
    }
    const turns = [];
    for (let i = 0; i < 64; i++) {
      const [job] = await claim();
      turns.push(job.league_id);
      await done(job.id);
    }
    for (let i = 1; i < turns.length; i++)
      assert.notEqual(
        turns[i],
        turns[i - 1],
        "backlogged peer leagues alternate within a priority",
      );
    assert.equal(
      (
        await q(
          "select count(*)::int n from sportsbook_private.automation_dispatch_state",
        )
      )[0].n,
      2,
      "one overwritten cursor per league, no claim archive",
    );
    await db.exec("delete from automation_jobs");
    const model = await add(A, "model_review", 60),
      critical = await add(B, "settlement", 1);
    assert.equal(
      (await claim())[0].id,
      critical,
      "critical money work precedes older model work",
    );
    await done(critical);
    await done(model);
    const later = await add(A, "settlement", 60, {
      scheduled: new Date(Date.now() + 3600000).toISOString(),
      expires: new Date(Date.now() + 7200000).toISOString(),
    });
    const eligible = await add(B, "settlement", 1);
    assert.equal(
      (await claim())[0].id,
      eligible,
      "future scheduled jobs cannot run early",
    );
    await done(eligible);
    assert.equal((await claim()).length, 0);
    await done(later);
    const expired = await add(A, "settlement", 1, {
      scheduled: new Date(Date.now() - 7200000).toISOString(),
      expires: new Date(Date.now() - 3600000).toISOString(),
    });
    assert.equal((await claim()).length, 0);
    assert.equal(
      (await q("select status from automation_jobs where id=$1", [expired]))[0]
        .status,
      "done",
    );
    const outage = await add(A, "settlement", 10, {
      scheduled: new Date(Date.now() - 600000).toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
      status: "failed",
      attempts: 3,
      lease: new Date(Date.now() + 300000).toISOString(),
    });
    const peer = await add(B, "settlement", 1);
    assert.equal(
      (await claim())[0].id,
      peer,
      "outage backoff does not block the peer",
    );
    await done(peer);
    assert.equal((await claim()).length, 0);
    await q(
      "update automation_jobs set lease_until=now()-interval '1 second'where id=$1",
      [outage],
    );
    assert.equal(
      (await claim())[0].id,
      outage,
      "due scheduled work recovers after its lease expires",
    );
    await done(outage);
    const busy = await add(A, "refresh_matchups", 10, {
        status: "running",
        attempts: 1,
        lease: new Date(Date.now() + 300000).toISOString(),
      }),
      blocked = await add(A, "refresh_players", 10),
      other = await add(B, "refresh_matchups", 1);
    assert.equal(
      (await claim())[0].id,
      other,
      "the other league retains its independent writer lane",
    );
    await done(other);
    assert.equal(
      (await claim()).length,
      0,
      "same-league writer lease remains exclusive",
    );
    await done(busy);
    assert.equal((await claim())[0].id, blocked);
    await done(blocked);
    const more = await add(B, "settlement", 1),
      before = (
        await q(
          "select count(*)::int n from sportsbook_private.automation_dispatch_state",
        )
      )[0].n;
    await q(
      "update weekly_schedule set automation_enabled=false where league_id=$1",
      [B],
    );
    assert.equal(
      (await claim()).length,
      0,
      "paused league never consumes a turn",
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from sportsbook_private.automation_dispatch_state",
        )
      )[0].n,
      before,
    );
    await done(more);
    await db.exec("set role authenticated");
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(
      q("select * from sportsbook_private.automation_dispatch_state"),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    await assert.rejects(
      q("select * from sportsbook_private.automation_dispatch_state"),
      /permission denied/,
    );
    await assert.rejects(
      q("select nextval('sportsbook_private.automation_dispatch_order')"),
      /permission denied/,
    );
    await db.exec("reset role");
    const exhausted = await add(A, "recheck", 1, {
      status: "failed",
      attempts: 4,
    });
    assert.equal(
      (await claim()).length,
      0,
      "legacy unscheduled attempt budget is preserved",
    );
    await done(exhausted);
    const dependency = await add(A, "refresh_matchups", 1, {
      scheduled: new Date(Date.now() - 60000).toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
      status: "failed",
      lease: new Date(Date.now() + 300000).toISOString(),
    });
    const publication = await add(A, "publish", 1, {
      scheduled: new Date(Date.now() - 30000).toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(
      (await claim()).length,
      0,
      "publication waits for unfinished refresh dependency",
    );
    await done(dependency);
    assert.equal((await claim())[0].id, publication);
    await done(publication);
    const lateJob = await add(A, "settlement", 1);
    const stateBefore = await q(
      "select * from sportsbook_private.automation_dispatch_state order by league_id",
    );
    await db.exec("begin");
    assert.equal((await claim())[0].id, lateJob);
    await db.exec("rollback");
    assert.deepEqual(
      await q(
        "select * from sportsbook_private.automation_dispatch_state order by league_id",
      ),
      stateBefore,
      "claim cursor rolls back with the job lease",
    );
    assert.equal(
      (
        await q("select attempts from automation_jobs where id=$1", [lateJob])
      )[0].attempts,
      0,
    );
    console.log(
      "Fair dispatch: 64-claim alternating peer burst; critical priority; future/expired schedule fences; failed/expired lease recovery; independent writer lanes; paused/access denial; cursor rollback and constant state. No hosted actions.",
    );
  }
} finally {
  await db.close();
}
