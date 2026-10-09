begin;
create table public.live_forecast_runs (
 id uuid primary key default gen_random_uuid(), cycle_id uuid not null unique references public.line_refresh_cycles(id),
 league_id uuid not null references public.leagues(id), nfl_season integer not null, market_week integer not null check(market_week between 1 and 18),
 captured_at timestamptz not null default now(), observed_at timestamptz not null,
 model_version text not null, model_config jsonb not null, source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 status text not null check(status in ('shadow','blocked')), sources jsonb not null, payload jsonb not null,
 check(jsonb_typeof(payload->'teams')='array' and jsonb_typeof(payload->'quotes')='array')
);
create index live_forecast_week_idx on public.live_forecast_runs(league_id,nfl_season,market_week,captured_at desc);
create table public.live_model_reviews (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),nfl_season integer not null,
 market_week integer not null check(market_week between 1 and 18),created_at timestamptz not null default now(),
 outcome_hash text not null check(outcome_hash ~ '^[0-9a-f]{64}$'),forecast_hash text not null check(forecast_hash ~ '^[0-9a-f]{64}$'),
 outcomes jsonb not null check(jsonb_typeof(outcomes)='array'),report jsonb not null,
 unique(league_id,nfl_season,market_week,outcome_hash,forecast_hash)
);
create index live_review_week_idx on public.live_model_reviews(league_id,nfl_season,market_week,created_at desc);
alter table public.live_forecast_runs enable row level security;
alter table public.live_model_reviews enable row level security;
revoke all on public.live_forecast_runs,public.live_model_reviews from public,anon,authenticated,service_role;
grant select on public.live_forecast_runs,public.live_model_reviews to authenticated,service_role;
create policy live_forecast_admin_read on public.live_forecast_runs for select to authenticated using(sportsbook_private.is_admin(league_id));
create policy live_review_admin_read on public.live_model_reviews for select to authenticated using(sportsbook_private.is_admin(league_id));
create function sportsbook_private.keep_forecast_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Forecast and review history is append-only.'; end $$;
revoke all on function sportsbook_private.keep_forecast_history() from public,anon,authenticated,service_role;
create trigger keep_live_forecasts before update or delete on public.live_forecast_runs for each row execute function sportsbook_private.keep_forecast_history();
create trigger keep_live_reviews before update or delete on public.live_model_reviews for each row execute function sportsbook_private.keep_forecast_history();
create trigger keep_published_forecasts before update or delete on public.forecast_snapshots for each row execute function sportsbook_private.keep_forecast_history();

create function public.save_live_shadow(p_job uuid,p_attempt integer,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;c public.line_refresh_cycles;result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'interval_matchups' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Live shadow lease lost.';end if;
 perform 1 from public.line_refresh_runtime where league_id=j.league_id for update;
 select * into strict c from public.line_refresh_cycles where id=j.refresh_cycle_id for update;
 if c.status<>'staging' or c.market_week<>j.market_week or c.league_id<>j.league_id or c.created_at<now()-interval '20 minutes' then raise exception 'Live shadow cycle expired.';end if;
 if (select week from public.sportsbook_period(j.league_id))<>j.market_week then raise exception 'Live shadow week changed.';end if;
 if p_snapshot->'model_config'->>'mode' is distinct from 'shadow' or coalesce(p_snapshot->'payload'->>'status','') not in ('shadow','blocked') or jsonb_typeof(p_snapshot->'payload'->'teams') is distinct from 'array' or jsonb_typeof(p_snapshot->'payload'->'quotes') is distinct from 'array' then raise exception 'Shadow logging cannot enable acceptance.';end if;
 insert into public.live_forecast_runs(cycle_id,league_id,nfl_season,market_week,observed_at,model_version,model_config,source_hash,status,sources,payload)
 values(c.id,j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,(p_snapshot->>'observed_at')::timestamptz,p_snapshot->>'model_version',p_snapshot->'model_config',p_snapshot->>'source_hash',p_snapshot->'payload'->>'status',p_snapshot->'sources',p_snapshot->'payload')
 on conflict(cycle_id) do nothing returning id into result;
 if result is null then select id into result from public.live_forecast_runs where cycle_id=c.id;end if;
 return result;
end $$;
revoke all on function public.save_live_shadow(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_live_shadow(uuid,integer,jsonb) to service_role;

create function public.save_live_model_review(p_job uuid,p_attempt integer,p_outcome_hash text,p_forecast_hash text,p_outcomes jsonb,p_report jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Model review lease lost.';end if;
 if ((select week from public.sportsbook_period(j.league_id))<=j.market_week and j.market_week<>18) or p_report->>'status' is distinct from 'complete' then raise exception 'Model review requires a completed week.';end if;
 insert into public.live_model_reviews(league_id,nfl_season,market_week,outcome_hash,forecast_hash,outcomes,report)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,p_outcome_hash,p_forecast_hash,p_outcomes,p_report)
 on conflict(league_id,nfl_season,market_week,outcome_hash,forecast_hash) do nothing returning id into result;
 if result is null then select id into result from public.live_model_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and outcome_hash=p_outcome_hash and forecast_hash=p_forecast_hash;end if;
 return result;
end $$;
revoke all on function public.save_live_model_review(uuid,integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_live_model_review(uuid,integer,text,text,jsonb,jsonb) to service_role;

-- Daily recheck during the following week permits corrected outcomes without
-- overwriting any prior assessment. Reviews cannot starve settlement/emails.
do $$ declare d text;anchor text;
begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 anchor:='if p_error is not null or r.last_error is not null or r.next_due_at>now() then continue; end if;';
 if position(anchor in d)=0 then raise exception 'Review schedule anchor changed.';end if;
 execute replace(d,anchor,'insert into public.automation_jobs(league_id,event_key,operation,market_week)
 select distinct s.league_id,''model-review:''||logged.nfl_season||'':''||logged.market_week||'':''||(now() at time zone ''America/New_York'')::date,''model_review'',logged.market_week
 from public.live_forecast_runs logged where logged.league_id=s.league_id and logged.nfl_season=(select nfl_season from public.leagues where id=s.league_id) and (logged.market_week=w-1 or (logged.market_week=18 and w=18 and ((p_status->>''season_year'')::integer>logged.nfl_season or ((p_status->>''season_year'')::integer=logged.nfl_season and (p_status->>''season_type'')::integer=3))))
 on conflict do nothing; '||anchor);
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure) into d;
 anchor:='when j.operation like ''interval_%'' then 9';
 if position(anchor in d)=0 then raise exception 'Review priority anchor changed.';end if;
 execute replace(d,anchor,'when j.operation=''model_review'' then 8 '||anchor);
end $$;
commit;
