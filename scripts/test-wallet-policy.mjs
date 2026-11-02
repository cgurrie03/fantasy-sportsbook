import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  walletPolicyDefaults,
  defaultWalletPolicy,
  parseWalletPolicy,
  weeklyCashTarget,
} from "../api/_lib/wallet-policy.ts";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, member, A, B, team, other] = Array.from(
  { length: 6 },
  randomUUID,
);
const act = (id) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
  );
const reason = "Reviewed effective policy and preserved accepted terms";
const values = {
  minimum_stake: 5,
  maximum_picks: 2,
  weekly_target: 150,
  futures_cash_floor: 40,
};
const save = (rev = 0, overrides = values, week = 5, league = A) =>
  q("select save_wallet_policy($1,$2,2026,$3,$4,$5) r", [
    league,
    rev,
    week,
    JSON.stringify(overrides),
    reason,
  ]).then((r) => r[0].r);
try {
  assert.equal(weeklyCashTarget(walletPolicyDefaults, 40), 60);
  assert.equal(weeklyCashTarget(values, 130), 40);
  assert.equal(weeklyCashTarget(values, 0, 200), 200);
  for (const invalid of [
    { maximum_picks: 11 },
    { minimum_stake: NaN },
    { futures_cash_floor: 151 },
    { weekly_target: 10.001 },
  ])
    assert.throws(() =>
      parseWalletPolicy({
        ...defaultWalletPolicy,
        values: { ...values, ...invalid },
      }),
    );
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  for (const id of [owner, member])
    await q("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  for (const id of [A, B])
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Policy fixture',($1::uuid)::text,2026,1,5,now())",
      [id],
    );
  for (const [id, l] of [
    [team, A],
    [other, B],
  ])
    await q(
      "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,1,'Team','Owner','Owner')",
      [id, l],
    );
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  assert.deepEqual(
    (await q("select sportsbook_private.wallet_policy_defaults() p"))[0].p,
    walletPolicyDefaults,
  );
  await act(member);
  await assert.rejects(save(), /owner/);
  await assert.rejects(q("select current_wallet_policy($1)", [A]), /access/);
  await assert.rejects(
    q("select * from sportsbook_private.league_policy_versions"),
    /permission denied/,
  );
  await act(owner);
  for (const invalid of [
    { minimum_stake: null },
    { maximum_picks: 11 },
    { maximum_picks: 2.5 },
    { weekly_target: 0 },
    { futures_cash_floor: 200 },
    { arbitrary_code: 1 },
    { minimum_stake: 1.001 },
  ])
    await assert.rejects(save(0, invalid), /Unsupported|limits|whole-cent/);
  await assert.rejects(save(1), /changed/);
  await assert.rejects(save(0, values, 4), /current or future/);
  assert.equal((await save()).revision, 1);
  assert.equal((await save()).duplicate, true);
  await assert.rejects(save(0, { ...values, minimum_stake: 6 }), /changed/);
  const policy = (await q("select current_wallet_policy($1) p", [A]))[0].p;
  parseWalletPolicy(policy);
  assert.deepEqual(policy.values, values);
  assert.deepEqual(
    (await q("select current_wallet_policy($1) p", [B]))[0].p.values,
    walletPolicyDefaults,
  );
  assert.deepEqual(
    (await q("select league_capabilities($1) p", [A]))[0].p.policy,
    policy,
  );
  assert.deepEqual(
    (await q("select sportsbook_board_manifest($1) p", [A]))[0].p.policy,
    policy,
  );
  assert.deepEqual(
    (await q("select weekly_finance_wallets($1,2026,5) p", [A]))[0].p.policy,
    policy,
  );
  // Compare the actual legacy and per-user replenishment engines with the same
  // typed target used by the API preview and client, including per-league scope.
  await q("select approve_user_wallet($1,$2,$3,$4)", [A, member, team, reason]);
  await db.exec("reset role");
  await q("update public.user_wallets set balance=20 where league_id=$1", [A]);
  await q(
    "insert into wallets(team_id,balance)values($1,20)on conflict(team_id)do update set balance=20",
    [other],
  );
  await q(
    "insert into sportsbook_private.user_finance_modes(league_id,enabled)values($1,true)",
    [A],
  );
  await act(owner);
  await q("select replenish_weekly_balances($1,2026,5)", [A]);
  await q("select replenish_weekly_balances($1,2026,5)", [B]);
  await db.exec("reset role");
  assert.equal(
    Number(
      (await q("select balance from user_wallets where league_id=$1", [A]))[0]
        .balance,
    ),
    150,
  );
  assert.equal(
    Number(
      (await q("select balance from wallets where team_id=$1", [other]))[0]
        .balance,
    ),
    100,
  );
  // Local fixture only: activation remains a separate owner-reviewed gate.
  await db.exec("set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id=$1", [A]);
  await db.exec("set session_replication_role=origin");
  const insert = (stake = 5) =>
    q(
      "insert into tickets(id,league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)values(gen_random_uuid(),$1,$2,1,2026,5,5,now(),100,$3::numeric,2*$3::numeric,'OPEN',0)returning id,policy_snapshot",
      [A, team, stake],
    );
  await assert.rejects(insert(1), /effective league minimum/);
  const ticket = (await insert())[0];
  assert.deepEqual(ticket.policy_snapshot.values, values);
  const addLeg = (n) =>
    q(
      "insert into ticket_legs(ticket_id,leg_number,selection,market_type,accepted_odds,status,result_evidence)values($1,$2,'Fixture','spread',100,'OPEN','')",
      [ticket.id, n],
    );
  await addLeg(1);
  await addLeg(2);
  await assert.rejects(addLeg(3), /pick limit/);
  await assert.rejects(
    q("update tickets set policy_snapshot='{}' where id=$1", [ticket.id]),
    /immutable/,
  );
  await q("update leagues set operations_enabled=false where id=$1", [A]);
  await act(owner);
  await assert.rejects(
    save(1, { ...values, minimum_stake: 6 }),
    /effective periods must increase|Accepted tickets/,
  );
  await save(1, { minimum_stake: 7, weekly_target: 200 }, 6);
  assert.equal(
    (await q("select current_wallet_policy($1) p", [A]))[0].p.values
      .minimum_stake,
    5,
    "future version does not silently change current wagers",
  );
  await db.exec("reset role");
  await q("update leagues set active_week=6 where id=$1", [A]);
  await act(owner);
  assert.equal(
    (await q("select current_wallet_policy($1) p", [A]))[0].p.values
      .minimum_stake,
    7,
  );
  await db.exec("reset role");
  assert.deepEqual(
    (await q("select policy_snapshot from tickets where id=$1", [ticket.id]))[0]
      .policy_snapshot.values,
    values,
    "accepted policy stays frozen",
  );
  await db.exec("set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id=$1", [B]);
  await db.exec("set session_replication_role=origin");
  await act(owner);
  await assert.rejects(save(0, values, 6, B), /Pause operations/);
  await db.exec("reset role");
  await assert.rejects(
    q("delete from sportsbook_private.league_policy_versions"),
    /immutable/,
  );
  console.log(
    "Wallet/ticket policy: SQL/TS default parity, typed/dependency/owner/CAS/effective-period guards, scoped shared reads, both finance targets, immutable accepted terms and enforced minimum/pick limits.",
  );
} finally {
  await db.close();
}
