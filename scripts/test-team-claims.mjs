import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const [owner, primary, coowner, outsider, unverified] = Array.from(
  { length: 5 },
  randomUUID,
);
const [A, B, team, other] = Array.from({ length: 4 }, randomUUID);
const act = (id) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
  );
const token = () => randomBytes(32).toString("hex"),
  digest = (t) => createHash("sha256").update(t).digest("hex");
const reason = "Reviewed verified manager identity and team association";
const issue = (t, league = A, target = null, email = null) =>
  q("select issue_team_invitation($1,$2,$3,$4,$5) r", [
    league,
    target,
    email,
    digest(t),
    reason,
  ]).then((r) => r[0].r);
const submit = (t, tId = team, name = "Participant") =>
  q("select submit_team_claim($1,$2,$3) r", [t, tId, name]).then((r) => r[0].r);
const review = (id, rev = 1, action = "approve", why = reason) =>
  q("select review_team_claim($1,$2,$3,$4) r", [id, rev, action, why]).then(
    (r) => r[0].r,
  );
const directory = (league) =>
  q("select team_claim_directory($1) r", [league]).then((r) => r[0].r);
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  for (const id of [owner, primary, coowner, outsider, unverified])
    await q("insert into auth.users values($1,$2,$3)", [
      id,
      id + "@example.test",
      id === unverified ? null : new Date().toISOString(),
    ]);
  for (const id of [A, B])
    await q(
      "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season)values($1,'Claim fixture',($1::uuid)::text,2026,1)",
      [id],
    );
  for (const [id, league] of [
    [team, A],
    [other, B],
  ])
    await q(
      "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,1,'Unclaimed team','Unknown','Unknown')",
      [id, league],
    );
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  await act(outsider);
  await assert.rejects(issue(token()), /owner/);
  await assert.rejects(directory(A), /owner/);
  await assert.rejects(
    q("select * from sportsbook_private.team_invitations"),
    /permission denied/,
  );
  assert.deepEqual((await directory(null)).claims, []);
  await act(owner);
  const t = token(),
    _invite = await issue(t);
  assert.equal((await issue(t)).duplicate, true);
  await assert.rejects(issue(t, B), /different terms/);
  await assert.rejects(issue(token(), A, other), /Scoped team/);
  await act(unverified);
  await assert.rejects(submit(t), /Verified sign-in/);
  await act(primary);
  const preview = (await q("select team_invitation_preview($1) r", [t]))[0].r;
  assert.equal(preview.teams.length, 1);
  assert.equal(preview.teams[0].id, team);
  assert(!JSON.stringify(preview).includes("example.test"));
  await assert.rejects(submit(token()), /unavailable/);
  await assert.rejects(submit(t, other), /Scoped team/);
  const claim = await submit(t, team, "Primary");
  assert.equal(claim.state, "pending");
  assert.equal((await submit(t, team, "Primary")).duplicate, true);
  await assert.rejects(submit(t, team, "Changed"), /different terms/);
  assert.equal((await q("select count(*)::int n from user_wallets"))[0].n, 0);
  await assert.rejects(review(claim.id), /owner/);
  await act(coowner);
  assert.deepEqual((await directory(null)).claims, []);
  const co = await submit(t, team, "Co-owner");
  await act(owner);
  await assert.rejects(review(claim.id, 2), /changed/);
  const approved = await review(claim.id);
  assert.equal(approved.state, "approved");
  assert.equal((await review(claim.id)).duplicate, true);
  const approvedCo = await review(co.id);
  assert.notEqual(approvedCo.wallet_id, approved.wallet_id);
  await db.exec("reset role");
  assert.equal(
    (
      await q("select count(*)::int n from user_wallets where balance is null")
    )[0].n,
    2,
  );
  assert.equal(
    (await q("select count(*)::int n from user_wallet_entries"))[0].n,
    0,
  );
  assert.equal(
    (await q("select count(*)::int n from league_memberships"))[0].n,
    0,
  );
  assert.equal(
    (await q("select count(*)::int n from league_staff_grants"))[0].n,
    0,
  );
  assert.equal((await q("select count(*)::int n from tickets"))[0].n, 0);
  const stored = JSON.stringify(
    await q("select * from sportsbook_private.team_invitations"),
  );
  assert(!stored.includes(t));
  assert(stored.includes(digest(t)));
  assert(
    !JSON.stringify(await q("select * from admin_change_log")).includes(t),
  );
  await act(owner);
  const revoked = await review(co.id, 2, "revoke");
  assert.equal(revoked.state, "revoked");
  await db.exec("reset role");
  assert.equal(
    (
      await q("select status from user_wallets where id=$1", [
        approvedCo.wallet_id,
      ])
    )[0].status,
    "revoked",
  );
  await act(owner);
  const target = token();
  await issue(target, B, other, primary + "@example.test");
  await act(outsider);
  await assert.rejects(submit(target, other), /unavailable/);
  await assert.rejects(
    q("select team_invitation_preview($1)", [target]),
    /unavailable/,
  );
  await act(primary);
  const second = await submit(target, other, "Primary");
  await act(owner);
  await review(second.id);
  await act(primary);
  assert.equal(
    (await directory(null)).claims.length,
    2,
    "one verified account can claim independently in two leagues",
  );
  await act(owner);
  const r = token(),
    ri = await issue(r);
  await act(outsider);
  const pending = await submit(r);
  await act(owner);
  await q("select revoke_team_invitation($1,1,$2)", [ri.id, reason]);
  await assert.rejects(review(pending.id), /changed/);
  await act(outsider);
  assert.equal((await directory(null)).claims[0].state, "revoked");
  await assert.rejects(submit(r), /unavailable/);
  await act(owner);
  const exp = token(),
    ei = await issue(exp);
  await act(outsider);
  const ec = await submit(exp);
  await db.exec("reset role");
  await q(
    "update sportsbook_private.team_invitations set expires_at=now()-interval '1 minute' where id=$1",
    [ei.id],
  );
  await act(outsider);
  assert.equal(
    (await directory(null)).claims.find((c) => c.id === ec.id).state,
    "expired",
  );
  await act(owner);
  await assert.rejects(review(ec.id), /expired/);
  const replacement = token();
  await issue(replacement);
  await act(outsider);
  const replacementClaim = await submit(replacement);
  await act(owner);
  assert.equal(
    (await review(replacementClaim.id, 1, "reject")).state,
    "rejected",
  );
  assert.equal(
    (await review(replacementClaim.id, 1, "reject")).duplicate,
    true,
  );
  await act(outsider);
  assert.equal(
    (await directory(null)).claims.find((c) => c.id === replacementClaim.id)
      .state,
    "rejected",
  );
  await act(owner);
  // Changed verification cannot pass owner review, even with a previously valid JWT.
  const changed = token();
  await issue(changed, B, other, outsider + "@example.test");
  await act(outsider);
  const cc = await submit(changed, other);
  await db.exec("reset role");
  await q("update auth.users set email_confirmed_at=null where id=$1", [
    outsider,
  ]);
  await act(owner);
  await assert.rejects(review(cc.id), /identity changed/);
  await db.exec("reset role;set role anon");
  await assert.rejects(submit(t), /permission denied/);
  await db.exec("reset role;set role service_role");
  await assert.rejects(issue(token()), /permission denied/);
  await db.exec("reset role");
  // Exercise the admission boundary with synthetic private rows, not real Auth.
  await q(
    `insert into sportsbook_private.team_invitations(league_id,token_digest,created_by,expires_at,reason)
    select $1,encode(sha256(convert_to(n::text,'UTF8')),'hex'),$2,now()+interval '1 day',$3 from generate_series(1,32)n`,
    [A, owner, reason],
  );
  await act(owner);
  await assert.rejects(issue(token()), /admission budget/);
  await db.exec("reset role");
  await q("update auth.users set email_confirmed_at=null where id=$1", [owner]);
  await act(owner);
  await assert.rejects(issue(token()), /owner/);
  await assert.rejects(directory(A), /Verified sign-in/);
  console.log(
    "Verified claims: opaque scoped invitations, no email directory, verified-email binding, CAS/idempotent review, separate co-owner/two-league wallets, pending/rejected/revoked/expiry, no staff/funds or fabricated memberships.",
  );
} finally {
  await db.close();
}
