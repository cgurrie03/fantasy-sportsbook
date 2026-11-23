import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const productionRef='bmvjcdgxwxqalaohpsnw';
export const canonical=value=>JSON.stringify(value&&typeof value==='object'?
  Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function cents(value) {
  const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  assert(m,`Invalid two-decimal credit amount: ${value}`);
  return BigInt(m[2])*100n*(m[1]?-1n:1n)+BigInt((m[3]??'').padEnd(2,'0'))*(m[1]?-1n:1n);
}
export const creditString=value=>`${value<0n?'-':''}${(value<0n?-value:value)/100n}.${((value<0n?-value:value)%100n).toString().padStart(2,'0')}`;
export function legacyFutureRouting(snapshot,contexts){
  unique(contexts,'id','legacy future context');
  const open=snapshot.tickets.filter(t=>t.status==='OPEN'&&t.ticket_type==='future');
  const expected=snapshot.legs.filter(l=>open.some(t=>t.id===l.ticket_id));
  assert.equal(contexts.length,expected.length,'Missing legacy accepted context');
  const kinds={'Make / Miss Playoffs':'future_playoffs','Regular-season Wins':'future_win_total','League Winner':'future_champion','#1 Pick':'future_first_pick'};
  return expected.map(leg=>{
    const row=contexts.find(r=>r.id===leg.id),context=row?.settlement_context;
    assert(context&&context.kind===kinds[leg.market_type],'Unsupported or changed accepted market');
    const subject=snapshot.teams.find(t=>t.id===context.team_id);
    assert(subject&&subject.roster_id===Number(context.metadata?.roster_id),'Accepted roster identity mismatch');
    assert.equal(row.accepted_line==null?null:Number(row.accepted_line),leg.accepted_line==null?null:Number(leg.accepted_line),'Accepted line changed');
    const ticket=open.find(t=>t.id===leg.ticket_id);
    // The selected team's identity is NOT the bettor/payout recipient.
    return {ticket_id:ticket.id,leg_id:leg.id,bettor_team_id:ticket.team_id,subject_team_id:subject.id,
      subject_roster_id:subject.roster_id,kind:context.kind,side:context.side,accepted_line:leg.accepted_line,
      accepted_odds:leg.accepted_odds,accepted_context_digest:digest(context),
      recipient_status:'requires_immutable_bettor_attribution',migration_action:'preserve_accepted_context'};
  });
}
function unique(rows,key,label) {assert.equal(new Set(rows.map(r=>r[key])).size,rows.length,`Duplicate ${label}`);}
export function prepareMigration(snapshot) {
  assert.equal(snapshot.format,'boff-production-migration-inventory-v1');
  assert.equal(snapshot.project_ref,productionRef,'Wrong migration source');
  assert(Number.isFinite(Date.parse(snapshot.captured_at)),'Invalid capture time');
  for(const name of ['leagues','teams','members','wallets','tickets','legs','ledger'])assert(Array.isArray(snapshot[name]),`Missing ${name}`);
  for(const name of ['leagues','teams','members','tickets','legs','ledger'])unique(snapshot[name],'id',name);
  unique(snapshot.wallets,'team_id','wallet');
  const teamIds=new Set(snapshot.teams.map(t=>t.id)),ticketIds=new Set(snapshot.tickets.map(t=>t.id));
  for(const t of snapshot.tickets){assert(teamIds.has(t.team_id),'Orphan ticket');cents(t.stake);cents(t.accepted_potential_payout);}
  for(const l of snapshot.legs)assert(ticketIds.has(l.ticket_id),'Orphan leg');
  const reservations=snapshot.wallets.map(w=>{
    assert(teamIds.has(w.team_id),'Orphan wallet');
    const members=snapshot.members.filter(m=>m.team_id===w.team_id);
    assert(members.length===1,'Ambiguous legacy wallet recipient; review required');
    const member=members[0];
    assert(!member.user_id||member.user_id===member.matched_auth_id,'Linked account differs from mapped email');
    return {team_id:w.team_id,membership_id:member.id,sleeper_user_id:member.sleeper_user_id,
      // A verified mapping is a candidate, not proof of every historical ticket's bettor.
      user_id:member.verified&&member.user_id===member.matched_auth_id?member.user_id:null,
      email_fingerprint:member.email_fingerprint,amount:creditString(cents(w.balance)),
      account_state:member.verified?'verified':member.matched_auth_id?'verification_required':'invitation_required',
      routine_mail_allowed:member.verified&&!!member.user_id,
      event_key:`production-migration:${w.team_id}`};
  });
  const open=snapshot.tickets.filter(t=>t.status==='OPEN');
  const futureTypes=new Set(['Make / Miss Playoffs','Regular-season Wins','League Winner','#1 Pick']);
  const isFuture=t=>{const legs=snapshot.legs.filter(l=>l.ticket_id===t.id);return legs.length>0&&legs.every(l=>futureTypes.has(l.market_type));};
  const openFutures=open.filter(isFuture);
  const total=rows=>creditString(rows.reduce((sum,r)=>sum+cents(r),0n));
  const finance={wallets:snapshot.wallets.length,available:total(snapshot.wallets.map(w=>w.balance)),
    tickets:snapshot.tickets.length,legs:snapshot.legs.length,ledger:snapshot.ledger.length,
    open_tickets:open.length,open_stakes:total(open.map(t=>t.stake)),
    open_futures:openFutures.length,open_future_stakes:total(openFutures.map(t=>t.stake)),
    open_nonfuture_stakes:total(open.filter(t=>!isFuture(t)).map(t=>t.stake)),
    accepted_open_payouts:total(open.map(t=>t.accepted_potential_payout)),
    ticket_statuses:Object.fromEntries([...new Set(snapshot.tickets.map(t=>t.status))].sort().map(status=>[status,snapshot.tickets.filter(t=>t.status===status).length]))};
  const blockers=[
    'Apply and rehearse the full additive Production schema upgrade; Development SQL is not a Production upgrade.',
    'Approve immutable legacy ticket attribution separately from current roster membership; retain unproved history as archive.',
    'Map legacy open futures to their accepted season/rules and stable roster subjects before enabling settlement; never treat market_week=1 as an expired weekly bet.',
    'Take and restore-test a fresh encrypted Production checkpoint, including application/configuration recovery.',
    'Approve exact release source, schema, worker, scheduled jobs and postflight evidence before enabling Production writes.',
  ];
  return {format:'boff-production-migration-plan-v1',source_digest:digest(snapshot),captured_at:snapshot.captured_at,
    production_unchanged:true,ready_for_cutover:false,finance,reservations,
    legacy_open_futures:openFutures.map(t=>({id:t.id,team_id:t.team_id,placed_at:t.placed_at,stake:t.stake})),
    open_nonfuture_tickets:open.filter(t=>!isFuture(t)).map(t=>t.id),
    blockers};
}
// Disposable financial staging rehearsal, not an application-schema restore.
// Keep accepted records byte-equivalent and reserve funds exactly once without
// creating Auth accounts, asserting historical ownership, or minting credit.
export async function rehearseFinancialStage(db,snapshot,plan=prepareMigration(snapshot)) {
  assert.equal(plan.source_digest,digest(snapshot),'Snapshot changed after review');
  await db.exec(`create schema migration_rehearsal;
    create table migration_rehearsal.receipts(kind text,id text,payload jsonb,primary key(kind,id));
    create table migration_rehearsal.reserved_funds(event_key text primary key,team_id uuid unique,amount numeric(20,2),user_id uuid,payload jsonb);
    create table migration_rehearsal.legacy_wallets(team_id uuid primary key,balance numeric(20,2));`);
  for(const kind of ['tickets','legs','ledger'])for(const row of snapshot[kind])
    await db.query('insert into migration_rehearsal.receipts values($1,$2,$3)',[kind,row.id,JSON.stringify(row)]);
  for(const row of snapshot.wallets)await db.query('insert into migration_rehearsal.legacy_wallets values($1,$2)',[row.team_id,String(row.balance)]);
  const reserve=async(p)=>{
    for(const r of p.reservations){
      const existing=(await db.query('select payload from migration_rehearsal.reserved_funds where event_key=$1',[r.event_key])).rows[0];
      if(existing){assert.equal(canonical(existing.payload),canonical(r),'Changed duplicate reservation');continue;}
      const moved=await db.query('update migration_rehearsal.legacy_wallets set balance=0 where team_id=$1 and balance=$2 returning team_id',[r.team_id,r.amount]);
      assert.equal(moved.rows.length,1,'Wallet changed after snapshot');
      await db.query('insert into migration_rehearsal.reserved_funds values($1,$2,$3,$4,$5)',[r.event_key,r.team_id,r.amount,r.user_id,JSON.stringify(r)]);
    }
  };
  await db.exec('begin');await reserve(plan);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from migration_rehearsal.reserved_funds')).rows[0].n,0,'Rollback left funds reserved');
  await db.exec('begin');await reserve(plan);await reserve(plan);await db.exec('commit');
  const total=(await db.query('select (select sum(balance) from migration_rehearsal.legacy_wallets)+(select sum(amount) from migration_rehearsal.reserved_funds) amount')).rows[0].amount;
  assert.equal(cents(total),cents(plan.finance.available),'Available funds were lost or duplicated');
  assert.equal((await db.query('select count(*)::int n from migration_rehearsal.reserved_funds')).rows[0].n,snapshot.wallets.length);
  for(const kind of ['tickets','legs','ledger']){
    const actual=(await db.query('select payload from migration_rehearsal.receipts where kind=$1 order by id',[kind])).rows.map(r=>r.payload);
    const expected=[...snapshot[kind]].sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(digest(actual),digest(expected),`${kind} changed during staging`);
  }
  return {coverage:'financial-staging-only',rollback:true,retry_idempotent:true,accepted_records_preserved:true,
    available_funds_conserved:true,application_schema_rehearsed:false,auth_accounts_created:0,emails_sent:0};
}
