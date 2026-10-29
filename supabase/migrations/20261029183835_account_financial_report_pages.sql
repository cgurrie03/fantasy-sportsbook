begin;

create function public.account_wallet_report(p_league uuid,p_team uuid default null,p_cursor jsonb default null,p_limit integer default 40)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_hash text;v_as_of timestamptz;v_date timestamptz;v_source text;v_id uuid;v_result jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_team is not null and not exists(select 1 from public.teams where id=p_team and league_id=p_league))
  then raise exception 'Invalid wallet report scope';end if;
 if (select count(*) from public.teams where league_id=p_league)>128 then raise exception 'League exceeds wallet report summary budget';end if;
 v_hash:=md5(p_league::text||coalesce(p_team::text,'all')||(select auth.uid())::text);
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or p_cursor->>'scope' is distinct from v_hash
   or not(p_cursor ?& array['as_of','date','source','id']) then raise exception 'Invalid wallet report cursor';end if;
  v_as_of:=(p_cursor->>'as_of')::timestamptz;v_date:=(p_cursor->>'date')::timestamptz;v_source:=p_cursor->>'source';v_id:=(p_cursor->>'id')::uuid;
  if v_as_of is null or v_date is null or v_source is null or v_source not in ('ledger','adjustment') or v_id is null
   or v_as_of>now()+interval '1 second' or v_as_of<now()-interval '1 day' then raise exception 'Wallet report cursor expired; refresh report';end if;
 else v_as_of:=now();end if;
 with entries as materialized (
  select l.id,l.team_id,l.created_at,l.kind,l.reason,l.balance_before,l.balance_after,'ledger' source
   from public.wallet_ledger l join public.teams t on t.id=l.team_id where t.league_id=p_league and (p_team is null or t.id=p_team) and l.created_at<=v_as_of
  union all
  select e.id,e.team_id,e.created_at,e.kind,e.reason,e.previous_balance,e.new_balance,'adjustment'
   from public.balance_events e join public.teams t on t.id=e.team_id where t.league_id=p_league and (p_team is null or t.id=p_team) and e.created_at<=v_as_of
 ), page as materialized (
  select * from entries where v_id is null or created_at<v_date or (created_at=v_date and (source,id)>(v_source,v_id))
   order by created_at desc,source,id limit p_limit+1
 ), visible as materialized (select * from page order by created_at desc,source,id limit p_limit), cash as (
  select team_id,coalesce(sum(greatest(balance_after-balance_before,0)) filter(where balance_before is not null and kind not in ('historical_opening','opening_balance')),0) credits,
   coalesce(sum(greatest(balance_before-balance_after,0)) filter(where balance_before is not null and kind not in ('historical_opening','opening_balance')),0) debits
   from entries group by team_id
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,source,id) from visible v),'[]'::jsonb),
  'total',(select count(*) from entries),'by_team',coalesce((select jsonb_agg(to_jsonb(c) order by team_id) from cash c),'[]'::jsonb),'as_of',v_as_of,
  'next',case when (select count(*) from page)>p_limit then
   (select jsonb_build_object('scope',v_hash,'as_of',v_as_of,'date',created_at,'source',source,'id',id) from visible order by created_at,source desc,id desc limit 1) else null end) into v_result;
 if octet_length(v_result::text)>262144 then raise exception 'Wallet report page byte budget exceeded';end if;
 return v_result;
end $$;

create function public.account_selection_report(p_league uuid,p_season integer,p_week integer default null,p_team uuid default null,p_cursor jsonb default null,p_limit integer default 40)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_hash text;v_as_of timestamptz;v_count bigint;v_label text;v_result jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required';end if;
 if p_season is null or p_season not between 2020 and 2100 or (p_week is not null and p_week not between 1 and 18)
  or p_limit is null or p_limit not between 1 and 50 or (p_team is not null and not exists(select 1 from public.teams where id=p_team and league_id=p_league))
  then raise exception 'Invalid selection report scope';end if;
 v_hash:=md5(p_league::text||p_season::text||coalesce(p_week::text,'all')||coalesce(p_team::text,'all')||(select auth.uid())::text);
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>262144 or p_cursor->>'scope' is distinct from v_hash
   or not(p_cursor ?& array['as_of','count','label','revision']) then raise exception 'Invalid selection report cursor';end if;
  v_as_of:=(p_cursor->>'as_of')::timestamptz;v_count:=(p_cursor->>'count')::bigint;v_label:=p_cursor->>'label';
  if v_as_of is null or v_count is null or v_count<1 or v_label is null or v_as_of>now()+interval '1 second' or v_as_of<now()-interval '1 day'
   then raise exception 'Selection report cursor expired; refresh report';end if;
 else v_as_of:=now();end if;
 with selections as (
  select case when l.market_type ~* 'moneyline|^ml$' then regexp_replace(l.selection,'\s*·?\s*ML$','','i')||' · ML' else l.selection end label,
   t.stake,l.status from public.tickets t join public.ticket_legs l on l.ticket_id=t.id
   where t.league_id=p_league and t.nfl_season=p_season and (p_week is null or t.market_week=p_week)
    and (p_team is null or t.team_id=p_team) and t.status<>'VOIDED' and t.placed_at<=v_as_of
 ), grouped as materialized (
  select label,count(*) count,sum(stake) stakes,count(*) filter(where status='WON') won,count(*) filter(where status='LOST') lost,
   count(*) filter(where status in ('PUSH','VOIDED')) pushed,count(*) filter(where status='OPEN') open from selections group by label
 ), version as (
  select md5(coalesce(string_agg(md5(to_jsonb(g)::text),'' order by label),'')) revision from grouped g
 ), page as materialized (
  select * from grouped where v_label is null or count<v_count or (count=v_count and label>v_label)
   order by count desc,label limit p_limit+1
 ), visible as materialized (select * from page order by count desc,label limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v) order by count desc,label) from visible v),'[]'::jsonb),
  'top',coalesce((select jsonb_agg(to_jsonb(v) order by count desc,label) from (select * from grouped order by count desc,label limit 12) v),'[]'::jsonb),
  'total',(select count(*) from grouped),'appearances',coalesce((select sum(count) from grouped),0),'maximum',coalesce((select max(count) from grouped),0),
  'as_of',v_as_of,'revision',(select revision from version),
  'next',case when (select count(*) from page)>p_limit then
   (select jsonb_build_object('scope',v_hash,'as_of',v_as_of,'count',count::text,'label',label,'revision',(select revision from version)) from visible order by count,label desc limit 1) else null end) into v_result;
 if p_cursor is not null and p_cursor<>'null'::jsonb and p_cursor->>'revision' is distinct from v_result->>'revision'
  then raise exception 'Selection results changed; refresh report before continuing';end if;
 if octet_length(v_result::text)>262144 then raise exception 'Selection report page byte budget exceeded';end if;
 return v_result;
end $$;

create function public.account_open_ticket_report(p_league uuid,p_season integer,p_week integer default null,p_team uuid default null,p_cursor jsonb default null,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_filters jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required';end if;
 if p_season is null or p_season not between 2020 and 2100 or (p_week is not null and p_week not between 1 and 18)
  or (p_team is not null and not exists(select 1 from public.teams where id=p_team and league_id=p_league)) then raise exception 'Invalid open ticket report scope';end if;
 v_filters:=jsonb_build_object('status','Open','season',p_season,'details',false)
  ||case when p_week is not null then jsonb_build_object('market_week',p_week) else '{}'::jsonb end
  ||case when p_team is not null then jsonb_build_object('team',p_team) else '{}'::jsonb end;
 return public.account_ticket_page(p_league,v_filters,p_cursor,p_limit)||jsonb_build_object('totals',public.account_betting_totals(p_league,p_season,p_week));
end $$;

revoke all on function public.account_wallet_report(uuid,uuid,jsonb,integer),public.account_selection_report(uuid,integer,integer,uuid,jsonb,integer),public.account_open_ticket_report(uuid,integer,integer,uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.account_wallet_report(uuid,uuid,jsonb,integer),public.account_selection_report(uuid,integer,integer,uuid,jsonb,integer),public.account_open_ticket_report(uuid,integer,integer,uuid,jsonb,integer) to authenticated;
comment on function public.account_wallet_report(uuid,uuid,jsonb,integer) is 'Admin-only recorded wallet ledger and balance adjustments across all seasons, with full-scope cash totals and bounded stable pages. Historical opening entries are excluded from cash-flow sums.';
comment on function public.account_selection_report(uuid,integer,integer,uuid,jsonb,integer) is 'Admin-only aggregate selection pages, complete-scope appearance totals and revision fencing when settlement/void results change during traversal.';
comment on function public.account_open_ticket_report(uuid,integer,integer,uuid,jsonb,integer) is 'Admin-only open-ticket pages without receipt bodies and complete-scope stake totals, evaluated in one stable database statement.';
commit;
