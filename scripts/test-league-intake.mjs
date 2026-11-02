import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  normalizeSleeperIntake,
  reviewIntake,
  fetchSleeperIntake,
  compareProviderContract,
} from "../api/_lib/league-intake.ts";
const fixture = (size = 8, id = "1234567890123456789") => ({
  league: {
    league_id: id,
    name: "Synthetic intake",
    sport: "nfl",
    season_type: "regular",
    season: "2026",
    status: "in_season",
    total_rosters: size,
    scoring_settings: { pass_yd: 0.04, rec: 1, rush_yd: 0.1 },
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
    settings: { playoff_week_start: 15, playoff_teams: 4, divisions: 0 },
  },
  rosters: Array.from({ length: size }, (_, i) => ({
    league_id: id,
    roster_id: i + 1,
    owner_id: i === size - 1 ? null : String(20000 + i),
    co_owners: i === 0 ? ["30000"] : [],
    settings: { wins: 2, losses: 3, ties: 0 },
    players: ["unneeded raw roster"],
  })),
  users: [
    ...Array.from({ length: size - 1 }, (_, i) => ({
      user_id: String(20000 + i),
      display_name: "Manager " + i,
      metadata: { team_name: "Team " + i, unneeded: "discard" },
    })),
    { user_id: "30000", display_name: "Public co-owner" },
  ],
});
const f = fixture(),
  source = normalizeSleeperIntake(f.league, f.rosters, f.users),
  report = reviewIntake(source);
assert.equal(source.teams.length, 8);
assert.equal(source.teams[7].owner_id, null);
assert.deepEqual(source.teams[0].co_owner_ids, ["30000"]);
assert(!JSON.stringify(source).includes("unneeded"));
assert.equal(report.admission, "review_required");
const retained = {
  version: 1,
  source: { ...source },
  capabilities: report,
  review_status: "pending",
};
delete retained.source.teams;
const stored = source.teams.map((t) => ({
  roster_id: t.roster_id,
  sleeper_owner_id: t.owner_id,
  co_owner_ids: t.co_owner_ids,
}));
assert.equal(
  compareProviderContract(retained, stored, source).state,
  "unchanged",
);
const reordered = structuredClone(source);
reordered.positions.reverse();
reordered.teams.reverse();
assert.equal(
  compareProviderContract(retained, [...stored].reverse(), reordered).state,
  "unchanged",
  "ordering is not drift",
);
const cosmetic = structuredClone(source);
cosmetic.name = "Renamed";
cosmetic.teams[0].wins++;
assert.equal(
  compareProviderContract(retained, stored, cosmetic).state,
  "unchanged",
  "names and weekly wins are not rule changes",
);
for (const [section, change] of [
  ["scoring", (s) => (s.scoring.rec = 0.5)],
  ["provider_settings", (s) => (s.settings.playoff_teams = 6)],
  ["lineup_slots", (s) => s.positions.push("SUPER_FLEX")],
  ["roster_field", (s) => (s.teams[0].roster_id = 99)],
  ["public_roster_ownership", (s) => s.teams[0].co_owner_ids.push("40000")],
]) {
  const changed = structuredClone(source);
  change(changed);
  const r = compareProviderContract(retained, stored, changed);
  assert.equal(r.state, "rules_changed");
  assert(r.changes.some((c) => c.section === section));
  assert.equal(r.approval, "still_required");
  assert(
    !JSON.stringify(r).includes("40000"),
    "public owner identifiers are not returned",
  );
}
const completed = structuredClone(source);
completed.status = "complete";
assert(
  compareProviderContract(retained, stored, completed).changes.some(
    (c) => c.section === "provider_status",
  ),
);
const renewed = structuredClone(source);
renewed.season++;
assert.equal(
  compareProviderContract(retained, stored, renewed).state,
  "renewal_required",
);
assert.throws(
  () =>
    compareProviderContract(
      { ...retained, source: { ...retained.source, league_id: "999" } },
      stored,
      source,
    ),
  /matching/,
);
assert.throws(
  () => compareProviderContract(retained, stored.slice(1), source),
  /coverage/,
);
const many = structuredClone(source);
many.settings = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => ["rule_" + i, i]),
);
const bounded = compareProviderContract(retained, stored, many);
assert(bounded.changes[0].count > 32);
assert.equal(bounded.changes[0].keys.length, 32);
assert(new TextEncoder().encode(JSON.stringify(bounded)).length < 16384);

for (const size of [8, 10, 12, 14, 16]) {
  const v = fixture(size);
  assert.equal(
    reviewIntake(normalizeSleeperIntake(v.league, v.rosters, v.users))
      .families[1].state,
    "input_compatible",
  );
}
const odd = fixture(9);
assert.equal(
  reviewIntake(normalizeSleeperIntake(odd.league, odd.rosters, odd.users))
    .families[1].state,
  "blocked",
);
const idp = structuredClone(source);
idp.positions.push("IDP_FLEX");
idp.settings.league_average_match = 1;
idp.settings.divisions = 2;
assert(reviewIntake(idp).issues.some((i) => i.code === "median_wins"));
assert.equal(reviewIntake(idp).families[0].state, "blocked");
assert.throws(
  () =>
    normalizeSleeperIntake(
      f.league,
      [...f.rosters.slice(0, -1), f.rosters[0]],
      f.users,
    ),
  /Duplicate/,
);
assert.throws(
  () =>
    normalizeSleeperIntake({ ...f.league, sport: "nba" }, f.rosters, f.users),
  /NFL/,
);
assert.throws(
  () =>
    normalizeSleeperIntake(
      { ...f.league, scoring_settings: { rec: NaN } },
      f.rosters,
      f.users,
    ),
  /numeric/,
);
await assert.rejects(
  fetchSleeperIntake("https://example.invalid"),
  /numeric Sleeper/,
);
const calls = [];
const fetched = await fetchSleeperIntake(
  source.league_id,
  async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    return Response.json(
      url.endsWith("/users")
        ? f.users
        : url.endsWith("/rosters")
          ? f.rosters
          : f.league,
    );
  },
);
assert.equal(fetched.source.league_id, source.league_id);
assert.equal(calls.length, 3);
await assert.rejects(
  fetchSleeperIntake(
    source.league_id,
    async () => new Response("x".repeat(600000)),
  ),
  /budget/,
);
const db = new PGlite(),
  owner = randomUUID(),
  outsider = randomUUID(),
  q = async (sql, args = []) => (await db.query(sql, args)).rows,
  act = (id) =>
    db.exec(
      `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
    );
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`,
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const file of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + file, "utf8"));
  for (const id of [owner, outsider])
    await q("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.invalid",
    ]);
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  const save = (request, data = source, cap = report) =>
    q("select save_league_intake_draft($1,$2,$3) r", [
      request,
      JSON.stringify(data),
      JSON.stringify(cap),
    ]);
  await act(outsider);
  await assert.rejects(save(randomUUID()), /owner/);
  assert.equal(
    (await q("select count(*)::int n from league_intake_drafts"))[0].n,
    0,
  );
  await act(owner);
  assert.equal((await q("select league_intake_owner() yes"))[0].yes, true);
  const request = randomUUID(),
    draft = (await save(request))[0].r;
  assert.equal((await save(request))[0].r.duplicate, true);
  await assert.rejects(
    save(request, { ...source, name: "Changed source" }),
    /different provider/,
  );
  await assert.rejects(
    save(randomUUID(), { ...source, season: null }),
    /incomplete/,
  );
  await assert.rejects(
    save(randomUUID(), source, { ...report, admission: "approved" }),
    /capability review/,
  );
  const importArgs = [draft.id, 1, 1, "Reviewed synthetic inactive import"];
  await assert.rejects(
    q("select import_league_intake_draft($1,2,$2,$3)", [
      draft.id,
      1,
      importArgs[3],
    ]),
    /changed/,
  );
  const imported = (
    await q("select import_league_intake_draft($1,$2,$3,$4) r", importArgs)
  )[0].r;
  assert.equal(
    (await q("select import_league_intake_draft($1,$2,$3,$4) r", importArgs))[0]
      .r.duplicate,
    true,
  );
  await assert.rejects(
    q("select import_league_intake_draft($1,$2,2,$3)", [
      draft.id,
      1,
      importArgs[3],
    ]),
    /different reviewed terms/,
  );
  await db.exec("reset role");
  assert.equal(
    (
      await q("select count(*)::int n from teams where league_id=$1", [
        imported.league_id,
      ])
    )[0].n,
    8,
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from teams where league_id=$1 and sleeper_owner_id is null",
        [imported.league_id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (await q("select count(*)::int n from league_memberships"))[0].n,
    0,
  );
  assert.equal((await q("select count(*)::int n from user_wallets"))[0].n, 0);
  assert.equal(
    (
      await q("select count(*)::int n from wallets where balance is not null")
    )[0].n,
    0,
  );
  assert.equal(
    (
      await q("select operations_enabled from leagues where id=$1", [
        imported.league_id,
      ])
    )[0].operations_enabled,
    false,
  );
  assert.equal(
    (
      await q(
        "select automation_enabled from weekly_schedule where league_id=$1",
        [imported.league_id],
      )
    )[0].automation_enabled,
    false,
  );
  await assert.rejects(
    q("update leagues set operations_enabled=true where id=$1", [
      imported.league_id,
    ]),
    /pending/,
  );
  assert.deepEqual(
    (
      await q("select source from league_intake_drafts where id=$1", [draft.id])
    )[0].source,
    {},
  );
  await act(owner);
  const cap = (
    await q("select league_capabilities($1) r", [imported.league_id])
  )[0].r;
  assert.equal(cap.bet, false);
  assert.equal(cap.participant, null);
  const another = fixture(10, "2234567890123456789"),
    anotherSource = normalizeSleeperIntake(
      another.league,
      another.rosters,
      another.users,
    );
  const expiring = (
    await save(randomUUID(), anotherSource, reviewIntake(anotherSource))
  )[0].r;
  await db.exec("reset role");
  await q(
    "update league_intake_drafts set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [expiring.id],
  );
  await db.exec(
    "set request.jwt.claim.role='service_role';set role service_role",
  );
  assert.equal(
    (await q("select cleanup_routine_payloads(1) r"))[0].r
      .retired_intake_drafts,
    1,
  );
  await db.exec("reset role");
  assert.deepEqual(
    (
      await q("select source from league_intake_drafts where id=$1", [
        expiring.id,
      ])
    )[0].source,
    {},
  );
  await q("update auth.users set email_confirmed_at=null where id=$1", [owner]);
  await act(owner);
  await assert.rejects(save(randomUUID()), /owner/);
  assert.equal(
    (await q("select count(*)::int n from league_intake_drafts"))[0].n,
    0,
  );
  await act(outsider);
  assert.equal(
    (await q("select count(*)::int n from league_intake_drafts"))[0].n,
    0,
  );
  console.log(
    "Versioned Sleeper intake: bounded/fixed-host reads, 8–16/even and contrasting rule reports, private resumable drafts, CAS import once, real unclaimed teams, no Auth/member/user-wallet fabrication or funds, and quarantined operations.",
  );
} finally {
  await db.close();
}
