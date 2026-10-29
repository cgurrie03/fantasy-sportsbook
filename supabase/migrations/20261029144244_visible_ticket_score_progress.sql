begin;
create function public.account_score_progress(p_league uuid,p_tickets uuid[] default '{}'::uuid[],p_current jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_season integer;v_week integer;
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required';end if;
 if p_tickets is null or cardinality(p_tickets)>20 or array_position(p_tickets,null) is not null then raise exception 'At most 20 visible tickets required';end if;
 if p_current is not null and p_current<>'null'::jsonb then
  if jsonb_typeof(p_current)<>'object' or not(p_current ?& array['season','week'])
   or exists(select 1 from jsonb_object_keys(p_current) k where k not in ('season','week')) then raise exception 'Invalid current score period';end if;
  v_season:=(p_current->>'season')::integer;v_week:=(p_current->>'week')::integer;
  if v_season is null or v_week is null or v_week not between 1 and 18
   or v_season is distinct from (select nfl_season from public.leagues where id=p_league)
   then raise exception 'Invalid current score period';end if;
 end if;
 with visible as materialized (
  select id,nfl_season,market_week from public.tickets where league_id=p_league and id=any(p_tickets)
   and status='OPEN' and ticket_type<>'future'
 ), periods as (
  select nfl_season,market_week from visible union select v_season,v_week where v_week is not null
 ), players as (
  select distinct v.nfl_season,v.market_week,p.id from visible v join public.ticket_legs l on l.ticket_id=v.id
   cross join lateral(values(l.settlement_context->'metadata'->>'player_id'),(l.settlement_context->'metadata'->>'opponent_player_id')) p(id)
   where l.status='OPEN' and l.settlement_context->>'kind' in ('player_points','player_milestone','player_h2h') and p.id is not null
 ), observations as (
  select o.league_id,o.nfl_season,o.market_week,o.fetched_at,o.cadence_minutes,
   jsonb_build_object('teams',coalesce(o.payload->'teams','{}'::jsonb),'players',coalesce((
    select jsonb_object_agg(p.id,o.payload->'players'->p.id) from players p
    where p.nfl_season=o.nfl_season and p.market_week=o.market_week and o.payload->'players' ? p.id),'{}'::jsonb),
    'week_final',o.payload->'week_final','provider_observed_at',o.payload->'provider_observed_at',
    'observation_note',o.payload->'observation_note') as payload
   from public.ticket_score_observations o join periods p using(nfl_season,market_week) where o.league_id=p_league
 ) select coalesce(jsonb_agg(to_jsonb(o) order by nfl_season,market_week),'[]'::jsonb) into v_result from observations o;
 if octet_length(v_result::text)>262144 then raise exception 'Visible score response exceeds byte budget';end if;
 return v_result;
end $$;
revoke all on function public.account_score_progress(uuid,uuid[],jsonb) from public,anon,service_role;
grant execute on function public.account_score_progress(uuid,uuid[],jsonb) to authenticated;
comment on function public.account_score_progress(uuid,uuid[],jsonb) is
 'Read only selected periods and players referenced by at most 20 visible open tickets; current board requests receive team scores without unrelated player bodies. RLS remains active.';
commit;
