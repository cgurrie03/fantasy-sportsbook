import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  selectEditorialStories,
  comparableEdition,
  editorialLabel,
} from "../api/_lib/editorial-stories.ts";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function facts(n = 8, offset = 0) {
  const team_ids = Array.from({ length: n }, (_, i) => id(offset + i + 1));
  return {
    contract: "opening-editorial-facts-v1",
    league_id: id(900 + offset),
    nfl_season: 2026,
    league_season: 3,
    market_week: 5,
    board_id: id(800 + offset),
    board_revision: 1,
    window_key: "a".repeat(32),
    prepared_at: new Date().toISOString(),
    team_ids,
    teams: team_ids.map((id, i) => ({
      id,
      name: "Team " + (i + 1),
      projected: 110 + i * 3,
    })),
    matchups: Array.from({ length: n / 2 }, (_, i) => ({
      id: "match-" + i,
      home: team_ids[i * 2],
      away: team_ids[i * 2 + 1],
      home_projected: 110 + i * 6,
      away_projected: 113 + i * 6,
      featured: i === 0 ? "Game of the Week" : null,
    })),
    championship: team_ids
      .slice(0, 4)
      .map((id, i) => ({
        id,
        team: "Team " + (i + 1),
        owner: "Public owner " + (i + 1),
        odds: 300 + i * 50,
      })),
  };
}
for (const n of [8, 10]) {
  const f = facts(n),
    first = selectEditorialStories(f);
  assert.equal(first.stories.length, 3);
  assert.equal(new Set(first.stories.map((s) => s.group)).size, 3);
  assert.deepEqual(
    selectEditorialStories(f),
    first,
    "same evidence gives identical editorial choices",
  );
  const shuffled = {
    ...f,
    teams: [...f.teams].reverse(),
    matchups: [...f.matchups].reverse(),
    championship: [...f.championship].reverse(),
  };
  assert.deepEqual(
    selectEditorialStories(shuffled).stories,
    first.stories,
    "provider row order does not change choices",
  );
  let previous = first;
  let changes = 0;
  for (let week = 6; week <= 18; week++) {
    const current = {
      ...f,
      market_week: week,
      championship: f.championship.map((p, i) => ({
        ...p,
        odds: p.odds + (week % 2 ? 25 : 0) * (i + 1),
      })),
    };
    const edition = selectEditorialStories(current, previous);
    assert(edition.stories.length >= 2 && edition.stories.length <= 3);
    assert.equal(
      new Set(edition.stories.map((s) => s.group)).size,
      edition.stories.length,
    );
    assert(
      edition.stories.every((s) =>
        s.evidence.every((id) => f.team_ids.includes(id)),
      ),
    );
    if (
      JSON.stringify(edition.stories.map((s) => s.key)) !==
      JSON.stringify(previous.stories.map((s) => s.key))
    )
      changes++;
    assert(
      !/eliminated|injured|winning streak|must.win|bottom 3/i.test(
        edition.stories.map((s) => s.title + " " + s.text).join(" "),
      ),
    );
    previous = edition;
  }
  assert(changes >= 8, "consecutive editions vary their factual topics");
  const moved = {
    ...f,
    market_week: 6,
    championship: f.championship.map((p) => ({ ...p, odds: p.odds + 100 })),
  };
  const change = selectEditorialStories(moved, first).stories.find(
    (s) => s.key === "championship-price-movement",
  );
  assert(change);
  assert.match(change.text, /Week 5/);
  assert.match(change.text, /\+300.*\+400/);
  for (const mismatch of [
    { ...first, facts: { ...first.facts, league_id: id(9999) } },
    { ...first, facts: { ...first.facts, nfl_season: 2025 } },
    { ...first, facts: { ...first.facts, league_season: 2 } },
    { ...first, facts: { ...first.facts, market_week: 3 } },
    {
      ...first,
      facts: { ...first.facts, team_ids: [...first.facts.team_ids, id(9999)] },
    },
  ]) {
    assert.equal(comparableEdition(moved, mismatch), false);
    assert(
      !selectEditorialStories(moved, mismatch).stories.some(
        (s) => s.key === "championship-price-movement",
      ),
    );
  }
  const missing = selectEditorialStories({
    ...f,
    teams: [],
    matchups: [],
    championship: [],
  });
  assert.equal(missing.stories.length, 1);
  assert.match(missing.stories[0].text, new RegExp("0 of " + n));
  assert(!/0\.0 projected/.test(missing.stories[0].text));
  assert.throws(
    () =>
      selectEditorialStories({
        ...f,
        team_ids: [...f.team_ids, f.team_ids[0]],
      }),
    /scope or budget/,
  );
  assert.throws(
    () =>
      selectEditorialStories({
        ...f,
        teams: [{ ...f.teams[0], projected: NaN }],
      }),
    /evidence/,
  );
}
assert(
  new TextEncoder().encode(editorialLabel("🏈".repeat(1000))).length <= 160,
);

const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;",
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    "set row_security=on;set request.jwt.claim.role='service_role';set request.jwt.claim.sub=''",
  );
  const scope = facts(8),
    foreign = facts(10, 100);
  for (const f of [scope, foreign]) {
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Editorial fixture',($1::uuid)::text,2026,3,5,now())",
      [f.league_id],
    );
    for (const [i, t] of f.teams.entries())
      await q(
        "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,$3,$4,'Public owner','Public owner')",
        [t.id, f.league_id, i + 1, t.name],
      );
    await q(
      "insert into weekly_schedule(league_id,publication_paused)values($1,false)",
      [f.league_id],
    );
  }
  await db.exec("set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id in($1,$2)", [
    scope.league_id,
    foreign.league_id,
  ]);
  await db.exec("set session_replication_role=origin");
  const board = async (f, week, season = 2026, leagueSeason = 3) => {
    const b = randomUUID();
    await q(
      "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,opens_at,closes_at,status,board_type)values($1,$2,$3,$4,$5,now()-interval '1 hour',now()+interval '4 hours','published','weekly')",
      [b, f.league_id, season, leagueSeason, week],
    );
    for (const m of f.matchups)
      await q(
        "insert into sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,active,home_team_id,away_team_id,home_projection,away_projection,featured)values($1,$2,$3,$3,'spread','Fixture','Team','home',1,-110,true,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          b,
          m.id,
          m.home,
          m.away,
          m.home_projected,
          m.away_projected,
          m.featured ?? "",
        ],
      );
    return b;
  };
  for (const f of [scope, foreign]) {
    const b = randomUUID();
    await q(
      "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,opens_at,closes_at,status,board_type)values($1,$2,2026,3,1,now()-interval '1 hour',now()+interval '4 hours','published','future')",
      [b, f.league_id],
    );
    for (const p of f.championship)
      await q(
        "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,active,team_id)values($1,$2,$3,'future_champion','Fixture','Team','yes',$4,true,$3::text::uuid)",
        [randomUUID(), b, p.id, p.odds],
      );
  }
  const document = async (
    f,
    b,
    week,
    previous = null,
    season = 2026,
    leagueSeason = 3,
  ) => {
    const w = (
      await q("select notification_window($1,$2,$3,'opening') w", [
        f.league_id,
        season,
        week,
      ])
    )[0].w;
    assert.equal(w.eligible, true);
    const revision = (
      await q("select revision from sportsbook_boards where id=$1", [b])
    )[0].revision;
    return selectEditorialStories(
      {
        ...f,
        market_week: week,
        board_id: b,
        board_revision: revision,
        window_key: w.window_key,
        prepared_at: new Date().toISOString(),
        nfl_season: season,
        league_season: leagueSeason,
        ...(season !== 2026 ? { championship: [] } : {}),
      },
      previous,
    );
  };
  const publish = async (d) =>
    (
      await q("select publish_opening_editorial($1,$2) d", [
        d.facts.league_id,
        d,
      ])
    )[0].d;
  const context = async (d) =>
    (
      await q("select opening_editorial_context($1,$2,$3,$4) c", [
        d.facts.league_id,
        d.facts.nfl_season,
        d.facts.market_week,
        d.facts.window_key,
      ])
    )[0].c;
  const b5 = await board(scope, 5),
    d5 = await document(scope, b5, 5);
  assert.deepEqual(await context(d5), { current: null, previous: null });
  assert.deepEqual(await publish(d5), d5);
  const different = structuredClone(d5);
  different.stories[0].text =
    "A different candidate with the same valid source key.";
  assert.deepEqual(
    await publish(different),
    d5,
    "first edition for a source window wins atomically",
  );
  const b6 = await board(scope, 6),
    d6 = await document(scope, b6, 6, d5);
  assert.deepEqual((await context(d6)).previous, d5);
  await publish(d6);
  await q("update sportsbook_boards set revision=revision+1 where id=$1", [b6]);
  await assert.rejects(publish(d6), /revision|window changed/);
  const refresh = await document(scope, b6, 6, d5);
  await publish(refresh);
  let stored = (
    await q(
      "select * from sportsbook_private.opening_editorial_editions where league_id=$1",
      [scope.league_id],
    )
  )[0];
  assert.equal(
    stored.previous_document.facts.market_week,
    5,
    "same-week replacements preserve prior week, not refresh archives",
  );
  assert.equal(
    stored.current_document.facts.board_revision,
    refresh.facts.board_revision,
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from sportsbook_private.opening_editorial_editions",
      )
    )[0].n,
    1,
  );
  for (const [patch, pattern] of [
    [(d) => (d.facts.teams[0].projected += 10), /forecast evidence/],
    [
      (d) => (d.facts.provider_payload = { raw: "forbidden" }),
      /bounded editorial/,
    ],
    [(d) => (d.stories[0].text = "x".repeat(4097)), /editorial story/],
    [(d) => (d.stories[0].evidence = [id(9999)]), /editorial story/],
  ]) {
    const bad = structuredClone(refresh);
    patch(bad);
    await assert.rejects(publish(bad), pattern);
  }
  const foreignBoard = await board(foreign, 5),
    foreignDoc = await document(foreign, foreignBoard, 5);
  await publish(foreignDoc);
  await assert.rejects(
    q("select publish_opening_editorial($1,$2)", [foreign.league_id, refresh]),
    /Invalid bounded/,
  );
  await assert.rejects(
    q("select opening_editorial_context($1,2026,6,$2)", [
      foreign.league_id,
      refresh.facts.window_key,
    ]),
    /window required/,
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from sportsbook_private.opening_editorial_editions",
      )
    )[0].n,
    2,
  );
  const b8 = await board(scope, 8),
    d8 = await document(scope, b8, 8);
  await publish(d8);
  assert.equal(
    (await context(d8)).previous,
    null,
    "nonconsecutive history is not presented as comparable",
  );
  await assert.rejects(publish(refresh), /rewound/);
  await q("update leagues set nfl_season=2027,league_season=4 where id=$1", [
    scope.league_id,
  ]);
  const nextBoard = await board(scope, 1, 2027, 4),
    nextDoc = await document(scope, nextBoard, 1, null, 2027, 4);
  await publish(nextDoc);
  assert.equal(
    (await context(nextDoc)).previous,
    null,
    "season renewal clears comparison evidence",
  );
  stored = (
    await q(
      "select * from sportsbook_private.opening_editorial_editions where league_id=$1",
      [scope.league_id],
    )
  )[0];
  assert.equal(stored.previous_document, null);
  await db.exec("set role authenticated");
  await assert.rejects(
    q("select * from sportsbook_private.opening_editorial_editions"),
    /permission denied/,
  );
  await assert.rejects(context(nextDoc), /permission denied/);
  await db.exec("reset role;set role service_role");
  await assert.rejects(
    q("select * from sportsbook_private.opening_editorial_editions"),
    /permission denied/,
  );
  assert.deepEqual((await context(nextDoc)).current, nextDoc);
  await db.exec("reset role;set role anon");
  await assert.rejects(publish(nextDoc), /permission denied/);
  console.log(
    "Editorial editions: 8/10 teams across consecutive weeks, bounded diverse deterministic facts, missing forecasts, valid price comparisons only; actual quoted evidence, source revision fencing, one current/prior edition per league, no refresh archives, tenant/role limits and season reset.",
  );
} finally {
  await db.close();
}
