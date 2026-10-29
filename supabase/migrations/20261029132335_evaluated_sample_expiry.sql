begin;
alter table public.model_evaluation_summaries add column retired_at timestamptz;
create index evaluation_summary_retirement_due on public.model_evaluation_summaries(known_at) where retired_at is null;

create function public.evaluation_review_checkpoint(p_job uuid,p_attempt integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;s public.model_evaluation_summaries;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=clock_timestamp() then raise exception 'Review checkpoint lease lost.';end if;
 select * into s from public.model_evaluation_summaries where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id)
  and market_week=j.market_week for update;
 return jsonb_build_object('retired_at',s.retired_at);
end $$;
revoke all on function public.evaluation_review_checkpoint(uuid,integer) from public,anon,authenticated;
grant execute on function public.evaluation_review_checkpoint(uuid,integer) to service_role;

-- Keep temporary diagnostic writes bounded even when review or cleanup fails.
do $$declare d text;anchor text;begin
 select pg_get_functiondef('public.save_evaluation_summary(uuid,integer,text,text,timestamptz,jsonb)'::regprocedure) into d;
 anchor:='if found then';
 if position(anchor in d)=0 then raise exception 'Summary correction anchor changed.';end if;
 execute replace(d,anchor,anchor||' if old.retired_at is not null then raise exception ''Summary correction window closed.'';end if;');
 select pg_get_functiondef('public.save_model_assessment(uuid,integer,text,jsonb,jsonb,jsonb)'::regprocedure) into d;
 anchor:='insert into public.model_outcome_revisions';
 if position(anchor in d)=0 then raise exception 'Assessment budget anchor changed.';end if;
 execute replace(d,anchor,$guard$
 if p_report->>'retention_format' is distinct from 'transient-evaluation-v1' then raise exception 'Temporary evaluation format required.';end if;
 if p_report->>'retention_format'='transient-evaluation-v1' then
  perform 1 from public.model_controls where league_id=j.league_id for update;
  if exists(select 1 from public.model_evaluation_summaries where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id)
   and market_week=j.market_week and retired_at is not null) then raise exception 'Row-level correction window closed.';end if;
  select id into r from public.model_weekly_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and input_hash=p_hash;
  if r is not null then return r;end if;
  if octet_length(p_report::text)>1048576 or octet_length(p_outcome::text)>262144 or octet_length(p_comparison::text)>32768 then raise exception 'Assessment diagnostic row budget exceeded.';end if;
  if (select count(*) from public.model_weekly_reviews where league_id=j.league_id and report->>'retention_format'='transient-evaluation-v1')>=64
   or (select coalesce(sum(octet_length(report::text)),0) from public.model_weekly_reviews where league_id=j.league_id and report->>'retention_format'='transient-evaluation-v1')+
    (select coalesce(sum(octet_length(outcome::text)),0) from public.model_outcome_revisions where league_id=j.league_id and outcome->>'retention_format'='transient-evaluation-v1')+
    octet_length(p_report::text)+octet_length(p_outcome::text)>33554432 then raise exception 'Assessment diagnostic league budget exceeded.';end if;
 end if;
 insert into public.model_outcome_revisions$guard$);
 select pg_get_functiondef('public.save_live_model_review(uuid,integer,text,text,jsonb,jsonb)'::regprocedure) into d;
 anchor:='insert into public.live_model_reviews';
 if position(anchor in d)=0 then raise exception 'Live review budget anchor changed.';end if;
 execute replace(d,anchor,$guard$
 if p_report->>'retention_format' is distinct from 'transient-live-v1' then raise exception 'Temporary live format required.';end if;
 if p_report->>'retention_format'='transient-live-v1' then
  perform 1 from public.model_controls where league_id=j.league_id for update;
  if exists(select 1 from public.model_evaluation_summaries where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id)
   and market_week=j.market_week and retired_at is not null) then raise exception 'Row-level correction window closed.';end if;
  select id into result from public.live_model_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id)
   and market_week=j.market_week and outcome_hash=p_outcome_hash and forecast_hash=p_forecast_hash;
  if result is not null then return result;end if;
  if octet_length(p_report::text)>131072 or octet_length(p_outcomes::text)>65536
   or (select count(*) from public.live_model_reviews where league_id=j.league_id and report->>'retention_format'='transient-live-v1')>=64
   or (select coalesce(sum(octet_length(report::text)+octet_length(outcomes::text)),0) from public.live_model_reviews where league_id=j.league_id and report->>'retention_format'='transient-live-v1')+
    octet_length(p_report::text)+octet_length(p_outcomes::text)>8388608 then raise exception 'Live review diagnostic budget exceeded.';end if;
 end if;
 insert into public.live_model_reviews$guard$);
end $$;

-- This non-login role has no financial privileges and no app-role memberships.
-- Only the fixed, worker-only cleanup function runs with its authority.
create role boff_evaluation_retention nologin noinherit;
grant usage on schema public,sportsbook_private,auth to boff_evaluation_retention;
grant execute on function auth.role() to boff_evaluation_retention;
grant select on public.leagues,public.automation_jobs,public.model_change_events to boff_evaluation_retention;
create policy retention_read on public.leagues for select to boff_evaluation_retention using(true);
create policy retention_read on public.automation_jobs for select to boff_evaluation_retention using(true);
create policy retention_read on public.model_change_events for select to boff_evaluation_retention using(true);
grant select,delete on public.model_evaluation_samples,public.model_prediction_contexts,public.published_forecast_samples,public.live_forecast_samples to boff_evaluation_retention;
grant select,update on public.model_evaluation_summaries to boff_evaluation_retention;
grant select,update,delete on public.model_weekly_reviews,public.model_outcome_revisions,public.live_model_reviews to boff_evaluation_retention;
create table public.evaluation_retention_health (
 league_id uuid primary key references public.leagues(id),heartbeat_at timestamptz not null default clock_timestamp(),
 retired_periods bigint not null default 0,removed_samples bigint not null default 0,unresolved_periods integer not null default 0,
 oldest_unresolved_period integer,last_retired_at timestamptz
);
alter table public.evaluation_retention_health enable row level security;
revoke all on public.evaluation_retention_health from public,anon,authenticated,service_role;
grant select on public.evaluation_retention_health to authenticated,service_role;
grant select,insert,update on public.evaluation_retention_health to boff_evaluation_retention;
create policy retention_health_admin on public.evaluation_retention_health for select to authenticated using(sportsbook_private.is_admin(league_id));
do $$declare relation text;begin
 foreach relation in array array['model_evaluation_samples','model_prediction_contexts','published_forecast_samples','live_forecast_samples',
  'model_evaluation_summaries','model_weekly_reviews','model_outcome_revisions','live_model_reviews','evaluation_retention_health'] loop
  execute format('create policy retention_internal on public.%I to boff_evaluation_retention using(true) with check(true)',relation);
 end loop;
end $$;
create or replace function sportsbook_private.keep_forecast_history() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='boff_evaluation_retention' and tg_table_schema='public' and tg_table_name in ('model_weekly_reviews','model_outcome_revisions','live_model_reviews') then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 raise exception 'Forecast and review history is append-only.';
end $$;

create function public.cleanup_evaluated_samples(p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path='' set row_security='on' set statement_timeout='5s' set lock_timeout='500ms' as $$
declare s public.model_evaluation_summaries;latest uuid;latest_hash text;removed integer:=0;before_removed integer;n integer;periods integer:=0;l record;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'Invalid retirement batch.';end if;
 for s in select * from public.model_evaluation_summaries where retired_at is null and known_at<clock_timestamp()-interval '7 days'
  order by known_at,league_id,nfl_season,market_week limit p_limit for update skip locked loop
  if exists(select 1 from public.automation_jobs j where j.league_id=s.league_id and j.market_week=s.market_week and j.operation='model_review'
   and j.status='running' and j.lease_until>clock_timestamp()) then continue;end if;
  select id,input_hash into latest,latest_hash from public.model_weekly_reviews where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week
   order by created_at desc,id desc limit 1;
  if latest_hash is distinct from s.input_hash then continue;end if;
  before_removed:=removed;
  delete from public.model_evaluation_samples where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week and category<>'Season Futures';
  get diagnostics n=row_count;removed:=removed+n;
  delete from public.published_forecast_samples where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week and board_type='weekly';
  get diagnostics n=row_count;removed:=removed+n;
  delete from public.live_forecast_samples where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week;
  get diagnostics n=row_count;removed:=removed+n;
  if s.summary->>'future_final'='true' then
   delete from public.model_evaluation_samples where league_id=s.league_id and nfl_season=s.nfl_season and category='Season Futures';
   get diagnostics n=row_count;removed:=removed+n;
   delete from public.published_forecast_samples where league_id=s.league_id and nfl_season=s.nfl_season and board_type='future';
   get diagnostics n=row_count;removed:=removed+n;
  end if;
  delete from public.model_weekly_reviews r where r.league_id=s.league_id and r.nfl_season=s.nfl_season and r.market_week=s.market_week
   and r.id<>latest and r.report->>'retention_format'='transient-evaluation-v1' and not exists(select 1 from public.model_change_events e where e.review_id=r.id);
  update public.model_weekly_reviews r set report=case when r.id=latest then
   jsonb_build_object('status','complete','retention_format','retired-evaluation-v1','assessment_version',r.report->'assessment_version','summary',s.summary)
   else jsonb_build_object('status','complete','retention_format','retired-evaluation-v1','assessment_version',r.report->'assessment_version',
    'score_views',r.report->'score_views','coverage',r.report->'coverage','row_level_retired',true) end
   where r.league_id=s.league_id and r.nfl_season=s.nfl_season and r.market_week=s.market_week and r.report->>'retention_format'='transient-evaluation-v1';
  update public.model_outcome_revisions o set outcome=jsonb_build_object('final',true,'completed_period',true,'confirmed_games_final',true,'retention_format','retired-evaluation-v1')
   where o.league_id=s.league_id and o.nfl_season=s.nfl_season and o.market_week=s.market_week and o.outcome->>'retention_format'='transient-evaluation-v1'
    and not exists(select 1 from public.model_weekly_reviews r where r.outcome_id=o.id and r.report->>'retention_format'<>'retired-evaluation-v1');
  delete from public.model_outcome_revisions o where o.league_id=s.league_id and o.nfl_season=s.nfl_season and o.market_week=s.market_week
   and o.outcome->>'retention_format'='retired-evaluation-v1' and not exists(select 1 from public.model_weekly_reviews r where r.outcome_id=o.id);
  update public.live_model_reviews set report=(report-array['observations','matches','excluded'])||'{"retention_format":"retired-live-v1","row_level_retired":true}'::jsonb,outcomes='[]'
   where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week and report->>'retention_format'='transient-live-v1';
  update public.model_evaluation_summaries set retired_at=clock_timestamp() where league_id=s.league_id and nfl_season=s.nfl_season and market_week=s.market_week;
  delete from public.model_prediction_contexts c where c.league_id=s.league_id and c.created_at<clock_timestamp()-interval '7 days'
   and not exists(select 1 from public.model_evaluation_samples x where x.league_id=c.league_id and x.context_version=c.id);
  periods:=periods+1;
  insert into public.evaluation_retention_health(league_id,retired_periods,removed_samples,last_retired_at)
   values(s.league_id,1,removed-before_removed,clock_timestamp()) on conflict(league_id) do update set heartbeat_at=clock_timestamp(),
    retired_periods=evaluation_retention_health.retired_periods+1,removed_samples=evaluation_retention_health.removed_samples+removed-before_removed,last_retired_at=clock_timestamp();
 end loop;
 -- Fourteen-day unresolved periods remain capped by writer admission budgets;
 -- record the backlog rather than deleting pending evidence on a timer.
 for l in select id from public.leagues loop
  insert into public.evaluation_retention_health(league_id) values(l.id) on conflict(league_id) do update set heartbeat_at=clock_timestamp();
  update public.evaluation_retention_health h set (unresolved_periods,oldest_unresolved_period)=(
   select count(*),min(period) from (select distinct nfl_season*100+market_week period from public.model_evaluation_samples x
    where x.league_id=l.id and x.category<>'Season Futures' and captured_at<clock_timestamp()-interval '14 days'
    and not exists(select 1 from public.model_evaluation_summaries checkpoint where checkpoint.league_id=x.league_id and checkpoint.nfl_season=x.nfl_season and checkpoint.market_week=x.market_week)
    union select nfl_season*100+market_week from public.published_forecast_samples x where x.league_id=l.id and board_type='weekly' and captured_at<clock_timestamp()-interval '14 days'
     and not exists(select 1 from public.model_evaluation_summaries checkpoint where checkpoint.league_id=x.league_id and checkpoint.nfl_season=x.nfl_season and checkpoint.market_week=x.market_week)
    union select nfl_season*100+market_week from public.live_forecast_samples x where x.league_id=l.id and captured_at<clock_timestamp()-interval '14 days'
     and not exists(select 1 from public.model_evaluation_summaries checkpoint where checkpoint.league_id=x.league_id and checkpoint.nfl_season=x.nfl_season and checkpoint.market_week=x.market_week)
    union select nfl_season*100+market_week from public.model_evaluation_summaries where league_id=l.id and retired_at is null and known_at<clock_timestamp()-interval '14 days') pending)
   where h.league_id=l.id;
 end loop;
 return jsonb_build_object('retired_periods',periods,'removed_samples',removed);
end $$;
revoke all on function public.cleanup_evaluated_samples(integer) from public,anon,authenticated;
grant execute on function public.cleanup_evaluated_samples(integer) to service_role;
comment on function public.cleanup_evaluated_samples(integer) is 'Prospective temporary records only. No legacy archive or financial deletion. Bounded seven-day post-summary expiry, lease exclusion and fourteen-day unresolved heartbeat.';
grant create on schema public to boff_evaluation_retention;
grant boff_evaluation_retention to postgres;
alter function public.cleanup_evaluated_samples(integer) owner to boff_evaluation_retention;
revoke create on schema public from boff_evaluation_retention;
revoke boff_evaluation_retention from postgres;
commit;
