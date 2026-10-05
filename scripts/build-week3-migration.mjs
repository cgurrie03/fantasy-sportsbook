import fs from 'node:fs'
const dir=new URL('../../outputs/',import.meta.url)
const data=JSON.parse(fs.readFileSync(new URL('week3-import-prepared.json',dir),'utf8'))
const q=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'"
const amount=c=>(c/100).toFixed(2)
const league="'13121261-5398-4391-8240-000000000003'"
let sql=`begin;
create table sportsbook_private.import_batches (id text primary key, source_url text not null, approved_at timestamptz not null default now(), imported_at timestamptz not null default now());
alter table sportsbook_private.import_batches enable row level security;
revoke all on sportsbook_private.import_batches from anon,authenticated;
create table public.tickets (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id), team_id uuid not null,
 source_batch text references sportsbook_private.import_batches(id), legacy_ticket_id text, league_season integer not null, nfl_season integer not null,
 placement_week integer not null, market_week integer not null, ticket_type text not null default 'parlay', placed_at timestamptz not null,
 accepted_combined_odds integer not null, stake numeric(12,2) not null check(stake>0), accepted_potential_payout numeric(12,2) not null check(accepted_potential_payout>=0),
 status text not null check(status in ('OPEN','WON','LOST','PUSH')), actual_payout numeric(12,2) not null check(actual_payout>=0),
 net_profit numeric(12,2) generated always as (actual_payout-stake) stored, settled_at timestamptz, source_record jsonb,
 foreign key(team_id,league_id) references public.teams(id,league_id), unique(league_id,legacy_ticket_id), check((status='OPEN')=(settled_at is null))
);
create index tickets_team_date_idx on public.tickets(team_id,placed_at desc);
create index tickets_league_week_idx on public.tickets(league_id,market_week);
create index tickets_batch_idx on public.tickets(source_batch);
create table public.ticket_legs (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id), leg_number integer not null check(leg_number>0),
 selection text not null, market_type text not null, matchup text, accepted_odds integer not null, accepted_line numeric,
 status text not null check(status in ('OPEN','WON','LOST','PUSH')), actual_value numeric, result_evidence text not null, unique(ticket_id,leg_number)
);
create table public.wallet_ledger (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.wallets(team_id), ticket_id uuid references public.tickets(id),
 source_batch text references sportsbook_private.import_batches(id), event_key text not null unique,
 kind text not null check(kind in ('historical_opening','settlement','weekly_replenishment')), amount numeric(12,2) not null,
 balance_before numeric(12,2), balance_after numeric(12,2) not null check(balance_after>=0), reason text not null, created_at timestamptz not null default now(),
 check(balance_before is null or balance_after=balance_before+amount)
);
create index wallet_ledger_team_idx on public.wallet_ledger(team_id,created_at);
create index wallet_ledger_ticket_idx on public.wallet_ledger(ticket_id);
create index wallet_ledger_batch_idx on public.wallet_ledger(source_batch);
alter table public.tickets enable row level security;
alter table public.ticket_legs enable row level security;
alter table public.wallet_ledger enable row level security;
revoke all on public.tickets,public.ticket_legs,public.wallet_ledger from anon,authenticated;
grant select on public.tickets,public.ticket_legs,public.wallet_ledger to authenticated;
create policy tickets_read on public.tickets for select to authenticated using(sportsbook_private.is_member(league_id));
create policy ticket_legs_read on public.ticket_legs for select to authenticated using(exists(select 1 from public.tickets t where t.id=ticket_id));
create policy wallet_ledger_read on public.wallet_ledger for select to authenticated using(sportsbook_private.can_view_wallet(team_id));
insert into sportsbook_private.import_batches(id,source_url) values('sheet-week3-2026-v1','https://docs.google.com/spreadsheets/d/1ybv6cWMLGDEVzyELMDaewKTBpoHXdYyAdMFr1TWlUUY/edit');
do $$ begin if (select count(*) from public.teams where league_id=${league})<>12 then raise exception 'Expected 12 teams'; end if;
if exists(select 1 from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=${league} and w.balance is not null) then raise exception 'Opening wallets already initialized; review before import'; end if; end $$;
`
for(const u of data.mappings) {
 const team=`(select id from public.teams where league_id=${league} and roster_id=${u.roster_id})`
 sql+=`insert into public.league_memberships(league_id,team_id,invited_email,display_name,sleeper_user_id,role) values(${league},${team},${q(u.email)},${q(u.name)},${q(u.sleeper_user_id)},${q(u.role)}) on conflict(team_id) do nothing;\n`
 sql+=`do $$ begin if not exists(select 1 from public.league_memberships where team_id=${team} and invited_email=${q(u.email)} and sleeper_user_id=${q(u.sleeper_user_id)} and role=${q(u.role)}) then raise exception 'Mapping conflict for roster ${u.roster_id}'; end if; end $$;\n`
 sql+=`update public.wallets set balance=${amount(u.sheet_balance_cents)},updated_at=now() where team_id=${team};\ninsert into public.wallet_ledger(team_id,source_batch,event_key,kind,amount,balance_before,balance_after,reason) values(${team},'sheet-week3-2026-v1',${q('week3:opening:'+u.roster_id)},'historical_opening',${amount(u.sheet_balance_cents)},null,${amount(u.sheet_balance_cents)},'Google Sheet available balance; Week 3 stakes already deducted');\n`
 for(const t of data.tickets.filter(t=>t.legacy_user_id===u.legacy_user_id)) {
  sql+=`insert into public.tickets(league_id,team_id,source_batch,legacy_ticket_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout,settled_at,source_record) values(${league},${team},'sheet-week3-2026-v1',${q(t.legacy_ticket_id)},3,${t.nfl_season},3,3,${q(t.placed_at)},${t.accepted_combined_odds},${amount(t.stake_cents)},${amount(t.accepted_potential_payout_cents)},${q(t.result)},${amount(t.payout_cents)},now(),${q(JSON.stringify(t))}::jsonb);\n`
  const ticket=`(select id from public.tickets where league_id=${league} and legacy_ticket_id=${q(t.legacy_ticket_id)})`
  for(const [i,l]of t.legs.entries()) sql+=`insert into public.ticket_legs(ticket_id,leg_number,selection,market_type,matchup,accepted_odds,accepted_line,status,actual_value,result_evidence) values(${ticket},${i+1},${q(l.selection)},${q(l.type)},${q(l.matchup)},${l.accepted_odds},${l.accepted_line??'null'},${q(l.result)},${l.actual_value},'Sleeper league 1312126153980391424 Week 3; accepted ticket terms');\n`
  sql+=`insert into public.wallet_ledger(team_id,ticket_id,source_batch,event_key,kind,amount,balance_before,balance_after,reason) select ${team},${ticket},'sheet-week3-2026-v1',${q('week3:settle:'+t.legacy_ticket_id)},'settlement',${amount(t.payout_cents)},balance,balance+${amount(t.payout_cents)},${q('Week 3 '+t.result+' ticket '+t.legacy_ticket_id)} from public.wallets where team_id=${team};\nupdate public.wallets set balance=balance+${amount(t.payout_cents)},updated_at=now() where team_id=${team};\n`
 }
 if(u.proposed_replenishment_cents>0) sql+=`insert into public.wallet_ledger(team_id,source_batch,event_key,kind,amount,balance_before,balance_after,reason) select ${team},'sheet-week3-2026-v1',${q('week3:reset:'+u.roster_id)},'weekly_replenishment',100-balance,balance,100,'Approved post-Week 3 catch-up replenishment; excluded from betting profit' from public.wallets where team_id=${team};\nupdate public.wallets set balance=100,updated_at=now() where team_id=${team};\n`
}
sql+=`create function public.league_leaderboard(p_league uuid)
returns table(team_id uuid,bets_placed bigint,bets_won bigint,bets_lost bigint,bets_push bigint,total_wagered numeric,total_payout numeric,net_profit numeric,roi numeric,win_percentage numeric,biggest_parlay_legs bigint,biggest_parlay_odds integer,biggest_payout numeric,current_balance numeric)
language sql stable security definer set search_path='' as $$
 select t.id,count(b.id),count(b.id) filter(where b.status='WON'),count(b.id) filter(where b.status='LOST'),count(b.id) filter(where b.status='PUSH'),coalesce(sum(b.stake),0),coalesce(sum(b.actual_payout),0),coalesce(sum(b.net_profit) filter(where b.status<>'OPEN'),0),
 coalesce(100*sum(b.net_profit) filter(where b.status<>'OPEN')/nullif(sum(b.stake) filter(where b.status<>'OPEN'),0),0),coalesce(100.0*count(b.id) filter(where b.status='WON')/nullif(count(b.id) filter(where b.status in ('WON','LOST')),0),0),
 coalesce(max((select count(*) from public.ticket_legs l where l.ticket_id=b.id)) filter(where b.status='WON'),0),max(b.accepted_combined_odds) filter(where b.status='WON'),coalesce(max(b.actual_payout),0),w.balance
 from public.teams t join public.wallets w on w.team_id=t.id left join public.tickets b on b.team_id=t.id
 where t.league_id=p_league and sportsbook_private.is_member(p_league)
 group by t.id,w.balance order by 8 desc,14 desc,2 desc;
$$;
revoke all on function public.league_leaderboard(uuid) from public,anon;
grant execute on function public.league_leaderboard(uuid) to authenticated;
do $$ begin
 if (select count(*) from public.tickets where source_batch='sheet-week3-2026-v1')<>19 or (select sum(actual_payout) from public.tickets where source_batch='sheet-week3-2026-v1')<>607.40 or (select sum(balance) from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=${league})<>1517.40 then raise exception 'Import reconciliation failed'; end if;
end $$;
commit;
`
fs.writeFileSync(new URL('../supabase/migrations/202610050003_week3_import.sql',import.meta.url),sql)
const base=fs.readFileSync(new URL('../supabase/migrations/202610050001_accounts.sql',import.meta.url),'utf8')
const seed=fs.readFileSync(new URL('../supabase/migrations/202610050002_league_seed.sql',import.meta.url),'utf8')
const combined='begin;\n'+[base,seed,sql].map(s=>s.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'')).join('\n')+'\ncommit;'
fs.writeFileSync(new URL('week3-approved-import.sql',dir),combined)
console.log('Prepared atomic account setup and approved Week 3 import.')
