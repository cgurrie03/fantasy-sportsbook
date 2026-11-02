import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  validateNotificationWindow,
  windowRejection,
} from "../api/_lib/notification-window.ts";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, outsider, A, B, board, foreignBoard] = Array.from(
  { length: 6 },
  randomUUID,
);
const act = (id) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
  );
const window = async (league = A, kind = "reminder") =>
  (await q("select notification_window($1,2026,5,$2) w", [league, kind]))[0].w;
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`,
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  for (const id of [owner, outsider])
    await q("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  for (const id of [A, B]) {
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Window fixture',($1::uuid)::text,2026,1,5,now())",
      [id],
    );
    await q(
      "insert into weekly_schedule(league_id,publication_paused)values($1,false)",
      [id],
    );
  }
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  for (const [id, league] of [
    [board, A],
    [foreignBoard, B],
  ])
    await q(
      "insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)values($1,$2,5,2026,1,now()-interval '1 hour',now()+interval '4 hours','published','weekly')",
      [id, league],
    );
  await act(outsider);
  await assert.rejects(window(), /operator/);
  await act(owner);
  assert.equal((await window()).reason, "paused");
  await q(
    "select set_league_staff($1,$2,'operator',true,'Fixture scoped notification operator')",
    [A, outsider],
  );
  await act(outsider);
  assert.equal((await window()).reason, "paused");
  await assert.rejects(window(B), /operator/);
  await act(owner);
  await q(
    "select set_league_staff($1,$2,'operator',false,'Fixture immediate operator revocation',1)",
    [A, outsider],
  );
  await act(outsider);
  await assert.rejects(window(), /operator/);
  await act(owner);
  await db.exec("reset role;set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id in($1,$2)", [
    A,
    B,
  ]);
  await db.exec("set session_replication_role=origin");
  await q(
    "update weekly_schedule set automation_enabled=true where league_id in($1,$2)",
    [A, B],
  );
  await act(owner);
  assert.equal((await window()).reason, "no_eligible_ticket");
  await db.exec("reset role");
  const future = randomUUID();
  await q(
    "insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)values($1,$2,1,2026,1,now()-interval '1 hour',now()+interval '1 day','published','future')",
    [future, B],
  );
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,active)values(gen_random_uuid(),$1,'champion','future_champion','Fixture','Team','fixture',200,true)",
    [future],
  );
  await act(owner);
  assert.equal(
    (await window(B)).reason,
    "no_eligible_ticket",
    "open futures never justify weekly reminders",
  );
  await db.exec("reset role");
  const ids = [];
  for (const side of ["home", "away"]) {
    const id = randomUUID();
    ids.push(id);
    await q(
      "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active,metadata)values($1,$2,'same-market','spread','Fixture','Team',$3,1,100,true,jsonb_build_object('cutoff_at',now()+interval '3 hours'))",
      [id, board, side],
    );
  }
  await act(owner);
  assert.equal(
    (await window()).reason,
    "no_eligible_ticket",
    "opposite outcomes are not a valid ticket",
  );
  await db.exec("reset role");
  const total = randomUUID();
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active,metadata)values($1,$2,'total','match_total','Fixture','Team','over',200,100,true,jsonb_build_object('cutoff_at',now()+interval '2 hours'))",
    [total, board],
  );
  await act(owner);
  const first = await window();
  validateNotificationWindow(
    first,
    { league_id: A, market_week: 5, kind: "reminder" },
    2026,
  );
  assert.equal(first.eligible, true);
  assert.equal(Date.parse(first.deadline) - Date.now() > 7100000, true);
  assert.equal(
    Date.parse(first.deadline) - Date.now() < 7300000,
    true,
    "last compatible pair closes before the board does",
  );
  const row = {
    league_id: A,
    market_week: 5,
    kind: "reminder",
    notification_context: first,
  };
  assert.match(windowRejection(row, first), /not due/);
  assert.equal(windowRejection(row, first, Date.parse(first.send_after)), null);
  assert.match(
    windowRejection(row, first, Date.parse(first.send_before)),
    /no longer useful/,
  );
  await db.exec("reset role");
  await q(
    "insert into line_refresh_runtime(league_id,market_week,observed_at)values($1,5,now()-interval '4 minutes')",
    [A],
  );
  await act(owner);
  assert.equal((await window()).reason, "game_state_unavailable");
  await db.exec("reset role");
  await q(
    "update line_refresh_runtime set observed_at=now(),last_error='Fixture outage' where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal((await window()).reason, "game_state_unavailable");
  await db.exec("reset role");
  await q(
    "update line_refresh_runtime set last_error=null,week_started=true where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal((await window()).reason, "game_state_unavailable");
  await db.exec("reset role");
  await q(
    "update line_refresh_runtime set week_started=false where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal((await window()).eligible, true);
  assert.match(
    windowRejection({ ...row, notification_context: null }, first),
    /no verified window/,
  );
  await db.exec("reset role");
  await q("update sportsbook_markets set odds=110 where board_id=$1", [board]);
  await act(owner);
  assert.equal(
    (await window()).window_key,
    first.window_key,
    "ordinary price refreshes do not change the window",
  );
  assert.equal((await window(B)).eligible, false);
  await db.exec("reset role");
  await q(
    "update sportsbook_markets set metadata=jsonb_build_object('cutoff_at',now()-interval '1 minute') where id=$1",
    [total],
  );
  await act(owner);
  assert.equal((await window()).eligible, false);
  await db.exec("reset role");
  const special = randomUUID();
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active)values($1,$2,'special','weekly_any_200','Fixture','League','yes',200,100,true)",
    [special, board],
  );
  await act(owner);
  const single = await window();
  assert.equal(single.eligible, true);
  for (const patch of [
    "active=false",
    "metadata='{\"resolved\":true}'",
    "metadata='{\"lineup_locked\":true}'",
    'metadata=\'{"cutoff_at":"tomorrow"}\'',
    "market_state='suspended'",
  ]) {
    await db.exec("reset role");
    await q(`update sportsbook_markets set ${patch} where id=$1`, [special]);
    await act(owner);
    assert.equal((await window()).eligible, false);
    await db.exec("reset role");
    await q(
      "update sportsbook_markets set active=true,metadata='{}',market_state='open' where id=$1",
      [special],
    );
    await act(owner);
  }
  assert.notEqual(single.window_key, first.window_key);
  assert.match(windowRejection(row, single), /changed/);
  await db.exec("reset role");
  await q("update sportsbook_boards set phase='live' where id=$1", [board]);
  await act(owner);
  assert.equal((await window()).reason, "reopening_unavailable");
  await db.exec("reset role");
  await q(
    "update sportsbook_boards set phase='pregame',suspension_reason='test' where id=$1",
    [board],
  );
  await act(owner);
  assert.equal((await window()).reason, "stale_or_suspended");
  await db.exec("reset role");
  await q(
    "update sportsbook_boards set suspension_reason=null,quote_valid_until=now()-interval '1 minute' where id=$1",
    [board],
  );
  await act(owner);
  assert.equal((await window()).reason, "stale_or_suspended");
  await db.exec("reset role");
  await q("update sportsbook_boards set quote_valid_until=null where id=$1", [
    board,
  ]);
  await q(
    "update weekly_schedule set reminder_email=false where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal((await window()).reason, "disabled");
  await db.exec("reset role");
  await q(
    "update weekly_schedule set reminder_email=true,publication_paused=true where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal((await window()).reason, "paused");
  await db.exec("reset role");
  await q(
    "update weekly_schedule set publication_paused=false where league_id=$1",
    [A],
  );
  await q(
    "update sportsbook_boards set closes_at=now()-interval '1 second' where id=$1",
    [board],
  );
  await act(owner);
  assert.equal((await window()).reason, "closed");
  await db.exec("reset role");
  await q(
    "update sportsbook_boards set closes_at=now()+interval '4 hours' where id=$1",
    [board],
  );
  await act(owner);
  const opening = await window(A, "opening"),
    reminder = await window();
  await db.exec("reset role");
  await q("update sportsbook_boards set revision=revision+1 where id=$1", [
    board,
  ]);
  await act(owner);
  assert.notEqual(
    (await window(A, "opening")).window_key,
    opening.window_key,
    "opening editorial prices bind to a quote revision",
  );
  assert.equal((await window()).window_key, reminder.window_key);
  await db.exec("reset role");
  const team = randomUUID(),
    email = owner + "@example.test";
  await q(
    "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,1,'Fixture','Fixture','Fixture')",
    [team, A],
  );
  await q(
    "insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)values($1,$2,$3,$4,'Fixture','fixture','admin')",
    [A, team, owner, email],
  );
  await act(owner);
  const context = await window();
  await db.exec("reset role");
  const mail = randomUUID();
  await q(
    "insert into outbound_emails(id,league_id,event_key,kind,recipient,team_id,market_week,notification_context)values($1,$2,($1::uuid)::text,'reminder',$3,$4,5,$5)",
    [mail, A, email, team, JSON.stringify(context)],
  );
  await assert.rejects(
    q("update outbound_emails set notification_context=null where id=$1", [
      mail,
    ]),
    /immutable/,
  );
  await q(
    "update outbound_emails set payload=jsonb_build_object('to',jsonb_build_array(recipient),'subject','Fixture','text','Fixture'),status='captured' where id=$1",
    [mail],
  );
  await q(
    "update outbound_emails set terminal_at=now()-interval '8 days' where id=$1",
    [mail],
  );
  await db.exec(
    "set request.jwt.claim.role='service_role';set role service_role",
  );
  assert.equal(
    (await q("select cleanup_routine_payloads(1) r"))[0].r.retired_email_bodies,
    1,
  );
  await db.exec("reset role");
  const retired = (
    await q(
      "select payload,notification_context,body_retired_at from outbound_emails where id=$1",
      [mail],
    )
  )[0];
  assert.equal(retired.payload, null);
  assert.equal(retired.notification_context, null);
  assert(retired.body_retired_at);
  await db.exec("reset role");
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active)select gen_random_uuid(),$1,'budget-'||n,'spread','Fixture','Team','home',1,100,true from generate_series(1,4096)n",
    [foreignBoard],
  );
  await act(owner);
  assert.equal((await window(B)).eligible, true);
  await db.exec("reset role");
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active)values(gen_random_uuid(),$1,'budget-over','spread','Fixture','Team','home',1,100,true)",
    [foreignBoard],
  );
  await act(owner);
  assert.equal((await window(B)).reason, "selection_budget");
  assert.equal(
    (await q("select notification_window($1,2025,5,'reminder') w", [A]))[0].w
      .reason,
    "season_changed",
  );
  // Exercise the real replacement planner and outbox RPC, rather than merely
  // checking a subtraction helper or a source string.
  await db.exec("reset role");
  await q(
    "update weekly_schedule set automation_enabled=true where league_id=$1",
    [A],
  );
  const legacyJob = randomUUID(),
    legacyMail = randomUUID();
  await q(
    "insert into automation_jobs(id,league_id,event_key,operation,market_week)values($1,$2,'legacy-fixed-clock','reminder',5)",
    [legacyJob, A],
  );
  await q(
    "insert into outbound_emails(id,league_id,event_key,kind,recipient,team_id,market_week)values($1,$2,'2026:5:reminder:legacy','reminder',$3,$4,5)",
    [legacyMail, A, email, team],
  );
  await db.exec("set request.jwt.claim.role='service_role'");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    (await q("select status from automation_jobs where id=$1", [legacyJob]))[0]
      .status,
    "done",
  );
  assert.equal(
    (await q("select status from outbound_emails where id=$1", [legacyMail]))[0]
      .status,
    "skipped",
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from automation_jobs where league_id=$1 and operation='reminder' and status='pending'",
        [A],
      )
    )[0].n,
    0,
    "early planner never queues a reminder",
  );
  await q(
    "update sportsbook_boards set closes_at=now()+interval '30 minutes' where id=$1",
    [board],
  );
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  const due = (await window()).send_after;
  const planned = await q(
    "select * from automation_jobs where league_id=$1 and operation='reminder' and status='pending'",
    [A],
  );
  assert.equal(planned.length, 1);
  assert.equal(new Date(planned[0].scheduled_for).getTime(), Date.parse(due));
  const queued = async (recipient = email) =>
    (
      await q("select queue_relative_reminder($1,5,$2,$3,$4) ok", [
        A,
        team,
        recipient,
        (await window()).window_key,
      ])
    )[0].ok;
  assert.equal(await queued(), true);
  assert.equal(await queued(), false, "same reminder retry is idempotent");
  const beforePlan = await window();
  await act(outsider);
  await assert.rejects(
    q("select reminder_schedule_preview($1,60)", [A]),
    /operator/,
  );
  await assert.rejects(
    q(
      "select configure_weekly_schedule_v3($1,false,true,true,true,'08:00','19:00','08:15',$2,120)",
      [
        A,
        JSON.stringify({
          settlement: "00:30",
          recheck: "07:00",
          replenishment: "08:00",
          generation: "08:30",
          refresh: "07:30",
          cutoff: "20:00",
        }),
      ],
    ),
    /platform owner/,
  );
  await act(owner);
  const schedule = (
    await q("select * from weekly_schedule where league_id=$1", [A])
  )[0];
  const preview = (
    await q("select reminder_schedule_preview($1,120) p", [A])
  )[0].p;
  assert.equal(preview.saved_lead_minutes, 60);
  assert.equal(preview.proposed_lead_minutes, 120);
  assert.notEqual(preview.saved.window_key, preview.proposed.window_key);
  assert.equal(
    (
      await q(
        "select reminder_lead_minutes from weekly_schedule where league_id=$1",
        [A],
      )
    )[0].reminder_lead_minutes,
    60,
    "preview changes nothing",
  );
  const configure = async (lead) =>
    q(
      "select configure_weekly_schedule_v3($1,false,true,true,true,'08:00','19:00','08:15',$2,$3)",
      [A, JSON.stringify(schedule.job_times), lead],
    );
  await assert.rejects(configure(4), /5 to 1440/);
  await configure(120);
  assert.match(
    windowRejection(
      {
        league_id: A,
        market_week: 5,
        kind: "reminder",
        notification_context: beforePlan,
      },
      await window(),
    ),
    /changed/,
  );
  await db.exec("reset role;set request.jwt.claim.role='service_role'");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    (
      await q("select status from automation_jobs where id=$1", [planned[0].id])
    )[0].status,
    "done",
  );
  assert.equal(
    (
      await q(
        "select status from outbound_emails where league_id=$1 and kind='reminder' and status='pending'",
        [A],
      )
    ).length,
    0,
    "changed lead retires old unattempted message",
  );
  assert.equal(
    await queued(),
    true,
    "replacement is allowed only before any attempt",
  );
  await q(
    "update outbound_emails set status='captured',attempts=1,payload=jsonb_build_object('to',jsonb_build_array(recipient),'subject','Fixture','text','Fixture') where league_id=$1 and kind='reminder' and status='pending'",
    [A],
  );
  await q(
    "update outbound_emails set terminal_at=now()-interval '8 days' where league_id=$1 and kind='reminder' and status='captured'",
    [A],
  );
  await q("select cleanup_routine_payloads(500)");
  await act(owner);
  await configure(180);
  await db.exec("reset role;set request.jwt.claim.role='service_role'");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    await queued(),
    false,
    "durable period key suppresses resend even after context retirement",
  );
  await q("update auth.users set email='coowner@example.test' where id=$1", [
    outsider,
  ]);
  await q(
    "insert into sportsbook_private.user_finance_modes(league_id,enabled)values($1,true)",
    [A],
  );
  await q(
    "insert into user_wallets(league_id,team_id,user_id,display_name)values($1,$2,$3,'Independent co-owner')",
    [A, team, outsider],
  );
  assert.equal(
    await queued("coowner@example.test"),
    true,
    "co-owner recipient is independent",
  );
  await q(
    "update outbound_emails set attempts=1,status='failed' where league_id=$1 and recipient='coowner@example.test'",
    [A],
  );
  await act(owner);
  await configure(240);
  await db.exec("reset role;set request.jwt.claim.role='service_role'");
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    (
      await q(
        "select status from outbound_emails where league_id=$1 and recipient='coowner@example.test'",
        [A],
      )
    )[0].status,
    "needs_review",
  );
  assert.equal(
    await queued("coowner@example.test"),
    false,
    "ambiguous attempt cannot be resent under a new lead",
  );
  for (const [deadline, expected] of [
    ["2026-11-01T07:30:00Z", "2026-11-01T05:30:00Z"],
    ["2026-03-08T08:30:00Z", "2026-03-08T06:30:00Z"],
  ]) {
    const plan = (
      await q(
        "select sportsbook_private.relative_reminder_contract($1,120) p",
        [
          JSON.stringify({
            eligible: true,
            opens_at: "2026-01-01T00:00:00Z",
            deadline,
            window_key: "fixture",
          }),
        ],
      )
    )[0].p;
    assert.equal(
      Date.parse(plan.send_after),
      Date.parse(expected),
      "lead is elapsed time across Eastern DST transitions",
    );
  }
  await q(
    "update sportsbook_boards set closes_at=now()-interval '1 second' where id=$1",
    [board],
  );
  await q("select sportsbook_private.enqueue_weekly_jobs(now())");
  assert.equal(
    await queued("coowner@example.test"),
    false,
    "closed window cannot queue after outage",
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from automation_jobs where league_id=$1 and operation='reminder' and status='pending'",
        [A],
      )
    )[0].n,
    0,
    "closed-window jobs are retired",
  );
  console.log(
    "Relative reminder scheduler: not early, actual due/expiry, preview read-only, owner/tenant scope, rescheduling, durable duplicate suppression, co-owner independence, prior-attempt review and spring/fall DST.",
  );
  await db.exec("reset role;set request.jwt.claim.role='anon';set role anon");
  await assert.rejects(window(), /permission denied/);
  console.log(
    "Notification window: operator/tenant scope, pause/disabled/closed/stale/live guards, real compatible ticket and event deadlines, unchanged price refresh key, frozen/changed-window rejection; no future-only or opposite-outcome urgency.",
  );
} finally {
  await db.close();
}
