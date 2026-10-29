begin;

create table public.model_prediction_contexts (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 fingerprint text not null, created_at timestamptz not null default now(),
 scoring_settings jsonb not null, roster_positions jsonb not null,
 unique(league_id,id),unique(league_id,fingerprint),
 check(jsonb_typeof(scoring_settings)='object' and jsonb_typeof(roster_positions)='array'),
 check(octet_length(scoring_settings::text)+octet_length(roster_positions::text)<=8192)
);
create table public.model_evaluation_samples (
 sample_id uuid primary key default gen_random_uuid(),run_id uuid not null,
 league_id uuid not null references public.leagues(id),nfl_season integer not null,
 market_week integer not null check(market_week between 1 and 18),
 category text not null check(category in ('Matchups','Player Points','Weekly Specials','Season Futures')),
 horizon text not null check(horizon in ('opening','final_pregame')),
 captured_at timestamptz not null default now(),cutoff timestamptz not null,
 model_version uuid not null,context_version uuid not null,payload jsonb not null,
 payload_bytes integer generated always as (octet_length(payload::text)) stored,
 unique(league_id,nfl_season,market_week,category,horizon),
 foreign key(league_id,model_version) references public.model_config_versions(league_id,id),
 foreign key(league_id,context_version) references public.model_prediction_contexts(league_id,id),
 check(captured_at<cutoff),check(octet_length(payload::text)<=262144),
 check(payload->>'retention_format'='compact-forecast-v1'),
 check(jsonb_typeof(payload->'quotes')='array' and jsonb_typeof(payload->'models')='array' and jsonb_typeof(payload->'pool')='array')
);
create index evaluation_samples_run on public.model_evaluation_samples(league_id,run_id);
create table public.model_evaluation_health (
 league_id uuid primary key references public.leagues(id),last_capture_at timestamptz,
 captured_requests bigint not null default 0,skipped_requests bigint not null default 0,
 last_gap_at timestamptz,last_gap_reason text,
 cleanup_at timestamptz,removed_samples bigint not null default 0,
 check(last_gap_reason in ('unsupported_format','unknown_cutoff','post_cutoff','empty_family','row_budget','byte_budget','context_budget','sample_too_large','invalid_context'))
);
create table public.model_evaluation_coverage (
 league_id uuid not null references public.leagues(id),nfl_season integer not null,
 market_week integer not null check(market_week between 1 and 18),
 category text not null check(category in ('Matchups','Player Points','Weekly Specials','Season Futures')),
 requests bigint not null default 0,stored_requests bigint not null default 0,
 skipped_requests bigint not null default 0,eligible_gaps bigint not null default 0,
 last_capture_at timestamptz,last_gap_at timestamptz,last_gap_reason text,
 primary key(league_id,nfl_season,market_week,category)
);
alter table public.model_prediction_contexts enable row level security;
alter table public.model_evaluation_samples enable row level security;
alter table public.model_evaluation_health enable row level security;
alter table public.model_evaluation_coverage enable row level security;
revoke all on public.model_prediction_contexts,public.model_evaluation_samples,public.model_evaluation_health,public.model_evaluation_coverage from public,anon,authenticated,service_role;
grant select on public.model_prediction_contexts,public.model_evaluation_samples,public.model_evaluation_health,public.model_evaluation_coverage to service_role;
grant select on public.model_evaluation_health,public.model_evaluation_coverage to authenticated;
create policy evaluation_health_admin on public.model_evaluation_health for select to authenticated
 using(sportsbook_private.is_admin(league_id));
create policy evaluation_coverage_admin on public.model_evaluation_coverage for select to authenticated
 using(sportsbook_private.is_admin(league_id));

create function sportsbook_private.evaluation_pick(value jsonb,keys text[]) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,val),'{}'::jsonb) from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) as x(key,val) where key=any(keys);
$$;
revoke all on function sportsbook_private.evaluation_pick(jsonb,text[]) from public,anon,authenticated,service_role;

create function sportsbook_private.evaluation_gap(p_league uuid,p_reason text,p_season integer,p_week integer,p_category text) returns void
language sql set search_path='' as $$
 update public.model_evaluation_health set skipped_requests=skipped_requests+1,last_gap_at=now(),last_gap_reason=p_reason where league_id=p_league;
 update public.model_evaluation_coverage set skipped_requests=skipped_requests+1,
   eligible_gaps=eligible_gaps+case when p_reason='post_cutoff' then 0 else 1 end,
   last_gap_at=case when p_reason='post_cutoff' then last_gap_at else now() end,
   last_gap_reason=case when p_reason='post_cutoff' then last_gap_reason else p_reason end
   where league_id=p_league and nfl_season=p_season and market_week=p_week and category=p_category;
$$;
revoke all on function sportsbook_private.evaluation_gap(uuid,text,integer,integer,text) from public,anon,authenticated,service_role;

create function sportsbook_private.compact_evaluation_payload(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('retention_format','compact-forecast-v1','algorithm_version',p->'algorithm_version',
  'source_quality',sportsbook_private.evaluation_pick(p->'source_quality',array['source_count','unknown_observation_times']),
  'models',coalesce((select jsonb_agg(sportsbook_private.evaluation_pick(m,array['id','roster_id','mean','sd']) ||
    jsonb_build_object('lineup',coalesce((select jsonb_agg(jsonb_build_object('id',l->'id')) from jsonb_array_elements(m->'lineup') l),'[]'::jsonb)))
    from jsonb_array_elements(p->'models') m),'[]'::jsonb),
  'pool',coalesce((select jsonb_agg(sportsbook_private.evaluation_pick(m,array['id','expected','assessment_sd','injury','positions']))
    from jsonb_array_elements(p->'pool') m),'[]'::jsonb),
  'quotes',coalesce((select jsonb_agg(sportsbook_private.evaluation_pick(q,array['id','market_key','kind','side','line','odds','team_id','home_team_id','away_team_id']) ||
    jsonb_build_object('metadata',sportsbook_private.evaluation_pick(q->'metadata',array['assessment_run_id','player_id','opponent_player_id','margin_lower','margin_upper',
      'expected_team_count','projection_targets','roster_id','fair_probability','simulated_probability','expected_points','expected_wins','win_distribution','lineup_locked']) ||
      case when jsonb_typeof(q->'metadata'->'player_distribution')='object' then jsonb_build_object('player_distribution',
        sportsbook_private.evaluation_pick(q->'metadata'->'player_distribution',array['mean','sd'])) else '{}'::jsonb end))
    from jsonb_array_elements(p->'quotes') q),'[]'::jsonb),
  'specials',case when jsonb_typeof(p->'specials')='object' then
    sportsbook_private.evaluation_pick(p->'specials',array['anyBelow100','anyAtLeast200','high','low','counts150','countsProjection']) ||
    jsonb_build_object('average_summary',sportsbook_private.evaluation_pick(p->'specials'->'average_summary',
      array['n','mean','median','p05','p10','p25','p75','p90','p95','sd']),
      'highest_summary',sportsbook_private.evaluation_pick(p->'specials'->'highest_summary',
      array['n','mean','median','p05','p10','p25','p75','p90','p95','sd'])) else 'null'::jsonb end);
$$;
revoke all on function sportsbook_private.compact_evaluation_payload(jsonb) from public,anon,authenticated,service_role;

-- Keep the legacy signature so an in-flight old generation request can finish
-- publication. Unsupported archive bodies are discarded, with an explicit gap;
-- they never fall back to writing another permanent raw run.
create or replace function public.save_model_forecast(p_run uuid,p_league uuid,p_season integer,p_week integer,p_category text,p_version uuid,p_sources jsonb,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare c public.model_config_versions;context_id uuid;context_hash text;slim jsonb;deadline timestamptz;
 slots integer;used_bytes bigint;required_slots integer;old_bytes bigint;new_bytes integer;h text;
begin
 if auth.role() is distinct from 'service_role' and not sportsbook_private.is_admin(p_league) then raise exception 'League admin only.';end if;
 if not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Season mismatch.';end if;
 if p_run is null or p_week is null or p_week not between 1 and 18 or p_category is null or p_category not in ('Matchups','Player Points','Weekly Specials','Season Futures') then raise exception 'Invalid forecast scope.';end if;
 select * into strict c from public.model_config_versions where league_id=p_league and id=p_version;
 if jsonb_typeof(p_payload->'quotes') is distinct from 'array' then raise exception 'Invalid forecast selections.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q where q->'metadata'->>'assessment_run_id' is distinct from p_run::text) then raise exception 'Forecast run context mismatch.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q cross join lateral unnest(array[q->>'team_id',q->>'home_team_id',q->>'away_team_id']) t(id) where t.id is not null and not exists(select 1 from public.teams where id=t.id::uuid and league_id=p_league)) then raise exception 'Forecast team outside league.';end if;
 insert into public.model_evaluation_health(league_id) values(p_league) on conflict do nothing;
 -- A stable per-league lock serializes budget admission and opening/final writes.
 perform 1 from public.model_evaluation_health where league_id=p_league for update;
 insert into public.model_evaluation_coverage(league_id,nfl_season,market_week,category,requests)
   values(p_league,p_season,p_week,p_category,1)
   on conflict(league_id,nfl_season,market_week,category) do update set requests=model_evaluation_coverage.requests+1;
 if p_payload->>'retention_format' is distinct from 'compact-forecast-v1' then
   perform sportsbook_private.evaluation_gap(p_league,'unsupported_format',p_season,p_week,p_category);return p_run;
 end if;
 if jsonb_typeof(p_payload->'models') is distinct from 'array' or jsonb_typeof(p_payload->'pool') is distinct from 'array'
   or jsonb_array_length(p_payload->'models')>16 or jsonb_array_length(p_payload->'pool')>512 or jsonb_array_length(p_payload->'quotes')>1500 then raise exception 'Invalid compact evaluation targets.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'models') m where not exists(select 1 from public.teams t where t.id=(m->>'id')::uuid and t.league_id=p_league)) then raise exception 'Forecast model outside league.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'models') m where jsonb_typeof(m->'mean') is distinct from 'number'
   or jsonb_typeof(m->'sd') is distinct from 'number' or jsonb_typeof(m->'lineup') is distinct from 'array'
   or jsonb_array_length(m->'lineup')>32) then raise exception 'Invalid compact team predictions.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'pool') p where jsonb_typeof(p->'expected') is distinct from 'number'
   or jsonb_typeof(p->'id') is distinct from 'string' or length(p->>'id')>80
   or jsonb_typeof(p->'positions') is distinct from 'array' or jsonb_array_length(p->'positions')>8
   or length(coalesce(p->>'injury',''))>24) then raise exception 'Invalid compact player predictions.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'pool') p where
   (p->'assessment_sd' is not null and p->'assessment_sd'<>'null'::jsonb and jsonb_typeof(p->'assessment_sd')<>'number')
   or (p->'injury' is not null and p->'injury'<>'null'::jsonb and jsonb_typeof(p->'injury')<>'string')) then raise exception 'Invalid compact player flags.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'models') m,lateral jsonb_array_elements(m->'lineup') l
   where jsonb_typeof(l->'id') is distinct from 'string' or length(l->>'id')>80) then raise exception 'Invalid compact lineup target IDs.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'pool') p,lateral jsonb_array_elements(p->'positions') x
   where jsonb_typeof(x)<>'string' or length(x::text)>40) then raise exception 'Invalid compact position flags.';end if;
 if p_payload->'algorithm_version' is not null and p_payload->'algorithm_version'<>'null'::jsonb
   and (jsonb_typeof(p_payload->'algorithm_version')<>'string' or length(p_payload->>'algorithm_version')>80) then raise exception 'Invalid algorithm version.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,lateral jsonb_each(q) v
   where v.key in ('line','odds') and v.value<>'null'::jsonb and jsonb_typeof(v.value)<>'number') then raise exception 'Invalid compact price metadata.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,lateral jsonb_each(q) v
   where v.key in ('id','market_key','kind','side','team_id','home_team_id','away_team_id') and v.value<>'null'::jsonb
   and (jsonb_typeof(v.value)<>'string' or length(v.value::text)>200)) then raise exception 'Invalid compact selection identity.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,lateral jsonb_each(q->'metadata') v
   where v.key in ('projection_targets','win_distribution','player_distribution') and v.value<>'null'::jsonb
   and jsonb_typeof(v.value)<>'object') then raise exception 'Invalid compact numeric maps.';end if;
 if exists(select 1 from jsonb_each(case when jsonb_typeof(p_payload->'source_quality')='object' then p_payload->'source_quality' else '{}'::jsonb end) v
   where v.key in ('source_count','unknown_observation_times') and v.value<>'null'::jsonb and jsonb_typeof(v.value)<>'number') then raise exception 'Invalid compact source quality.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,
   lateral jsonb_each(case when jsonb_typeof(q->'metadata'->'projection_targets')='object' then q->'metadata'->'projection_targets' else '{}'::jsonb end) t
   where jsonb_typeof(t.value)<>'number' or not exists(select 1 from public.teams where id=t.key::uuid and league_id=p_league))
   then raise exception 'Invalid compact projection targets.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,
   lateral jsonb_each(case when jsonb_typeof(q->'metadata'->'win_distribution')='object' then q->'metadata'->'win_distribution' else '{}'::jsonb end) t
   where t.key !~ '^([0-9]|1[0-8])$' or jsonb_typeof(t.value)<>'number' or t.value::numeric not between 0 and 1)
   then raise exception 'Invalid compact win distribution.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,
   lateral jsonb_each(case when jsonb_typeof(q->'metadata'->'player_distribution')='object' then q->'metadata'->'player_distribution' else '{}'::jsonb end) t
   where t.key in ('mean','sd') and jsonb_typeof(t.value)<>'number')
   then raise exception 'Invalid compact player distribution.';end if;
 if jsonb_typeof(p_payload->'specials')='object' then
   if exists(select 1 from jsonb_each(p_payload->'specials') s where s.key in ('high','low','counts150','countsProjection')
     and (jsonb_typeof(s.value)<>'array' or jsonb_array_length(s.value)>32)) then raise exception 'Invalid compact special bins.';end if;
   if exists(select 1 from jsonb_each(p_payload->'specials') s,
     lateral jsonb_each(case when s.key in ('average_summary','highest_summary') and jsonb_typeof(s.value)='object' then s.value else '{}'::jsonb end) v
     where s.key in ('average_summary','highest_summary') and v.value<>'null'::jsonb and jsonb_typeof(v.value)<>'number')
     then raise exception 'Invalid compact special summary.';end if;
   if exists(select 1 from jsonb_each(p_payload->'specials') s,
     lateral jsonb_array_elements(case when s.key in ('high','low','counts150','countsProjection') then s.value else '[]'::jsonb end) x
     where jsonb_typeof(x)<>'number' or x::numeric not between 0 and 1) then raise exception 'Invalid compact special probabilities.';end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,lateral jsonb_each(q->'metadata') v
   where v.key in ('margin_lower','margin_upper','expected_team_count','roster_id','fair_probability','simulated_probability','expected_points','expected_wins')
   and v.value<>'null'::jsonb and jsonb_typeof(v.value)<>'number') then raise exception 'Invalid compact numeric metadata.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q,lateral jsonb_each(q->'metadata') v
   where v.key in ('assessment_run_id','player_id','opponent_player_id') and v.value<>'null'::jsonb
   and (jsonb_typeof(v.value)<>'string' or length(v.value::text)>100)) then raise exception 'Invalid compact identity metadata.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q where q->'metadata'->'lineup_locked' is not null
   and q->'metadata'->'lineup_locked'<>'null'::jsonb and jsonb_typeof(q->'metadata'->'lineup_locked')<>'boolean') then raise exception 'Invalid compact lock metadata.';end if;
 begin deadline:=(p_payload->>'pregame_cutoff')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then deadline:=null;end;
 if deadline is null then perform sportsbook_private.evaluation_gap(p_league,'unknown_cutoff',p_season,p_week,p_category);return p_run;end if;
 if deadline<=now() then perform sportsbook_private.evaluation_gap(p_league,'post_cutoff',p_season,p_week,p_category);return p_run;end if;
 if jsonb_array_length(p_payload->'quotes')=0 then perform sportsbook_private.evaluation_gap(p_league,'empty_family',p_season,p_week,p_category);return p_run;end if;
 if jsonb_typeof(p_sources->'scoring_settings') is distinct from 'object' or jsonb_typeof(p_sources->'roster_positions') is distinct from 'array'
   or octet_length((p_sources->'scoring_settings')::text)+octet_length((p_sources->'roster_positions')::text)>8192 then
   perform sportsbook_private.evaluation_gap(p_league,'invalid_context',p_season,p_week,p_category);return p_run;
 end if;
 if exists(select 1 from jsonb_each(p_sources->'scoring_settings') s where jsonb_typeof(s.value)<>'number')
   or exists(select 1 from jsonb_array_elements(p_sources->'roster_positions') r where jsonb_typeof(r)<>'string' or length(r::text)>40)
   then perform sportsbook_private.evaluation_gap(p_league,'invalid_context',p_season,p_week,p_category);return p_run;end if;
 slim:=sportsbook_private.compact_evaluation_payload(p_payload);new_bytes:=octet_length(slim::text);
 if new_bytes>262144 then perform sportsbook_private.evaluation_gap(p_league,'sample_too_large',p_season,p_week,p_category);return p_run;end if;
 context_hash:=md5((p_sources->'scoring_settings')::text || ':' || (p_sources->'roster_positions')::text);
 select id into context_id from public.model_prediction_contexts where league_id=p_league and fingerprint=context_hash;
 if context_id is not null and exists(select 1 from public.model_prediction_contexts where id=context_id
   and (scoring_settings<>p_sources->'scoring_settings' or roster_positions<>p_sources->'roster_positions')) then raise exception 'Prediction context fingerprint collision.';end if;
 if context_id is null and (select count(*) from public.model_prediction_contexts where league_id=p_league)>=64 then
   perform sportsbook_private.evaluation_gap(p_league,'context_budget',p_season,p_week,p_category);return p_run;
 end if;
 select count(*)::integer,coalesce(sum(payload_bytes),0) into slots,used_bytes from public.model_evaluation_samples where league_id=p_league;
 required_slots:=case when p_category='Season Futures' then 1 else 2 end;
 select required_slots-count(*)::integer,coalesce(sum(payload_bytes),0) into required_slots,old_bytes
   from public.model_evaluation_samples where league_id=p_league and nfl_season=p_season and market_week=p_week and category=p_category;
 if slots+required_slots>256 then perform sportsbook_private.evaluation_gap(p_league,'row_budget',p_season,p_week,p_category);return p_run;end if;
 -- Opening remains fixed; only the provisional final slot is replaceable.
 select coalesce(sum(payload_bytes),0) into old_bytes from public.model_evaluation_samples
   where league_id=p_league and nfl_season=p_season and market_week=p_week and category=p_category and horizon='final_pregame';
 if used_bytes-old_bytes+new_bytes*(required_slots+case when old_bytes>0 then 1 else 0 end)>8388608 then
   perform sportsbook_private.evaluation_gap(p_league,'byte_budget',p_season,p_week,p_category);return p_run;
 end if;
 if context_id is null then
   insert into public.model_prediction_contexts(league_id,fingerprint,scoring_settings,roster_positions)
     values(p_league,context_hash,p_sources->'scoring_settings',p_sources->'roster_positions') returning id into context_id;
 end if;
 if exists(select 1 from public.model_evaluation_samples where league_id=p_league and run_id=p_run
   and (payload<>slim or model_version<>p_version or context_version<>context_id)) then raise exception 'Retained forecast run collision.';end if;
 foreach h in array case when p_category='Season Futures' then array['opening'] else array['opening','final_pregame'] end loop
   insert into public.model_evaluation_samples(run_id,league_id,nfl_season,market_week,category,horizon,cutoff,model_version,context_version,payload)
   values(p_run,p_league,p_season,p_week,p_category,h,deadline,p_version,context_id,slim)
   on conflict(league_id,nfl_season,market_week,category,horizon) do update
     set run_id=excluded.run_id,captured_at=excluded.captured_at,cutoff=excluded.cutoff,
         model_version=excluded.model_version,context_version=excluded.context_version,payload=excluded.payload
     where model_evaluation_samples.horizon='final_pregame' and model_evaluation_samples.run_id<>excluded.run_id;
 end loop;
 update public.model_evaluation_health set last_capture_at=now(),captured_requests=captured_requests+1 where league_id=p_league;
 update public.model_evaluation_coverage set stored_requests=stored_requests+1,last_capture_at=now()
   where league_id=p_league and nfl_season=p_season and market_week=p_week and category=p_category;
 return p_run;
end $$;
revoke all on function public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb) to authenticated,service_role;

create view public.sportsbook_evaluation_runs with (security_invoker=true) as
 select r.id,r.league_id,r.nfl_season,r.market_week,r.category,r.captured_at,r.phase,r.provenance,
   r.model_version,r.model_config,r.sources,r.payload,null::uuid as sample_id
 from public.model_forecast_runs r
 union all
 select s.run_id,s.league_id,s.nfl_season,s.market_week,s.category,s.captured_at,'pregame','as_of',
   s.model_version,c.config,'{}'::jsonb,
   s.payload || jsonb_build_object('model_config',c.config,'scoring_settings',v.scoring_settings),s.sample_id
 from public.model_evaluation_samples s
 join public.model_config_versions c on c.league_id=s.league_id and c.id=s.model_version
 join public.model_prediction_contexts v on v.league_id=s.league_id and v.id=s.context_version;
revoke all on public.sportsbook_evaluation_runs from public,anon,authenticated,service_role;
grant select on public.sportsbook_evaluation_runs to service_role;

create or replace view public.sportsbook_model_future_openings with (security_invoker=true) as
select r.id,r.league_id,r.nfl_season,r.market_week,r.captured_at,r.category,
 coalesce((select jsonb_agg(jsonb_build_object(
   'id',q->'id','market_key',q->'market_key','kind',q->'kind','side',q->'side','line',q->'line',
   'metadata',jsonb_build_object('roster_id',q->'metadata'->'roster_id',
     'fair_probability',q->'metadata'->'fair_probability','expected_wins',q->'metadata'->'expected_wins',
     'win_distribution',q->'metadata'->'win_distribution')) order by ord)
   from jsonb_array_elements(r.payload->'quotes') with ordinality x(q,ord)), '[]'::jsonb) as quotes
from (select distinct on (league_id,nfl_season,market_week)
  id,league_id,nfl_season,market_week,captured_at,category,payload
  from public.sportsbook_evaluation_runs where category='Season Futures'
  order by league_id,nfl_season,market_week,captured_at,id) r;
revoke all on public.sportsbook_model_future_openings from public,anon,authenticated,service_role;
grant select on public.sportsbook_model_future_openings to service_role;

do $$declare definition text;anchor text;begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into definition;
 anchor:='from public.model_forecast_runs) logged where';
 if position(anchor in definition)=0 then raise exception 'Evaluation review scheduling anchor changed.';end if;
 execute replace(definition,anchor,'from public.model_forecast_runs union select league_id,nfl_season,market_week from public.model_evaluation_samples) logged where');
end $$;

-- A later retention activation migration will connect successful compact
-- summaries/prospective comparisons to the seven-day cleanup boundary. Nothing
-- in this migration deletes legacy history or financial records.
commit;
