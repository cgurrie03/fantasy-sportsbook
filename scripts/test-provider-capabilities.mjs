import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { reviewIntake } from "../api/_lib/league-intake.ts";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, outsider, league, board] = Array.from({ length: 4 }, uuid),
  build = "a".repeat(40),
  provider = "1234567890123456789";
const source = {
  contract: "sleeper-nfl-intake-v1",
  provider: "sleeper",
  league_id: provider,
  name: "Capability fixture",
  season: 2026,
  status: "in_season",
  total_rosters: 8,
  scoring: { rec: 1 },
  positions: ["QB", "BN"],
  settings: { playoff_week_start: 15, playoff_teams: 4 },
  teams: Array.from({ length: 8 }, (_, i) => ({
    roster_id: i + 1,
    team_name: "Team " + i,
    owner_id: null,
    owner_name: "Unclaimed",
    co_owner_ids: [],
    co_owner_names: [],
    wins: 0,
    losses: 0,
    ties: 0,
  })),
};
const act = async (id = owner) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated`,
  );
const server = () =>
  db.exec(
    "reset role;set row_security=on;set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';set role service_role",
  );
async function observe(s = source) {
  await server();
  const r = (
    await q("select observe_provider_capability($1,$2,$3,$4,$5)p", [
      league,
      s,
      reviewIntake(s),
      build,
      new Date().toISOString(),
    ])
  )[0].p;
  await act();
  return r;
}
const approve = (h, ack = true, revision = 0) =>
  q(
    "select approve_provider_capability($1,$2,$5,$3,'I reviewed supported rules and projection/result evidence',$4)p",
    [league, h, build, ack, revision],
  );
try {
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
  await q(
    "insert into sportsbook_private.application_environment(environment,project_ref,app_origin)values('development','whlcnlacueweaqpsupqs','https://dev.sportsbook.coopergurrie.com')",
  );
  for (const id of [owner, outsider])
    await q("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  const retained = { ...source };
  delete retained.teams;
  await q(
    "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor,provider_contract)values($1,'Capability fixture',$2,2026,1,1,now(),$3)",
    [
      league,
      provider,
      {
        version: 1,
        source: retained,
        capabilities: reviewIntake(source),
        review_status: "pending",
      },
    ],
  );
  await q("insert into weekly_schedule(league_id)values($1)", [league]);
  for (let i = 1; i <= 8; i++)
    await q(
      "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,$3,'Fixture','Unclaimed','Unclaimed')",
      [uuid(), league, i],
    );
  await q(
    "insert into sportsbook_boards(id,league_id,nfl_season,league_season,market_week,opens_at,closes_at,status)values($1,$2,2026,1,1,now(),now()+interval '1 day','draft')",
    [board, league],
  );
  await assert.rejects(
    q("update sportsbook_boards set status='published'where id=$1", [board]),
    /capability review/,
  );
  let observation = await observe();
  await assert.rejects(approve(observation.review_hash, false), /coverage/);
  await assert.rejects(
    approve(observation.review_hash),
    /disable season futures/,
  );
  await q(
    "select save_sportsbook_policy($1,0,2026,1,'{\"futures_enabled\":false}','Reviewed weekly-only supported imported profile')",
    [league],
  );
  await assert.rejects(
    approve(observation.review_hash),
    /Configuration changed/,
  );
  observation = await observe();
  await approve(observation.review_hash);
  assert.equal((await approve(observation.review_hash))[0].p.duplicate, true);
  assert.equal(
    (await q("select provider_capability_review($1)p", [league]))[0].p
      .approval_current,
    true,
  );
  await db.exec("reset role");
  await q("update sportsbook_boards set status='published'where id=$1", [
    board,
  ]);
  // Drift suspends publication/acceptance eligibility without rewriting accepted facts.
  const changed = structuredClone(source);
  changed.scoring.rec = 0.5;
  await observe(changed);
  await db.exec("reset role");
  await assert.rejects(
    q("update sportsbook_boards set status='published'where id=$1", [board]),
    /changed/,
  );
  // Drift invalidation remains sticky; restoration requires a new explicit owner decision.
  const cosmetic = structuredClone(source);
  cosmetic.name = "Renamed";
  cosmetic.settings.leg = 2;
  observation = await observe(cosmetic);
  await act();
  assert.equal(
    (await q("select provider_capability_review($1)p", [league]))[0].p
      .approval_current,
    false,
  );
  await approve(observation.review_hash, true, 1);
  assert.equal(
    (await q("select provider_capability_review($1)p", [league]))[0].p
      .approval_current,
    true,
  );
  await db.exec("reset role");
  await q(
    "update sportsbook_private.provider_capability_state set observed_at=now()-interval '25 hours'where league_id=$1",
    [league],
  );
  await assert.rejects(
    q("update sportsbook_boards set status='published'where id=$1", [board]),
    /freshness changed/,
  );
  await observe();
  await act(outsider);
  await assert.rejects(
    q("select provider_capability_review($1)", [league]),
    /owner/,
  );
  await assert.rejects(
    q("select observe_provider_capability($1,$2,$3,$4,$5)", [
      league,
      source,
      reviewIntake(source),
      build,
      new Date().toISOString(),
    ]),
    /permission denied/,
  );
  await server();
  await assert.rejects(
    q("select observe_provider_capability($1,$2,$3,$4,$5)", [
      league,
      source,
      reviewIntake(source),
      build,
      new Date(Date.now() - 60000).toISOString(),
    ]),
    /newer provider observation/,
  );
  await act();
  const renewed = structuredClone(source);
  renewed.season = 2027;
  renewed.previous_league_id = renewed.league_id;
  renewed.league_id = "9876543210987654321";
  const unrelated = structuredClone(renewed);
  delete unrelated.previous_league_id;
  await assert.rejects(observe(unrelated), /identity/);
  observation = await observe(renewed);
  await q(
    "select renew_provider_season($1,$2,2026,'Reviewed next season with unchanged roster IDs and no open tickets')",
    [league, observation.review_hash],
  );
  assert.equal(
    (
      await q(
        "select nfl_season,league_season,operations_enabled from leagues where id=$1",
        [league],
      )
    )[0].nfl_season,
    2027,
  );
  assert.equal(
    (await q("select provider_capability_review($1)p", [league]))[0].p
      .approval_current,
    false,
  );
  const communication = (
    await q("select communication_identity_review($1)c", [league])
  )[0].c;
  await assert.rejects(
    q("select save_communication_identity($1,$2,$3,$4,$5)", [
      league,
      communication.revision_hash,
      "https://wrong.invalid/",
      "fixture@example.invalid",
      "Reviewed verified identity",
    ]),
    /exact HTTPS application origin/,
  );
  await q("select save_communication_identity($1,$2,$3,$4,$5)", [
    league,
    communication.revision_hash,
    communication.required_origin + "/",
    "fixture@example.invalid",
    "Reviewed verified identity",
  ]);
  assert.equal((await q("select count(*)::int n from tickets"))[0].n, 0);
  assert.equal(
    (await q("select count(*)::int n from user_wallet_entries"))[0].n,
    0,
  );
  console.log(
    "Provider capabilities: server-only bounded observations, explicit owner attestation/exact build/configuration, unsupported profile/futures rejection, current drift/stale publication holds, harmless metadata stability, scoped decisions and unfunded next-season renewal.",
  );
} finally {
  await db.close();
}
