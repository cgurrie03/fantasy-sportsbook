import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testPolicyPlacement(
  db,
  { owner, member, A, B, team, other },
) {
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const act = (id) =>
    db.exec(
      `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`,
    );
  await act(owner);
  await q(
    "select save_wallet_policy($1,0,2026,5,'{\"minimum_stake\":6}','Reviewed contrasting legacy policy minimum')",
    [B],
  );
  await db.exec("reset role");
  await q(
    "insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)values($1,$2,$3,$4,'Fixture participant','fixture','member')",
    [B, other, member, member + "@example.test"],
  );
  // Local activation fixture only, never a hosted rollout or owner-approval proof.
  await db.exec("set session_replication_role=replica");
  await q("update leagues set operations_enabled=true where id in($1,$2)", [
    A,
    B,
  ]);
  await db.exec("set session_replication_role=origin");
  const boards = [randomUUID(), randomUUID()],
    quotes = [],
    request = randomUUID();
  for (const [index, league] of [A, B].entries()) {
    await q(
      "insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)values($1,$2,1,2026,1,now()-interval '1 hour',now()+interval '1 hour','published','future')",
      [boards[index], league],
    );
    const ids = [];
    for (let i = 0; i < (index === 0 ? 3 : 1); i++) {
      const t = i === 0 ? (index === 0 ? team : other) : randomUUID(),
        id = randomUUID();
      if (i > 0)
        await q(
          "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,$3,'Other fantasy team','Unclaimed','Unclaimed')",
          [t, league, i + 1],
        );
      await q(
        "insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active,team_id)values($1,$2,$3,'future_win_total','Fixture wins','Team','over',8.5,100,true,$4)",
        [id, boards[index], "win-total-" + i, t],
      );
      ids.push(id);
    }
    const revision = (
      await q("select revision from sportsbook_boards where id=$1", [
        boards[index],
      ])
    )[0].revision;
    quotes.push({ ids, revision });
  }
  const place = (index, picks, stake, key = randomUUID()) =>
    q("select place_sportsbook_ticket($1,$2,$3::uuid[],$4,$5) r", [
      boards[index],
      quotes[index].revision,
      picks,
      stake,
      key,
    ]);
  const cash = async () =>
    Number(
      (await q("select balance from user_wallets where league_id=$1", [A]))[0]
        .balance,
    );
  const before = await cash();
  await act(member);
  await assert.rejects(
    place(0, quotes[0].ids.slice(0, 1), 1),
    /effective league minimum/,
    "week-one season board must obey placement-week minimum",
  );
  await assert.rejects(
    place(1, quotes[1].ids, 1),
    /effective league minimum/,
    "legacy routing uses the placement-week policy too",
  );
  await assert.rejects(
    place(0, quotes[0].ids, 5),
    /pick limit/,
    "season board cannot bypass a newer maximum-pick rule",
  );
  await db.exec("reset role");
  assert.equal(
    await cash(),
    before,
    "failed placements leave pretend balances untouched",
  );
  assert.equal((await q("select count(*)::int n from tickets"))[0].n, 0);
  await act(member);
  await place(0, quotes[0].ids.slice(0, 2), 5, request);
  await db.exec("reset role");
  const ticket = (
    await q(
      "select id,ticket_type,market_week,placement_week,policy_snapshot from tickets where request_key=$1",
      [request],
    )
  )[0];
  assert.equal(ticket.ticket_type, "future");
  assert.equal(ticket.market_week, 1);
  assert.equal(ticket.placement_week, 5);
  assert.equal(ticket.policy_snapshot.revision, 1);
  assert.equal(ticket.policy_snapshot.values.minimum_stake, 5);
  assert.equal(ticket.policy_snapshot.values.maximum_picks, 2);
  assert.equal(await cash(), before - 5);
  await q("update leagues set operations_enabled=false where id=$1", [B]);
  return {
    async checkAfterPolicyChange() {
      await db.exec("reset role;set session_replication_role=replica");
      await q("update leagues set operations_enabled=true where id=$1", [A]);
      await db.exec("set session_replication_role=origin");
      await act(member);
      await place(0, quotes[0].ids.slice(0, 2), 5, request);
      await assert.rejects(
        place(0, quotes[0].ids.slice(0, 2), 5),
        /effective league minimum/,
      );
      await db.exec("reset role");
      assert.equal(
        await cash(),
        before - 5,
        "accepted request retry does not wager twice or adopt the new minimum",
      );
      assert.equal(
        (
          await q("select policy_snapshot from tickets where id=$1", [
            ticket.id,
          ])
        )[0].policy_snapshot.values.minimum_stake,
        5,
      );
      await act(owner);
      await q("select void_sportsbook_ticket($1,$2)", [
        ticket.id,
        "Reviewed old-policy ticket refund after policy change",
      ]);
      await db.exec("reset role");
      assert.equal(
        await cash(),
        before,
        "old accepted terms still refund correctly",
      );
      await q("update leagues set operations_enabled=false where id=$1", [A]);
    },
  };
}
