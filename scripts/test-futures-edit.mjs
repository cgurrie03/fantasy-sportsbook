import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`);
  // Historical seed replay is confined to this disposable in-memory test.
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const admin = randomUUID(), outsider = randomUUID(), board = randomUUID();
  const league = "13121261-5398-4391-8240-000000000003";
  await rows("insert into auth.users values($1,'cooper.gurrie@gmail.com',now()),($2,'outsider@example.test',now())", [admin, outsider]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';select claim_memberships();`);
  const team = (await rows("select id,roster_id from teams order by roster_id limit 1"))[0];
  const quote = { id: randomUUID(), market_key: "future_champion:" + team.id,
    kind: "future_champion", label: "Synthetic champion", subject: "Team", team_id: team.id,
    side: team.id, odds: 350, metadata: { roster_id: team.roster_id, model: "protected-v1" } };
  await rows("select save_future_board_revision($1,$2,null,$3,'published')", [board, league, [quote]]);
  const revision = async () => (await rows("select revision from sportsbook_boards where id=$1", [board]))[0].revision;
  const before = await revision();
  const patch = (updates, expected = before, status = "published") =>
    rows("select patch_future_board($1,$2,$3,$4)", [board, expected, updates, status]);
  await patch([{ id: quote.id, odds: 400 }]);
  assert.deepEqual((await rows("select metadata from sportsbook_markets where id=$1", [quote.id]))[0].metadata, quote.metadata);
  assert.equal((await rows("select odds from sportsbook_markets where id=$1", [quote.id]))[0].odds, 400);
  await assert.rejects(patch([{ id: quote.id, odds: 450 }]), /changed/);
  const current = await revision();
  for (const updates of [[{ id: quote.id, odds: 400, metadata: {} }], [{ id: randomUUID(), odds: 400 }],
    [{ id: quote.id, odds: 400 }, { id: quote.id.toUpperCase(), odds: 450 }], [{ id: quote.id, odds: 425 }]])
    await assert.rejects(patch(updates, current));
  assert.equal(await revision(), current);
  await patch([], current, "closed"); await patch([], await revision(), "published");
  await assert.rejects(rows("select save_future_board_revision($1,$2,$3,$4,'published')", [board, league, before, [quote]]), /changed/);
  const outsiderRevision = await revision();
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  await assert.rejects(patch([], outsiderRevision), /authorized/);
  assert.equal((await rows("select sportsbook_board_manifest($1) m", [league]))[0].m, null);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  const manifest = async () => (await rows("select sportsbook_board_manifest($1) m", [league]))[0].m;
  let first = await manifest();
  assert.equal(first.future.id, board); assert(!("markets" in first));
  assert(!("metadata" in first.future));
  await db.exec("reset role");
  await rows("update sportsbook_markets set odds=odds where id=$1", [quote.id]);
  assert.equal((await manifest()).future.content_version, first.future.content_version);
  await rows("update sportsbook_markets set active=false where id=$1", [quote.id]);
  assert((await manifest()).future.content_version > first.future.content_version);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
  assert.equal((await rows("select sportsbook_board_manifest($1) m", [league]))[0].m.future.id, board);
  await db.exec('reset role');
  await rows('update leagues set nfl_season=nfl_season+1 where id=$1', [league]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
  await assert.rejects(patch([], current), /authorized/);
  console.log("Passed metadata-preserving futures edits, unchanged save, close/reopen, stale revisions, invalid/tampered/cross-scope edits, manifest authorization and statement-level content invalidation. In-memory only.");
} finally { await db.close(); }
