begin;

-- Selected-league keyset order. Existing team/date and child-ticket indexes stay.


create or replace function public.account_ticket_page(p_league uuid,p_filters jsonb default '{}'::jsonb,
 p_cursor jsonb default null,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 v_season integer;v_market_week integer;v_ticket uuid;v_details boolean:=true;
 v_status text:=coalesce(p_filters->>'status','All');
 v_week text:=coalesce(p_filters->>'week','all');
 v_sort text:=coalesce(p_filters->>'sort','placed');
 v_direction text:=coalesce(p_filters->>'direction','desc');
 v_query text:=trim(coalesce(p_filters->>'query',''));
 v_team uuid;v_personal boolean:=false;v_hash text;v_as_of timestamptz;
 v_key numeric;v_date numeric;v_id uuid;v_result jsonb;
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required';end if;
 if jsonb_typeof(p_filters)<>'object' or p_filters is null
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('status','week','sort','direction','query','team','personal','season','market_week','ticket','details'))
  or v_status not in ('All','Open','Settled','Won','Lost','Voided')
  or v_week not in ('all','futures','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18')
  or v_sort not in ('placed','settled','winnings','odds') or v_direction not in ('asc','desc')
  or length(v_query)>128 or p_limit is null or p_limit not between 1 and 50
  or (p_filters ? 'personal' and jsonb_typeof(p_filters->'personal')<>'boolean')
 then raise exception 'Invalid ticket filters';end if;
 if (p_filters ? 'season' and jsonb_typeof(p_filters->'season')<>'number')
  or (p_filters ? 'market_week' and jsonb_typeof(p_filters->'market_week')<>'number')
  or (p_filters ? 'ticket' and jsonb_typeof(p_filters->'ticket')<>'string')
  or (p_filters ? 'details' and jsonb_typeof(p_filters->'details')<>'boolean') then raise exception 'Invalid ticket period or identity filter';end if;
 v_details:=coalesce((p_filters->>'details')::boolean,true);
 v_season:=(p_filters->>'season')::integer;v_market_week:=(p_filters->>'market_week')::integer;v_ticket:=(p_filters->>'ticket')::uuid;
 if (v_season is not null and v_season not between 2020 and 2100) or (v_market_week is not null and v_market_week not between 1 and 18)
  then raise exception 'Invalid ticket period';end if;
 v_personal:=coalesce((p_filters->>'personal')::boolean,false);
 if v_personal then
  select team_id into v_team from public.league_memberships where league_id=p_league and user_id=(select auth.uid());
  if v_team is null then raise exception 'Personal account unavailable';end if;
 elsif coalesce(p_filters->>'team','all')<>'all' then v_team:=(p_filters->>'team')::uuid;
 end if;
 v_hash:=md5(p_league::text||coalesce((select auth.uid())::text,'')||p_filters::text);
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or p_cursor->>'scope' is distinct from v_hash
   or not (p_cursor ?& array['as_of','key','date','id']) then raise exception 'Invalid ticket cursor';end if;
  v_as_of:=(p_cursor->>'as_of')::timestamptz;v_key:=(p_cursor->>'key')::numeric;
  v_date:=(p_cursor->>'date')::numeric;v_id:=(p_cursor->>'id')::uuid;
  if v_as_of is null or v_key is null or v_date is null or v_id is null
   or v_as_of>now()+interval '1 second' or v_as_of<now()-interval '1 day'
   or v_key::text in ('NaN','Infinity','-Infinity') or v_date::text in ('NaN','Infinity','-Infinity')
   then raise exception 'Ticket cursor expired or invalid; refresh history';end if;
 else v_as_of:=now();end if;
 with eligible as materialized (
  select t.id,t.league_id,t.nfl_season,t.team_id,t.legacy_ticket_id,t.placement_week,t.market_week,t.placed_at,t.settled_at,
   t.stake,t.accepted_combined_odds,t.ticket_type,t.accepted_potential_payout,t.actual_payout,t.status
  from public.tickets t where t.league_id=p_league and t.placed_at<=v_as_of
   and (v_season is null or t.nfl_season=v_season) and (v_market_week is null or t.market_week=v_market_week) and (v_ticket is null or t.id=v_ticket)
   and (v_team is null or t.team_id=v_team)
   and (v_status='All' or case when v_status='Settled' then t.status<>'OPEN' else t.status=upper(v_status) end)
   and (v_week='all' or case when v_week='futures' then t.ticket_type='future' else t.placement_week=v_week::integer end)
   and (v_query='' or position(lower(v_query) in lower(t.id::text||' '||coalesce(t.legacy_ticket_id,'')))>0
    or exists(select 1 from public.teams tm left join public.league_memberships m on m.team_id=tm.id
     where tm.id=t.team_id and position(lower(v_query) in lower(tm.team_name||' '||tm.sportsbook_owner_name||' '||coalesce(m.display_name,'')))>0)
    or exists(select 1 from public.ticket_legs l where l.ticket_id=t.id
     and position(lower(v_query) in lower(l.selection||' '||coalesce(l.matchup,'')||' '||l.market_type))>0))
 ), keyed as (
  select e.*,coalesce((case v_sort when 'placed' then extract(epoch from placed_at)
   when 'settled' then extract(epoch from settled_at) when 'winnings' then actual_payout
   else case when accepted_combined_odds>0 then 1+accepted_combined_odds/100.0
    else 1+100.0/nullif(abs(accepted_combined_odds),0) end end)*case v_direction when 'asc' then 1 else -1 end,1e50) as sort_key,
   -extract(epoch from placed_at) as placed_key from eligible e
 ), page as materialized (
  select * from keyed where v_id is null or (sort_key,placed_key,id)>(v_key,v_date,v_id)
  order by sort_key,placed_key,id limit p_limit+1
 ), visible as materialized (select * from page order by sort_key,placed_key,id limit p_limit),
 ticket_rows as (
  select sort_key,placed_key,id,jsonb_build_object('id',id,'league_id',league_id,'nfl_season',nfl_season,'team_id',team_id,
   'legacy_ticket_id',legacy_ticket_id,'placement_week',placement_week,'market_week',market_week,'placed_at',placed_at,'settled_at',settled_at,
   'stake',stake,'accepted_combined_odds',accepted_combined_odds,'ticket_type',ticket_type,
   'accepted_potential_payout',accepted_potential_payout,'actual_payout',actual_payout,'status',status) body from visible
 )
 select jsonb_build_object(
  'tickets',coalesce((select jsonb_agg(body order by sort_key,placed_key,id) from ticket_rows),'[]'::jsonb),
  'legs',case when v_details then coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'ticket_id',l.ticket_id,'leg_number',l.leg_number,
   'selection',l.selection,'market_type',l.market_type,'matchup',l.matchup,'status',l.status,'actual_value',l.actual_value,
   'result_evidence',l.result_evidence,'accepted_line',l.accepted_line,'settlement_context',l.settlement_context,
   'market_kind',l.settlement_context->>'kind','subject_team_id',l.settlement_context->>'team_id') order by l.ticket_id,l.leg_number,l.id)
   from public.ticket_legs l join visible v on v.id=l.ticket_id),'[]'::jsonb) else '[]'::jsonb end,
  'ticketPromotions',case when v_details then coalesce((select jsonb_agg(jsonb_build_object('ticket_id',p.ticket_id,'kind',p.kind,'boost_pct',p.boost_pct,'base_decimal',p.base_decimal))
   from public.ticket_promotions p join visible v on v.id=p.ticket_id),'[]'::jsonb) else '[]'::jsonb end,
  'total',(select count(*) from eligible),'as_of',v_as_of,
  'next',case when (select count(*) from page)>p_limit then
   (select jsonb_build_object('scope',v_hash,'as_of',v_as_of,'key',sort_key::text,'date',placed_key::text,'id',id)
    from visible order by sort_key desc,placed_key desc,id desc limit 1) else null end
 ) into v_result;
 if octet_length(v_result::text)>1048576 then raise exception 'Ticket page exceeds byte budget; request fewer tickets';end if;
 return v_result;
end $$;
revoke all on function public.account_ticket_page(uuid,jsonb,jsonb,integer) from public,anon,service_role;
grant execute on function public.account_ticket_page(uuid,jsonb,jsonb,integer) to authenticated;
comment on function public.account_ticket_page(uuid,jsonb,jsonb,integer) is
 'RLS-preserving selected-league keyset pages; cursor binds user and filters. Counts and receipt children come from one statement. Mutable settlement filters reflect current committed data; refresh restarts traversal.';

commit;
