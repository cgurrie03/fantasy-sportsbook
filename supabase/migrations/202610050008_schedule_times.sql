begin;
alter table public.weekly_schedule add column job_times jsonb not null default '{"settlement":"00:30","recheck":"07:00","replenishment":"08:00","generation":"08:30","refresh":"07:30","cutoff":"20:00"}'::jsonb;
create function public.configure_weekly_schedule_v2(p_league uuid,p_paused boolean,p_opening boolean,p_reminder boolean,p_recap boolean,p_opening_time time,p_reminder_time time,p_recap_time time,p_job_times jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can configure the schedule.'; end if;
 if jsonb_typeof(p_job_times) is distinct from 'object' or not (p_job_times ?& array['settlement','recheck','replenishment','generation','refresh','cutoff']) then raise exception 'Every scheduled job requires a time.'; end if;
 if exists(select 1 from jsonb_each_text(p_job_times) x where x.key not in ('settlement','recheck','replenishment','generation','refresh','cutoff') or x.value is null or x.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Use valid HH:MM job times.'; end if;
 perform public.configure_weekly_schedule(p_league,p_paused,p_opening,p_reminder,p_recap,p_opening_time,p_reminder_time,p_recap_time);
 update public.weekly_schedule set job_times=p_job_times where league_id=p_league;
end $$;
revoke all on function public.configure_weekly_schedule_v2(uuid,boolean,boolean,boolean,boolean,time,time,time,jsonb) from public,anon;
grant execute on function public.configure_weekly_schedule_v2(uuid,boolean,boolean,boolean,boolean,time,time,time,jsonb) to authenticated;
commit;
