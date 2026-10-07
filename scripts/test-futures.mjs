import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  seasonProbabilities,
  firstRoundOwner,
  bracketProbabilities,
} from "../api/_lib/futures-model.ts";
import {
  settleFuture,
  regularSeasonResults,
} from "../api/_lib/futures-settlement.ts";
import ts from "typescript";
const marketSource = fs
  .readFileSync("src/lib/markets.ts", "utf8")
  .replace('import { supabase } from "./supabase";', "const supabase = null;");
const { canPlacePicks, pickConflict } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(marketSource, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
        },
      }).outputText,
    ).toString("base64")
);

const teams = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  roster_id: i + 1,
  wins: 0,
  ties: 0,
  points: 0,
  mean: i === 0 ? 200 : 100,
  sd: 15,
}));
const schedule = [
  Array.from({ length: 6 }, (_, i) => ({ home: i * 2 + 1, away: i * 2 + 2 })),
];
const odds = seasonProbabilities(teams, schedule, 7, 5);
const sum = (key) => odds.reduce((n, p) => n + p[key], 0);
assert(Math.abs(sum("champion") - 1) < 1e-10);
assert(Math.abs(sum("last") - 1) < 1e-10);
assert(Math.abs(sum("playoffs") - 7) < 1e-10);
assert(odds[0].champion > 0.9);
assert.deepEqual(odds, seasonProbabilities(teams, schedule, 7, 5));
assert.throws(
  () => seasonProbabilities(teams, [[{ home: 1, away: 2 }]], 7),
  /incomplete/,
);
assert.equal(
  firstRoundOwner(1, 2027, [
    { season: "2026", round: 1, roster_id: 1, owner_id: 3 },
    { season: "2027", round: 1, roster_id: 1, owner_id: 4 },
  ]),
  4,
);
assert.equal(firstRoundOwner(2, 2027, []), 2);
assert.throws(
  () =>
    firstRoundOwner(1, 2027, [
      { season: "2027", round: 1, roster_id: 1, owner_id: 3 },
      { season: "2027", round: 1, roster_id: 1, owner_id: 4 },
    ]),
  /Conflicting/,
);
const bracket = [
  { m: 1, r: 1, t1: 2, t2: 3, w: 2, l: 3 },
  { m: 2, r: 2, p: 1, t1: 1, t2_from: { w: 1 } },
];
const champ = bracketProbabilities(teams, bracket, 5);
assert.equal(champ[2], 0);
assert(champ[0] > 0.99);
assert.equal(
  bracketProbabilities(teams, [{ ...bracket[1], t2: 2, w: 2, l: 1 }], 5)[1],
  1,
);
const standings = teams.map((t, i) => ({
  roster_id: t.roster_id,
  settings: { wins: 12 - i, fpts: 1800 - i * 10 },
}));
const season = regularSeasonResults(standings, 7);
assert.equal(season.last, 12);
assert.deepEqual(season.playoffRosters, [1, 2, 3, 4, 5, 6, 7]);
const tied = structuredClone(standings);
tied[11].settings = { ...tied[10].settings };
assert.equal(regularSeasonResults(tied, 7).last, null);
const leg = (kind, side, roster_id) => ({
  id: "leg",
  accepted_line: null,
  settlement_context: { kind, side, metadata: { roster_id } },
});
assert.equal(
  settleFuture(leg("future_first_pick", "team", 12), {
    ...season,
    champion: null,
  }).status,
  "WON",
);
assert.equal(
  settleFuture(leg("future_playoffs", "miss", 12), {
    ...season,
    champion: null,
  }).status,
  "WON",
);
assert.equal(
  settleFuture(leg("future_champion", "team", 1), { ...season, champion: null })
    .status,
  "OPEN",
);
assert.equal(
  settleFuture(leg("future_champion", "team", 1), { ...season, champion: 2 })
    .status,
  "LOST",
);
const future = { id: "a", kind: "future_champion", market_key: "champ" },
  weekly = { id: "b", kind: "spread", market_key: "spread" };
assert(canPlacePicks([future]));
assert(!canPlacePicks([future, weekly]));
assert.match(pickConflict([weekly], future), /standalone/);
console.log(
  "Season simulations, playoff progression, draft ownership, tied standings, and standalone selection rules passed.",
);

const db = new PGlite();
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;",
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const league = "13121261-5398-4391-8240-000000000003",
    admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const all = await rows(
      "select id,roster_id from public.teams order by roster_id",
    ),
    team = all[0].id,
    board = randomUUID();
  const roundingBoard = randomUUID();
  await db.query(
    "insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at) values($1,$2,18,2026,3,now(),now()+interval '1 day')",
    [roundingBoard, league],
  );
  for (const [kind, raw, expected] of [
    ["moneyline", 147, 150],
    ["moneyline", -147, -150],
    ["weekly_high", 237, 225],
    ["weekly_low", -237, -225],
    ["future_champion", 333, 350],
    ["future_champion", -333, -350],
  ]) {
    const id = randomUUID();
    await db.query(
      "insert into public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds) values($1::uuid,$2,$1::uuid::text,$3,'Test','Test','home',$4)",
      [id, roundingBoard, kind, raw],
    );
    assert.equal(
      Number(
        (
          await rows("select odds from public.sportsbook_markets where id=$1", [
            id,
          ])
        )[0].odds,
      ),
      expected,
    );
  }
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select public.claim_memberships();reset role;`,
  );
  await db.query("update public.wallets set balance=100 where team_id=$1", [
    team,
  ]);
  const q = (kind, side) => ({
    id: randomUUID(),
    market_key: kind,
    kind,
    label: "Team selection",
    subject: "Team",
    team_id: team,
    side,
    odds: 333,
    metadata: {
      roster_id: 1,
      last_place_basis: "regular_season",
      pick_owner_team_id: team,
    },
  });
  const quotes = [
    q("future_champion", team),
    q("future_playoffs", "make"),
    q("future_first_pick", team),
  ];
  const act = () =>
    db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await act();
  const save = async () =>
    rows("select public.save_future_board($1,$2,$3::jsonb,$4)", [
      board,
      league,
      JSON.stringify(quotes),
      "published",
    ]);
  await save();
  assert.equal(
    Number(
      (
        await rows("select odds from public.sportsbook_markets where id=$1", [
          quotes[0].id,
        ])
      )[0].odds,
    ),
    350,
  );
  const revision = async () =>
    Number(
      (
        await rows(
          "select revision from public.sportsbook_boards where id=$1",
          [board],
        )
      )[0].revision,
    );
  const req = randomUUID();
  const place = async (picks, stake, key = req, rev) =>
    (
      await rows(
        "select public.place_sportsbook_ticket($1,$2,$3,$4,$5) result",
        [board, rev ?? (await revision()), picks, stake, key],
      )
    )[0].result;
  await place([quotes[0].id], 30);
  const ticket = (
    await rows("select * from public.tickets where request_key=$1", [req])
  )[0];
  assert.equal(ticket.ticket_type, "future");
  const ticketLeg = (
    await rows("select * from public.ticket_legs where ticket_id=$1", [
      ticket.id,
    ])
  )[0];
  assert.equal(ticketLeg.market_type, "League Winner");
  assert.equal(Number(ticketLeg.accepted_odds), 350);
  const balance = async () =>
    Number(
      (
        await rows("select balance from public.wallets where team_id=$1", [
          team,
        ])
      )[0].balance,
    );
  assert.equal(await balance(), 70);
  await place([quotes[0].id], 30);
  assert.equal(await balance(), 70);
  await assert.rejects(
    () => place([quotes[0].id, quotes[1].id], 10, randomUUID()),
    /standalone/,
  );
  quotes[0].odds = 9900;
  await save();
  assert.equal(
    Number(
      (
        await rows("select accepted_odds from public.ticket_legs where id=$1", [
          ticketLeg.id,
        ])
      )[0].accepted_odds,
    ),
    350,
  );
  await assert.rejects(
    () => place([quotes[0].id], 10, randomUUID(), 1),
    /Lines have changed/,
  );
  await assert.rejects(
    () =>
      rows(
        "select public.save_market_board($1,$2,1,now(),now()+interval '1 day',$3::jsonb,'published')",
        [board, league, JSON.stringify(quotes)],
      ),
    /identity/,
  );
  await db.exec("reset role");
  await db.query("update public.wallets set balance=20 where team_id=$1", [
    team,
  ]);
  await act();
  await rows("select public.replenish_weekly_balances($1,2026,6)", [league]);
  assert.equal(await balance(), 70);
  const result = [
    {
      id: ticketLeg.id,
      status: "WON",
      actual_value: 1,
      evidence: "Confirmed season champion Team",
    },
  ];
  await rows("select public.settle_weekly_ticket($1,$2::jsonb)", [
    ticket.id,
    JSON.stringify(result),
  ]);
  assert.equal(await balance(), 205);
  await rows("select public.settle_weekly_ticket($1,$2::jsonb)", [
    ticket.id,
    JSON.stringify(result),
  ]);
  assert.equal(await balance(), 205);
  await place([quotes[1].id], 50, randomUUID());
  const openTicket = (
    await rows(
      "select id from public.tickets where team_id=$1 and status='OPEN' order by placed_at desc limit 1",
      [team],
    )
  )[0].id;
  await rows("select public.void_sportsbook_ticket($1,'Admin cancellation')", [
    openTicket,
  ]);
  assert.equal(await balance(), 205);
  await rows("select public.void_sportsbook_ticket($1,'Admin cancellation')", [
    openTicket,
  ]);
  assert.equal(await balance(), 205);
  await rows(
    "select public.resolve_future_markets($1,array['future_playoffs'])",
    [league],
  );
  await save();
  assert.equal(
    (
      await rows("select active from public.sportsbook_markets where id=$1", [
        quotes[1].id,
      ])
    )[0].active,
    false,
  );
  await assert.rejects(
    () => place([quotes[1].id], 5, randomUUID()),
    /no longer available/,
  );
  await db.exec(
    "reset role;update public.sportsbook_boards set status='closed' where board_type='weekly';",
  );
  assert.equal(
    (
      await rows("select status from public.sportsbook_boards where id=$1", [
        board,
      ])
    )[0].status,
    "published",
  );
  for (const [i, committed, cash] of [
    [1, 0, 0],
    [2, 30, 0],
    [3, 90, 0],
    [4, 100, 0],
    [5, 150, 0],
    [6, 100, 160],
  ]) {
    await db.query("update public.wallets set balance=$1 where team_id=$2", [
      cash,
      all[i].id,
    ]);
    if (committed)
      await db.query(
        "insert into public.tickets(league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout,ticket_type) values($1,$2,3,2026,5,1,now(),100,$3::numeric,$3::numeric*2,'OPEN',0,'future')",
        [league, all[i].id, committed],
      );
  }
  await act();
  await rows("select public.replenish_weekly_balances($1,2026,8)", [league]);
  for (const [i, expected] of [
    [1, 100],
    [2, 70],
    [3, 25],
    [4, 25],
    [5, 25],
    [6, 160],
  ])
    assert.equal(
      Number(
        (
          await rows("select balance from public.wallets where team_id=$1", [
            all[i].id,
          ])
        )[0].balance,
      ),
      expected,
    );
  await rows("select public.replenish_weekly_balances($1,2026,8)", [league]);
  assert.equal(
    Number(
      (
        await rows(
          "select count(*) n from public.wallet_ledger where team_id=$1 and event_key like 'weekly:replenish:2026:8:%'",
          [all[3].id],
        )
      )[0].n,
    ),
    1,
  );
  console.log(
    "Futures placement, immutable accepted odds, refunds, settlement, cutoff isolation, closed outcomes, and all cash-floor cases passed.",
  );
} finally {
  await db.close();
}
