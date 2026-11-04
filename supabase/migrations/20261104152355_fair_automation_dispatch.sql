begin;
-- One mutable scheduling cursor per league. No claim/event/provider archive.
create sequence sportsbook_private.automation_dispatch_order as bigint;
revoke all on sequence sportsbook_private.automation_dispatch_order from public,anon,authenticated,service_role;
create table sportsbook_private.automation_dispatch_state(
 league_id uuid primary key references public.leagues(id) on delete cascade,
 last_claimed_at timestamptz not null,
 last_turn bigint not null default nextval('sportsbook_private.automation_dispatch_order')
);
alter table sportsbook_private.automation_dispatch_state enable row level security;
revoke all on sportsbook_private.automation_dispatch_state from public,anon,authenticated,service_role;

create or replace function public.claim_automation_job()returns setof public.automation_jobs
language plpgsql security definer set search_path=''as $$
declare picked public.automation_jobs;
begin
 if auth.role()is distinct from 'service_role'then raise exception 'Server worker only.';end if;
 -- Existing global claim fence keeps selection, lease and cursor atomic.
 perform pg_advisory_xact_lock(hashtext('sportsbook-job-claim'));
 perform sportsbook_private.enqueue_weekly_jobs(now());
 update public.automation_jobs set status='done',completed_at=now(),
  summary=coalesce(summary,'{}'::jsonb)||jsonb_build_object('skipped',true,'reason','Scheduled window expired; no stale action was applied')
 where expires_at<=now()and status in('pending','failed','running')and coalesce(lease_until,'-infinity')<now();
 update public.automation_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes'
 where id in(select j.id from public.automation_jobs j join public.weekly_schedule cfg using(league_id)
  join public.leagues l on l.id=j.league_id
  left join sportsbook_private.automation_dispatch_state turn on turn.league_id=j.league_id
  where cfg.automation_enabled and l.operations_enabled and j.status in('pending','failed','running')
   and coalesce(j.lease_until,'-infinity')<now()
   and((j.scheduled_for is not null and j.scheduled_for<=now()and j.expires_at>now())or
    (j.scheduled_for is null and j.attempts<4 and j.created_at>now()-interval '2 hours'))
   and(j.operation!~'^(generate_|refresh_|interval_|publish$)'or not exists(
    select 1 from public.automation_jobs busy where busy.league_id=j.league_id and busy.id<>j.id
     and busy.status='running'and busy.lease_until>now()and busy.operation~'^(generate_|refresh_|interval_|publish$)'))
   and(j.operation<>'publish'or not exists(select 1 from public.automation_jobs dependency
    where dependency.league_id=j.league_id and dependency.market_week=j.market_week
     and dependency.operation in('refresh_matchups','refresh_players','refresh_specials','refresh_futures')
     and dependency.scheduled_for>=j.scheduled_for-interval '1 day'and dependency.status<>'done'))
  order by case j.operation
   when 'settlement'then 0 when 'recheck'then 1 when 'replenishment'then 2 when 'cutoff'then 3
   when 'generate_matchups'then 4 when 'generate_players'then 5 when 'generate_specials'then 6 when 'generate_futures'then 7
   when 'refresh_matchups'then 8 when 'refresh_players'then 9 when 'refresh_specials'then 10 when 'refresh_futures'then 11
   when 'publish'then 12 when 'recap'then 13 when 'final_recap'then 13 when 'reminder'then 14 when 'monday_watch'then 15
   when 'model_review'then 20 else 30 end,
   coalesce(turn.last_turn,0),j.created_at,j.event_key
  for update of j skip locked limit 1)returning * into picked;
 if found then
  insert into sportsbook_private.automation_dispatch_state(league_id,last_claimed_at)values(picked.league_id,clock_timestamp())
   on conflict(league_id)do update set last_claimed_at=excluded.last_claimed_at,last_turn=excluded.last_turn;
  return next picked;
 end if;
end $$;
revoke all on function public.claim_automation_job()from public,anon,authenticated;
grant execute on function public.claim_automation_job()to service_role;
commit;
