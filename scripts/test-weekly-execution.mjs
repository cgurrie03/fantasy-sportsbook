import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { settleLeg } from "../api/_lib/settlement.ts";
const final = {
  final: true,
  teams: {
    a: { name: "A", points: 110 },
    b: { name: "B", points: 100 },
    c: { name: "C", points: 80 },
  },
  players: {
    p: { played: true, points: 20 },
    dnp: { played: false, points: 0 },
  },
};
const leg = (kind, side = "over", line = 20, metadata = {}) => ({
  id: "leg",
  accepted_line: line,
  settlement_context: {
    kind,
    side,
    team_id: "a",
    home_team_id: "a",
    away_team_id: "b",
    metadata,
  },
});
assert.equal(settleLeg(leg("spread", "a", -10), final).status, "PUSH");
assert.equal(settleLeg(leg("moneyline", "a", null), final).status, "WON");
assert.equal(
  settleLeg(leg("match_total", "under", 209.5), final).status,
  "LOST",
);
assert.equal(
  settleLeg(leg("player_points", "under", 5, { player_id: "dnp" }), final)
    .status,
  "PUSH",
);
assert.equal(
  settleLeg(leg("player_points", "under", 5, { player_id: "missing" }), final)
    .status,
  "OPEN",
);
assert.equal(
  settleLeg(leg("player_points", "over", 5, { player_id: "invalid" }), {
    ...final,
    players: { invalid: { played: true, points: NaN } },
  }).status,
  "OPEN",
);
assert.equal(settleLeg(leg("weekly_high"), final).status, "WON");
assert.equal(
  settleLeg(leg("weekly_high"), {
    ...final,
    teams: { ...final.teams, b: { name: "B", points: 110 } },
  }).status,
  "PUSH",
);
assert.equal(
  settleLeg(leg("moneyline"), { ...final, final: false }).status,
  "OPEN",
);

const db = new PGlite();
const thresholdResults = {
  final: true,
  teams: {
    a: { name: "A", points: 150 },
    b: { name: "B", points: 200 },
    c: { name: "C", points: 100 },
  },
  players: {},
};
const special = (kind, side, line) =>
  leg(kind, side, line, { expected_team_count: 3 });
assert.equal(
  settleLeg(special("weekly_count_150", "2", 2), thresholdResults).status,
  "WON",
);
assert.equal(
  settleLeg(special("weekly_count_150", "1", 1), thresholdResults).status,
  "LOST",
);
assert.equal(
  settleLeg(special("weekly_any_below_100", "yes", 100), thresholdResults)
    .status,
  "LOST",
);
assert.equal(
  settleLeg(special("weekly_any_below_100", "no", 100), thresholdResults)
    .status,
  "WON",
);
assert.equal(
  settleLeg(special("weekly_any_200", "yes", 200), thresholdResults).status,
  "WON",
);
assert.equal(
  settleLeg(special("weekly_count_150", "2", 2), {
    ...thresholdResults,
    teams: { a: thresholdResults.teams.a },
  }).status,
  "OPEN",
);
try {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;",
  );
  await db.exec(
    "create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$; grant execute on function auth.role() to anon,authenticated,service_role;",
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const league = "13121261-5398-4391-8240-000000000003",
    admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const team = (await rows("select id from public.teams where roster_id=1"))[0]
    .id;
  const specialBoard = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await db.query(
    "insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at) values($1,$2,17,2026,3,now(),now()+interval '1 day')",
    [specialBoard, league],
  );
  for (const [i, kind] of [
    "weekly_count_150",
    "weekly_any_below_100",
    "weekly_any_200",
  ].entries()) {
    const id = `99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`;
    await db.query(
      "insert into public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds) values($1,$2,$3,$3,'Selection','Special','yes',237)",
      [id, specialBoard, kind],
    );
    assert.equal(
      Number(
        (
          await rows("select odds from public.sportsbook_markets where id=$1", [
            id,
          ])
        )[0].odds,
      ),
      240,
    );
  }
  const ticket = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    l1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    l2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select public.claim_memberships();reset role;`,
  );
  await db.query(
    "insert into public.tickets(id,league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout) values($1,$2,$3,3,2026,5,5,now(),500,10,60,'OPEN',0)",
    [ticket, league, team],
  );
  await db.query(
    "insert into public.ticket_legs(id,ticket_id,leg_number,selection,market_type,accepted_odds,accepted_decimal_odds,status,result_evidence) values($1,$3,1,'A','Spread',100,2,'OPEN','test'),($2,$3,2,'B','Team Total',200,3,'OPEN','test')",
    [l1, l2, ticket],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  const results = [
    { id: l1, status: "WON", actual_value: 10, evidence: "final score" },
    { id: l2, status: "PUSH", actual_value: 100, evidence: "tied line" },
  ];
  const before = Number(
    (
      await rows("select balance from public.wallets where team_id=$1", [team])
    )[0].balance,
  );
  const settle = () =>
    rows("select public.settle_weekly_ticket($1,$2::jsonb) result", [
      ticket,
      JSON.stringify(results),
    ]);
  assert.equal((await settle())[0].result.payout, 20);
  assert.equal((await settle())[0].result.duplicate, true);
  assert.equal(
    Number(
      (
        await rows("select balance from public.wallets where team_id=$1", [
          team,
        ])
      )[0].balance,
    ),
    before + 20,
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int n from public.wallet_ledger where event_key=$1",
        [`ticket:settle:${ticket}`],
      )
    )[0].n,
    1,
  );
  const replenish = () =>
    rows("select public.replenish_weekly_balances($1,2026,6) result", [league]);
  await replenish();
  const balance = Number(
    (
      await rows("select balance from public.wallets where team_id=$1", [team])
    )[0].balance,
  );
  assert.equal(balance, before + 20);
  assert.equal((await replenish())[0].result.already_processed, 12);
  await db.exec("reset role;");
  const blockedTeam = (
    await rows("select id from public.teams where roster_id=2")
  )[0].id;
  await db.query("update public.wallets set balance=20 where team_id=$1", [
    blockedTeam,
  ]);
  await db.query(
    "insert into public.tickets(league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout) values($1,$2,3,2026,6,6,now(),100,10,20,'OPEN',0)",
    [league, blockedTeam],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  const blocked = await rows(
    "select public.replenish_weekly_balances($1,2026,7) result",
    [league],
  );
  assert.equal(blocked[0].result.blocked, 1);
  assert.equal(
    Number(
      (
        await rows("select balance from public.wallets where team_id=$1", [
          blockedTeam,
        ])
      )[0].balance,
    ),
    20,
  );
  await db.exec("reset role;");
  for (const outcome of ["PUSH", "LOST"]) {
    const id = (
      await rows(
        "insert into public.tickets(league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout) values($1,$2,3,2026,5,5,now(),100,10,20,'OPEN',0) returning id",
        [league, team],
      )
    )[0].id;
    const idLeg = (
      await rows(
        "insert into public.ticket_legs(ticket_id,leg_number,selection,market_type,accepted_odds,accepted_decimal_odds,status,result_evidence) values($1,1,'A','Spread',100,2,'OPEN','test') returning id",
        [id],
      )
    )[0].id;
    await db.exec(
      `set role authenticated;set request.jwt.claim.sub='${admin}';`,
    );
    const paid = (
      await rows("select public.settle_weekly_ticket($1,$2::jsonb) result", [
        id,
        JSON.stringify([
          {
            id: idLeg,
            status: outcome,
            actual_value: 0,
            evidence: "confirmed result",
          },
        ]),
      ])
    )[0].result;
    assert.equal(paid.payout, outcome === "PUSH" ? 10 : 0);
    assert.equal(paid.status, outcome);
    await db.exec("reset role;");
  }
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  const times = {
    settlement: "00:30",
    recheck: "07:00",
    replenishment: "08:00",
    generation: "08:30",
    refresh: "07:30",
    cutoff: "20:00",
  };
  const saveTimes = (values) =>
    rows(
      "select public.configure_weekly_schedule_v2($1,false,true,true,true,'08:00','19:00','08:15',$2::jsonb)",
      [league, JSON.stringify(values)],
    );
  await saveTimes(times);
  assert.deepEqual(
    (
      await rows(
        "select job_times from public.weekly_schedule where league_id=$1",
        [league],
      )
    )[0].job_times,
    times,
  );
  await assert.rejects(() => saveTimes({ ...times, settlement: "25:00" }));
  assert.equal(
    (
      await rows(
        "select automation_enabled from public.weekly_schedule where league_id=$1",
        [league],
      )
    )[0].automation_enabled,
    false,
  );
  await assert.rejects(() =>
    rows("select public.replenish_weekly_balances($1,2025,6)", [league]),
  );

  await db.exec("reset role;");
  const voidId = (
    await rows(
      "insert into public.tickets(league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout) values($1,$2,3,2026,5,5,now(),100,10,20,'OPEN',0) returning id",
      [league, team],
    )
  )[0].id;
  await rows(
    "insert into public.ticket_legs(ticket_id,leg_number,selection,market_type,accepted_odds,status,result_evidence) values($1,1,'A','Spread',100,'OPEN','test')",
    [voidId],
  );
  const voidBefore = Number(
    (
      await rows("select balance from public.wallets where team_id=$1", [team])
    )[0].balance,
  );
  await db.exec(
    "set role authenticated;set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';",
  );
  await assert.rejects(
    () => rows("select public.void_sportsbook_ticket($1,'test')", [voidId]),
    /Only the league admin/,
  );
  await db.exec(`set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    () => rows("select public.void_sportsbook_ticket($1,'')", [voidId]),
    /reason/,
  );
  const voidIt = () =>
    rows(
      "select public.void_sportsbook_ticket($1,'Admin cancellation') result",
      [voidId],
    );
  assert.equal((await voidIt())[0].result.refund, 10);
  assert.equal((await voidIt())[0].result.duplicate, true);
  assert.equal(
    Number(
      (
        await rows("select balance from public.wallets where team_id=$1", [
          team,
        ])
      )[0].balance,
    ),
    voidBefore + 10,
  );
  assert.equal(
    (
      await rows("select status,net_profit from public.tickets where id=$1", [
        voidId,
      ])
    )[0].status,
    "VOIDED",
  );
  assert.equal(
    Number(
      (
        await rows("select net_profit from public.tickets where id=$1", [
          voidId,
        ])
      )[0].net_profit,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await rows(
          "select count(*) n from public.wallet_ledger where ticket_id=$1 and kind='void_refund'",
          [voidId],
        )
      )[0].n,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await rows(
          "select count(*) n from public.ticket_legs where ticket_id=$1 and status='VOIDED'",
          [voidId],
        )
      )[0].n,
    ),
    1,
  );
  await assert.rejects(
    () => rows("select public.void_sportsbook_ticket($1,'test')", [ticket]),
    /Only open/,
  );
  await db.exec("reset role;");
  const lockBoard = (
    await rows(
      "insert into public.sportsbook_boards(league_id,market_week,nfl_season,league_season,opens_at,closes_at) values($1,18,2026,3,now(),now()+interval '1 day') returning id",
      [league],
    )
  )[0].id;
  const quoteId = "99999999-9999-4999-8999-999999999999";
  await rows(
    "insert into public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,metadata) values($1,$2,'locked','moneyline','A','A','home',100,'{\"lineup_locked\":true}')",
    [quoteId, lockBoard],
  );
  await assert.rejects(
    () =>
      rows(
        "insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,accepted_odds,status,result_evidence) values($1,2,$2,'A','Moneyline',100,'OPEN','test')",
        [voidId, quoteId],
      ),
    /market is locked/,
  );
  await db.exec("reset role;set role anon;");
  await assert.rejects(settle);
  await assert.rejects(() =>
    rows("select * from public.claim_automation_job()"),
  );
  await db.exec(
    "reset role; update public.weekly_schedule set automation_enabled=true;",
  );
  await rows(
    "insert into public.automation_jobs(league_id,event_key,operation,market_week) values($1,'test-worker','settlement',5)",
    [league],
  );
  await rows(
    "insert into public.email_deliveries(ticket_id,recipient) values($1,'test@example.invalid')",
    [voidId],
  );
  await db.exec(
    "set role service_role;set request.jwt.claim.role='service_role';",
  );
  const claimedJob = await rows("select * from public.claim_automation_job()");
  assert.equal(claimedJob.length, 1);
  const claimedMail = await rows(
    "select * from public.claim_outbound_emails()",
  );
  assert.equal(claimedMail.length, 1);
  assert.equal(
    (await rows("select * from public.claim_outbound_emails()")).length,
    0,
  );
  await rows(
    "update public.outbound_emails set first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 hour' where id=$1",
    [claimedMail[0].id],
  );
  assert.equal(
    (await rows("select * from public.claim_outbound_emails()")).length,
    0,
  );
  assert.equal(
    (
      await rows("select status from public.outbound_emails where id=$1", [
        claimedMail[0].id,
      ])
    )[0].status,
    "needs_review",
  );
  console.log(
    "Passed worker role isolation, atomic confirmation queueing, leased job/email claims, and expired-idempotency hold.",
  );
  console.log(
    "Passed actual-score settlement, inactive pushes, pending results, accepted odds, duplicate payment/reset protection, higher-balance retention, and unauthorized execution rejection.",
  );
} finally {
  await db.close();
}
