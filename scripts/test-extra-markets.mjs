import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = fs.mkdtempSync(path.resolve("node_modules/.extra-markets-"));
for (const name of [
  "settlement",
  "extra-markets",
  "model-assessment",
  "ticket-progress",
  "line-model",
  "game-status",
  "futures-settlement",
])
  fs.writeFileSync(
    path.join(dir, name + ".js"),
    ts.transpileModule(fs.readFileSync("api/_lib/" + name + ".ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText,
  );
fs.writeFileSync(
  path.join(dir, "markets.js"),
  ts.transpileModule(
    fs
      .readFileSync("src/lib/markets.ts", "utf8")
      .replace('"./supabase"', '"./supabase.js"'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    },
  ).outputText,
);
fs.writeFileSync(path.join(dir, "supabase.js"), "export const supabase=null;");
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
const load = (name) => import(pathToFileURL(path.join(dir, name + ".js")).href);
const { settleLeg } = await load("settlement");
const { milestones, oddsFor, differenceSd, playerExtras } =
  await load("extra-markets");
const { legProgress, refreshTicketProgress } = await load("ticket-progress");
const { canPlacePicks, pickConflict } = await load("markets");
const result = {
  final: true,
  teams: { a: { name: "A", points: 150 }, b: { name: "B", points: 140 } },
  players: { p: { played: true, points: 20 }, q: { played: true, points: 20 } },
};
const leg = (kind, side = "home", line = null, meta = {}) => ({
  id: "leg",
  accepted_line: line,
  settlement_context: {
    kind,
    side,
    team_id: "a",
    home_team_id: "a",
    away_team_id: "b",
    metadata: { player_id: "p", opponent_player_id: "q", ...meta },
  },
});
assert.equal(settleLeg(leg("player_h2h"), result).status, "PUSH");
assert.equal(
  settleLeg(leg("player_h2h"), {
    ...result,
    players: { ...result.players, q: { played: false, points: 0 } },
  }).status,
  "PUSH",
);
assert.equal(
  settleLeg(leg("player_h2h"), {
    ...result,
    players: { ...result.players, p: { played: true, points: 21 } },
  }).status,
  "WON",
);
assert.equal(
  settleLeg(leg("player_h2h", "away"), {
    ...result,
    players: { ...result.players, p: { played: true, points: 21 } },
  }).status,
  "LOST",
);
assert.equal(
  settleLeg(leg("player_milestone", "at_least", 20), result).status,
  "WON",
);
assert.equal(
  settleLeg(leg("team_milestone", "at_least", 150), result).status,
  "WON",
);
assert.equal(
  settleLeg(leg("team_milestone", "at_least", 175), result).status,
  "LOST",
);
assert.equal(
  settleLeg(
    leg("winning_margin", "home", null, { margin_lower: 0, margin_upper: 10 }),
    result,
  ).status,
  "LOST",
);
assert.equal(
  settleLeg(
    leg("winning_margin", "home", null, { margin_lower: 10, margin_upper: 20 }),
    result,
  ).status,
  "WON",
);
assert.equal(
  settleLeg(
    leg("winning_margin", "home", null, { margin_lower: 0, margin_upper: 10 }),
    { ...result, teams: { ...result.teams, b: { name: "B", points: 150 } } },
  ).status,
  "PUSH",
);
assert.equal(
  settleLeg(leg("player_h2h"), { ...result, final: false }).status,
  "OPEN",
);
assert.equal(
  settleLeg(leg("player_h2h"), { ...result, players: {} }).status,
  "OPEN",
);
assert.deepEqual(milestones(20, 5), [15, 20, 25, 30]);
assert(oddsFor(0.1) > oddsFor(0.2));
assert(differenceSd([1, 2, 3], [1, 2, 3], 5, 5) < Math.hypot(5, 5));
assert.match(
  legProgress(leg("spread", "home", -8), {
    teams: { a: 150, b: 140 },
    players: {},
  }),
  /Adjusted margin: 2.0/,
);
const p = {
  id: "p",
  name: "Actual Starter",
  positions: ["QB"],
  projection: 20,
  expected: 20,
  average: 18,
  injury: "",
  team: "BUF",
  game: "Sun vs. ATL",
  assessment_sd: 8,
};
const q = { ...p, id: "q", name: "Flex Starter", positions: ["RB"] };
const ctx = {
  matchup_key: "match",
  home_team_id: "a",
  away_team_id: "b",
  metadata: {},
  active: true,
};
const extras = playerExtras(
  ctx,
  { id: "a" },
  { id: "b" },
  ["p"],
  ["q"],
  ["SUPER_FLEX"],
  [p, q],
  [
    { player_id: "p", date: "2030-10-10T17:00:00Z" },
    { player_id: "q", date: "2030-10-10T20:00:00Z" },
  ],
  [],
);
assert.equal(extras.length, 2);
assert.equal(extras[0].metadata.left_player.id, "p");
assert.equal(extras[0].metadata.right_player.position, "RB");
assert.equal(extras[0].metadata.cutoff_at, "2030-10-10T17:00:00.000Z");
assert(canPlacePicks([extras[0]]));
assert(
  pickConflict([extras[0]], { ...extras[1], id: "other", market_key: "other" }),
);
const originalFetch = globalThis.fetch;
let fetches = 0,
  snapshot = null;
globalThis.fetch = async (url) => {
  fetches++;
  return new Response(
    JSON.stringify(
      String(url).includes("/stats/")
        ? [{ player_id: "p", stats: { gp: 1, pass_td: 2 } }]
        : String(url).includes("/matchups/")
          ? [{ roster_id: 1, points: 40 }]
          : { season: "2026", scoring_settings: { pass_td: 4 } },
    ),
    { status: 200 },
  );
};
const fake = {
  from(table) {
    const b = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      neq() {
        return b;
      },
      then(resolve) {
        return Promise.resolve({
          data:
            table === "tickets"
              ? [{ market_week: 5, nfl_season: 2026 }]
              : table === "teams"
                ? [{ id: "a", roster_id: 1 }]
                : snapshot
                  ? [snapshot]
                  : [],
          error: null,
        }).then(resolve);
      },
      async upsert(value) {
        snapshot = value;
        return { error: null };
      },
    };
    return b;
  },
};
try {
  await refreshTicketProgress(
    fake,
    { id: "league", nfl_season: 2026, sleeper_league_id: "123" },
    { games: [{ state: "in_progress" }] },
  );
  assert.equal(snapshot.cadence_minutes, 15);
  assert.equal(snapshot.payload.players.p, 8);
  assert.equal(snapshot.payload.teams.a, 40);
  const count = fetches;
  await refreshTicketProgress(
    fake,
    { id: "league", nfl_season: 2026, sleeper_league_id: "123" },
    { games: [{ state: "in_progress" }] },
  );
  assert.equal(fetches, count);
  snapshot.fetched_at = new Date(Date.now() - 121 * 60000).toISOString();
  await refreshTicketProgress(
    fake,
    { id: "league", nfl_season: 2026, sleeper_league_id: "123" },
    { games: [{ state: "final" }] },
  );
  assert.equal(snapshot.cadence_minutes, 120);
} finally {
  globalThis.fetch = originalFetch;
}
const db = new PGlite();
const A = "13121261-5398-4391-8240-000000000003",
  user = randomUUID(),
  outsider = randomUUID();
const rows = async (s, args = []) => (await db.query(s, args)).rows;
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`,
  );
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await rows("insert into auth.users values($1,$2,now()),($3,$4,now())", [
    user,
    "cooper.gurrie@gmail.com",
    outsider,
    "outsider@example.test",
  ]);
  const act = async (id) =>
    db.exec(
      `reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
    );
  await act(user);
  await rows("select claim_memberships()");
  const team = (
    await rows("select team_id from league_memberships where user_id=$1", [
      user,
    ])
  )[0].team_id;
  await db.exec("reset role");
  await rows("update wallets set balance=1000 where team_id=$1", [team]);
  const other = (
    await rows("select id from teams where league_id=$1 and id<>$2 limit 1", [
      A,
      team,
    ])
  )[0].id;
  await act(user);
  const period = (await rows("select * from sportsbook_period($1)", [A]))[0];
  const board = randomUUID();
  const quote = {
    ...extras[0],
    id: randomUUID(),
    team_id: team,
    home_team_id: team,
    away_team_id: other,
    metadata: { ...extras[0].metadata, cutoff_at: "2030-10-10T17:00:00Z" },
  };
  const ladder = {
    ...quote,
    id: randomUUID(),
    kind: "player_milestone",
    market_key: "ladder",
    side: "at_least",
    line: 20,
    label: "Player 20+",
    metadata: { player_id: "p", cutoff_at: "2030-10-10T17:00:00Z" },
  };
  await rows(
    "select save_market_board($1,$2,$3,now()-interval '1 hour',now()+interval '3 days',$4,'published')",
    [board, A, period.week, JSON.stringify([quote, ladder])],
  );
  const revision = (
    await rows("select revision from sportsbook_boards where id=$1", [board])
  )[0].revision;
  const request = randomUUID();
  const accepted = (
    await rows("select place_sportsbook_ticket($1,$2,$3,$4,$5) r", [
      board,
      revision,
      [quote.id],
      10,
      request,
    ])
  )[0].r;
  assert.equal(
    (
      await rows("select market_type from ticket_legs where ticket_id=$1", [
        accepted.ticket_id,
      ])
    )[0].market_type,
    "Head to Head",
  );
  await rows("select place_sportsbook_ticket($1,$2,$3,$4,$5)", [
    board,
    revision,
    [quote.id],
    10,
    request,
  ]);
  assert.equal(
    Number(
      (await rows("select balance from wallets where team_id=$1", [team]))[0]
        .balance,
    ),
    990,
  );
  await assert.rejects(
    rows("select place_sportsbook_ticket($1,$2,$3,$4,$5)", [
      board,
      revision,
      [quote.id, ladder.id],
      10,
      randomUUID(),
    ]),
  );
  await db.exec("reset role");
  await rows(
    "update sportsbook_markets set metadata=jsonb_set(metadata,'{cutoff_at}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",
    [quote.id],
  );
  await act(user);
  await assert.rejects(
    rows("select place_sportsbook_ticket($1,$2,$3,$4,$5)", [
      board,
      revision,
      [quote.id],
      10,
      randomUUID(),
    ]),
  );
  assert.equal(
    Number(
      (await rows("select balance from wallets where team_id=$1", [team]))[0]
        .balance,
    ),
    990,
  );
  await db.exec("reset role");
  await rows(
    "insert into ticket_score_observations values($1,2026,5,now(),15,$2)",
    [A, JSON.stringify({ teams: { [team]: 100 }, players: { p: 20 } })],
  );
  await act(outsider);
  assert.equal(
    (await rows("select * from ticket_score_observations")).length,
    0,
  );
  console.log(
    "Passed extra-market settlement, exact boundaries, no-play/tie pushes, actual FLEX slots, cutoff selection, pricing monotonicity, snapshot idempotency, single acceptance, parlay conflicts and league-scoped score RLS.",
  );
} finally {
  await db.close();
  if (path.dirname(dir) === path.resolve("node_modules"))
    fs.rmSync(dir, { recursive: true, force: true });
}
