begin;
-- Raw provider responses are cycle-local working data. Published forecasts
-- and accepted ticket snapshots are retained in their existing archives.
create function sportsbook_private.release_refresh_sources() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'staging' then
  delete from public.line_refresh_sources where cycle_id=new.id;
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.release_refresh_sources() from public,anon,authenticated,service_role;
create trigger release_refresh_sources after update of status on public.line_refresh_cycles
for each row execute function sportsbook_private.release_refresh_sources();
-- Recovered or expired leases may finish an old source request after a cycle
-- is superseded. The next heartbeat clears only those scratch responses.
do $$ declare d text; anchor text;
begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 anchor:='for s in select * from public.weekly_schedule where automation_enabled order by league_id loop';
 if position(anchor in d)=0 then raise exception 'Source cleanup anchor changed.'; end if;
 execute replace(d,anchor,'delete from public.line_refresh_sources where cycle_id in (select id from public.line_refresh_cycles where status<>''staging'' or created_at<now()-interval ''20 minutes''); '||anchor);
end $$;
commit;
