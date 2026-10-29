begin;
create index tickets_league_season_week_idx on public.tickets(league_id,nfl_season,market_week);
create function public.account_history_seasons(p_league uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required';end if;
 return (select coalesce(jsonb_agg(season order by season desc),'[]'::jsonb) from (
  select nfl_season season from public.leagues where id=p_league
  union select nfl_season from public.tickets where league_id=p_league
  union select nfl_season from public.league_result_weeks where league_id=p_league
 ) seasons where season between 2020 and 2100);
end $$;
revoke all on function public.account_history_seasons(uuid) from public,anon,service_role;
grant execute on function public.account_history_seasons(uuid) to authenticated;
create function public.account_betting_totals(p_league uuid,p_season integer default null,p_week integer default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required';end if;
 if (p_season is not null and p_season not between 2020 and 2100)
  or (p_week is not null and p_week not between 1 and 18) then raise exception 'Invalid betting totals period';end if;
 if (select count(*) from public.teams where league_id=p_league)>128 then raise exception 'League exceeds account summary budget';end if;
 with scoped as (
  select team_id,status,stake,actual_payout,ticket_type from public.tickets
   where league_id=p_league and (p_season is null or nfl_season=p_season) and (p_week is null or market_week=p_week)
 ), totals as (
  select t.id team_id,count(b.team_id) placed,count(b.team_id) filter(where b.status in ('WON','LOST','PUSH')) settled,
   coalesce(sum(b.stake) filter(where b.status in ('WON','LOST','PUSH')),0) stake,
   coalesce(sum(b.actual_payout-b.stake) filter(where b.status in ('WON','LOST','PUSH')),0) profit,
   coalesce(sum(b.stake) filter(where b.status='OPEN'),0) open,
   coalesce(sum(b.stake) filter(where b.status='OPEN' and b.ticket_type='future'),0) open_future,
   count(b.team_id) filter(where b.status='OPEN') open_count,
   count(b.team_id) filter(where b.status='OPEN' and b.ticket_type<>'future') open_weekly_count,
   coalesce(sum(b.stake) filter(where b.status<>'VOIDED'),0) all_stake
  from public.teams t left join scoped b on b.team_id=t.id where t.league_id=p_league group by t.id
 ) select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('roi',case when stake>0 then profit/stake else null end) order by team_id),'[]'::jsonb)
  into v_result from totals t;
 if octet_length(v_result::text)>65536 then raise exception 'Account summary byte budget exceeded';end if;
 return v_result;
end $$;
revoke all on function public.account_betting_totals(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.account_betting_totals(uuid,integer,integer) to authenticated;
comment on function public.account_betting_totals(uuid,integer,integer) is
 'RLS-preserving complete selected-league betting totals, optionally scoped by NFL season and market week. Voids count as placed but are excluded from settled ROI and wagered stakes. No raw financial histories returned.';
commit;
