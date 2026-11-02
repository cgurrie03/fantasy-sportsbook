import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, coowner, outsider, A, B, teamA, teamB, board] = Array.from(
  { length: 8 },
  randomUUID,
);
const email = (id) => id + "@example.test";
const act = (id) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated`,
  );
const server = () =>
  db.exec(
    "reset role;set row_security=on;set request.jwt.claim.role='service_role';set request.jwt.claim.sub=''",
  );
const all = {
  opening: true,
  reminder: true,
  recap: true,
  monday_watch: true,
  reopening: true,
};
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;",
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  for (const id of [owner, coowner, outsider])
    await q("insert into auth.users values($1,$2,now())", [id, email(id)]);
  for (const [id, team] of [
    [A, teamA],
    [B, teamB],
  ]) {
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Routine fixture',($1::uuid)::text,2026,1,5,now())",
      [id],
    );
    await q(
      "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,1,'Fixture','Fixture','Fixture')",
      [team, id],
    );
    await q(
      "insert into weekly_schedule(league_id,publication_paused)values($1,false)",
      [id],
    );
    await q(
      "insert into sportsbook_private.user_finance_modes(league_id,enabled)values($1,true)",
      [id],
    );
    await q(
      "insert into user_wallets(league_id,user_id,team_id,display_name,balance)values($1,$2,$3,'Owner fixture',100)",
      [id, owner, team],
    );
  }
  await q(
    "insert into user_wallets(league_id,user_id,team_id,display_name,balance)values($1,$2,$3,'Co-owner fixture',100)",
    [A, coowner, teamA],
  );
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  await db.exec("set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id in($1,$2)", [
    A,
    B,
  ]);
  await db.exec("set session_replication_role=origin");
  await q(
    "update weekly_schedule set automation_enabled=true where league_id in($1,$2)",
    [A, B],
  );
  const monday = (
    await q(
      "select (sportsbook_private.notification_week(now())+13+'17:00'::time) at time zone 'America/New_York' t",
    )
  )[0].t;
  const at = new Date(monday).toISOString();
  const mail = async (kind = "opening", league = A, user = owner) => {
    const id = randomUUID();
    await q(
      "insert into outbound_emails(id,league_id,event_key,kind,recipient,team_id,market_week)values($1,$2,($1::uuid)::text,$3,$4,$5,$6)",
      [
        id,
        league,
        kind,
        email(user),
        league === A ? teamA : teamB,
        kind === "recap" ? 4 : 5,
      ],
    );
    return id;
  };
  const permission = async (id, commit = false, time = at) =>
    (
      await q(
        "select sportsbook_private.routine_delivery_permission_at($1,$2,$3) p",
        [id, commit, time],
      )
    )[0].p;
  const freeze = async (id, time = at) => {
    const p = await permission(id, false, time);
    assert.equal(p.allowed, true, JSON.stringify(p));
    await q(
      "update outbound_emails set payload=jsonb_build_object('to',jsonb_build_array(recipient),'subject','Fixture','text','Fixture'),routine_context=$2 where id=$1",
      [id, p.context],
    );
    return p.context;
  };
  await act(outsider);
  await assert.rejects(
    q("select my_notification_preferences($1)", [A]),
    /Approved/,
  );
  await act(owner);
  let prefs = (await q("select my_notification_preferences($1) p", [A]))[0].p;
  assert.equal(prefs.revision, 0);
  assert.deepEqual(prefs.effective, all);
  prefs = (
    await q("select save_my_notification_preferences($1,0,$2) p", [
      A,
      { opening: false },
    ])
  )[0].p;
  assert.equal(prefs.effective.opening, false);
  await assert.rejects(
    q("select save_my_notification_preferences($1,0,$2)", [
      A,
      { opening: true },
    ]),
    /changed/,
  );
  for (const invalid of [{ receipt: false }, { opening: "false" }, [], null])
    await assert.rejects(
      q("select save_my_notification_preferences($1,1,$2)", [A, invalid]),
      /supported/,
    );
  await act(coowner);
  assert.equal(
    (await q("select my_notification_preferences($1) p", [A]))[0].p.effective
      .opening,
    true,
    "co-owners do not share preferences",
  );
  await assert.rejects(
    q("select my_notification_preferences($1)", [B]),
    /Approved/,
  );
  await act(owner);
  assert.equal(
    (await q("select my_notification_preferences($1) p", [B]))[0].p.effective
      .opening,
    true,
    "same user has separate league choices",
  );
  await q(
    "select set_league_staff($1,$2,'operator',true,'Fixture scoped notification operator')",
    [A, outsider],
  );
  await act(outsider);
  await q("select league_notification_defaults($1)", [A]);
  await assert.rejects(
    q("select league_notification_defaults($1)", [B]),
    /operator/,
  );
  await assert.rejects(
    q("select save_league_notification_defaults($1,0,$2)", [A, all]),
    /owner/,
  );
  await act(owner);
  await q("select save_league_notification_defaults($1,0,$2)", [
    A,
    { ...all, opening: false },
  ]);
  await q("select save_my_notification_preferences($1,1,$2)", [
    A,
    { opening: true },
  ]);
  assert.equal(
    (await q("select my_notification_preferences($1) p", [A]))[0].p.effective
      .opening,
    false,
    "personal opt-in never overrides disabled league type",
  );
  await assert.rejects(
    q("select save_league_notification_defaults($1,0,$2)", [A, all]),
    /changed/,
  );
  await q("select save_league_notification_defaults($1,1,$2)", [A, all]);
  await server();
  await q(
    "update weekly_schedule set reminder_email=false where league_id=$1",
    [A],
  );
  await act(owner);
  assert.equal(
    (await q("select my_notification_preferences($1) p", [A]))[0].p.effective
      .reminder,
    false,
    "existing disabled flags remain authoritative",
  );
  await server();
  await q("update weekly_schedule set reminder_email=true where league_id=$1", [
    A,
  ]);

  await q(
    "insert into user_wallet_entries(wallet_id,league_id,team_id,event_key,kind,amount,balance_before,balance_after,reason,created_at) select id,league_id,team_id,'weekly:replenish:2026:5:'||id,'weekly_replenishment',25,75,100,'Synthetic exact weekly credit',now()-interval '48 hours' from user_wallets where league_id=$1 and user_id=$2",
    [A, owner],
  );
  const ids = [];
  for (const kind of ["opening", "recap", "reopening"]) {
    const id = await mail(kind);
    ids.push(id);
    await freeze(id);
    assert.equal((await permission(id)).allowed, true);
    assert.equal(
      (
        await q(
          "select count(*)::int n from sportsbook_private.routine_dispatches",
        )
      )[0].n,
      ids.length - 1,
      "preview never spends budget",
    );
    assert.equal((await permission(id, true)).allowed, true);
    assert.equal(
      (await permission(id, true)).allowed,
      true,
      "retry spends one credit",
    );
  }
  const fourth = await mail("opening");
  assert.match((await permission(fourth)).reason, /Three routine/);
  const otherUser = await mail("opening", A, coowner);
  await freeze(otherUser);
  assert.equal((await permission(otherUser, true)).allowed, true);
  const otherLeague = await mail("opening", B, owner);
  await freeze(otherLeague);
  assert.equal((await permission(otherLeague, true)).allowed, true);
  const essential = await mail("confirmation");
  assert.deepEqual(await permission(essential, true), {
    allowed: true,
    essential: true,
  });
  assert.equal(
    (
      await q(
        "select count(*)::int n from sportsbook_private.routine_dispatches where email_id=$1",
        [essential],
      )
    )[0].n,
    0,
  );
  const tomorrow = new Date(Date.parse(at) + 7 * 86400000).toISOString();
  assert.match(
    (await permission(ids[0], false, tomorrow)).reason,
    /useful period/,
  );
  const nextWeek = await mail("opening");
  await freeze(nextWeek, tomorrow);
  assert.equal(
    (await permission(nextWeek, true, tomorrow)).allowed,
    true,
    "new Tuesday–Monday period has its own cap",
  );
  await q(
    "update outbound_emails set status='captured',attempts=1 where id=any($1::uuid[])",
    [ids],
  );
  await q(
    "update outbound_emails set terminal_at=now()-interval '8 days' where id=any($1::uuid[])",
    [ids],
  );
  await q("select cleanup_routine_payloads(500)");
  assert.equal(
    (
      await q(
        "select count(*)::int n from outbound_emails where id=any($1::uuid[]) and payload is null and routine_context is null and body_retired_at is not null",
        [ids],
      )
    )[0].n,
    3,
  );
  assert.match(
    (await permission(fourth)).reason,
    /Three routine/,
    "payload retirement cannot reset budget",
  );
  await assert.rejects(
    q("delete from sportsbook_private.routine_dispatches where email_id=$1", [
      ids[0],
    ]),
    /immutable/i,
  );
  const legacy = await mail("opening", B, owner);
  await q(
    "update outbound_emails set payload=jsonb_build_object('to',jsonb_build_array(recipient),'subject','Frozen')where id=$1",
    [legacy],
  );
  assert.match((await permission(legacy)).reason, /no verified composition/);

  // A shared team has two independent accepted-ticket owners. No real bets.
  const wallet = (
    await q("select id from user_wallets where league_id=$1 and user_id=$2", [
      A,
      coowner,
    ])
  )[0].id;
  await q(
    "insert into tickets(id,league_id,team_id,user_wallet_id,bettor_display_name,market_week,placement_week,nfl_season,league_season,ticket_type,stake,accepted_combined_odds,accepted_potential_payout,request_key,placed_at,status,actual_payout)values($1,$2,$3,$4,'Co-owner',5,5,2026,1,'parlay',1,100,2,$5,now(),'OPEN',0)",
    [randomUUID(), A, teamA, wallet, randomUUID()],
  );
  const boardClose = new Date(Date.parse(at) + 2 * 3600000).toISOString();
  await q(
    "insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)values($1,$2,5,2026,1,now()-interval '1 hour',$3,'published','weekly')",
    [board, A, boardClose],
  );
  await q(
    "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,active)values($1,$2,'weekly-high','weekly_high','Fixture','Team','yes',100,true)",
    [randomUUID(), board],
  );
  const watch = await mail("monday_watch", A, coowner);
  assert.match((await permission(watch)).reason, /nearby closing reminder/);
  const reminderWindow = (
    await q("select notification_window($1,2026,5,'reminder') w", [A])
  )[0].w;
  await q(
    "insert into automation_jobs(league_id,event_key,operation,market_week,status)values($1,$2,'reminder',5,'done')",
    [A, `relative-reminder-v1:${A}:2026:5:${reminderWindow.window_key}`],
  );
  assert.equal(
    (
      await permission(
        watch,
        false,
        new Date(Date.parse(at) + 90 * 60000).toISOString(),
      )
    ).allowed,
    true,
    "a completed reminder job without a recipient message cannot promise a future merged delivery",
  );
  const reminder = await mail("reminder", A, coowner);
  await q("update outbound_emails set notification_context=$2 where id=$1", [
    reminder,
    reminderWindow,
  ]);
  const reminderAt = new Date(Date.parse(at) + 60 * 60000).toISOString();
  const merged = await freeze(reminder, reminderAt);
  assert.equal(merged.merge_watch, true);
  assert.equal(merged.open_ticket_count, 1);
  await assert.rejects(
    q("update outbound_emails set routine_context=null where id=$1", [
      reminder,
    ]),
    /immutable/,
  );
  assert.equal((await permission(reminder, true, reminderAt)).allowed, true);
  assert.match(
    (await permission(watch)).reason,
    /included in the closing reminder/,
  );
  const ownerWatch = await mail("monday_watch");
  assert.match(
    (await permission(ownerWatch)).reason,
    /No open personal/,
    "co-owner tickets never become primary-owner watch facts",
  );
  const early = new Date(Date.parse(at) - 3 * 3600000).toISOString();
  assert.match(
    (await permission(watch, false, early)).reason,
    /outside its useful/,
  );
  await act(coowner);
  await q("select save_my_notification_preferences($1,0,$2)", [
    A,
    { monday_watch: false },
  ]);
  await server();
  assert.match(
    (await permission(reminder, false, reminderAt)).reason,
    /disabled after composition/,
    "frozen merged content respects a later watch opt-out",
  );
  await q(
    "update user_wallets set status='revoked' where league_id=$1 and user_id=$2",
    [A, coowner],
  );
  assert.match(
    (await permission(reminder, false, reminderAt)).reason,
    /recipient unavailable/,
  );
  await act(coowner);
  await assert.rejects(
    q("select my_notification_preferences($1)", [A]),
    /Approved/,
  );
  await server();
  const capacityTime = new Date(Date.parse(at) + 14 * 86400000).toISOString();
  // Synthetic high-water rows test the fixed recipient bound, without sending.
  await db.exec(`do $$declare u uuid;i integer;begin for i in 1..128 loop
    u:=gen_random_uuid();insert into auth.users values(u,u||'@example.test',now());
    insert into public.outbound_emails(id,league_id,event_key,kind,recipient,team_id,market_week)values(u,'${B}',u::text,'opening','${email(owner)}','${teamB}',5);
    insert into sportsbook_private.routine_dispatches(email_id,league_id,user_id,nfl_season,period_start,kind,merged_watch)
     values(u,'${B}',u,2026,sportsbook_private.notification_week('${capacityTime}'::timestamptz),'opening',false);
   end loop;end $$;`);
  const capacityMail = await mail("opening", B);
  assert.match(
    (await permission(capacityMail, false, capacityTime)).reason,
    /recipient capacity/,
  );
  await act(owner);
  for (const table of [
    "notification_preferences",
    "notification_defaults",
    "routine_dispatches",
  ])
    await assert.rejects(
      q("select * from sportsbook_private." + table),
      /permission denied/,
    );
  await assert.rejects(
    q("select routine_delivery_permission($1,false)", [fourth]),
    /permission denied/,
  );
  await server();
  const livePreview = await mail("opening", B);
  await db.exec("set role service_role");
  assert.equal(
    (
      await q("select routine_delivery_permission($1,false) p", [livePreview])
    )[0].p.allowed,
    true,
    "actual service-role RPC needs no signed-in owner claim",
  );
  await assert.rejects(
    q("select * from sportsbook_private.routine_dispatches"),
    /permission denied/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    q("select my_notification_preferences($1)", [A]),
    /permission denied/,
  );
  console.log(
    "Routine notifications: self/league/co-owner scope, revocation, owner defaults/CAS and legacy flags, 3-credit atomic admission/retry, essential bypass, durable cleanup, weekly rollover, frozen opt-out and merged personal Monday watch. No provider calls.",
  );
} finally {
  await db.close();
}
