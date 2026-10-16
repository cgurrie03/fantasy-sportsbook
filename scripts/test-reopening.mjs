import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const league = "13121261-5398-4391-8240-000000000003",
  admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;",
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query(
    "update leagues set active_week=6,week_anchor=now() where id=$1",
    [league],
  );
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select claim_memberships();reset role;`,
  );
  const team = (await rows("select id from teams where roster_id=1"))[0].id;
  await db.query("update wallets set balance=100 where team_id=$1", [team]);
  const team2 = (await rows("select id from teams where roster_id=2"))[0].id;
  const quote2 = randomUUID();
  const board = randomUUID(),
    future = randomUUID(),
    quote = randomUUID(),
    fq = randomUUID();
  const base = {
    id: quote,
    market_key: "reopening:test",
    kind: "team_total",
    label: "Team Over 125.5",
    subject: "Team",
    team_id: team,
    side: "over",
    line: 125.5,
    odds: -110,
    boost_pct: 0,
    metadata: { expected_team_count: 12, roster_id: 1 },
  };
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await rows(
    "select save_market_board($1,$2,6,now()-interval '1 day',now()+interval '1 day',$3,'published')",
    [board, league, JSON.stringify([base])],
  );
  await rows("select save_future_board($1,$2,$3,'published')", [
    future,
    league,
    JSON.stringify([
      {
        ...base,
        id: fq,
        kind: "future_champion",
        market_key: "future:test",
        line: null,
        side: team,
      },
    ]),
  ]);
  await db.exec("reset role");
  const deadline = (
    await rows(
      "select (date_trunc('week',now() at time zone 'America/New_York')+interval '6 days 12 hours') at time zone 'America/New_York' as t",
    )
  )[0].t;
  // Tests can run on Sunday afternoon too: choose the next eligible Sunday.
  const closes =
    new Date(deadline) > new Date()
      ? new Date(deadline)
      : new Date(new Date(deadline).getTime() + 7 * 86400000);
  const game = {
    id: "pending",
    starts_at: new Date(Date.now() + 4 * 86400000).toISOString(),
    state: "scheduled",
    teams: ["BUF", "NE"],
  };
  await db.query(
    "insert into line_refresh_runtime(league_id,market_week,week_started,observed_at,games) values($1,6,true,now(),$2) on conflict(league_id) do update set market_week=6,week_started=true,observed_at=now(),last_error=null,games=excluded.games",
    [league, JSON.stringify([game])],
  );
  const meta = {
    reopening_model: "between-games-conditional-v1",
    reopening_locked: false,
    reopening_game_ids: ["pending"],
    reopening_events: [game],
  };
  const weekly = [
      { ...base, metadata: meta },
      {
        ...base,
        id: quote2,
        market_key: "reopening:other",
        team_id: team2,
        metadata: meta,
      },
    ],
    futures = [
      {
        ...base,
        id: fq,
        kind: "future_champion",
        market_key: "future:test",
        side: team,
        line: null,
        metadata: { ...meta, roster_id: 1 },
      },
    ];
  const hash = "a".repeat(64);
  const stage = async () =>
    (
      await rows(
        "select stage_reopening_review($1,6,2026,$2,now(),$3,$4,$5,$6) as id",
        [
          league,
          closes.toISOString(),
          hash,
          JSON.stringify(weekly),
          JSON.stringify(futures),
          JSON.stringify({ model: meta.reopening_model, games: [game] }),
        ],
      )
    )[0].id;
  await db.exec(
    "set request.jwt.claim.role='service_role';set role service_role",
  );
  const review = await stage();
  await db.exec(
    `reset role;set request.jwt.claim.role='authenticated';set role authenticated;set request.jwt.claim.sub='${admin}';`,
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from outbound_emails where kind='reopening'",
      )
    )[0].n,
    0,
    "preview never queues emails",
  );
  await assert.rejects(
    () =>
      rows("select activate_reopening_review($1,$2)", [review, "b".repeat(64)]),
    /exact reopening snapshot/,
  );
  await db.exec("reset role");
  const outsider = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await db.query(
    "insert into auth.users values($1,'member@example.invalid',now())",
    [outsider],
  );
  await db.query("update league_memberships set user_id=$1 where team_id=$2", [
    outsider,
    team2,
  ]);
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${outsider}';`,
  );
  assert.equal(
    (await rows("select count(*)::int n from sportsbook_reopening_reviews"))[0]
      .n,
    0,
  );
  await assert.rejects(
    () => rows("select activate_reopening_review($1,$2)", [review, hash]),
    /Only this league admin/,
  );
  await assert.rejects(
    () => rows("select sportsbook_readiness($1)", [league]),
    /Only this league admin/,
  );
  await assert.rejects(
    () => rows("select queue_reopening_announcement($1)", [review]),
    /Only this league admin/,
  );
  await db.exec(
    `reset role;set role authenticated;set request.jwt.claim.sub='${admin}';`,
  );
  await rows("select activate_reopening_review($1,$2)", [review, hash]);
  const boards = await rows(
    "select * from sportsbook_boards where id=any($1)",
    [[board, future]],
  );
  assert(
    boards.every((b) => b.reopening_id === review && b.status === "published"),
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from outbound_emails where kind='reopening'",
      )
    )[0].n,
    0,
    "approval alone never sends",
  );
  const rev = (
    await rows("select revision from sportsbook_boards where id=$1", [board])
  )[0].revision;
  const ticket = (
    await rows("select place_sportsbook_ticket($1,$2,$3,10,$4) result", [
      board,
      rev,
      [quote, quote2],
      randomUUID(),
    ])
  )[0].result;
  assert(ticket.ticket_id);
  const originalLeg = (
    await rows("select * from ticket_legs where ticket_id=$1", [
      ticket.ticket_id,
    ])
  )[0];
  const count = (
    await rows("select queue_reopening_announcement($1) n", [review])
  )[0].n;
  assert.equal(count, 12);
  assert.equal(
    (await rows("select queue_reopening_announcement($1) n", [review]))[0].n,
    0,
  );
  await db.exec("reset role");
  // The regular four-family refresh must keep the approved window usable.
  await db.exec("set request.jwt.claim.role='service_role'");
  await rows(
    "update weekly_schedule set automation_enabled=true,publication_paused=false where league_id=$1",
    [league],
  );
  await rows("select observe_line_refresh($1)", [
    JSON.stringify({
      games: [game],
      week_started: true,
      any_in_progress: false,
      season_year: 2026,
      reason: null,
    }),
  ]);
  assert.equal(
    (
      await rows(
        "select suspension_reason from sportsbook_boards where id=$1",
        [board],
      )
    )[0].suspension_reason,
    null,
  );
  const cycle = (
    await rows(
      "select * from line_refresh_cycles where league_id=$1 and market_week=6 and status='staging' order by created_at desc limit 1",
      [league],
    )
  )[0];
  assert(cycle, "approved reopening schedules an ordinary refresh cycle");
  const jobs = await rows(
    "select * from automation_jobs where refresh_cycle_id=$1 order by operation",
    [cycle.id],
  );
  assert.equal(jobs.length, 4);
  for (const job of jobs) {
    await rows(
      "update automation_jobs set status='running',attempts=1,lease_until=now()+interval '5 minutes' where id=$1",
      [job.id],
    );
    const qs = (
      job.operation === "interval_matchups"
        ? weekly
        : job.operation === "interval_futures"
          ? futures
          : []
    ).map((q) => ({
      ...q,
      metadata: {
        ...q.metadata,
        reopening_review_id: review,
        generated_at: new Date().toISOString(),
      },
    }));
    await rows("select stage_line_refresh($1,1,$2)", [
      job.id,
      JSON.stringify(qs),
    ]);
  }
  assert.equal(
    (
      await rows("select status from line_refresh_cycles where id=$1", [
        cycle.id,
      ])
    )[0].status,
    "published",
  );
  assert(
    (
      await rows(
        "select reopening_id,suspension_reason from sportsbook_boards where id=any($1)",
        [[board, future]],
      )
    ).every((b) => b.reopening_id === review && b.suspension_reason === null),
  );
  await db.exec("set request.jwt.claim.role='authenticated'");
  await db.query(
    "update line_refresh_runtime set games=$2 where league_id=$1",
    [league, JSON.stringify([{ ...game, state: "in_progress" }])],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    () =>
      rows("select place_sportsbook_ticket($1,$2,$3,10,$4)", [
        board,
        rev,
        [quote, quote2],
        randomUUID(),
      ]),
    /Reopening prices or game state changed/,
  );
  await db.exec("reset role");
  await db.query(
    "update line_refresh_runtime set games=$2 where league_id=$1",
    [
      league,
      JSON.stringify([
        { ...game, starts_at: new Date(Date.now() - 10000).toISOString() },
      ]),
    ],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    () =>
      rows("select place_sportsbook_ticket($1,$2,$3,10,$4)", [
        board,
        rev,
        [quote, quote2],
        randomUUID(),
      ]),
    /Reopening prices or game state changed/,
  );
  await db.exec("reset role");
  await db.query(
    "update sportsbook_reopening_reviews set closes_at=now()-interval '1 second' where id=$1",
    [review],
  );
  await db.query(
    "update sportsbook_boards set reopening_until=now()-interval '1 second' where reopening_id=$1",
    [review],
  );
  await db.query("select sportsbook_private.maintain_reopenings($1,6)", [
    league,
  ]);
  assert(
    (
      await rows("select status from sportsbook_boards where id=any($1)", [
        [board, future],
      ])
    ).every((b) => b.status === "closed"),
  );
  await db.query("select sportsbook_private.maintain_reopenings($1,7)", [
    league,
  ]);
  const rolled = (
    await rows("select * from sportsbook_boards where id=$1", [future])
  )[0];
  assert.equal(rolled.reopening_id, null);
  assert.equal(rolled.phase, "pregame");
  assert.equal(
    (await rows("select balance from wallets where team_id=$1", [team]))[0]
      .balance,
    "90.00",
  );
  assert.deepEqual(
    (
      await rows("select * from ticket_legs where ticket_id=$1", [
        ticket.ticket_id,
      ])
    )[0],
    originalLeg,
  );
  console.log(
    "Passed review-only staging, exact-snapshot approval, atomic weekly/futures publication, explicit deduplicated announcement, eligible acceptance, active/past-kickoff refusal, deadline closure, next-week restoration, unchanged accepted terms and balance.",
  );
} finally {
  await db.close();
}
