begin;

alter table public.automation_jobs add column scheduled_for timestamptz;
alter table public.automation_jobs add column expires_at timestamptz;
create index automation_jobs_due_idx on public.automation_jobs(lease_until,created_at)
 where status in ('pending','failed','running');

-- Reconstruct missed events from the saved Eastern schedule. A scheduler outage
-- must not permanently lose the opening merely because a two-hour window passed.
create function sportsbook_private.enqueue_weekly_jobs(p_now timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s record; local_now timestamp:=p_now at time zone 'America/New_York';
 cycle date; op text; due time; offset_days integer; event_day date;
 scheduled timestamptz; deadline timestamptz; target_week integer; event text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 cycle:=local_now::date-((extract(isodow from local_now)::integer+5)%7);
 for s in select cfg.*,l.active_week,l.week_anchor,l.nfl_season
   from public.weekly_schedule cfg join public.leagues l on l.id=cfg.league_id
   where cfg.automation_enabled and l.operations_enabled order by cfg.league_id loop
  for op,due,offset_days in select * from (values
   ('settlement',(s.job_times->>'settlement')::time,0),
   ('recheck',(s.job_times->>'recheck')::time,0),
   ('replenishment',(s.job_times->>'replenishment')::time,0),
   ('generate_matchups',(s.job_times->>'generation')::time,0),
   ('generate_players',(s.job_times->>'generation')::time,0),
   ('generate_specials',(s.job_times->>'generation')::time,0),
   ('generate_futures',(s.job_times->>'generation')::time,0),
   ('refresh_matchups',(s.job_times->>'refresh')::time,1),
   ('refresh_players',(s.job_times->>'refresh')::time,1),
   ('refresh_specials',(s.job_times->>'refresh')::time,1),
   ('refresh_futures',(s.job_times->>'refresh')::time,1),
   ('publish',s.opening_time,1),('recap',s.recap_time,0),
   ('reminder',s.reminder_time,2),('cutoff',(s.job_times->>'cutoff')::time,2),
   ('monday_watch','17:00'::time,6)
  ) x(op,due,offset_days) loop
   event_day:=cycle+offset_days;
   scheduled:=(event_day+due) at time zone 'America/New_York';
   deadline:=case
    when op in ('settlement','recheck','replenishment','recap','cutoff') then (cycle+7+'08:00'::time) at time zone 'America/New_York'
    when op='monday_watch' then (cycle+7+'00:00'::time) at time zone 'America/New_York'
    else (cycle+2+(s.job_times->>'cutoff')::time) at time zone 'America/New_York' end;
   if scheduled>p_now or deadline<=p_now then continue; end if;
   target_week:=least(18,s.active_week+greatest(0,floor(extract(epoch from
     ((scheduled at time zone 'America/New_York')-(s.week_anchor at time zone 'America/New_York')))/604800)::integer));
   event:=s.league_id||':'||event_day||':'||op;
   insert into public.automation_jobs(league_id,event_key,operation,market_week,scheduled_for,expires_at)
    values(s.league_id,event,op,target_week,scheduled,deadline)
    on conflict(event_key) do update set
      scheduled_for=coalesce(public.automation_jobs.scheduled_for,excluded.scheduled_for),
      expires_at=coalesce(public.automation_jobs.expires_at,excluded.expires_at)
    where public.automation_jobs.scheduled_for is null or public.automation_jobs.expires_at is null;
   -- A late opening must recalculate stale categories, not publish yesterday's prices.
   if op like 'refresh_%' and not exists(select 1 from public.automation_jobs published
     where published.league_id=s.league_id and published.event_key=s.league_id||':'||(cycle+1)||':publish' and published.status='done') then
    update public.automation_jobs set status='pending',lease_until=null,attempts=0,
      summary=jsonb_build_object('retry_reason','Refresh stale before opening')
     where event_key=event and status='done' and coalesce(completed_at,created_at)<p_now-interval '120 minutes';
   end if;
  end loop;
 end loop;
end $$;
revoke all on function sportsbook_private.enqueue_weekly_jobs(timestamptz) from public,anon,authenticated;

create or replace function public.claim_automation_job() returns setof public.automation_jobs
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 perform pg_advisory_xact_lock(hashtext('sportsbook-job-claim'));
 perform sportsbook_private.enqueue_weekly_jobs(now());
 update public.automation_jobs set status='done',completed_at=now(),
   summary=coalesce(summary,'{}'::jsonb)||jsonb_build_object('skipped',true,'reason','Scheduled window expired; no stale action was applied')
  where expires_at<=now() and status in ('pending','failed','running') and coalesce(lease_until,'-infinity')<now();
 return query update public.automation_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes'
 where id in(select j.id from public.automation_jobs j join public.weekly_schedule cfg using(league_id)
  join public.leagues l on l.id=j.league_id
  where cfg.automation_enabled and l.operations_enabled and j.status in ('pending','failed','running')
   and coalesce(j.lease_until,'-infinity')<now()
   and ((j.scheduled_for is not null and j.expires_at>now()) or
     (j.scheduled_for is null and j.attempts<4 and j.created_at>now()-interval '2 hours'))
   and (j.operation !~ '^(generate_|refresh_|interval_|publish$)' or not exists(
     select 1 from public.automation_jobs busy where busy.league_id=j.league_id and busy.id<>j.id
      and busy.status='running' and busy.lease_until>now() and busy.operation ~ '^(generate_|refresh_|interval_|publish$)'))
   and (j.operation<>'publish' or not exists(select 1 from public.automation_jobs dependency
     where dependency.league_id=j.league_id and dependency.market_week=j.market_week
      and dependency.operation in ('refresh_matchups','refresh_players','refresh_specials','refresh_futures')
      and dependency.scheduled_for>=j.scheduled_for-interval '1 day' and dependency.status<>'done'))
  order by case j.operation
   when 'settlement' then 0 when 'recheck' then 1 when 'replenishment' then 2 when 'cutoff' then 3
   when 'generate_matchups' then 4 when 'generate_players' then 5 when 'generate_specials' then 6 when 'generate_futures' then 7
   when 'refresh_matchups' then 8 when 'refresh_players' then 9 when 'refresh_specials' then 10 when 'refresh_futures' then 11
   when 'publish' then 12 when 'recap' then 13 when 'reminder' then 14 when 'monday_watch' then 15
   when 'model_review' then 20 else 30 end,j.created_at,j.event_key
  for update of j skip locked limit 1) returning *;
end $$;
revoke all on function public.claim_automation_job() from public,anon,authenticated;
grant execute on function public.claim_automation_job() to service_role;

-- Completion time, not queue-creation time, establishes freshness after recovery.
do $$ declare d text; original text; begin
 select pg_get_functiondef('public.confirm_scheduled_publication(uuid)'::regprocedure) into d;
 original:=d;
 d:=replace(d,'created_at>now()-interval ''2 hours''','coalesce(completed_at,created_at)>now()-interval ''130 minutes''');
 if d=original then raise exception 'Publication freshness anchor changed.'; end if;
 execute d;
end $$;
commit;
