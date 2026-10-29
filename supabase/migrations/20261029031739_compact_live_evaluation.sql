begin;
create function sportsbook_private.compact_live_payload(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object('horizon',p->'horizon','status',p->'status','reason',left(p->>'reason',240),'source_quality','{"live_freshness_verified":false}'::jsonb,
 'teams',coalesce((select jsonb_agg(jsonb_build_object('team_id',t->'team_id','roster_id',t->'roster_id',
 'name',left(t->>'name',160),'matchup_id',t->'matchup_id','starters',t->'starters',
 'mean',t->'mean','sd',t->'sd','observed',t->'observed','reasons',t->'reasons'))
 from jsonb_array_elements(p->'teams') t),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(q) where key=any(array[
 'matchup_id','home_team_id','away_team_id','home_mean','away_mean','spread','total','home_fair_probability',
 'away_fair_probability','home_odds','away_odds'])) || '{"shadow":true,"acceptance_enabled":false,"promotion_pct":0}'::jsonb)
 from jsonb_array_elements(p->'quotes') q),'[]'::jsonb));
$$;
revoke all on function sportsbook_private.compact_live_payload(jsonb) from public,anon,authenticated,service_role;
grant execute on function sportsbook_private.compact_live_payload(jsonb) to authenticated,service_role;

create table public.live_forecast_samples (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 nfl_season integer not null,market_week integer not null check(market_week between 1 and 18),
 horizon integer not null check(horizon between 0 and 3),cycle_id uuid not null references public.line_refresh_cycles(id),
 captured_at timestamptz not null,observed_at timestamptz not null,model_version text not null check(length(model_version)<=80),
 status text not null default 'shadow' check(status='shadow'),payload jsonb not null check(octet_length(payload::text)<=65536),
 unique(league_id,nfl_season,market_week,horizon)
);
create table public.live_forecast_health (
 league_id uuid primary key references public.leagues(id),nfl_season integer not null,market_week integer not null,
 captured_at timestamptz not null,observed_at timestamptz not null,status text not null check(status in ('shadow','blocked')),
 model_version text not null,payload jsonb not null check(octet_length(payload::text)<=65536),
 captured_requests bigint not null default 0,skipped_requests bigint not null default 0,
 last_gap_reason text check(last_gap_reason in ('incomplete_targets','sample_too_large','row_budget','byte_budget','old_observation'))
);
alter table public.live_forecast_samples enable row level security;
alter table public.live_forecast_health enable row level security;
revoke all on public.live_forecast_samples,public.live_forecast_health from public,anon,authenticated,service_role;
grant select on public.live_forecast_samples,public.live_forecast_health to authenticated,service_role;
create policy live_samples_admin on public.live_forecast_samples for select to authenticated using(sportsbook_private.is_admin(league_id));
create policy live_health_admin on public.live_forecast_health for select to authenticated using(sportsbook_private.is_admin(league_id));

do $$declare d text;anchor text;begin
 select pg_get_functiondef('public.save_live_shadow(uuid,integer,jsonb)'::regprocedure) into d;
 anchor:='declare j public.automation_jobs;c public.line_refresh_cycles;result uuid;';
 if position(anchor in d)=0 then raise exception 'Live declaration anchor changed.';end if;
 d:=replace(d,anchor,anchor||'p jsonb;slim jsonb;observed timestamptz;reason text;slots integer;used_bytes bigint;old_bytes integer;');
 anchor:=' insert into public.live_forecast_runs';
 if position(anchor in d)=0 then raise exception 'Live insert anchor changed.';end if;
 d:=split_part(d,anchor,1)||$body$
 p:=p_snapshot->'payload';observed:=(p_snapshot->>'observed_at')::timestamptz;
 if observed is null or observed<clock_timestamp()-interval '20 minutes' or observed>clock_timestamp()+interval '30 seconds'
  or jsonb_array_length(p->'teams')>16 or jsonb_array_length(p->'quotes')>8 or length(p_snapshot->>'model_version')>80 then raise exception 'Invalid compact live scope.';end if;
 if exists(select 1 from jsonb_array_elements(p->'teams') t where not exists(select 1 from public.teams m
  where m.id=(t->>'team_id')::uuid and m.league_id=j.league_id and m.roster_id=(t->>'roster_id')::integer)) then raise exception 'Live team outside league.';end if;
 if p->>'status'<>'shadow' or jsonb_typeof(p->'horizon') is distinct from 'number' or (p->>'horizon')::integer not between 0 and 3
  or jsonb_array_length(p->'teams')<2 or jsonb_array_length(p->'quotes')=0
  or jsonb_array_length(p->'teams')<>(select count(*) from public.teams where league_id=j.league_id)
  or (select count(distinct t->>'team_id') from jsonb_array_elements(p->'teams') t)<>jsonb_array_length(p->'teams')
  or exists(select 1 from jsonb_array_elements(p->'teams') t where jsonb_typeof(t->'reasons') is distinct from 'array' or t->'reasons'<>'[]'::jsonb)
  then reason:='incomplete_targets';
 else
  if exists(select 1 from jsonb_array_elements(p->'teams') t where jsonb_typeof(t->'starters') is distinct from 'array'
    or jsonb_array_length(t->'starters')>32 or jsonb_typeof(t->'mean') is distinct from 'number' or jsonb_typeof(t->'sd') is distinct from 'number'
    or jsonb_typeof(t->'observed') is distinct from 'number') then raise exception 'Invalid live prediction targets.';end if;
  if exists(select 1 from jsonb_array_elements(p->'teams') t,lateral jsonb_array_elements(t->'starters') s
    where jsonb_typeof(s)<>'string' or length(s#>>'{}')>80) then raise exception 'Invalid live starter target.';end if;
  if exists(select 1 from jsonb_array_elements(p->'quotes') q,lateral jsonb_each(q) x
    where x.key in ('matchup_id','home_mean','away_mean','spread','total','home_fair_probability','away_fair_probability','home_odds','away_odds')
     and jsonb_typeof(x.value)<>'number') then raise exception 'Invalid live numeric quote.';end if;
  if exists(select 1 from jsonb_array_elements(p->'quotes') q cross join lateral unnest(array['matchup_id','home_mean','away_mean','spread','total','home_fair_probability','away_fair_probability','home_odds','away_odds']) fields(k)
    where jsonb_typeof(q->k) is distinct from 'number') then raise exception 'Missing live numeric quote.';end if;
  if exists(select 1 from jsonb_array_elements(p->'quotes') q where
    not exists(select 1 from jsonb_array_elements(p->'teams') t where t->>'team_id'=q->>'home_team_id')
    or not exists(select 1 from jsonb_array_elements(p->'teams') t where t->>'team_id'=q->>'away_team_id')) then raise exception 'Live quote outside targets.';end if;
  slim:=sportsbook_private.compact_live_payload(p);
  if octet_length(slim::text)>65536 then reason:='sample_too_large';end if;
 end if;
 insert into public.live_forecast_health(league_id,nfl_season,market_week,captured_at,observed_at,status,model_version,payload)
  values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,clock_timestamp(),observed,'blocked',left(p_snapshot->>'model_version',80),'{}') on conflict do nothing;
 perform 1 from public.live_forecast_health where league_id=j.league_id for update;
 if exists(select 1 from public.live_forecast_health where league_id=j.league_id and observed_at>observed) then
  update public.live_forecast_health set skipped_requests=skipped_requests+1,last_gap_reason='old_observation' where league_id=j.league_id;
  return c.id;
 end if;
 if reason is null then
  select count(*),coalesce(sum(octet_length(payload::text)),0) into slots,used_bytes from public.live_forecast_samples where league_id=j.league_id;
  select id,octet_length(payload::text) into result,old_bytes from public.live_forecast_samples where league_id=j.league_id
   and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and horizon=(p->>'horizon')::integer;
  if exists(select 1 from public.live_forecast_samples where id=result and cycle_id=c.id) then return result;end if;
  if exists(select 1 from public.live_forecast_samples where id=result and observed_at>=observed) then reason:='old_observation';
  elsif result is null and slots>=128 then reason:='row_budget';
  elsif used_bytes-coalesce(old_bytes,0)+octet_length(slim::text)>8388608 then reason:='byte_budget';end if;
 end if;
 if reason is not null then
  update public.live_forecast_health set skipped_requests=skipped_requests+1,last_gap_reason=reason,
   captured_at=clock_timestamp(),observed_at=observed,status='blocked',nfl_season=(select nfl_season from public.leagues where id=j.league_id),market_week=j.market_week,
   payload=jsonb_build_object('teams','[]'::jsonb,'quotes','[]'::jsonb,'reason','Optional evaluation capture unavailable: '||reason)
   where league_id=j.league_id;
  return c.id;
 end if;
 insert into public.live_forecast_samples(league_id,nfl_season,market_week,horizon,cycle_id,captured_at,observed_at,model_version,payload)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,(p->>'horizon')::integer,c.id,clock_timestamp(),observed,left(p_snapshot->>'model_version',80),slim)
 on conflict(league_id,nfl_season,market_week,horizon) do update set cycle_id=excluded.cycle_id,captured_at=excluded.captured_at,
 observed_at=excluded.observed_at,model_version=excluded.model_version,payload=excluded.payload returning id into result;
 update public.live_forecast_health set captured_requests=captured_requests+1,captured_at=clock_timestamp(),observed_at=observed,status='shadow',payload=slim,
  nfl_season=(select nfl_season from public.leagues where id=j.league_id),market_week=j.market_week,model_version=left(p_snapshot->>'model_version',80) where league_id=j.league_id;
 return result;
end; $body$||'$function$';
 execute d;
end $$;

create view public.sportsbook_live_forecasts with (security_invoker=true) as
select id,league_id,nfl_season,market_week,captured_at,status,model_version,payload from public.live_forecast_samples
union all
select id,league_id,nfl_season,market_week,captured_at,status,model_version,sportsbook_private.compact_live_payload(payload)
 from (select distinct on (league_id,nfl_season,market_week,(payload->>'horizon')) * from public.live_forecast_runs
 where status='shadow' and payload->>'horizon' in ('0','1','2','3') and not exists(select 1 from jsonb_array_elements(payload->'teams') t where t->'reasons'<>'[]'::jsonb)
 order by league_id,nfl_season,market_week,(payload->>'horizon'),captured_at desc,id desc) legacy
union all
select league_id as id,league_id,nfl_season,market_week,captured_at,status,model_version,payload from public.live_forecast_health where status='blocked';
revoke all on public.sportsbook_live_forecasts from public,anon,authenticated,service_role;
grant select on public.sportsbook_live_forecasts to authenticated,service_role;

do $$declare d text;anchor text;begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 anchor:='from public.model_evaluation_samples) logged where';
 if position(anchor in d)=0 then raise exception 'Live review scheduling anchor changed.';end if;
 execute replace(d,anchor,'from public.model_evaluation_samples union select league_id,nfl_season,market_week from public.live_forecast_samples) logged where');
end $$;
comment on table public.live_forecast_samples is 'Latest fully eligible numeric shadow forecast per progress quartile. Partial captures are explicit gaps; no player/provider bodies. Expiry follows compact summaries in a later migration.';
commit;
