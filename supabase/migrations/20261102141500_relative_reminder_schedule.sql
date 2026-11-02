begin;
alter table public.weekly_schedule add column reminder_lead_minutes integer not null default 60
 check(reminder_lead_minutes between 5 and 1440);
create index outbound_reminder_period_idx on public.outbound_emails(league_id,market_week,recipient,team_id) where kind='reminder';

-- Keep the original authorization, quote, reopening and policy contract intact.
alter function public.notification_window(uuid,integer,integer,text) set schema sportsbook_private;
alter function sportsbook_private.notification_window(uuid,integer,integer,text) rename to base_notification_window;
revoke all on function sportsbook_private.base_notification_window(uuid,integer,integer,text) from public,anon,authenticated,service_role;
create function sportsbook_private.relative_reminder_contract(c jsonb,p_lead integer) returns jsonb
language sql stable set search_path='' as $$
 select case when c->>'eligible'='true' then c||jsonb_build_object(
  'schedule_contract','relative-reminder-v1','lead_minutes',p_lead,
  'send_after',greatest((c->>'opens_at')::timestamptz,(c->>'deadline')::timestamptz-make_interval(mins=>p_lead)),
  'window_key',md5(jsonb_build_array('relative-reminder-v1',c->'window_key',p_lead)::text)) else c end
$$;
revoke all on function sportsbook_private.relative_reminder_contract(jsonb,integer) from public,anon,authenticated,service_role;
create function public.notification_window(p_league uuid,p_season integer,p_week integer,p_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;lead integer;enabled boolean;begin
 c:=sportsbook_private.base_notification_window(p_league,p_season,p_week,p_kind);
 if p_kind='reminder' then
  select reminder_lead_minutes,automation_enabled into lead,enabled from public.weekly_schedule where league_id=p_league;
  if c->>'eligible'='true' and not coalesce(enabled,false) then return c||jsonb_build_object('eligible',false,'reason','automation_disabled');end if;
  return sportsbook_private.relative_reminder_contract(c,lead);
 end if;return c;
end $$;
revoke all on function public.notification_window(uuid,integer,integer,text) from public,anon;
grant execute on function public.notification_window(uuid,integer,integer,text) to authenticated,service_role;

create function public.reminder_schedule_preview(p_league uuid,p_lead integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.weekly_schedule;l public.leagues;p record;c jsonb;begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League operator required.';end if;
 if p_lead is null or p_lead not between 5 and 1440 then raise exception 'Reminder lead must be 5 to 1440 whole minutes.';end if;
 select * into s from public.weekly_schedule where league_id=p_league;
 if not found then raise exception 'League schedule unavailable.';end if;
 select * into l from public.leagues where id=p_league;
 select * into p from public.sportsbook_period(p_league);
 c:=sportsbook_private.base_notification_window(p_league,l.nfl_season,p.week,'reminder');
 return jsonb_build_object('league_id',p_league,'nfl_season',l.nfl_season,'market_week',p.week,
  'automation_enabled',s.automation_enabled,'saved_lead_minutes',s.reminder_lead_minutes,'proposed_lead_minutes',p_lead,
  'saved',sportsbook_private.relative_reminder_contract(c,s.reminder_lead_minutes),
  'proposed',sportsbook_private.relative_reminder_contract(c,p_lead));
end $$;
revoke all on function public.reminder_schedule_preview(uuid,integer) from public,anon,service_role;
grant execute on function public.reminder_schedule_preview(uuid,integer) to authenticated;

create function public.configure_weekly_schedule_v3(p_league uuid,p_paused boolean,p_opening boolean,p_reminder boolean,p_recap boolean,p_opening_time time,p_reminder_time time,p_recap_time time,p_job_times jsonb,p_reminder_lead_minutes integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_platform_owner() then raise exception 'Only the platform owner can configure the schedule.';end if;
 if p_reminder_lead_minutes is null or p_reminder_lead_minutes not between 5 and 1440 then raise exception 'Reminder lead must be 5 to 1440 whole minutes.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder-schedule:'||p_league,0));
 perform public.configure_weekly_schedule_v2(p_league,p_paused,p_opening,p_reminder,p_recap,p_opening_time,p_reminder_time,p_recap_time,p_job_times);
 update public.weekly_schedule set reminder_lead_minutes=p_reminder_lead_minutes where league_id=p_league;
end $$;
revoke all on function public.configure_weekly_schedule_v3(uuid,boolean,boolean,boolean,boolean,time,time,time,jsonb,integer) from public,anon,service_role;
grant execute on function public.configure_weekly_schedule_v3(uuid,boolean,boolean,boolean,boolean,time,time,time,jsonb,integer) to authenticated;

-- Remove exactly the old Thursday reminder; retain all financial/market jobs.
alter function sportsbook_private.enqueue_weekly_jobs(timestamptz) rename to enqueue_calendar_jobs;
do $$declare d text;needle text:='(''reminder'',s.reminder_time,2),';begin
 select pg_get_functiondef('sportsbook_private.enqueue_calendar_jobs(timestamptz)'::regprocedure) into d;
 if strpos(d,needle)=0 then raise exception 'Calendar reminder source drift';end if;
 execute replace(d,needle,'');
end $$;
revoke all on function sportsbook_private.enqueue_calendar_jobs(timestamptz) from public,anon,authenticated,service_role;
create function sportsbook_private.enqueue_weekly_jobs(p_now timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s record;b record;c jsonb;k text;due timestamptz;deadline timestamptz;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 perform sportsbook_private.enqueue_calendar_jobs(p_now);
 for s in select cfg.*,l.nfl_season from public.weekly_schedule cfg join public.leagues l on l.id=cfg.league_id
  where cfg.automation_enabled and l.operations_enabled order by cfg.league_id loop
  perform pg_advisory_xact_lock(hashtextextended('reminder-schedule:'||s.league_id,0));
  -- Legacy reminder jobs are never executed under the new relative schedule.
  update public.automation_jobs set status='done',completed_at=p_now,
   summary=jsonb_build_object('skipped',true,'reason','Reminder schedule superseded')
   where id in(select id from public.automation_jobs where league_id=s.league_id and operation='reminder'
    and event_key not like 'relative-reminder-v1:%' and status in('pending','failed','running')
    and coalesce(lease_until,'-infinity')<p_now order by created_at limit 500);
  for b in select market_week from public.sportsbook_boards where league_id=s.league_id and nfl_season=s.nfl_season and board_type='weekly' order by market_week loop
   c:=public.notification_window(s.league_id,s.nfl_season,b.market_week,'reminder');
   k:=case when c->>'eligible'='true' then 'relative-reminder-v1:'||s.league_id||':'||s.nfl_season||':'||b.market_week||':'||(c->>'window_key') else null end;
   update public.automation_jobs set status='done',completed_at=p_now,
    summary=jsonb_build_object('skipped',true,'reason','Reminder window changed or became unavailable')
    where id in(select id from public.automation_jobs where league_id=s.league_id and operation='reminder' and market_week=b.market_week
     and event_key is distinct from k and status in('pending','failed','running') and coalesce(lease_until,'-infinity')<p_now order by created_at limit 500);
   update public.outbound_emails set status=case when attempts>0 then 'needs_review' else 'skipped' end,
    last_error='Reminder window changed or became unavailable.'
    where id in(select id from public.outbound_emails where league_id=s.league_id and kind='reminder' and market_week=b.market_week
     and status in('pending','failed') and coalesce(lease_until,'-infinity')<p_now
     and (c->>'eligible' is distinct from 'true' or notification_context->>'window_key' is distinct from c->>'window_key') order by created_at limit 500);
   if k is null then continue;end if;
   due:=(c->>'send_after')::timestamptz;deadline:=(c->>'deadline')::timestamptz;
   if due>p_now or deadline<=p_now then continue;end if;
   insert into public.automation_jobs(league_id,event_key,operation,market_week,scheduled_for,expires_at)
   values(s.league_id,k,'reminder',b.market_week,due,deadline) on conflict(event_key) do nothing;
  end loop;
 end loop;
end $$;
revoke all on function sportsbook_private.enqueue_weekly_jobs(timestamptz) from public,anon,authenticated,service_role;

-- One delivery per recipient/period even if an operator changes the lead/window.
-- Unattempted obsolete rows may be replaced; prior attempts require review.
create function public.queue_relative_reminder(p_league uuid,p_week integer,p_team uuid,p_recipient text,p_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare l public.leagues;c jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder-schedule:'||p_league,0));
 select * into l from public.leagues where id=p_league;
 c:=public.notification_window(p_league,l.nfl_season,p_week,'reminder');
 if c->>'eligible' is distinct from 'true' or c->>'window_key' is distinct from p_key or (c->>'send_after')::timestamptz>now() then return false;end if;
 if exists(select 1 from public.outbound_emails where league_id=p_league and market_week=p_week and kind='reminder'
  and recipient=p_recipient and (notification_context->>'nfl_season'=l.nfl_season::text or event_key like l.nfl_season||':%'
   or event_key like 'relative-reminder-v1:'||p_league||':'||l.nfl_season||':'||p_week||':%')
  and (attempts>0 or status in('sent','captured','needs_review'))) then return false;end if;
 insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,market_week,notification_context)
 values(p_league,'relative-reminder-v1:'||p_league||':'||l.nfl_season||':'||p_week||':'||md5(p_team||':'||p_recipient)||':'||p_key,'reminder',p_recipient,p_team,p_week,c)
 on conflict(event_key) do nothing;
 return found;
end $$;
revoke all on function public.queue_relative_reminder(uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_relative_reminder(uuid,integer,uuid,text,text) to service_role;
commit;
