import assert from 'node:assert/strict';

// Disposable restore only. Never connects to a hosted database.
export async function verifyUserFinancialRecovery(db) {
  const clean = async (sql, label) => assert.equal((await db.query(sql)).rows[0].n, 0, label);
  await clean(`select count(*)::int n from public.user_wallets w where
    (w.balance is null and exists(select 1 from public.user_wallet_entries e where e.wallet_id=w.id))
    or (w.balance is not null and (
      w.balance is distinct from (select sum(amount) from public.user_wallet_entries e where e.wallet_id=w.id)
      or 1<>(select count(*) from public.user_wallet_entries e where e.wallet_id=w.id and e.event_key='initialize')))
    or not exists(select 1 from sportsbook_private.user_wallet_approvals a where a.wallet_id=w.id)`,
  'Recovered wallet conservation/opening/approval evidence differs');
  await clean(`select count(*)::int n from (
    select *,row_number() over w as seq,lag(balance_after) over w as previous
    from public.user_wallet_entries window w as (partition by wallet_id order by created_at,id)
  ) e where (seq=1 and (balance_before is not null or kind not in ('opening','legacy_transfer_in') or balance_after<>amount))
    or (seq>1 and balance_before is distinct from previous)`, 'Recovered user ledger chain differs');
  await clean(`select count(*)::int n from public.user_wallet_entries e full join public.wallet_ledger l
    on l.event_key='account:transfer:'||e.wallet_id and l.kind='account_transfer_out'
      and e.kind='legacy_transfer_in'
    where (e.kind='legacy_transfer_in' or l.kind='account_transfer_out') and
      (e.id is null or l.id is null or e.team_id<>l.team_id or e.amount<>-l.amount
        or l.balance_before<>e.amount or l.balance_after<>0)`, 'Recovered legacy transfer pair differs');
  await clean(`select count(*)::int n from public.tickets t where t.user_wallet_id is not null and (
    1<>(select count(*) from public.user_wallet_entries e where e.ticket_id=t.id and e.kind='wager' and e.amount=-t.stake)
    or (case when t.status='VOIDED' then t.stake else 0 end)<>
      coalesce((select sum(amount) from public.user_wallet_entries e where e.ticket_id=t.id and e.kind='void_refund'),0)
    or (case when t.status in ('WON','PUSH','LOST') then t.actual_payout else 0 end)<>
      coalesce((select sum(amount) from public.user_wallet_entries e where e.ticket_id=t.id and e.kind='settlement'),0)
  )`, 'Recovered user wager/payout/refund receipt differs');
  let duplicateRefundChecked = false;
  const open = (await db.query(`select t.id,t.user_wallet_id,t.stake,w.balance,a.id actor
    from public.tickets t join public.user_wallets w on w.id=t.user_wallet_id
    join auth.users a on a.email_confirmed_at is not null
    where t.status='OPEN' and w.balance is not null and (
      exists(select 1 from sportsbook_private.platform_owners o where o.user_id=a.id)
      or exists(select 1 from public.league_staff_grants s where s.user_id=a.id and s.league_id=t.league_id and s.active and s.role='operator')
      or exists(select 1 from public.league_memberships m where m.user_id=a.id and m.league_id=t.league_id and m.role='admin'))
    order by t.id,a.id limit 1`)).rows[0];
  if (open) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [open.actor]);
    await db.exec("set row_security=on;set request.jwt.claim.role='authenticated';set role authenticated;");
    await db.query("select void_sportsbook_ticket($1,'Disposable local restore verification')", [open.id]);
    const duplicate = (await db.query("select void_sportsbook_ticket($1,'Disposable local restore verification') r", [open.id])).rows[0].r;
    assert.equal(duplicate.duplicate, true);
    await db.exec('reset role;');
    assert.equal((await db.query("select count(*)::int n from public.user_wallet_entries where ticket_id=$1 and kind='void_refund'", [open.id])).rows[0].n, 1);
    assert.equal((await db.query('select balance=($2::numeric+$3::numeric) correct from public.user_wallets where id=$1', [open.user_wallet_id,open.balance,open.stake])).rows[0].correct, true);
    duplicateRefundChecked = true;
  }
  await db.exec("set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';set request.jwt.claim.role='authenticated';set role authenticated;");
  for (const table of ['user_wallets', 'user_wallet_entries', 'league_staff_grants', 'league_staff_audit'])
    assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0, `Outsider sees ${table}`);
  await assert.rejects(db.query('select * from sportsbook_private.user_wallet_approvals'));
  await db.exec('reset role;set role anon;');
  await assert.rejects(db.query('select * from public.user_wallets'));
  await db.exec('reset role;');
  return { conservation_checked: true, transfer_pairs_checked: true, ticket_receipts_checked: true,
    outsider_denied: true, anonymous_denied: true, duplicate_refund_checked: duplicateRefundChecked };
}
