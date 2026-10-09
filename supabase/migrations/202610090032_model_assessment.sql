begin;
create table public.model_config_versions (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 created_at timestamptz not null default now(), parent_id uuid, config jsonb not null,
 reason text not null, unique(league_id,id),
 foreign key(league_id,parent_id) references public.model_config_versions(league_id,id),
 check(jsonb_typeof(config)='object' and config ?& array['score_scale','variance_scale'] and
   (config->>'score_scale')::numeric between .9 and 1.1 and (config->>'variance_scale')::numeric between .9 and 1.1 and
   config - 'score_scale' - 'variance_scale' = '{}'::jsonb)
);
create table public.model_controls (
 league_id uuid primary key references public.leagues(id), baseline_id uuid not null, active_id uuid not null,
 paused boolean not null default false, updated_at timestamptz not null default now(),
 foreign key(league_id,baseline_id) references public.model_config_versions(league_id,id),
 foreign key(league_id,active_id) references public.model_config_versions(league_id,id)
);
create table public.model_forecast_runs (
 id uuid primary key,league_id uuid not null references public.leagues(id),nfl_season integer not null,market_week integer not null check(market_week between 1 and 18),
 category text not null check(category in ('Matchups','Player Points','Weekly Specials','Season Futures')),
 captured_at timestamptz not null default now(),phase text not null check(phase='pregame'),provenance text not null check(provenance='as_of'),
 model_version uuid not null,model_config jsonb not null,source_hash text not null, sources jsonb not null,payload jsonb not null,
 foreign key(league_id,model_version) references public.model_config_versions(league_id,id),
 check(jsonb_typeof(payload->'quotes')='array' and jsonb_typeof(payload->'models')='array' and jsonb_typeof(payload->'pool')='array')
);
create index model_runs_week on public.model_forecast_runs(league_id,nfl_season,market_week,captured_at,id);
create table public.model_outcome_revisions (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),nfl_season integer not null,market_week integer not null,
 created_at timestamptz not null default now(),outcome_hash text not null,outcome jsonb not null,
 unique(league_id,nfl_season,market_week,outcome_hash),unique(league_id,id)
);
create table public.model_weekly_reviews (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),nfl_season integer not null,market_week integer not null,
 created_at timestamptz not null default now(),outcome_id uuid not null,input_hash text not null,report jsonb not null,comparison jsonb not null,
 foreign key(league_id,outcome_id) references public.model_outcome_revisions(league_id,id),
 unique(league_id,nfl_season,market_week,input_hash),unique(league_id,id)
);
create index model_review_week on public.model_weekly_reviews(league_id,nfl_season,market_week,created_at desc);
create table public.model_change_events (
 id bigint generated always as identity primary key,league_id uuid not null references public.leagues(id),created_at timestamptz not null default now(),
 kind text not null check(kind in ('promote','pause','resume','rollback','auto_rollback')),from_id uuid not null,to_id uuid not null,
 review_id uuid,reason text not null,
 foreign key(league_id,from_id) references public.model_config_versions(league_id,id),
 foreign key(league_id,to_id) references public.model_config_versions(league_id,id),
 foreign key(league_id,review_id) references public.model_weekly_reviews(league_id,id)
);
create index model_events_league on public.model_change_events(league_id,created_at desc);
insert into public.model_config_versions(league_id,config,reason) select id,'{"score_scale":1,"variance_scale":1}','Frozen weekly-lineup-v3 team baseline; original capped player-history blend retained.' from public.leagues;
insert into public.model_controls(league_id,baseline_id,active_id) select league_id,id,id from public.model_config_versions;
create function sportsbook_private.initialize_model() returns trigger language plpgsql security definer set search_path='' as $$
declare v uuid;begin
 insert into public.model_config_versions(league_id,config,reason) values(new.id,'{"score_scale":1,"variance_scale":1}','Frozen weekly-lineup-v3 baseline.') returning id into v;
 insert into public.model_controls(league_id,baseline_id,active_id) values(new.id,v,v);return new;
end $$;
revoke all on function sportsbook_private.initialize_model() from public,anon,authenticated,service_role;
create trigger initialize_league_model after insert on public.leagues for each row execute function sportsbook_private.initialize_model();
do $$ declare t text;begin
 foreach t in array array['model_config_versions','model_forecast_runs','model_outcome_revisions','model_weekly_reviews','model_change_events','model_controls'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy model_admin_read on public.%I for select to authenticated using(sportsbook_private.is_admin(league_id))',t);
  if t<>'model_controls' then execute format('create trigger immutable_model_history before update or delete on public.%I for each row execute function sportsbook_private.keep_forecast_history()',t);end if;
 end loop;
end $$;

create function public.save_model_forecast(p_run uuid,p_league uuid,p_season integer,p_week integer,p_category text,p_version uuid,p_sources jsonb,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.model_config_versions;begin
 if auth.role() is distinct from 'service_role' and not sportsbook_private.is_admin(p_league) then raise exception 'League admin only.';end if;
 if not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Season mismatch.';end if;
 select * into strict c from public.model_config_versions where league_id=p_league and id=p_version;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q where q->'metadata'->>'assessment_run_id' is distinct from p_run::text) then raise exception 'Forecast run context mismatch.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q cross join lateral unnest(array[q->>'team_id',q->>'home_team_id',q->>'away_team_id']) t(id) where t.id is not null and not exists(select 1 from public.teams where id=t.id::uuid and league_id=p_league)) then raise exception 'Forecast team outside league.';end if;
 insert into public.model_forecast_runs(id,league_id,nfl_season,market_week,category,phase,provenance,model_version,model_config,source_hash,sources,payload)
 values(p_run,p_league,p_season,p_week,p_category,'pregame','as_of',p_version,c.config,md5(p_sources::text),p_sources,p_payload)
 on conflict(id) do nothing;
 if not exists(select 1 from public.model_forecast_runs where id=p_run and league_id=p_league and model_version=p_version and payload=p_payload and sources=p_sources) then raise exception 'Immutable run collision.';end if;
 return p_run;
end $$;
revoke all on function public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb) to authenticated,service_role;

create function public.save_model_assessment(p_job uuid,p_attempt integer,p_hash text,p_outcome jsonb,p_report jsonb,p_comparison jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;o uuid;r uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Assessment lease lost.';end if;
 if p_outcome->>'final' is distinct from 'true' or p_outcome->>'completed_period' is distinct from 'true' or p_outcome->>'confirmed_games_final' is distinct from 'true' or p_report->>'status' is distinct from 'complete' then raise exception 'Confirmed outcomes required.';end if;
 if exists(select 1 from public.tickets where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and ticket_type<>'future' and status='OPEN') then raise exception 'Weekly settlement reconciliation pending.';end if;
 insert into public.model_outcome_revisions(league_id,nfl_season,market_week,outcome_hash,outcome)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,md5(p_outcome::text),p_outcome)
 on conflict(league_id,nfl_season,market_week,outcome_hash) do nothing returning id into o;
 if o is null then select id into o from public.model_outcome_revisions where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and outcome_hash=md5(p_outcome::text);end if;
 insert into public.model_weekly_reviews(league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,o,p_hash,p_report,p_comparison)
 on conflict(league_id,nfl_season,market_week,input_hash) do nothing returning id into r;
 if r is null then select id into r from public.model_weekly_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and input_hash=p_hash;end if;
 return r;
end $$;
revoke all on function public.save_model_assessment(uuid,integer,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_model_assessment(uuid,integer,text,jsonb,jsonb,jsonb) to service_role;

create function public.control_model(p_league uuid,p_action text,p_reason text,p_review uuid default null,p_expected uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.model_controls;v public.model_config_versions;r public.model_weekly_reviews;target uuid;config jsonb;begin
 if p_action in ('promote','auto_rollback') then
  if auth.role() is distinct from 'service_role' then raise exception 'Validated worker only.';end if;
 elsif not sportsbook_private.is_admin(p_league) then raise exception 'League admin only.';end if;
 if length(trim(p_reason)) not between 5 and 500 then raise exception 'Provide an audit reason.';end if;
 select * into strict c from public.model_controls where league_id=p_league for update;
 if p_expected is not null and c.active_id<>p_expected then raise exception 'Active model changed; recompute assessment.';end if;
 target:=c.active_id;
 if p_action='promote' then
  if c.paused then raise exception 'Automatic promotion paused.';end if;
  select * into strict r from public.model_weekly_reviews where id=p_review and league_id=p_league;
  if exists(select 1 from public.model_change_events where review_id=p_review and kind='promote') then return c.active_id;end if;
  if r.created_at<now()-interval '1 day' or r.comparison->>'passed' is distinct from 'true' or jsonb_array_length(r.comparison->'reasons')<>0 then raise exception 'Promotion gates failed.';end if;
  if coalesce((r.comparison->>'training_weeks')::integer,0)<8 or coalesce((r.comparison->'gates'->>'max_step')::numeric,1)>.02 then raise exception 'Promotion policy mismatch.';end if;
  if coalesce(jsonb_array_length(r.comparison->'tests'),0)<>2 or exists(select 1 from jsonb_array_elements(r.comparison->'tests') t where t->>'pass' is distinct from 'true' or coalesce((t->>'observations')::integer,0)<case when t->>'phase'='holdout' then 40 else 120 end or coalesce((t->'interval'->>'low')::numeric,-1)<=0 or coalesce((t->'frozen_interval'->>'low')::numeric,-1)<0 or coalesce((t->>'weeks')::integer,0)<case when t->>'phase'='holdout' then 4 else 12 end) then raise exception 'Confidence/sample gates failed.';end if;
  select * into strict v from public.model_config_versions where id=c.active_id;
  if v.parent_id is not null and v.created_at>now()-interval '7 days' then raise exception 'Promotion cooldown active.';end if;
  if r.comparison->'current'<>v.config then raise exception 'Baseline comparison changed.';end if;
  config:=r.comparison->'candidate';
  if abs((config->>'score_scale')::numeric/(v.config->>'score_scale')::numeric-1)>.020000001 or abs((config->>'variance_scale')::numeric/(v.config->>'variance_scale')::numeric-1)>.020000001 then raise exception 'Weekly parameter bound exceeded.';end if;
  insert into public.model_config_versions(league_id,parent_id,config,reason) values(p_league,c.active_id,config,p_reason) returning id into target;
 elsif p_action in ('rollback','auto_rollback') then
  select coalesce(parent_id,c.baseline_id) into target from public.model_config_versions where id=c.active_id;
 elsif p_action not in ('pause','resume') then raise exception 'Unknown model action.';end if;
 update public.model_controls set active_id=target,paused=case when p_action in ('pause','rollback','auto_rollback') then true when p_action='resume' then false else paused end,updated_at=now() where league_id=p_league;
 insert into public.model_change_events(league_id,kind,from_id,to_id,review_id,reason) values(p_league,p_action,c.active_id,target,p_review,p_reason);
 return target;
end $$;
revoke all on function public.control_model(uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.control_model(uuid,text,text,uuid,uuid) to authenticated,service_role;

-- Existing daily review jobs now cover pregame archives too. Settlement retains higher priority.
do $$ declare d text;anchor text;begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 anchor:='from public.live_forecast_runs logged where';
 if position(anchor in d)=0 then raise exception 'Review scheduling anchor changed.';end if;
 execute replace(d,anchor,'from (select league_id,nfl_season,market_week from public.live_forecast_runs union select league_id,nfl_season,market_week from public.model_forecast_runs) logged where');
end $$;
commit;
