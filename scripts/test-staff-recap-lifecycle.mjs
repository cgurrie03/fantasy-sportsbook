import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, operator, viewer, unconfirmed, league, other, team, job] =
  Array.from({ length: 8 }, uuid);
const email = (id) => id + "@example.test";
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;",
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    "set request.jwt.claim.role='service_role';set request.jwt.claim.sub=''",
  );
  for (const id of [owner, operator, viewer, unconfirmed])
    await q("insert into auth.users values($1,$2,$3)", [
      id,
      email(id),
      new Date(),
    ]);
  for (const id of [league, other])
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Lifecycle fixture',($1::uuid)::text,2026,1,5,now())",
      [id],
    );
  for (const id of [league, other])
    await q("insert into weekly_schedule(league_id)values($1)", [id]);
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  await db.exec(`set request.jwt.claim.sub='${owner}'`);
  for (const [id, role] of [
    [operator, "operator"],
    [viewer, "viewer"],
    [unconfirmed, "operator"],
  ])
    await q(
      "insert into league_staff_grants(league_id,user_id,role,reason,created_by,updated_by)values($1,$2,$3,'Synthetic scoped grant',$4,$4)",
      [league, id, role, owner],
    );
  await q("update auth.users set email_confirmed_at=null where id=$1", [
    unconfirmed,
  ]);
  await q(
    "insert into automation_jobs(id,league_id,event_key,operation,market_week)values($1,$2,'lifecycle-job','recheck',5)",
    [job, league],
  );
  const at = new Date(),
    queue = async (t = at, id = job) =>
      (
        await q(
          "select sportsbook_private.queue_staff_attention_at($1,'results',$2) r",
          [id, t],
        )
      )[0].r;
  assert.equal(
    (await queue()).queued,
    2,
    "only confirmed owner and teamless operator",
  );
  assert.equal((await queue()).queued, 0, "same job is deduplicated");
  const rows = await q("select * from outbound_emails order by staff_user_id");
  assert(
    rows.every(
      (r) => r.team_id === null && r.ticket_id === null && r.payload === null,
    ),
  );
  const alert = rows.find((r) => r.staff_user_id === operator);
  assert.equal(
    (await q("select staff_alert_context($1) c", [alert.id]))[0].c.recipient,
    email(operator),
  );
  await q(
    "update league_staff_grants set active=false where league_id=$1 and user_id=$2",
    [league, operator],
  );
  await assert.rejects(
    q("select staff_alert_context($1)", [alert.id]),
    /permission.*changed/i,
  );
  await q(
    "update league_staff_grants set active=true where league_id=$1 and user_id=$2",
    [league, operator],
  );
  for (let i = 1; i <= 4; i++) {
    const id = uuid();
    await q(
      "insert into automation_jobs(id,league_id,event_key,operation,market_week)values($1,$2,($1::uuid)::text,'recheck',5)",
      [id, league],
    );
    const r = await queue(new Date(+at + i * 31 * 60000), id);
    assert.equal(r.queued, i <= 3 ? 2 : 0, "four alerts per user per ET day");
  }
  assert.equal(
    (
      await q(
        "select count(*)::int n from sportsbook_private.staff_alert_budget",
      )
    )[0].n,
    2,
    "mutable bounded budget, no daily history",
  );
  await q(
    "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,1,'Fixture','Fixture','Fixture')",
    [team, league],
  );
  await q(
    "insert into sportsbook_private.user_finance_modes(league_id,enabled)values($1,true)",
    [league],
  );
  await q(
    "insert into user_wallets(league_id,user_id,team_id,display_name,balance)values($1,$2,$3,'Owner',100)",
    [league, owner, team],
  );
  const recap = async (week = 5) =>
    (
      await q("select recap_financial_context($1,$2,$3,2026,$4)c", [
        league,
        team,
        email(owner),
        week,
      ])
    )[0].c;
  assert.equal(
    (await recap()).ready,
    false,
    "unreviewed replenishment never claims zero credit",
  );
  await q(
    "insert into weekly_execution_runs(league_id,nfl_season,market_week,operation,summary)values($1,2026,5,'replenishment','{}')",
    [league],
  );
  assert.equal((await recap()).state, "review_pending");
  await q(
    "insert into user_wallet_entries(wallet_id,league_id,team_id,event_key,kind,amount,balance_before,balance_after,reason,created_at)select id,league_id,team_id,'weekly:replenish:2026:5:'||id,'weekly_replenishment',25,75,100,'Synthetic historical credit',now()-interval '48 hours'from user_wallets where league_id=$1",
    [league],
  );
  assert.equal(
    (await recap()).credited,
    25,
    "exact event remains visible after 24h",
  );
  assert.equal(
    (await recap(6)).credited,
    null,
    "another week never borrows a credit",
  );
  await assert.rejects(
    q("select recap_financial_context($1,$2,$3,2026,5)", [
      other,
      team,
      email(owner),
    ]),
    /recipient/i,
  );
  await db.exec(
    "set request.jwt.claim.role='authenticated';set role authenticated",
  );
  const preview = async (kind = "recap") =>
    (await q("select notification_preview($1,$2)p", [league, kind]))[0].p;
  assert.equal(
    (await preview()).eligible,
    false,
    "paused development preview stays unavailable",
  );
  assert.match((await preview("attention")).reason, /Event-triggered/);
  await db.exec(`reset role;set request.jwt.claim.sub='${viewer}'`);
  await assert.rejects(
    q("select notification_preview($1,'opening')", [league]),
    /operator/,
  );
  await db.exec(
    `set request.jwt.claim.sub='${owner}';set request.jwt.claim.role='service_role';set session_replication_role=replica`,
  );
  await q(
    "update leagues set operations_enabled=true,active_week=18,week_anchor=now()-interval '8 days' where id=$1",
    [league],
  );
  await db.exec("set session_replication_role=origin");
  await q(
    "update weekly_schedule set automation_enabled=true where league_id=$1",
    [league],
  );
  assert.equal(
    (await q("select final_recap_ready($1,2026)r", [league]))[0].r,
    false,
  );
  await q(
    "insert into league_result_weeks(league_id,nfl_season,market_week,final,results)values($1,2026,18,true,'{}')",
    [league],
  );
  assert.equal(
    (await q("select final_recap_ready($1,2026)r", [league]))[0].r,
    true,
  );
  assert.equal((await recap(19)).state, "weekly_calendar_complete");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    (
      await q(
        "select count(*)::int n from automation_jobs where league_id=$1 and operation='final_recap'",
        [league],
      )
    )[0].n,
    1,
    "final recap is season-deduplicated",
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from automation_jobs where market_week=19 and operation='replenishment'",
      )
    )[0].n,
    0,
    "no invented week 19 cash reset",
  );
  assert.equal((await preview()).phase, "closing");
  assert.equal((await preview()).market_week, 18);
  assert.equal((await preview()).eligible, true);
  assert.equal((await preview("opening")).eligible, false);
  await q(
    "update leagues set week_anchor=now()-interval '15 days' where id=$1",
    [league],
  );
  assert.equal((await preview()).phase, "closed");
  assert.equal((await preview()).eligible, false);
  assert.equal(
    (await q("select final_recap_ready($1,2026)r", [league]))[0].r,
    false,
  );
  await q(
    "update leagues set nfl_season=2027,active_week=1,week_anchor=now() where id=$1",
    [league],
  );
  assert.equal(
    (await preview()).eligible,
    false,
    "prior NFL results cannot authorize new season recap",
  );
  await db.exec("set role authenticated");
  for (const call of [
    "queue_staff_attention($1,'results')",
    "staff_alert_context($1)",
  ])
    await assert.rejects(q("select " + call, [job]), /permission denied/);
  await db.exec("reset role;set role service_role");
  for (const table of ["staff_alert_budget", "opening_editorial_editions"])
    await assert.rejects(
      q("select * from sportsbook_private." + table),
      /permission denied/,
    );
  console.log(
    "Staff alerts: verified teamless staff, viewer/unconfirmed exclusion, immediate revocation, scoped immutable audience, cooldown/dedup and four-per-day cap. Recaps: exact historical credit, unknown vs reviewed state, tenant/week isolation. No mail/provider access.",
  );
} finally {
  await db.close();
}
