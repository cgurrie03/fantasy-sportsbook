import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  parseSportsbookPolicy,
  sportsbookDefaults,
  featuredBoost,
  policyOdds,
} from "../api/_lib/sportsbook-policy.ts";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, outsider, A, B, board] = Array.from({ length: 5 }, uuid);
try {
  assert.equal(
    featuredBoost({
      kind: "moneyline",
      side: "home",
      featured: "Game of the Week",
    }),
    25,
  );
  assert.equal(
    featuredBoost({
      kind: "match_total",
      side: "under",
      featured: "Tank Bowl",
    }),
    0,
  );
  assert.equal(
    featuredBoost(
      { kind: "match_total", side: "over", featured: "Tank Bowl" },
      { ...sportsbookDefaults, featured_boost_pct: 30 },
    ),
    30,
  );
  assert.equal(
    policyOdds(137, "moneyline", {
      ...sportsbookDefaults,
      matchup_odds_step: 25,
    }),
    125,
  );
  assert.equal(
    policyOdds(-110, "spread", {
      ...sportsbookDefaults,
      matchup_odds_step: 25,
    }),
    -110,
  );
  assert.equal(
    policyOdds(12000, "future_champion", {
      ...sportsbookDefaults,
      futures_max_odds: 5000,
    }),
    5000,
  );
  for (const overrides of [
    { featured_boost_pct: 51 },
    { players_enabled: "yes" },
    { weekly_odds_step: 5 },
    { futures_max_odds: 1001 },
    { unknown: true },
  ])
    assert.throws(() =>
      parseSportsbookPolicy({
        contract: "sportsbook-policy-v1",
        revision: 1,
        values: { ...sportsbookDefaults, ...overrides },
      }),
    );
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;",
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
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Policy fixture',($1::uuid)::text,2026,1,5,now())",
      [id],
    );
    await q("insert into weekly_schedule(league_id)values($1)", [id]);
  }
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  await db.exec(
    `set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${owner}';set role authenticated`,
  );
  assert.deepEqual(
    (await q("select sportsbook_policy($1,2026,5)p", [A]))[0].p.values,
    sportsbookDefaults,
  );
  const save = (
    expected = 0,
    values = { featured_boost_pct: 30, players_enabled: false },
    week = 6,
  ) =>
    q(
      "select save_sportsbook_policy($1,$2,2026,$3,$4,'Reviewed typed market and boost policy')p",
      [A, expected, week, values],
    ).then((r) => r[0].p);
  assert.equal((await save()).revision, 1);
  assert.equal((await save()).duplicate, true);
  assert.equal(
    (await q("select sportsbook_policy($1,2026,5)p", [A]))[0].p.values
      .featured_boost_pct,
    25,
  );
  assert.equal(
    (await q("select sportsbook_policy($1,2026,6)p", [A]))[0].p.values
      .featured_boost_pct,
    30,
  );
  assert.equal(
    (await q("select sportsbook_policy($1,2026,6)p", [B]))[0].p.revision,
    0,
    "league isolation",
  );
  await assert.rejects(save(0, { featured_boost_pct: 40 }, 7), /changed/);
  await assert.rejects(save(1, { featured_boost_pct: 60 }, 7), /bounds/);
  await assert.rejects(save(1, { players_enabled: "yes" }, 7), /Boolean/);
  await db.exec("reset role");
  await q(
    "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,opens_at,closes_at,status)values($1,$2,2026,1,6,now()-interval '1 hour',now()+interval '1 hour','draft')",
    [board, A],
  );
  const insert = (kind = "moneyline", boost = 30, revision = 1) =>
    q(
      "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,featured,boost_pct,metadata)values($1,$2,($1::uuid)::text,$3,'Fixture','Fixture','home',150,'Game of the Week',$4,jsonb_build_object('sportsbook_policy_revision',$5::integer))",
      [uuid(), board, kind, boost, revision],
    );
  await assert.rejects(insert("moneyline", 25), /boost/);
  await assert.rejects(insert("moneyline", 30, 0), /policy changed/);
  await assert.rejects(insert("player_points", 0), /disabled/);
  await insert();
  await q("update sportsbook_boards set status='published'where id=$1", [
    board,
  ]);

  const future = uuid();
  await q(
    "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,board_type,opens_at,closes_at,status)values($1,$2,2026,1,1,'future',now()-interval '1 hour',now()+interval '1 hour','draft')",
    [future, A],
  );
  const futureQuote = (revision) =>
    q(
      "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,odds,metadata)values($1,$2,($1::uuid)::text,'future_champion','Fixture','Fixture','yes',500,jsonb_build_object('sportsbook_policy_revision',$3::integer))",
      [uuid(), future, revision],
    );
  await futureQuote(0);
  await q("update leagues set active_week=6,week_anchor=now()where id=$1", [A]);
  await assert.rejects(futureQuote(0), /policy changed/);
  await futureQuote(1);
  assert.equal(
    (await q("select current_sportsbook_policy($1)p", [A]))[0].p.revision,
    1,
    "future prices follow current placement week, not board week one",
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    save(1, { featured_boost_pct: 40 }, 6),
    /periods must increase/,
  );
  await db.exec(
    `reset role;set request.jwt.claim.sub='${outsider}';set role authenticated`,
  );
  await assert.rejects(q("select sportsbook_policy($1,2026,6)", [A]), /access/);
  await assert.rejects(save(1, { featured_boost_pct: 40 }, 7), /owner/);
  await assert.rejects(
    q("select * from sportsbook_private.sportsbook_policy_versions"),
    /permission denied|row-level security/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    q("select sportsbook_policy($1,2026,6)", [A]),
    /permission denied|row-level security/,
  );
  await db.exec(
    "reset role;set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';set role service_role",
  );
  assert.equal(
    (await q("select sportsbook_policy($1,2026,6)p", [A]))[0].p.revision,
    1,
  );
  await db.exec(
    `reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${owner}';set role authenticated`,
  );
  await q(
    "select save_sportsbook_policy($1,0,2026,5,'{\"futures_enabled\":false}','Disable unsupported future family for reviewed profile')",
    [B],
  );
  await db.exec("reset role;set request.jwt.claim.role='service_role'");
  const disabledFuture = uuid(),
    cycle = uuid();
  await q(
    "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,board_type,opens_at,closes_at,status)values($1,$2,2026,1,1,'future',now()-interval '1 hour',now()+interval '1 hour','published')",
    [disabledFuture, B],
  );
  await q(
    "insert into line_refresh_runtime(league_id,market_week,observed_at)values($1,5,now())",
    [B],
  );
  await q(
    "insert into line_refresh_cycles(id,league_id,market_week,slot,future_board,future_revision)select $1,$2,5,1,id,revision from sportsbook_boards where id=$3",
    [cycle, B, disabledFuture],
  );
  for (const family of ["matchups", "players", "specials", "futures"]) {
    const job = uuid();
    await q(
      "insert into automation_jobs(id,league_id,event_key,operation,market_week,refresh_cycle_id,status,attempts,lease_until)values($1::uuid,$2,$1::text,$3,5,$4,'running',1,now()+interval '5 minutes')",
      [job, B, "interval_" + family, cycle],
    );
    await q("select stage_line_refresh($1,1,'[]')", [job]);
  }
  assert.match(
    (
      await q("select suspension_reason from sportsbook_boards where id=$1", [
        disabledFuture,
      ])
    )[0].suspension_reason,
    /disabled/,
  );
  assert.equal(
    (await q("select status from line_refresh_cycles where id=$1", [cycle]))[0]
      .status,
    "skipped",
  );
  console.log(
    "Shared policy: SQL/TS parity, typed bounds, paused owner/CAS/future periods, league scope, disabled families, stale quote revision and exact featured boosts; no accepted-price mutation.",
  );
} finally {
  await db.close();
}
