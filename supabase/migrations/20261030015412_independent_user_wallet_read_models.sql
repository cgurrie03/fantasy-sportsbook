begin;
create or replace function sportsbook_private.is_member(p_league uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select sportsbook_private.is_platform_owner()
 or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=auth.uid() and active)
 or exists(select 1 from public.league_memberships where league_id=p_league and user_id=auth.uid())
 or exists(select 1 from public.user_wallets w join sportsbook_private.user_finance_modes f on f.league_id=w.league_id
  join auth.users a on a.id=w.user_id where w.league_id=p_league and w.user_id=auth.uid()
   and f.enabled and w.status='approved' and a.email_confirmed_at is not null)
$$;
create or replace function sportsbook_private.user_finance_enabled(p_league uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select sportsbook_private.is_member(p_league) and exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and enabled)
$$;
grant execute on function sportsbook_private.user_finance_enabled(uuid) to authenticated;
create or replace function public.league_capabilities(p_league uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('league_id',l.id,'view',true,'admin',sportsbook_private.is_admin(l.id),
  'configure',sportsbook_private.is_platform_owner(),'platform_owner',sportsbook_private.is_platform_owner(),
  'wallet_model',case when sportsbook_private.user_finance_enabled(l.id) then 'user' else 'legacy' end,
  'bet',case when sportsbook_private.user_finance_enabled(l.id) then
    exists(select 1 from public.user_wallets w where w.league_id=l.id and w.user_id=auth.uid() and w.status='approved' and w.balance is not null)
   else exists(select 1 from public.league_memberships m join public.wallets w on w.team_id=m.team_id where m.league_id=l.id and m.user_id=auth.uid() and w.balance is not null) end,
  'team_id',case when sportsbook_private.user_finance_enabled(l.id) then (select team_id from public.user_wallets where league_id=l.id and user_id=auth.uid() and status='approved')
    else (select team_id from public.league_memberships where league_id=l.id and user_id=auth.uid()) end,
  'participant',case when sportsbook_private.user_finance_enabled(l.id) then
   (select jsonb_build_object('id',w.id,'wallet_id',w.id,'league_id',w.league_id,'team_id',w.team_id,'user_id',w.user_id,
     'display_name',w.display_name,'role','member','invited_email','','balance',w.balance,'source','financial')
    from public.user_wallets w where w.league_id=l.id and w.user_id=auth.uid() and w.status='approved') else null end)
 from public.leagues l where l.id=p_league
$$;

create function public.account_user_balance_page(p_league uuid,p_wallet uuid,p_cursor jsonb default null,p_limit integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare w public.user_wallets;scope text;as_of timestamptz;last_date timestamptz;last_id uuid;result jsonb;
begin
 select * into w from public.user_wallets where id=p_wallet and league_id=p_league;
 if not found then raise exception 'Financial account access required.';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid balance page limit.';end if;
 scope:=md5(p_league::text||p_wallet::text||auth.uid()::text);
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or p_cursor->>'scope' is distinct from scope
   or not(p_cursor ?& array['as_of','date','id']) then raise exception 'Invalid financial balance cursor.';end if;
  as_of:=(p_cursor->>'as_of')::timestamptz;last_date:=(p_cursor->>'date')::timestamptz;last_id:=(p_cursor->>'id')::uuid;
  if as_of is null or last_date is null or last_id is null or as_of>now()+interval '1 second' or as_of<now()-interval '1 day'
   then raise exception 'Financial balance cursor expired.';end if;
 else as_of:=now();end if;
 with scoped as materialized (select * from public.user_wallet_entries where wallet_id=p_wallet and created_at<=as_of),
 page as materialized (select * from scoped where last_id is null or (created_at,id)<(last_date,last_id) order by created_at desc,id desc limit p_limit+1),
 visible as materialized (select * from page order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('entries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticketId',ticket_id,
  'title',case kind when 'wager' then 'Ticket Placed' when 'settlement' then 'Ticket Settled' when 'void_refund' then 'Ticket Voided · Refund'
   when 'weekly_replenishment' then 'Weekly Replenishment' when 'legacy_transfer_in' then 'Reviewed Legacy Cash Transfer' else 'Balance Adjustment' end,
  'reason',reason,'amount',amount,'date',created_at,'imported',false,'balanceAfter',balance_after) order by created_at desc,id desc) from visible),'[]'::jsonb),
 'total',(select count(*) from scoped),'as_of',as_of,'wallet_id',p_wallet,
 'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('scope',scope,'as_of',as_of,'date',created_at,'id',id)
  from visible order by created_at,id limit 1) else null end) into result;
 if octet_length(result::text)>262144 then raise exception 'Financial balance page byte budget exceeded.';end if;
 return result;
end $$;
revoke all on function public.account_user_balance_page(uuid,uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.account_user_balance_page(uuid,uuid,jsonb,integer) to authenticated;

create function public.account_personal_totals(p_league uuid,p_season integer default null,p_week integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required.';end if;
 if (p_season is not null and p_season not between 2020 and 2100) or (p_week is not null and p_week not between 1 and 18) then raise exception 'Invalid betting totals period.';end if;
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('roi',case when s.stake>0 then s.profit/s.stake else null end)),'[]'::jsonb) into result from (
  select w.id wallet_id,w.team_id,count(t.id) placed,count(t.id) filter(where t.status in ('WON','LOST','PUSH')) settled,
   coalesce(sum(t.stake) filter(where t.status in ('WON','LOST','PUSH')),0) stake,
   coalesce(sum(t.actual_payout-t.stake) filter(where t.status in ('WON','LOST','PUSH')),0) profit,
   coalesce(sum(t.stake) filter(where t.status='OPEN'),0) open,
   coalesce(sum(t.stake) filter(where t.status='OPEN' and t.ticket_type='future'),0) open_future,
   count(t.id) filter(where t.status='OPEN') open_count,count(t.id) filter(where t.status='OPEN' and t.ticket_type<>'future') open_weekly_count,
   coalesce(sum(t.stake) filter(where t.status<>'VOIDED'),0) all_stake
  from public.user_wallets w left join public.tickets t on t.user_wallet_id=w.id and (p_season is null or t.nfl_season=p_season) and (p_week is null or t.market_week=p_week)
  where w.league_id=p_league and w.user_id=auth.uid() and w.status='approved' group by w.id,w.team_id
 ) s;
 return result;
end $$;
revoke all on function public.account_personal_totals(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.account_personal_totals(uuid,integer,integer) to authenticated;

-- Personal history is scoped by immutable wallet identity. Legacy team tickets
-- remain visible in league/admin history; no historical ownership is inferred.
do $$declare d text;begin
 select pg_get_functiondef('public.account_ticket_page(uuid,jsonb,jsonb,integer)'::regprocedure) into d;
 if position('select team_id into v_team from public.league_memberships' in d)=0 then raise exception 'Personal ticket scope anchor changed.';end if;
 d:=replace(d,'select team_id into v_team from public.league_memberships where league_id=p_league and user_id=(select auth.uid());',
  'if sportsbook_private.user_finance_enabled(p_league) then select team_id into v_team from public.user_wallets where league_id=p_league and user_id=auth.uid() and status=''approved'';else select team_id into v_team from public.league_memberships where league_id=p_league and user_id=auth.uid();end if;');
 d:=replace(d,'t.id,t.league_id,t.nfl_season,t.team_id,t.legacy_ticket_id','t.id,t.league_id,t.nfl_season,t.team_id,t.user_wallet_id,t.bettor_display_name,t.legacy_ticket_id');
 d:=replace(d,'and (v_team is null or t.team_id=v_team)',
  'and (v_team is null or t.team_id=v_team) and (not v_personal or not sportsbook_private.user_finance_enabled(p_league) or t.user_wallet_id=(select id from public.user_wallets where league_id=p_league and user_id=auth.uid() and status=''approved''))');
 d:=replace(d,'''legacy_ticket_id'',legacy_ticket_id,','''user_wallet_id'',user_wallet_id,''bettor_display_name'',bettor_display_name,''legacy_ticket_id'',legacy_ticket_id,');
 execute d;
end $$;
commit;
