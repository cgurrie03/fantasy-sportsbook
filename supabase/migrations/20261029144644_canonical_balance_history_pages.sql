begin;
create function public.account_balance_page(p_league uuid,p_team uuid,p_cursor jsonb default null,p_limit integer default 30)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_hash text;v_as_of timestamptz;v_balance numeric;v_date timestamptz;v_phase integer;v_placed timestamptz;v_id text;v_result jsonb;
begin
 if not sportsbook_private.can_view_wallet(p_team) or not exists(select 1 from public.teams where id=p_team and league_id=p_league)
  then raise exception 'Account history access required';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid balance page limit';end if;
 v_hash:=md5(p_league::text||p_team::text||coalesce((select auth.uid())::text,''));
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or p_cursor->>'scope' is distinct from v_hash
   or not(p_cursor ?& array['as_of','balance','date','phase','placed','id']) then raise exception 'Invalid balance cursor';end if;
  v_as_of:=(p_cursor->>'as_of')::timestamptz;v_balance:=(p_cursor->>'balance')::numeric;
  v_date:=(p_cursor->>'date')::timestamptz;v_phase:=(p_cursor->>'phase')::integer;
  v_placed:=(p_cursor->>'placed')::timestamptz;v_id:=p_cursor->>'id';
  if v_as_of is null or v_date is null or v_phase is null or v_placed is null or v_id is null or length(v_id)>80
   or v_phase not between 0 and 3 or v_as_of>now()+interval '1 second' or v_as_of<now()-interval '1 day'
   or v_balance::text in ('NaN','Infinity','-Infinity') then raise exception 'Balance cursor expired or invalid; refresh history';end if;
 else
  v_as_of:=now();select balance into v_balance from public.wallets where team_id=p_team;
 end if;
 with scoped_tickets as materialized (
  select id,legacy_ticket_id,market_week,ticket_type,status,stake,placed_at from public.tickets
   where league_id=p_league and team_id=p_team and placed_at<=v_as_of
 ), entries as (
  select 'wager-'||t.id::text id,t.id ticket_id,'Ticket Placed' title,
   case when t.ticket_type='future' then 'Season futures' else 'Week '||t.market_week end||' · '||coalesce(t.legacy_ticket_id,left(t.id::text,8)) reason,
   null::numeric recorded_balance,-t.stake amount,t.placed_at date,false imported,0 phase,t.placed_at placed
  from scoped_tickets t where not exists(select 1 from public.wallet_ledger l where l.ticket_id=t.id and l.kind='wager' and l.created_at<=v_as_of)
  union all
  select e.id::text,null::uuid,'Balance Adjustment',e.reason,e.new_balance,e.new_balance-coalesce(e.previous_balance,0),e.created_at,false,3,'1970-01-01T00:00:00Z'::timestamptz
  from public.balance_events e where e.team_id=p_team and e.kind<>'opening_balance' and e.created_at<=v_as_of
  union all
  select l.id::text,t.id,
   case when l.kind='void_refund' then 'Ticket Voided · Refund' when l.kind='wager' then 'Ticket Placed'
    when l.kind='weekly_replenishment' then 'Weekly Replenishment' when t.status='PUSH' then 'Wager Returned' else 'Ticket Won' end,
   case when t.id is null then l.reason else case when t.ticket_type='future' then 'Season futures' else 'Week '||t.market_week end||' · '||coalesce(t.legacy_ticket_id,left(t.id::text,8)) end,
   l.balance_after,l.balance_after-coalesce(l.balance_before,0),l.created_at,l.source_batch is not null,
   case when l.kind='weekly_replenishment' then 2 else 1 end,coalesce(t.placed_at,'1970-01-01T00:00:00Z'::timestamptz)
  from public.wallet_ledger l left join scoped_tickets t on t.id=l.ticket_id
   where l.team_id=p_team and l.kind<>'historical_opening' and l.created_at<=v_as_of
 ), grouped as (
  select *,count(recorded_balance) over(order by date desc,phase desc,placed desc,id rows unbounded preceding) anchor_group
   from entries where amount<>0
 ), balanced as materialized (
  select *,coalesce(first_value(recorded_balance) over(partition by anchor_group order by date desc,phase desc,placed desc,id),
   case when anchor_group=0 then v_balance end)
   -coalesce(sum(amount) over(partition by anchor_group order by date desc,phase desc,placed desc,id rows between unbounded preceding and 1 preceding),0) balance_after
  from grouped
 ), page as materialized (
  select * from balanced where v_id is null or date<v_date
   or (date=v_date and phase<v_phase) or (date=v_date and phase=v_phase and placed<v_placed)
   or (date=v_date and phase=v_phase and placed=v_placed and id>v_id)
   order by date desc,phase desc,placed desc,id limit p_limit+1
 ), visible as materialized (select * from page order by date desc,phase desc,placed desc,id limit p_limit)
 select jsonb_build_object('entries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticketId',ticket_id,'title',title,
  'reason',reason,'amount',amount,'date',date,'imported',imported,'balanceAfter',balance_after) order by date desc,phase desc,placed desc,id) from visible),'[]'::jsonb),
  'total',(select count(*) from balanced),'as_of',v_as_of,
  'next',case when (select count(*) from page)>p_limit then
   (select jsonb_build_object('scope',v_hash,'as_of',v_as_of,'balance',v_balance::text,'date',date,'phase',phase,'placed',placed,'id',id)
    from visible order by date,phase,placed,id desc limit 1) else null end) into v_result;
 if octet_length(v_result::text)>262144 then raise exception 'Balance history page exceeds byte budget';end if;
 return v_result;
end $$;
revoke all on function public.account_balance_page(uuid,uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.account_balance_page(uuid,uuid,jsonb,integer) to authenticated;
comment on function public.account_balance_page(uuid,uuid,jsonb,integer) is
 'Read-only canonical balance history with stable tie order, imported wager fallback, recorded balance anchors and a frozen wallet snapshot per cursor. RLS and team authorization remain active.';
commit;
