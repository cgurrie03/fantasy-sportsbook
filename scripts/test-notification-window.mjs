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
  assert.equal(windowRejection(row, first), null);
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
  await db.exec("reset role;set role anon");
  await assert.rejects(window(), /permission denied/);
  console.log(
    "Notification window: operator/tenant scope, pause/disabled/closed/stale/live guards, real compatible ticket and event deadlines, unchanged price refresh key, frozen/changed-window rejection; no future-only or opposite-outcome urgency.",
  );
} finally {
  await db.close();
}
