import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const league = "13121261-5398-4391-8240-000000000003";
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;",
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await rows(
    "update leagues set operations_enabled=true,active_week=6,week_anchor='2026-10-13 08:00-04' where id=$1",
    [league],
  );
  await rows(
    "update weekly_schedule set automation_enabled=true where league_id=$1",
    [league],
  );
  await db.exec("set request.jwt.claim.role='service_role'");
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-20 12:30-04')",
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from automation_jobs where operation like 'generate_%' and market_week=7",
      )
    )[0].n,
    4,
    "Missed Tuesday generation catches up after more than two hours",
  );
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-21 11:30-04')",
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from automation_jobs where operation like 'refresh_%' and market_week=7",
      )
    )[0].n,
    4,
    "Every category, including futures, refreshes before opening",
  );
  const publish = (
    await rows("select * from automation_jobs where operation='publish'")
  )[0];
  assert.equal(publish.market_week, 7);
  assert.equal(
    new Date(publish.scheduled_for).toISOString(),
    "2026-10-21T12:00:00.000Z",
  );
  const count = (await rows("select count(*)::int n from automation_jobs"))[0]
    .n;
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-21 11:31-04')",
  );
  assert.equal(
    (await rows("select count(*)::int n from automation_jobs"))[0].n,
    count,
    "Planner reruns never duplicate jobs",
  );
  await rows(
    "update automation_jobs set status='done',completed_at='2026-10-21 07:31-04' where operation like 'refresh_%'",
  );
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-21 11:32-04')",
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from automation_jobs where operation like 'refresh_%' and status='pending'",
      )
    )[0].n,
    4,
    "Late publication regenerates stale successful categories",
  );
  await rows(
    "update automation_jobs set status='done',completed_at=now() where operation='publish'",
  );
  await rows(
    "update automation_jobs set status='done',completed_at='2026-10-21 07:31-04' where operation like 'refresh_%'",
  );
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-21 11:33-04')",
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from automation_jobs where operation like 'refresh_%' and status='pending'",
      )
    )[0].n,
    0,
    "A completed opening is not reopened by catch-up",
  );
  await rows("delete from automation_jobs");
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-10-23 11:00-04')",
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from automation_jobs where operation='publish' or operation like 'refresh_%' or operation='reminder'",
      )
    )[0].n,
    0,
    "Never send stale opening/reminder or regenerate after cutoff",
  );
  await rows(
    "select sportsbook_private.enqueue_weekly_jobs('2026-11-04 11:00-05')",
  );
  const winter = (
    await rows(
      "select * from automation_jobs where operation='publish' order by scheduled_for desc",
    )
  )[0];
  assert.equal(
    new Date(winter.scheduled_for).toISOString(),
    "2026-11-04T13:00:00.000Z",
    "8 AM Eastern follows DST",
  );
  await rows("update automation_jobs set status='done'");
  await rows(
    "insert into automation_jobs(league_id,event_key,operation,market_week,status,attempts,created_at,scheduled_for,expires_at) values($1,'recovery-test','refresh_matchups',6,'failed',9,now()-interval '6 hours',now()-interval '6 hours',now()+interval '1 day')",
    [league],
  );
  let claimed = await rows("select * from claim_automation_job()");
  // Ignore harmless currently due schedule entries while exercising the injected retry.
  for (let i = 0; claimed[0]?.event_key !== "recovery-test" && i < 30; i++) {
    await rows("update automation_jobs set status='done' where id=$1", [
      claimed[0].id,
    ]);
    claimed = await rows("select * from claim_automation_job()");
  }
  assert.equal(claimed[0]?.event_key, "recovery-test");
  assert.equal(
    claimed[0].attempts,
    10,
    "Recover beyond four failed attempts and the old two-hour age limit",
  );
  const claimedId = claimed[0].id;
  await rows(
    "update automation_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [claimedId],
  );
  claimed = await rows("select * from claim_automation_job()");
  assert.equal(
    claimed[0].id,
    claimedId,
    "Expired worker lease resumes automatically",
  );
  assert.equal(claimed[0].attempts, 11);
  await rows(
    "update automation_jobs set lease_until=now()-interval '1 minute',expires_at=now()-interval '1 second' where id=$1",
    [claimedId],
  );
  await rows("select * from claim_automation_job()");
  const expired = (
    await rows("select * from automation_jobs where id=$1", [claimedId])
  )[0];
  assert.equal(expired.status, "done");
  assert.equal(expired.summary.skipped, true);
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select claim_memberships();reset role;`,
  );
  await rows("update leagues set active_week=6,week_anchor=now() where id=$1", [
    league,
  ]);
  const board = randomUUID(),
    quote = randomUUID();
  await rows(
    "insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status) values($1,$2,6,2026,3,now(),now()+interval '1 day','published')",
    [board, league],
  );
  await rows(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,metadata) values($1,$2,'snapshot','moneyline','Team wins','Team','home',100,'{\"home_lineup\":[1,2],\"projection_targets\":{\"keep\":true}}')",
    [quote, board],
  );
  await rows(
    "update sportsbook_markets set metadata=metadata||jsonb_build_object('generated_at',now()) where id=$1",
    [quote],
  );
  await rows(
    "insert into line_refresh_runtime(league_id,market_week,observed_at) values($1,6,now()) on conflict(league_id) do update set market_week=6,observed_at=now(),week_started=false,last_error=null",
    [league],
  );
  await rows("delete from automation_jobs");
  for (const operation of [
    "refresh_matchups",
    "refresh_players",
    "refresh_specials",
  ]) {
    await rows(
      "insert into automation_jobs(league_id,event_key,operation,market_week,status,created_at,completed_at) values($1,$2,$2,6,'done',now()-interval '6 hours',now())",
      [league, operation],
    );
  }
  assert.equal(
    (await rows("select confirm_scheduled_publication($1) ok", [board]))[0].ok,
    true,
    "Late queued jobs with newly completed prices can publish",
  );
  await rows(
    "insert into automation_jobs(league_id,event_key,operation,market_week,status,created_at) values($1,'newer-failure','refresh_players',6,'failed',now()-interval '3 hours')",
    [league],
  );
  assert.equal(
    (await rows("select confirm_scheduled_publication($1) ok", [board]))[0].ok,
    false,
    "A newer failed retry cannot be hidden by older completed work",
  );
  await rows(
    "update automation_jobs set status='done',completed_at=now() where event_key='newer-failure'",
  );
  assert.equal(
    (await rows("select confirm_scheduled_publication($1) ok", [board]))[0].ok,
    true,
    "Recovery completes without administrator input",
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  const snapshot = (
    await rows("select sportsbook_current_snapshot($1) s", [league])
  )[0].s;
  assert.equal(snapshot.week, 6);
  assert.equal(snapshot.board.id, board);
  assert.equal(snapshot.markets[0].id, quote);
  assert.equal(
    snapshot.markets[0].metadata.home_lineup,
    undefined,
    "Avoid repeated raw lineup payload",
  );
  assert.equal(
    snapshot.markets[0].metadata.projection_targets.keep,
    true,
    "Keep pricing contracts",
  );
  await db.exec(
    "set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'",
  );
  assert.equal(
    (await rows("select sportsbook_current_snapshot($1) s", [league]))[0].s,
    null,
    "Another member cannot read this league",
  );
  await assert.rejects(() => rows("select * from claim_automation_job()"));
  await db.exec("reset role;set role anon");
  await assert.rejects(() =>
    rows("select sportsbook_current_snapshot($1)", [league]),
  );
  console.log(
    "Passed missed Tuesday/Wednesday catch-up, four-category opening, DST, idempotent scheduling, stale refresh regeneration, deadline expiry, extended retry/expired lease recovery and one-request snapshot authorization/payload preservation.",
  );
} finally {
  await db.close();
}
