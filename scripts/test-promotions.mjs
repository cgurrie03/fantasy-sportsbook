import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validatePng } from "../api/_lib/promo-image.ts";
const db = new PGlite();
const A = "13121261-5398-4391-8240-000000000003",
  user = randomUUID(),
  outsider = randomUUID();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const act = async (id) =>
  db.exec(
    `reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
  );
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
  await act(user);
  await rows("select claim_memberships()");
  const team = (
    await rows("select team_id from league_memberships where user_id=$1", [
      user,
    ])
  )[0].team_id;
  const period = (await rows("select * from sportsbook_period($1)", [A]))[0];
  const board = randomUUID(),
    quotes = Array.from({ length: 6 }, () => randomUUID());
  const q = quotes.map((id, i) => ({
    id,
    market_key: "player:" + i,
    kind: "player_points",
    label: "Player " + i + " Over 10.5",
    subject: "Player " + i,
    side: "over",
    line: 10.5,
    odds: 100,
    metadata: { player_id: "p" + i },
  }));
  await rows(
    "select save_market_board($1,$2,$3,now()-interval '1 hour',now()+interval '3 days',$4,'published')",
    [board, A, period.week, JSON.stringify(q)],
  );
  await db.exec("reset role");
  const image = randomUUID();
  await rows("insert into promo_images(id,league_id,png) values($1,$2,$3)", [
    image,
    A,
    "a".repeat(40),
  ]);
  await rows("update wallets set balance=1000 where team_id=$1", [team]);
  await act(user);
  const template = {
    week: period.week,
    slot: 1,
    kind: "boost",
    title: "Points boost",
    description: "Five distinct players",
    image_id: image,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    status: "scheduled",
    terms: { criterion: "points_min", count: 5, percent: 50, max_stake: 20 },
  };
  async function offer(t = {}) {
    return (
      await rows("select save_promo($1,null,null,$2) as id", [
        A,
        JSON.stringify({ ...template, ...t }),
      ])
    )[0].id;
  }
  const o = await offer();
  assert.equal(
    (await rows("select list_promos($1) as result", [A]))[0].result.length,
    1,
  );
  await act(outsider);
  await assert.rejects(rows("select claim_promo($1)", [o]), /unavailable/);
  await assert.rejects(
    rows("select read_promo_image($1)", [image]),
    /unavailable/,
  );
  await assert.rejects(
    rows("select save_promo($1,null,null,$2)", [A, JSON.stringify(template)]),
    /admin/,
  );
  assert.equal((await rows("select * from promo_offers")).length, 0);
  await act(user);
  await rows("select claim_promo($1)", [o]);
  await rows("select claim_promo($1)", [o]);
  assert.equal(
    (await rows("select * from promo_claims where offer_id=$1", [o])).length,
    1,
  );
  assert.equal(
    (
      await rows("select used_ticket from promo_claims where offer_id=$1", [o])
    )[0].used_ticket,
    null,
  );
  const rev = (
    await rows("select revision from sportsbook_boards where id=$1", [board])
  )[0].revision;
  const bet = async (
    id,
    picks = quotes.slice(0, 5),
    stake = 10,
    request = randomUUID(),
    revision = rev,
  ) =>
    (
      await rows("select place_boosted_ticket($1,$2,$3,$4,$5,$6) as result", [
        board,
        revision,
        picks,
        stake,
        request,
        id,
      ])
    )[0].result;
  await assert.rejects(bet(o, quotes.slice(0, 4)), /count/);
  await assert.rejects(bet(o, quotes.slice(0, 5), 21), /Maximum/);
  await assert.rejects(
    bet(o, quotes.slice(0, 5), 10, randomUUID(), rev - 1),
    /Lines have changed/,
  );
  const request = randomUUID(),
    ticket = (await bet(o, quotes.slice(0, 5), 10, request)).ticket_id;
  assert.equal(
    (
      await rows("select accepted_potential_payout from tickets where id=$1", [
        ticket,
      ])
    )[0].accepted_potential_payout,
    "475.00",
  ); // 2^5=32; 1+31*1.5=47.5
  assert.equal((await bet(o, quotes.slice(0, 5), 10, request)).duplicate, true);
  await assert.rejects(rows('select place_sportsbook_ticket($1,$2,$3,$4,$5)',[board,rev,quotes.slice(0,5),10,request]),/promotion/);
  await assert.rejects(bet(o), /once/);
  await assert.rejects(
    bet(o, quotes.slice(0, 5), 11, request),
    /different ticket/,
  );
  const results = await rows(
    "select id from ticket_legs where ticket_id=$1 order by leg_number",
    [ticket],
  );
  const settlement = results.map((l, i) => ({
    id: l.id,
    status: i === 0 ? "PUSH" : "WON",
    evidence: "Fixture only",
  }));
  const settled = (
    await rows("select settle_weekly_ticket($1,$2) as result", [
      ticket,
      JSON.stringify(settlement),
    ])
  )[0].result;
  assert.equal(settled.payout, 235);
  assert.equal(
    (
      await rows("select settle_weekly_ticket($1,$2) as result", [
        ticket,
        JSON.stringify(settlement),
      ])
    )[0].result.duplicate,
    true,
  );
  await rows("select pause_promo($1)", [o]);
  const exact = await offer({
    terms: { ...template.terms, criterion: "points_exact" },
  });
  await rows("select claim_promo($1)", [exact]);
  await assert.rejects(bet(exact, quotes), /count/);
  const voidTicket = (await bet(exact)).ticket_id;
  await rows("select void_sportsbook_ticket($1,$2)", [
    voidTicket,
    "Fixture void",
  ]);
  await rows("select void_sportsbook_ticket($1,$2)", [
    voidTicket,
    "Fixture retry",
  ]);
  assert.equal(
    (
      await rows("select used_ticket from promo_claims where offer_id=$1", [
        exact,
      ])
    )[0].used_ticket,
    null,
  );
  assert.equal(
    (
      await rows(
        "select count(*)::int as n from promo_events where offer_id=$1 and event='restored'",
        [exact],
      )
    )[0].n,
    1,
  );
  const pushedTicket = (await bet(exact)).ticket_id;
  const pushed = (
    await rows("select id from ticket_legs where ticket_id=$1", [pushedTicket])
  ).map((l) => ({
    id: l.id,
    status: "PUSH",
    evidence: "Fixture did not play",
  }));
  assert.equal(
    (
      await rows("select settle_weekly_ticket($1,$2) as result", [
        pushedTicket,
        JSON.stringify(pushed),
      ])
    )[0].result.payout,
    10,
  );
  assert.equal(
    (
      await rows("select used_ticket from promo_claims where offer_id=$1", [
        exact,
      ])
    )[0].used_ticket,
    pushedTicket,
  );
  const fixed = await offer({
    slot: 2,
    kind: "fixed",
    title: "Locked double",
    terms: {
      legs: q
        .slice(0, 2)
        .map((l) => ({ id: l.id, label: l.label, line: 12.5, odds: 200 })),
      fixed_stake: null,
    },
  });
  await rows("select pause_promo($1)", [exact]);
  await db.exec("reset role");
  await rows(
    "update sportsbook_markets set active=false,market_state='suspended',odds=500,line=99 where id=any($1)",
    [quotes],
  );
  await act(user);
  const fixedRequest = randomUUID(),
    fixedTicket = (
      await rows("select place_fixed_ticket($1,10,$2) as result", [
        fixed,
        fixedRequest,
      ])
    )[0].result.ticket_id;
  assert.equal(
    (
      await rows("select accepted_potential_payout from tickets where id=$1", [
        fixedTicket,
      ])
    )[0].accepted_potential_payout,
    "90.00",
  );
  assert(
    (
      await rows("select accepted_line from ticket_legs where ticket_id=$1", [
        fixedTicket,
      ])
    ).every((l) => Number(l.accepted_line) === 12.5),
  );
  await assert.rejects(
    rows("select place_fixed_ticket($1,10,$2)", [fixed, randomUUID()]),
    /already been used/,
  );
  assert.equal(
    (
      await rows("select place_fixed_ticket($1,10,$2) as result", [
        fixed,
        fixedRequest,
      ])
    )[0].result.duplicate,
    true,
  );
  await assert.rejects(
    rows("select save_promo($1,$2,1,$3)", [
      A,
      fixed,
      JSON.stringify({ ...template, kind: "fixed" }),
    ]),
    /locked/,
  );
  await db.exec("reset role");
  await assert.rejects(
    rows("update ticket_promotions set boost_pct=999 where ticket_id=$1", [
      ticket,
    ]),
    /immutable/,
  );
  await rows(
    "update promo_offers set expires_at=now()-interval '1 second' where id=$1",
    [fixed],
  );
  await act(user);
  assert.equal(
    (await rows("select list_promos($1) as result", [A]))[0].result.length,
    0,
  );
  await assert.rejects(rows("select claim_promo($1)", [fixed]), /expired/);
  assert.equal(
    (
      await rows("select place_fixed_ticket($1,10,$2) as result", [
        fixed,
        fixedRequest,
      ])
    )[0].result.duplicate,
    true,
  );
  assert.throws(
    () =>
      validatePng(Buffer.from('<svg onload="alert(1)">').toString("base64")),
    /PNG/,
  );
  assert.throws(() => validatePng("not base64"), /Invalid/);
  console.log(
    "Passed promo database: authorization/image isolation, min/exact criteria, claims, maximum wager, stale rollback, profit math, partial pushes, full pushes, void/restoration retries, fixed immutable terms, one-use protection and expiry. PGlite tests only; hosted contention remains a release gate.",
  );
} finally {
  await db.close();
}
