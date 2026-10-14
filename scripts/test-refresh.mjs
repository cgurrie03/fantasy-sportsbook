import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  fetchGameStatus,
  normalizeGameStatus,
  parseScoreboard,
  scoreboardWindow,
} from "../api/_lib/game-status.ts";
for (const name of [
  "STATUS_IN_PROGRESS",
  "STATUS_HALFTIME",
  "STATUS_END_PERIOD",
])
  assert.equal(normalizeGameStatus(name), "in_progress");
for (const [name, state] of [
  ["STATUS_FINAL", "final"],
  ["STATUS_FINAL_OVERTIME", "final"],
  ["STATUS_SCHEDULED", "scheduled"],
  ["STATUS_DELAYED", "delayed"],
  ["STATUS_SUSPENDED", "suspended"],
  ["STATUS_POSTPONED", "postponed"],
  ["STATUS_CANCELED", "cancelled"],
  ["UNRECOGNIZED", "unknown"],
])
  assert.equal(normalizeGameStatus(name), state);
const feed = (names) => ({
  leagues: [{ slug: "nfl" }],
  events: names.map((name, i) => ({
    id: String(i),
    date: "2026-10-08T23:00:00Z",
    status: { type: { name } },
  })),
});
assert.equal(
  parseScoreboard(feed(["STATUS_FINAL", "STATUS_IN_PROGRESS"])).any_in_progress,
  true,
);
assert.equal(
  parseScoreboard(feed(["STATUS_FINAL", "STATUS_DELAYED"])).any_in_progress,
  false,
);
assert.equal(parseScoreboard(feed(["STATUS_SUSPENDED"])).reason !== null, true);
assert.throws(() => parseScoreboard({ events: [] }));
assert.equal(
  scoreboardWindow(new Date("2026-11-02T04:30:00Z")),
  "20261027-20261102",
);
assert.equal(
  scoreboardWindow(new Date("2026-11-03T13:00:00Z")),
  "20261103-20261109",
);
const db = new PGlite();
const originalFetch = globalThis.fetch;
try {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(
      JSON.stringify(feed(["STATUS_IN_PROGRESS", "STATUS_SCHEDULED"])),
      { headers: { "content-type": "application/json" } },
    );
  };
  const observed = await fetchGameStatus(new Date("2026-10-09T01:00:00Z"));
  assert.equal(requests.length, 3);
  assert(requests.some((url) => url.endsWith("?dates=20261008")));
  assert(requests.some((url) => url.endsWith("?dates=20261007")));
  assert.equal(observed.games.length, 2); // duplicate game IDs are coalesced
  assert.equal(observed.any_in_progress, true);
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  await assert.rejects(() => fetchGameStatus(), /503/);
} finally {
  globalThis.fetch = originalFetch;
}
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const league = "13121261-5398-4391-8240-000000000003",
  admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;",
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  // This scenario uses Week 5 boards/jobs. Keep its isolated league in Week 5
  // regardless of the runner's calendar; test calendar rollover separately.
  await db.query(
    "update leagues set active_week=5,week_anchor=now() where id=$1",
    [league],
  );
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select public.claim_memberships();reset role;`,
  );
  const team = (await rows("select id from teams where roster_id=1"))[0].id;
  await db.query("update wallets set balance=100 where team_id=$1", [team]);
  const board = randomUUID(),
    quoteId = randomUUID();
  const quotes = (odds) => [
    {
      id: quoteId,
      market_key: "weekly:test",
      kind: "weekly_any_200",
      label: "Any 200?",
      subject: "League",
      side: "yes",
      odds,
      boost_pct: 0,
      metadata: { expected_team_count: 12 },
    },
  ];
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await rows(
    "select save_market_board($1,$2,5,now()-interval '1 hour',now()+interval '1 day',$3,'published')",
    [board, league, JSON.stringify(quotes(200))],
  );
  const unchangedLocation = (await rows("select ctid::text as location from sportsbook_markets where id=$1", [quoteId]))[0].location;
  await rows(
    "select save_market_board($1,$2,5,now()-interval '1 hour',now()+interval '1 day',$3,'published')",
    [board, league, JSON.stringify(quotes(200))],
  );
  assert.equal((await rows("select ctid::text as location from sportsbook_markets where id=$1", [quoteId]))[0].location, unchangedLocation, "An unchanged carried-forward quote must not be rewritten");
  const rev = async () =>
    Number(
      (
        await rows("select revision from sportsbook_boards where id=$1", [
          board,
        ])
      )[0].revision,
    );
  const request = randomUUID(),
    originalRev = await rev();
  const accept = async (revision, id = request) =>
    (
      await rows("select place_sportsbook_ticket($1,$2,$3,10,$4) as result", [
        board,
        revision,
        [quoteId],
        id,
      ])
    )[0].result;
  const ticket = await accept(originalRev);
  const legsBefore = await rows(
    "select * from ticket_legs where ticket_id=$1",
    [ticket.ticket_id],
  );
  await db.exec("reset role");
  await db.query(
    "update weekly_schedule set automation_enabled=true where league_id=$1",
    [league],
  );
  await db.exec("set request.jwt.claim.role='service_role';");
  await rows("select observe_line_refresh($1)", [
    JSON.stringify(parseScoreboard(feed(["STATUS_SCHEDULED"]))),
  ]);
  assert.equal(
    (await rows("select interval_minutes from line_refresh_runtime"))[0]
      .interval_minutes,
    120,
  );
  let cycle = (
    await rows(
      "select * from line_refresh_cycles order by created_at desc limit 1",
    )
  )[0];
  const jobs = await rows(
    "select * from automation_jobs where refresh_cycle_id=$1 order by operation",
    [cycle.id],
  );
  assert.equal(jobs.length, 4);
  await rows(
    "insert into line_refresh_sources(cycle_id,path,payload) values($1,$2,$3)",
    [cycle.id, "public:test-feed", "{}"],
  );
  await rows("select observe_line_refresh($1)", [
    JSON.stringify(parseScoreboard(feed(["STATUS_SCHEDULED"]))),
  ]);
  assert.equal(
    (await rows("select count(*) as n from line_refresh_cycles"))[0].n,
    1,
  );
  // Three stages alone are invisible. Fourth stage swaps the complete set.
  for (const [i, j] of jobs.entries()) {
    await db.query(
      "update automation_jobs set status='running',attempts=1,lease_until=now()+interval '5 minutes' where id=$1",
      [j.id],
    );
    await rows("select stage_line_refresh($1,1,$2)", [
      j.id,
      JSON.stringify(j.operation === "interval_specials" ? quotes(300) : []),
    ]);
    if (i < 3) assert.equal(await rev(), originalRev);
  }
  assert.equal(await rev(), originalRev + 1);
  assert.equal(
    (await rows("select count(*) as n from line_refresh_sources"))[0].n,
    0,
  );
  assert.deepEqual(
    await rows("select * from ticket_legs where ticket_id=$1", [
      ticket.ticket_id,
    ]),
    legsBefore,
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    () => accept(originalRev, randomUUID()),
    /Lines have changed/,
  );
  const balanceBefore = (
    await rows("select balance from wallets where team_id=$1", [team])
  )[0].balance;
  assert.equal((await accept(originalRev)).duplicate, true);
  assert.equal(
    (await rows("select balance from wallets where team_id=$1", [team]))[0]
      .balance,
    balanceBefore,
  );
  const newTicket = await accept(await rev(), randomUUID());
  assert.equal(
    (
      await rows("select accepted_odds from ticket_legs where ticket_id=$1", [
        newTicket.ticket_id,
      ])
    )[0].accepted_odds,
    300,
  );
  await db.exec("reset role");
  await assert.rejects(
    () =>
      rows("update ticket_legs set accepted_odds=999 where ticket_id=$1", [
        ticket.ticket_id,
      ]),
    /immutable/,
  );
  await assert.rejects(
    () => rows("update tickets set stake=99 where id=$1", [ticket.ticket_id]),
    /immutable/,
  );
  // A publication race with an admin save must discard the staged cycle.
  const runCycle = async (action) => {
    const cid = randomUUID();
    await rows(
      "insert into line_refresh_cycles(id,league_id,market_week,slot,weekly_board,weekly_revision) values($1,$2,5,$3,$4,$5)",
      [cid, league, Date.now(), board, await rev()],
    );
    const ids = [];
    for (const family of ["matchups", "players", "specials", "futures"]) {
      const jid = randomUUID();
      ids.push([jid, family]);
      await rows(
        "insert into automation_jobs(id,league_id,event_key,operation,market_week,refresh_cycle_id,status,attempts,lease_until) values($1::uuid,$2,$1::text,$3,5,$4,'running',1,now()+interval '5 minutes')",
        [jid, league, "interval_" + family, cid],
      );
    }
    for (const [jid, family] of ids.slice(0, 3))
      await rows("select stage_line_refresh($1,1,$2)", [
        jid,
        JSON.stringify(family === "specials" ? quotes(400) : []),
      ]);
    await action();
    return (
      await rows("select stage_line_refresh($1,1,$2) result", [ids[3][0], "[]"])
    )[0].result;
  };
  let cycleResult = await runCycle(async () => {
    await rows("update sportsbook_boards set revision=revision+1 where id=$1", [
      board,
    ]);
  });
  assert.equal(cycleResult.superseded, true);
  const raceRev = await rev();
  await rows(
    "update line_refresh_runtime set last_error=null,week_started=false,observed_at=now()",
  );
  cycleResult = await runCycle(async () => {
    await rows("update weekly_schedule set publication_paused=true");
  });
  assert.match(cycleResult.suspension_reason, /paused/);
  assert.equal(await rev(), raceRev);
  assert.equal(
    (await rows("select status from sportsbook_boards where id=$1", [board]))[0]
      .status,
    "published",
  );
  await rows("update weekly_schedule set publication_paused=false");
  await rows(
    "update line_refresh_runtime set last_error=null,week_started=false,observed_at=now()",
  );
  await runCycle(async () => {
    await rows("update sportsbook_boards set status='closed' where id=$1", [
      board,
    ]);
  });
  assert.equal(
    (await rows("select status from sportsbook_boards where id=$1", [board]))[0]
      .status,
    "closed",
  );
  await rows(
    "update sportsbook_boards set status='published',suspension_reason=null,quote_valid_until=now()-interval '1 second' where id=$1",
    [board],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    async () => accept(await rev(), randomUUID()),
    /expired/,
  );
  await db.exec("reset role");
  await rows(
    "update sportsbook_boards set quote_valid_until=now()+interval '1 hour' where id=$1",
    [board],
  );
  await rows(
    "update line_refresh_runtime set observed_at=now()-interval '4 minutes'",
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    async () => accept(await rev(), randomUUID()),
    /game state/,
  );
  await db.exec("reset role");
  await rows("update line_refresh_runtime set observed_at=now()");
  // Known outcome fails on the server even with a matching board revision.
  await rows(
    "update sportsbook_markets set market_state='settled' where id=$1",
    [quoteId],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    async () => accept(await rev(), randomUUID()),
    /suspended or resolved/,
  );
  await db.exec("reset role");
  await rows("update sportsbook_markets set market_state='open' where id=$1", [
    quoteId,
  ]);
  await rows("select observe_line_refresh($1)", [
    JSON.stringify(
      parseScoreboard(feed(["STATUS_IN_PROGRESS", "STATUS_SCHEDULED"])),
    ),
  ]);
  assert.equal(
    (await rows("select interval_minutes from line_refresh_runtime"))[0]
      .interval_minutes,
    15,
  );
  assert.equal(
    (await rows("select live_families from line_refresh_runtime"))[0]
      .live_families.players,
    false,
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(
    async () => accept(await rev(), randomUUID()),
    /Live acceptance|suspended|game state/,
  );
  // Settlement still pays accepted odds after publication/suspension.
  const leg = legsBefore[0];
  await rows("select settle_weekly_ticket($1,$2)", [
    ticket.ticket_id,
    JSON.stringify([
      {
        id: leg.id,
        status: "WON",
        actual_value: 210,
        evidence: "Verified final result",
      },
    ]),
  ]);
  assert.equal(
    Number(
      (
        await rows("select actual_payout from tickets where id=$1", [
          ticket.ticket_id,
        ])
      )[0].actual_payout,
    ),
    30,
  );
  await db.exec("reset role");
  await rows("select observe_line_refresh($1)", [
    JSON.stringify(
      parseScoreboard(feed(["STATUS_FINAL", "STATUS_FINAL_OVERTIME"])),
    ),
  ]);
  assert.equal(
    (await rows("select interval_minutes from line_refresh_runtime"))[0]
      .interval_minutes,
    120,
  );
  await rows("select observe_line_refresh($1,$2)", [{}, "Provider outage"]);
  assert.equal(
    (await rows("select last_error from line_refresh_runtime"))[0].last_error,
    "Provider outage",
  );
  // Lost lease is unable to publish or overwrite a subsequent claimant.
  await db.query("update automation_jobs set attempts=2 where id=$1", [
    jobs[0].id,
  ]);
  await assert.rejects(
    () => rows("select stage_line_refresh($1,1,$2)", [jobs[0].id, "[]"]),
    /lease lost/,
  );
  await db.exec(
    `set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${admin}';`,
  );
  await assert.rejects(
    () => rows("select observe_line_refresh($1)", [{}]),
    /permission denied|Server worker/,
  );
  // A new week without a generated board must leave historical tickets,
  // balances and authorized snapshots readable. It is an empty new slate,
  // not an account-wide failure.
  const savedTicket = (await rows("select * from tickets where id=$1", [ticket.ticket_id]))[0];
  const savedWallets = await rows("select * from wallets order by team_id");
  await db.exec("reset role");
  await db.query("update leagues set active_week=6,week_anchor=now() where id=$1", [league]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  assert.equal((await rows("select week from sportsbook_period($1)", [league]))[0].week, 6);
  assert.equal((await rows("select id from sportsbook_boards where league_id=$1 and market_week=6", [league])).length, 0);
  assert.equal((await rows("select sportsbook_quote_snapshot($1) as snapshot", [randomUUID()]))[0].snapshot, null);
  assert.equal((await rows("select sportsbook_quote_snapshot($1) as snapshot", [board]))[0].snapshot.board.id, board);
  assert.deepEqual((await rows("select * from tickets where id=$1", [ticket.ticket_id]))[0], savedTicket);
  assert.deepEqual(await rows("select * from wallets order by team_id"), savedWallets);
  console.log(
    "Passed kickoff/overlap/gaps/halftime/overtime/final/delay/suspension/cancellation/DST, interval coalescing, atomic four-stage publication, stale revision approval, request retry/debit once, immutable terms, resolved outcome refusal, feed outage, lease fencing and accepted-odds settlement. Live acceptance stays disabled.",
  );
} finally {
  await db.close();
}
