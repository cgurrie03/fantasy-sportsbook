import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  seasonProbabilities,
  firstRoundOwner,
  bracketProbabilities,
  seasonStrength,
} from "../api/_lib/futures-model.ts";
const strength = seasonStrength([120, 160, 100, 180], [140, 90, 170], 900);
assert(strength.weekly_means[1] < strength.weekly_means[0]);
assert(strength.mean_uncertainty > 0);
assert(strength.sd >= 20);
assert.throws(() => seasonStrength([NaN], [120], 900), /incomplete/);
import {
  settleFuture,
  regularSeasonResults,
} from "../api/_lib/futures-settlement.ts";
import ts from "typescript";
const eventSource = ts.transpileModule(
  fs.readFileSync("api/_lib/event-time.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  },
).outputText;
const eventUrl =
  "data:text/javascript;base64," + Buffer.from(eventSource).toString("base64");
const marketSource = fs
  .readFileSync("src/lib/markets.ts", "utf8")
  .replace('import { supabase } from "./supabase";', "const supabase = null;")
  .replace('"../../api/_lib/event-time"', JSON.stringify(eventUrl));
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
for (const p of odds) {
  assert.equal(p.win_line % 1, 0.5);
  assert(
    Math.abs(Object.values(p.win_distribution).reduce((a, b) => a + b, 0) - 1) <
      1e-10,
  );
}
const winLeg = {
  id: "wins",
  accepted_line: 6.5,
  settlement_context: {
    kind: "future_win_total",
    side: "over",
    metadata: { roster_id: 1 },
  },
};
assert.equal(
  settleFuture(winLeg, {
    champion: null,
    last: null,
    playoffRosters: null,
    regularWins: { 1: 7 },
  }).status,
  "WON",
);
assert.equal(
  settleFuture(winLeg, {
    champion: null,
    last: null,
    playoffRosters: null,
    regularWins: { 1: 6 },
  }).status,
  "LOST",
);
assert.equal(
  settleFuture(winLeg, { champion: null, last: null, playoffRosters: null })
    .status,
  "OPEN",
);
assert.equal(
  settleFuture(
    { ...winLeg, accepted_line: 6 },
    { champion: null, last: null, playoffRosters: null, regularWins: { 1: 6 } },
  ).status,
  "OPEN",
);
assert(canPlacePicks([{ kind: "future_win_total" }]));
assert(
  canPlacePicks([{ kind: "future_win_total" }, { kind: "future_win_total" }]),
);

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
const playoff = { id: "p", kind: "future_playoffs", market_key: "playoff:1" };
const otherPlayoff = { ...playoff, id: "p2", market_key: "playoff:2" };
assert(canPlacePicks([playoff, otherPlayoff]));
assert.equal(canPlacePicks([playoff]), false);
assert.equal(pickConflict([playoff], otherPlayoff), "");
assert.match(pickConflict([playoff], future), /standalone/);
assert.match(
  pickConflict([playoff], { ...playoff, id: "miss" }),
  /one outcome/,
);
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
    ["future_champion", 99900, 10000],
    ["future_champion", -99900, -10000],
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
  await assert.rejects(
    () => place([quotes[1].id], 10, randomUUID()),
    /at least two playoff picks/,
  );
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
  await place([quotes[2].id], 50, randomUUID());
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
  const otherPlayoffQuote = {
    ...q("future_playoffs", "miss"),
    market_key: "playoff:other",
    team_id: all[1].id,
    metadata: { roster_id: 2 },
  };
  const contradictoryQuote = { ...q("future_playoffs", "miss") };
  quotes.push(otherPlayoffQuote, contradictoryQuote);
  await save();
  await assert.rejects(
    () => place([quotes[1].id, contradictoryQuote.id], 1, randomUUID()),
    /one outcome/,
  );
  const parlayKey = randomUUID();
  await place([quotes[1].id, otherPlayoffQuote.id], 1, parlayKey);
  const playoffTicket = (
    await rows(
      "select id,ticket_type from public.tickets where request_key=$1",
      [parlayKey],
    )
  )[0];
  assert.equal(playoffTicket.ticket_type, "future");
  assert.equal(
    (
      await rows("select * from public.ticket_legs where ticket_id=$1", [
        playoffTicket.id,
      ])
    ).length,
    2,
  );
  await rows("select public.void_sportsbook_ticket($1,'Regression cleanup')", [
    playoffTicket.id,
  ]);
  console.log(
    "Playoff-only parlays accepted; opposite outcomes and mixed futures rejected.",
  );
  const winQuote = {
    ...q("future_win_total", "over"),
    market_key: "wins:team",
    line: 6.5,
    metadata: { roster_id: 1 },
  };
  const otherWin = {
    ...q("future_win_total", "under"),
    market_key: "wins:other",
    line: 7.5,
    team_id: all[1].id,
    metadata: { roster_id: 2 },
  };
  const oppositeWin = { ...winQuote, id: randomUUID(), side: "under" };
  quotes.push(winQuote, otherWin, oppositeWin);
  await save();
  assert.equal(
    Number(
      (
        await rows("select line from public.sportsbook_markets where id=$1", [
          winQuote.id,
        ])
      )[0].line,
    ),
    6.5,
  );
  const singleWin = await place([winQuote.id], 1, randomUUID());
  assert(singleWin);
  await place([winQuote.id, otherWin.id], 1, randomUUID());
  await assert.rejects(
    () => place([winQuote.id, oppositeWin.id], 1, randomUUID()),
    /one outcome/,
  );
  await assert.rejects(
    () => place([winQuote.id, quotes[1].id], 1, randomUUID()),
    /remain separate/,
  );
  const snapshot = (
    await rows(
      "select * from public.forecast_snapshots where board_id=$1 order by revision limit 1",
      [board],
    )
  )[0];
  assert.equal(
    snapshot.quotes[0].odds === 350 ||
      snapshot.quotes.some((q) => q.odds === 350),
    true,
  );
  const oldJson = JSON.stringify(snapshot.quotes);
  winQuote.line = 8.5;
  await save();
  assert.equal(
    JSON.stringify(
      (
        await rows("select quotes from public.forecast_snapshots where id=$1", [
          snapshot.id,
        ])
      )[0].quotes,
    ),
    oldJson,
  );
  assert.equal(
    Number(
      (
        await rows("select line from public.sportsbook_markets where id=$1", [
          winQuote.id,
        ])
      )[0].line,
    ),
    8.5,
  );
  await assert.rejects(
    () =>
      rows("update public.forecast_snapshots set quotes='[]' where id=$1", [
        snapshot.id,
      ]),
    /permission/,
  );
  await rows(
    "select public.save_league_identity($1,'Updated League','','Settings regression test')",
    [league],
  );
  assert.equal(
    (
      await rows("select * from public.admin_change_log where league_id=$1", [
        league,
      ])
    ).length,
    1,
  );
  await rows("select public.save_report_results($1,2026,1,true,$2::jsonb)", [
    league,
    JSON.stringify({ [team]: { points: 120 } }),
  ]);
  assert.equal(
    (
      await rows(
        "select * from public.league_result_weeks where league_id=$1",
        [league],
      )
    ).length,
    1,
  );
  winQuote.line = 8;
  await assert.rejects(save, /win_total_half_line/);
  winQuote.line = 8.5;
  console.log(
    "Win-total singles and homogeneous parlays, half-line validation, immutable forecast snapshots, and audited settings passed.",
  );
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
    () => place([quotes[1].id, otherPlayoffQuote.id], 5, randomUUID()),
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
  // A player falls out of the top 12 and later returns with a fresh generated ID.
  // Saving must revive the original quote rather than insert a duplicate.
  const weeklyBoard = randomUUID();
  const playerQuote = {
    id: randomUUID(),
    market_key: "week-9:player-points:123",
    kind: "player_points",
    label: "Player Over 20.5",
    subject: "Player",
    side: "over",
    line: 20.5,
    odds: -110,
    team_id: team,
    metadata: { player_id: "123" },
  };
  const saveWeekly = async (quotes) =>
    rows(
      "select public.save_market_board($1,$2,9,now(),now()+interval '1 day',$3::jsonb,'draft')",
      [weeklyBoard, league, JSON.stringify(quotes)],
    );
  await saveWeekly([playerQuote]);
  await saveWeekly([]);
  await saveWeekly([{ ...playerQuote, id: randomUUID(), line: 22.5 }]);
  await saveWeekly([{ ...playerQuote, id: randomUUID(), line: 23.5 }]);
  const revived = await rows(
    "select id,line,active from public.sportsbook_markets where board_id=$1",
    [weeklyBoard],
  );
  assert.equal(revived.length, 1);
  assert.equal(revived[0].id, playerQuote.id);
  assert.equal(Number(revived[0].line), 23.5);
  assert.equal(revived[0].active, true);
  const newSpecials = [
    "weekly_count_projection",
    "weekly_average",
    "weekly_highest_score",
  ].map((kind, i) => ({
    id: randomUUID(),
    market_key: kind,
    kind,
    label: kind,
    subject: kind,
    side: i ? "over" : "6",
    line: i ? 150.5 : 6,
    odds: 225,
    metadata: {
      expected_team_count: 12,
      projection_targets: Object.fromEntries(all.map((t) => [t.id, 150])),
    },
  }));
  newSpecials.push({
    ...newSpecials[0],
    id: randomUUID(),
    side: "6+",
    label: "At Least 6 Teams Beating Projection",
    odds: -125,
  });
  await rows(
    "select public.save_market_board($1,$2,9,now(),now()+interval '1 day',$3::jsonb,'published')",
    [weeklyBoard, league, JSON.stringify(newSpecials)],
  );
  const weeklyRevision = (
    await rows("select revision from public.sportsbook_boards where id=$1", [
      weeklyBoard,
    ])
  )[0].revision;
  await assert.rejects(() =>
    rows("select public.place_sportsbook_ticket($1,$2,$3,1,$4)", [
      weeklyBoard,
      weeklyRevision,
      [newSpecials[0].id, newSpecials[3].id],
      randomUUID(),
    ]),
  );
  for (const quote of newSpecials)
    await rows("select public.place_sportsbook_ticket($1,$2,$3,1,$4)", [
      weeklyBoard,
      weeklyRevision,
      [quote.id],
      randomUUID(),
    ]);
  const types = await rows(
    "select distinct market_type from public.ticket_legs where market_quote_id=any($1)",
    [newSpecials.map((q) => q.id)],
  );
  assert.equal(types.length, 3);
  const acceptedWeekly = () =>
    rows(
      "select l.* from public.ticket_legs l where market_quote_id=any($1) order by l.id",
      [newSpecials.map((q) => q.id)],
    );
  const beforeRefreshLegs = await acceptedWeekly();
  assert(
    beforeRefreshLegs.some(
      (l) =>
        l.settlement_context.side === "6+" && Number(l.accepted_line) === 6,
    ),
  );
  const beforeRefreshTickets = await rows(
    "select t.* from public.tickets t where id in(select ticket_id from public.ticket_legs where market_quote_id=any($1)) order by t.id",
    [newSpecials.map((q) => q.id)],
  );
  const beforeRefreshBalance = await balance();
  const refreshedQuotes = newSpecials.map((q) => ({
    ...q,
    odds: 400,
    line: q.kind === "weekly_count_projection" ? 7 : 170.5,
    metadata: {
      ...q.metadata,
      projection_targets: Object.fromEntries(all.map((t) => [t.id, 180])),
    },
  }));
  await rows(
    "select public.save_market_board($1,$2,9,now(),now()+interval '1 day',$3::jsonb,'draft')",
    [weeklyBoard, league, JSON.stringify(refreshedQuotes)],
  );
  await assert.rejects(
    () =>
      rows("select public.place_sportsbook_ticket($1,$2,$3,1,$4)", [
        weeklyBoard,
        weeklyRevision,
        [newSpecials[0].id],
        randomUUID(),
      ]),
    /Betting is closed/,
  );
  await rows(
    "select public.save_market_board($1,$2,9,now(),now()+interval '1 day',$3::jsonb,'published')",
    [weeklyBoard, league, JSON.stringify(refreshedQuotes)],
  );
  assert.deepEqual(await acceptedWeekly(), beforeRefreshLegs);
  assert.deepEqual(
    await rows(
      "select t.* from public.tickets t where id in(select ticket_id from public.ticket_legs where market_quote_id=any($1)) order by t.id",
      [newSpecials.map((q) => q.id)],
    ),
    beforeRefreshTickets,
  );
  assert.equal(await balance(), beforeRefreshBalance);
  await assert.rejects(
    () =>
      rows("select public.place_sportsbook_ticket($1,$2,$3,1,$4)", [
        weeklyBoard,
        weeklyRevision,
        [newSpecials[0].id],
        randomUUID(),
      ]),
    /Lines have changed/,
  );
  console.log(
    "Published-to-draft morning repricing preserves all ticket and leg fields, projection snapshots and wallet balances; stale slips are rejected.",
  );
  console.log(
    "New weekly specials accept singles and preserve descriptive labels and projection snapshots.",
  );
  console.log(
    "Player market removal, return and repeated recalculation preserve quote identity.",
  );
  await rows(
    "select public.review_admin_exception($1,'lineup:regression','keep_locked','Roster has no eligible positive projected replacement')",
    [league],
  );
  assert.equal(
    (
      await rows(
        "select * from public.admin_exception_reviews where league_id=$1",
        [league],
      )
    ).length,
    1,
  );
  const stranger = randomUUID();
  await db.exec(
    `reset role;set role authenticated;set request.jwt.claim.sub='${stranger}';`,
  );
  assert.equal(
    (await rows("select * from public.forecast_snapshots")).length,
    0,
  );
  assert.equal(
    (await rows("select * from public.league_result_weeks")).length,
    0,
  );
  assert.equal((await rows("select * from public.admin_change_log")).length, 0);
  assert.equal(
    (await rows("select * from public.admin_exception_reviews")).length,
    0,
  );
  await assert.rejects(
    () =>
      rows(
        "select public.save_league_identity($1,'Bad Change','','Unauthorized edit')",
        [league],
      ),
    /Only the league admin/,
  );
  await assert.rejects(
    () =>
      rows(
        "select public.review_admin_exception($1,'fake:test','keep_locked','Unauthorized review')",
        [league],
      ),
    /Only the league admin/,
  );
  await assert.rejects(
    () =>
      rows("select public.save_report_results($1,2026,1,true,'{}')", [league]),
    /Only the league admin/,
  );
  console.log(
    "Reports, settings history and exception decisions are isolated from non-admin identities.",
  );
  console.log(
    "Futures placement, immutable accepted odds, refunds, settlement, cutoff isolation, closed outcomes, and all cash-floor cases passed.",
  );
} finally {
  await db.close();
}
