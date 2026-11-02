begin;
create function public.final_recap_ready(p_league uuid,p_season integer)returns boolean language plpgsql stable security definer set search_path=''as $$begin
 if auth.role()is distinct from 'service_role'then raise exception 'Server worker only.';end if;
 return sportsbook_private.final_weekly_recap_ready(p_league,p_season,now());
end $$;
revoke all on function public.final_recap_ready(uuid,integer)from public,anon,authenticated;
grant execute on function public.final_recap_ready(uuid,integer)to service_role;
-- Add notification-only week 18 closeout. Financial/acceptance periods remain unchanged.
alter function sportsbook_private.enqueue_weekly_jobs(timestamptz) rename to enqueue_relative_notification_jobs;
revoke all on function sportsbook_private.enqueue_relative_notification_jobs(timestamptz) from public,anon,authenticated,service_role;
create function sportsbook_private.enqueue_weekly_jobs(p_now timestamptz)returns void language plpgsql security definer set search_path=''as $$
declare s record;cycle date;due timestamptz;deadline timestamptz;begin
 if auth.role()is distinct from 'service_role'then raise exception 'Server worker only.';end if;
 perform sportsbook_private.enqueue_relative_notification_jobs(p_now);
 for s in select cfg.*,l.nfl_season from public.weekly_schedule cfg join public.leagues l on l.id=cfg.league_id
  where cfg.automation_enabled and l.operations_enabled order by cfg.league_id loop
  if sportsbook_private.notification_calendar_week(s.league_id,p_now)>18 then
   update public.automation_jobs set status='done',completed_at=p_now,summary=jsonb_build_object('skipped',true,'reason','Weekly notification calendar complete')
    where league_id=s.league_id and operation in('recap','reminder','monday_watch')and status in('pending','failed','running')and coalesce(lease_until,'-infinity')<p_now;
  end if;
  if not s.recap_email or not sportsbook_private.final_weekly_recap_ready(s.league_id,s.nfl_season,p_now)then continue;end if;
  cycle:=sportsbook_private.notification_week(p_now);
  due:=(cycle+s.recap_time)at time zone 'America/New_York';
  deadline:=(cycle+7+'00:00'::time)at time zone 'America/New_York';
  if due>p_now or deadline<=p_now then continue;end if;
  insert into public.automation_jobs(league_id,event_key,operation,market_week,scheduled_for,expires_at)
   values(s.league_id,'final-recap-v1:'||s.league_id||':'||s.nfl_season,'final_recap',18,due,deadline)on conflict(event_key)do nothing;
 end loop;
end $$;
revoke all on function sportsbook_private.enqueue_weekly_jobs(timestamptz)from public,anon,authenticated,service_role;
do $$declare d text;begin
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure)into d;
 if strpos(d,'when ''recap'' then 13')=0 then raise exception 'Job priority source drift';end if;
 execute replace(d,'when ''recap'' then 13','when ''recap'' then 13 when ''final_recap'' then 13');
end $$;
create function public.notification_preview(p_league uuid,p_kind text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare l public.leagues;s public.weekly_schedule;week integer;content_week integer;phase text;reason text;c jsonb;eligible boolean:=false;begin
 if not sportsbook_private.is_admin(p_league)then raise exception 'Current league operator required.';end if;
 if p_kind is null or p_kind not in('opening','reminder','recap','monday_watch','reopening','attention','confirmation','signin')then raise exception 'Supported notification kind required.';end if;
 select * into l from public.leagues where id=p_league;select * into s from public.weekly_schedule where league_id=p_league;
 week:=sportsbook_private.notification_calendar_week(p_league,now());
 phase:=case when week<=18 then 'weekly' when week=19 then 'closing'else 'closed'end;
 content_week:=case when p_kind='recap'then least(18,week-1)else least(18,week)end;
 if p_kind in('attention','confirmation','signin')then reason:='Event-triggered only; no event or recipient is invented by this preview.';
 elsif not l.operations_enabled or not coalesce(s.automation_enabled,false)then reason:='Operations or automation are disabled.';
 elsif p_kind in('opening','reminder','reopening')then
  if week>18 and p_kind<>'reopening'then reason:='Weekly notification calendar complete.';
  else
   c:=public.notification_window(p_league,l.nfl_season,content_week,p_kind);
   eligible:=coalesce((c->>'eligible')::boolean,false);reason:=c->>'reason';
   if p_kind='reminder'and(c->>'send_after')::timestamptz>now()then eligible:=false;reason:='Reminder is not due yet.';end if;
  end if;
 elsif p_kind='recap'then
  eligible:=coalesce(s.recap_email,false)and((week between 2 and 18 and exists(select 1 from public.weekly_execution_runs where league_id=p_league and nfl_season=l.nfl_season and market_week=week and operation='replenishment'))or sportsbook_private.final_weekly_recap_ready(p_league,l.nfl_season,now()));
  reason:=case when eligible then 'Recorded replenishment review or final-week result is available; individual financial snapshots are checked at composition and dispatch.'else 'No current completed replenishment review or final-week closeout is available.'end;
 elsif p_kind='monday_watch'then
  eligible:=week<=18 and extract(isodow from now()at time zone 'America/New_York')=1 and(now()at time zone 'America/New_York')::time>='17:00'::time;
  reason:=case when eligible then 'Monday watch window is open; only personal open tickets qualify, with reminder collisions checked per recipient.'else 'Outside the useful Monday watch window.'end;
 end if;
 return jsonb_build_object('contract','notification-preview-v1','league_id',p_league,'kind',p_kind,'nfl_season',l.nfl_season,'calendar_week',week,'market_week',content_week,'phase',phase,'eligible',eligible,'reason',reason,'window',c,'checked_at',now(),
  'note','Shared availability only. Current verified recipients, preferences, individual funds/tickets, dispatch caps and frozen content are checked again before delivery. No messages or budget credits are created.');
end $$;
revoke all on function public.notification_preview(uuid,text)from public,anon,service_role;
grant execute on function public.notification_preview(uuid,text)to authenticated;
commit;
