begin;
create table public.weekly_schedule (
 league_id uuid primary key references public.leagues(id), automation_enabled boolean not null default false,
 publication_paused boolean not null default false, opening_email boolean not null default true,
 reminder_email boolean not null default true, recap_email boolean not null default true,
 opening_time time not null default '08:00', reminder_time time not null default '19:00', recap_time time not null default '08:15',
 updated_at timestamptz not null default now()
);
create table public.weekly_execution_runs (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 nfl_season integer not null, market_week integer not null check(market_week between 1 and 18),
 operation text not null check(operation in ('settlement','replenishment')),
 summary jsonb not null, created_at timestamptz not null default now()
);
create index weekly_runs_league_date_idx on public.weekly_execution_runs(league_id,created_at desc);
alter table public.weekly_schedule enable row level security;
alter table public.weekly_execution_runs enable row level security;
revoke all on public.weekly_schedule,public.weekly_execution_runs from public,anon,authenticated;
grant select on public.weekly_schedule,public.weekly_execution_runs to authenticated;
create policy schedule_admin_read on public.weekly_schedule for select to authenticated using(sportsbook_private.is_admin(league_id));
create policy runs_admin_read on public.weekly_execution_runs for select to authenticated using(sportsbook_private.is_admin(league_id));
insert into public.weekly_schedule(league_id) select id from public.leagues;

create function public.configure_weekly_schedule(p_league uuid,p_paused boolean,p_opening boolean,p_reminder boolean,p_recap boolean,p_opening_time time,p_reminder_time time,p_recap_time time)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can configure the schedule.'; end if;
 if p_paused is null or p_opening is null or p_reminder is null or p_recap is null or p_opening_time is null or p_reminder_time is null or p_recap_time is null then raise exception 'Schedule fields are required.'; end if;
 update public.weekly_schedule set publication_paused=p_paused,opening_email=p_opening,reminder_email=p_reminder,recap_email=p_recap,opening_time=p_opening_time,reminder_time=p_reminder_time,recap_time=p_recap_time,updated_at=now() where league_id=p_league;
end $$;

-- Result fetching happens before this short transaction. Accepted ticket snapshots determine payouts.
create function public.settle_weekly_ticket(p_ticket uuid,p_results jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_wallet public.wallets; v_leg public.ticket_legs; v_result jsonb;
 v_status text; v_price numeric:=1; v_payout numeric; v_pending boolean:=false; v_lost boolean:=false; v_won boolean:=false;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can settle tickets.'; end if;
 -- Use the same wallet-before-ticket lock order as bet placement.
 select * into v_wallet from public.wallets where team_id=v_ticket.team_id for update;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status<>'OPEN' then return jsonb_build_object('duplicate',true,'status',v_ticket.status,'payout',v_ticket.actual_payout); end if;
 if v_ticket.ticket_type='future' then raise exception 'Futures are not weekly tickets.'; end if;
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>(select count(*) from public.ticket_legs where ticket_id=p_ticket) then raise exception 'Every ticket leg requires exactly one result.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_results))<>jsonb_array_length(p_results) then raise exception 'Duplicate leg result.'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) x where not exists(select 1 from public.ticket_legs l where l.id=(x->>'id')::uuid and l.ticket_id=p_ticket)) then raise exception 'Result belongs to another ticket.'; end if;
 for v_leg in select * from public.ticket_legs where ticket_id=p_ticket order by leg_number loop
  select value into v_result from jsonb_array_elements(p_results) where value->>'id'=v_leg.id::text;
  v_status:=v_result->>'status';
  if v_status is null or v_status not in ('OPEN','WON','LOST','PUSH') or coalesce(v_result->>'evidence','')='' then raise exception 'Invalid leg result.'; end if;
  if v_leg.status<>'OPEN' and v_leg.status<>v_status then raise exception 'A confirmed leg result cannot be overwritten.'; end if;
  update public.ticket_legs set status=v_status,actual_value=(v_result->>'actual_value')::numeric,result_evidence=v_result->>'evidence' where id=v_leg.id;
  v_pending:=v_pending or v_status='OPEN'; v_lost:=v_lost or v_status='LOST'; v_won:=v_won or v_status='WON';
  if v_status='WON' then
   if v_leg.accepted_decimal_odds is null or v_leg.accepted_decimal_odds<1 then raise exception 'Accepted leg odds are missing.'; end if;
   v_price:=v_price*v_leg.accepted_decimal_odds;
  end if;
 end loop;
 if v_pending then return jsonb_build_object('status','OPEN','pending',true); end if;
 v_status:=case when v_lost then 'LOST' when v_won then 'WON' else 'PUSH' end;
 v_payout:=case when v_lost then 0 when not v_won then v_ticket.stake else round(v_ticket.stake*v_price,2) end;
 update public.tickets set status=v_status,actual_payout=v_payout,settled_at=now() where id=p_ticket;
 if v_payout>0 then
  insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_ticket.team_id,p_ticket,'ticket:settle:'||p_ticket,'settlement',v_payout,v_wallet.balance,v_wallet.balance+v_payout,'Ticket '||lower(v_status));
  update public.wallets set balance=balance+v_payout,updated_at=now() where team_id=v_ticket.team_id;
 end if;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(v_ticket.league_id,v_ticket.nfl_season,v_ticket.market_week,'settlement',jsonb_build_object('ticket_id',p_ticket,'status',v_status,'payout',v_payout));
 return jsonb_build_object('status',v_status,'payout',v_payout,'duplicate',false);
end $$;

create function public.replenish_weekly_balances(p_league uuid,p_season integer,p_week integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_wallet record; v_key text; v_added integer:=0; v_blocked integer:=0; v_skipped integer:=0;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.'; end if;
 if p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.'; end if;
 for v_wallet in select w.* from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=p_league order by w.team_id for update of w loop
  v_key:='weekly:replenish:'||p_season||':'||p_week||':'||v_wallet.team_id;
  if exists(select 1 from public.wallet_ledger where event_key=v_key) then v_skipped:=v_skipped+1; continue; end if;
  if exists(select 1 from public.tickets where team_id=v_wallet.team_id and nfl_season=p_season and market_week>=p_week) then v_blocked:=v_blocked+1; continue; end if;
  -- Unresolved tickets must be reviewed before this user's reset; futures require their separate allowance rule.
  if exists(select 1 from public.tickets where team_id=v_wallet.team_id and status='OPEN' and (ticket_type='future' or (nfl_season=p_season and market_week<p_week))) then v_blocked:=v_blocked+1; continue; end if;
  if v_wallet.balance is null then v_blocked:=v_blocked+1; continue; end if;
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_wallet.team_id,v_key,'weekly_replenishment',greatest(0,100-v_wallet.balance),v_wallet.balance,greatest(100,v_wallet.balance),'Week '||p_week||' replenishment');
  if v_wallet.balance<100 then
   update public.wallets set balance=100,updated_at=now() where team_id=v_wallet.team_id;
   v_added:=v_added+1;
  end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(p_league,p_season,p_week,'replenishment',jsonb_build_object('replenished',v_added,'blocked',v_blocked,'already_processed',v_skipped));
 return jsonb_build_object('replenished',v_added,'blocked',v_blocked,'already_processed',v_skipped);
end $$;
revoke all on function public.configure_weekly_schedule(uuid,boolean,boolean,boolean,boolean,time,time,time),public.settle_weekly_ticket(uuid,jsonb),public.replenish_weekly_balances(uuid,integer,integer) from public,anon;
grant execute on function public.configure_weekly_schedule(uuid,boolean,boolean,boolean,boolean,time,time,time),public.settle_weekly_ticket(uuid,jsonb),public.replenish_weekly_balances(uuid,integer,integer) to authenticated;
commit;
