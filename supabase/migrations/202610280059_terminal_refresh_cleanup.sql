begin;
create index refresh_terminal_cleanup_idx on public.line_refresh_cycles(completed_at,id)
  where status<>'staging';
create index refresh_stuck_cleanup_idx on public.line_refresh_cycles(created_at)
  where status='staging';
create table sportsbook_private.refresh_cleanup_health (
  singleton boolean primary key default true check(singleton),
  checked_at timestamptz not null, cycles integer not null, stages integer not null,
  sources integer not null, stuck_cycles integer not null
);
alter table sportsbook_private.refresh_cleanup_health enable row level security;
revoke all on sportsbook_private.refresh_cleanup_health from public,anon,authenticated,service_role;

-- Synchronize late source/stage writes with publication and cleanup's cycle lock.
create function sportsbook_private.guard_refresh_payload_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare state text;
begin
  select status into state from public.line_refresh_cycles where id=new.cycle_id for update;
  if state is distinct from 'staging' then raise exception 'Refresh cycle is no longer active.'; end if;
  return new;
end;
$$;
revoke all on function sportsbook_private.guard_refresh_payload_write() from public,anon,authenticated,service_role;
create trigger active_refresh_source_write before insert or update on public.line_refresh_sources
  for each row execute function sportsbook_private.guard_refresh_payload_write();
create trigger active_refresh_stage_write before insert or update on public.line_refresh_stages
  for each row execute function sportsbook_private.guard_refresh_payload_write();

create function public.cleanup_terminal_refresh_payloads(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare c record; cycles integer:=0; stages integer:=0; sources integer:=0; n integer; stuck integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
  if p_limit is null or p_limit<1 or p_limit>25 then raise exception 'Cleanup batch must be between 1 and 25 cycles.'; end if;
  for c in select r.id from public.line_refresh_cycles r
    where r.status<>'staging' and r.completed_at<now()-interval '1 hour'
      and (exists(select 1 from public.line_refresh_stages where cycle_id=r.id)
        or exists(select 1 from public.line_refresh_sources where cycle_id=r.id))
      and not exists(select 1 from public.automation_jobs j where j.refresh_cycle_id=r.id
        and (j.status in ('pending','running') or (j.status='failed' and j.attempts<4)))
    order by r.completed_at,r.id for update of r skip locked limit p_limit
  loop
    -- Keep the compact cycle/job identities and every financial record.
    delete from public.line_refresh_stages where cycle_id=c.id;
    get diagnostics n=row_count; stages:=stages+n;
    delete from public.line_refresh_sources where cycle_id=c.id;
    get diagnostics n=row_count; sources:=sources+n;
    cycles:=cycles+1;
  end loop;
  select count(*) into stuck from public.line_refresh_cycles
    where status='staging' and created_at<now()-interval '24 hours';
  insert into sportsbook_private.refresh_cleanup_health values(true,now(),cycles,stages,sources,stuck)
    on conflict(singleton) do update set checked_at=excluded.checked_at,cycles=excluded.cycles,
      stages=excluded.stages,sources=excluded.sources,stuck_cycles=excluded.stuck_cycles;
  return jsonb_build_object('cycles',cycles,'stages',stages,'sources',sources,'stuck_cycles',stuck);
end;
$$;
revoke all on function public.cleanup_terminal_refresh_payloads(integer) from public,anon,authenticated;
grant execute on function public.cleanup_terminal_refresh_payloads(integer) to service_role;
-- Retire the old age-only source deletion: an old active cycle may still own a
-- valid lease. Recovery must transition it explicitly before payload removal.
do $migration$
declare definition text; anchor text;
begin
  select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into definition;
  anchor:='delete from public.line_refresh_sources where cycle_id in (select id from public.line_refresh_cycles where status<>''staging'' or created_at<now()-interval ''20 minutes'');';
  if position(anchor in definition)=0 then raise exception 'Source cleanup anchor changed.'; end if;
  execute replace(definition,anchor,'');
end;
$migration$;
commit;
