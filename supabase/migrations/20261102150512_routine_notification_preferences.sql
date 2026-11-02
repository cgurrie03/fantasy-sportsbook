begin;
create function sportsbook_private.valid_notification_values(v jsonb,p_defaults boolean) returns boolean
language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>256 then return false;end if;
 return not exists(select 1 from jsonb_each(v) x where x.key not in('opening','reminder','recap','monday_watch','reopening')
  or (jsonb_typeof(x.value) is distinct from 'boolean' and (p_defaults or x.value is distinct from 'null'::jsonb)))
  and (not p_defaults or v ?& array['opening','reminder','recap','monday_watch','reopening']);
end $$;
revoke all on function sportsbook_private.valid_notification_values(jsonb,boolean) from public,anon,authenticated,service_role;
create table sportsbook_private.notification_defaults(
 league_id uuid primary key references public.leagues,
 values jsonb not null check(sportsbook_private.valid_notification_values(values,true)),
 revision integer not null default 1 check(revision>0),updated_by uuid not null references auth.users,
 updated_at timestamptz not null default clock_timestamp());
create table sportsbook_private.notification_preferences(
 league_id uuid not null references public.leagues,user_id uuid not null references auth.users,
 values jsonb not null check(sportsbook_private.valid_notification_values(values,false)),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),primary key(league_id,user_id));
create table sportsbook_private.routine_dispatches(
 email_id uuid primary key references public.outbound_emails,league_id uuid not null references public.leagues,
 user_id uuid not null references auth.users,nfl_season integer not null,period_start date not null,
 kind text not null check(kind in('opening','reminder','recap','monday_watch','reopening')),
 merged_watch boolean not null,admitted_at timestamptz not null default clock_timestamp());
create index routine_dispatch_budget on sportsbook_private.routine_dispatches(league_id,period_start,user_id);
alter table sportsbook_private.notification_defaults enable row level security;
alter table sportsbook_private.notification_preferences enable row level security;
alter table sportsbook_private.routine_dispatches enable row level security;
revoke all on sportsbook_private.notification_defaults,sportsbook_private.notification_preferences,sportsbook_private.routine_dispatches from public,anon,authenticated,service_role;
create trigger routine_dispatch_immutable before update or delete on sportsbook_private.routine_dispatches for each row execute function sportsbook_private.promo_snapshot_immutable();

create function sportsbook_private.notification_participant(p_league uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users a where a.id=p_user and a.email_confirmed_at is not null and (
  exists(select 1 from public.user_wallets w where w.league_id=p_league and w.user_id=a.id and w.status='approved') or
  (not exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and enabled) and exists(select 1 from public.league_memberships m where m.league_id=p_league and m.user_id=a.id and m.invited_email=a.email))))
$$;
revoke all on function sportsbook_private.notification_participant(uuid,uuid) from public,anon,authenticated,service_role;
create function sportsbook_private.notification_choices(p_league uuid,p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with d as(select coalesce((select values from sportsbook_private.notification_defaults where league_id=p_league),'{"opening":true,"reminder":true,"recap":true,"monday_watch":true,"reopening":true}'::jsonb) v),
 p as(select coalesce((select values from sportsbook_private.notification_preferences where league_id=p_league and user_id=p_user),'{}'::jsonb) v),
 flags as(select d.v,p.v overrides,k, (d.v->>k)::boolean and coalesce(case k when 'opening' then s.opening_email when 'reminder' then s.reminder_email when 'recap' then s.recap_email else true end,false) enabled
  from d cross join p cross join unnest(array['opening','reminder','recap','monday_watch','reopening']) k left join public.weekly_schedule s on s.league_id=p_league)
 select jsonb_build_object('defaults',(select v from d),'overrides',(select v from p),
  'available',jsonb_object_agg(k,enabled),'effective',jsonb_object_agg(k,enabled and coalesce((overrides->>k)::boolean,true))) from flags
$$;
revoke all on function sportsbook_private.notification_choices(uuid,uuid) from public,anon,authenticated,service_role;
create function public.my_notification_preferences(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not sportsbook_private.notification_participant(p_league,auth.uid()) then raise exception 'Approved league participant required.';end if;
 return sportsbook_private.notification_choices(p_league,auth.uid())||jsonb_build_object('league_id',p_league,'user_id',auth.uid(),'revision',coalesce((select revision from sportsbook_private.notification_preferences where league_id=p_league and user_id=auth.uid()),0),'weekly_limit',3);
end $$;
revoke all on function public.my_notification_preferences(uuid) from public,anon,service_role;
grant execute on function public.my_notification_preferences(uuid) to authenticated;
create function public.save_my_notification_preferences(p_league uuid,p_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare current_revision integer;begin
 if not sportsbook_private.notification_participant(p_league,auth.uid()) then raise exception 'Approved league participant required.';end if;
 if not sportsbook_private.valid_notification_values(p_values,false) then raise exception 'Use only supported notification choices.';end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-defaults:'||p_league,0));
 perform pg_advisory_xact_lock(hashtextextended('notification-user:'||p_league||':'||auth.uid(),0));
 select revision into current_revision from sportsbook_private.notification_preferences where league_id=p_league and user_id=auth.uid();
 if p_revision is distinct from coalesce(current_revision,0) then raise exception 'Notification preferences changed; reload before saving.';end if;
 if current_revision is null and (select count(*) from sportsbook_private.notification_preferences where league_id=p_league)>=128 then raise exception 'Notification preference capacity reached.';end if;
 insert into sportsbook_private.notification_preferences(league_id,user_id,values)values(p_league,auth.uid(),p_values)
 on conflict(league_id,user_id) do update set values=excluded.values,revision=notification_preferences.revision+1,updated_at=clock_timestamp();
 return public.my_notification_preferences(p_league);
end $$;
revoke all on function public.save_my_notification_preferences(uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.save_my_notification_preferences(uuid,integer,jsonb) to authenticated;
create function public.league_notification_defaults(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League operator required.';end if;
 return sportsbook_private.notification_choices(p_league,null)||jsonb_build_object('league_id',p_league,'revision',coalesce((select revision from sportsbook_private.notification_defaults where league_id=p_league),0),'weekly_limit',3);
end $$;
revoke all on function public.league_notification_defaults(uuid) from public,anon,service_role;
grant execute on function public.league_notification_defaults(uuid) to authenticated;
create function public.save_league_notification_defaults(p_league uuid,p_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare current_revision integer;begin
 if not sportsbook_private.is_platform_owner() then raise exception 'Verified platform owner required.';end if;
 if not sportsbook_private.valid_notification_values(p_values,true) then raise exception 'Every supported notification type requires an enabled/disabled choice.';end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-defaults:'||p_league,0));
 select revision into current_revision from sportsbook_private.notification_defaults where league_id=p_league;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception 'League notification defaults changed; reload before saving.';end if;
 insert into sportsbook_private.notification_defaults(league_id,values,updated_by)values(p_league,p_values,auth.uid())
 on conflict(league_id) do update set values=excluded.values,revision=notification_defaults.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp();
 return public.league_notification_defaults(p_league);
end $$;
revoke all on function public.save_league_notification_defaults(uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.save_league_notification_defaults(uuid,integer,jsonb) to authenticated;

alter table public.outbound_emails add column routine_context jsonb check(routine_context is null or octet_length(routine_context::text)<=512);
create function sportsbook_private.routine_context_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' and current_user='boff_routine_retention' and old.body_retired_at is null and new.body_retired_at is not null and new.payload is null then new.routine_context:=null;return new;end if;
 if tg_op='UPDATE' and old.routine_context is not null and new.routine_context is distinct from old.routine_context then raise exception 'Routine composition context is immutable.';end if;
 if tg_op='UPDATE' and old.routine_context is null and new.routine_context is not null and old.payload is not null then raise exception 'Frozen mail cannot adopt new routine composition.';end if;
 if new.routine_context is not null and (new.kind not in('opening','reminder','recap','monday_watch','reopening')
  or new.routine_context->>'contract' is distinct from 'routine-composition-v1' or new.routine_context->>'league_id' is distinct from new.league_id::text or new.routine_context->>'kind' is distinct from new.kind
  or coalesce(new.routine_context->>'user_id','')!~'^[0-9a-f-]{36}$' or jsonb_typeof(new.routine_context->'merge_watch') is distinct from 'boolean') then raise exception 'Invalid routine composition scope.';end if;
 return new;
end $$;
revoke all on function sportsbook_private.routine_context_guard() from public,anon,authenticated,service_role;
create trigger routine_context_guard before insert or update on public.outbound_emails for each row execute function sportsbook_private.routine_context_guard();

create function sportsbook_private.notification_week(p_now timestamptz) returns date language sql stable set search_path='' as $$
 select (p_now at time zone 'America/New_York')::date-((extract(isodow from p_now at time zone 'America/New_York')::integer+5)%7)
$$;
revoke all on function sportsbook_private.notification_week(timestamptz) from public,anon,authenticated,service_role;
create function sportsbook_private.routine_delivery_permission_at(p_email uuid,p_commit boolean,p_now timestamptz) returns jsonb
language plpgsql set search_path='' as $$
declare r public.outbound_emails;l public.leagues;s public.weekly_schedule;u uuid;wallet uuid;choices jsonb;period record;
 cycle date:=sportsbook_private.notification_week(p_now);local_now timestamp:=p_now at time zone 'America/New_York';
 prior sportsbook_private.routine_dispatches;used integer;open_count integer;merge_watch boolean:=false;c jsonb;context jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Mail worker only.';end if;
 if p_commit is null or p_now is null then raise exception 'Delivery phase and time required.';end if;
 select * into r from public.outbound_emails where id=p_email;
 if not found then raise exception 'Queued message unavailable.';end if;
 if r.kind not in('opening','reminder','recap','monday_watch','reopening') then return jsonb_build_object('allowed',true,'essential',true);end if;
 if exists(select 1 from sportsbook_private.user_finance_modes where league_id=r.league_id and enabled) then
  select w.user_id,w.id into u,wallet from public.user_wallets w join auth.users a on a.id=w.user_id where w.league_id=r.league_id and w.team_id=r.team_id and w.status='approved' and a.email_confirmed_at is not null and a.email=r.recipient;
 else
  select m.user_id into u from public.league_memberships m join auth.users a on a.id=m.user_id where m.league_id=r.league_id and m.team_id=r.team_id and m.invited_email=r.recipient and a.email=r.recipient and a.email_confirmed_at is not null;
 end if;
 if u is null then return jsonb_build_object('allowed',false,'reason','Approved routine recipient unavailable.');end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-defaults:'||r.league_id,0));
 perform pg_advisory_xact_lock(hashtextextended('notification-user:'||r.league_id||':'||u,0));
 select * into l from public.leagues where id=r.league_id;
 select * into s from public.weekly_schedule where league_id=r.league_id;
 choices:=sportsbook_private.notification_choices(r.league_id,u)->'effective';
 if choices->>r.kind is distinct from 'true' or not l.operations_enabled or (r.kind<>'reopening' and not coalesce(s.automation_enabled,false)) then return jsonb_build_object('allowed',false,'reason','Routine notification is disabled for this recipient or league.');end if;
 select * into period from public.sportsbook_period(r.league_id);
 if (r.kind='recap' and r.market_week<>period.week-1) or (r.kind<>'recap' and r.market_week<>period.week) then return jsonb_build_object('allowed',false,'reason','Routine notification belongs to an obsolete week.');end if;
 if r.kind='monday_watch' and (extract(isodow from local_now)<>1 or local_now::time<'17:00'::time) then return jsonb_build_object('allowed',false,'reason','Monday ticket watch is outside its useful window.');end if;
 open_count:=0;
 if r.kind='monday_watch' or (r.kind='reminder' and choices->>'monday_watch'='true' and extract(isodow from local_now)=1 and local_now::time>='15:00'::time) then
  select count(*)::integer into open_count from public.tickets t where t.league_id=r.league_id and t.market_week=period.week and t.nfl_season=l.nfl_season and t.status='OPEN' and t.ticket_type<>'future'
   and (case when wallet is not null then t.user_wallet_id=wallet else t.team_id=r.team_id and t.user_wallet_id is null end);
 end if;
 if r.kind='monday_watch' and open_count=0 then return jsonb_build_object('allowed',false,'reason','No open personal weekly tickets require a watch.');end if;
 if r.kind='reminder' and choices->>'monday_watch'='true' and open_count>0 and extract(isodow from local_now)=1 and local_now::time>='15:00'::time then merge_watch:=true;end if;
 if r.kind='monday_watch' and choices->>'reminder'='true' then
  if exists(select 1 from sportsbook_private.routine_dispatches d where d.league_id=r.league_id and d.user_id=u and d.period_start=cycle and d.kind='reminder' and d.merged_watch) then return jsonb_build_object('allowed',false,'reason','Ticket watch was included in the closing reminder.');end if;
  c:=public.notification_window(r.league_id,l.nfl_season,period.week,'reminder');
  if c->>'eligible'='true' and (c->>'send_after')::timestamptz<=p_now+interval '2 hours'
   and coalesce((case when wallet is not null then (select balance from public.user_wallets where id=wallet) else (select balance from public.wallets where team_id=r.team_id) end),0)>=(c->>'minimum_stake')::numeric
   and not exists(select 1 from public.outbound_emails e where e.league_id=r.league_id and e.kind='reminder' and e.market_week=period.week and e.recipient=r.recipient and e.payload is not null and coalesce((e.routine_context->>'merge_watch')::boolean,false)=false)
   and ((c->>'send_after')::timestamptz>p_now or exists(select 1 from public.outbound_emails e where e.league_id=r.league_id and e.recipient=r.recipient and e.kind='reminder' and e.market_week=period.week and e.status in('pending','failed','sending') and e.notification_context->>'window_key'=c->>'window_key')
    or not exists(select 1 from public.automation_jobs j where j.event_key='relative-reminder-v1:'||r.league_id||':'||l.nfl_season||':'||period.week||':'||(c->>'window_key') and j.status='done'))
  then return jsonb_build_object('allowed',false,'reason','Ticket watch is covered by the nearby closing reminder.');end if;
 end if;
 context:=jsonb_build_object('contract','routine-composition-v1','league_id',r.league_id,'user_id',u,'nfl_season',l.nfl_season,'period_start',cycle,'kind',r.kind,'merge_watch',merge_watch,'open_ticket_count',least(open_count,10000),'prepared_at',p_now);
 if r.payload is not null then
  if r.routine_context is null then return jsonb_build_object('allowed',false,'reason','Frozen routine message has no verified composition context.');end if;
  if r.routine_context->>'user_id' is distinct from u::text or r.routine_context->>'nfl_season' is distinct from l.nfl_season::text or r.routine_context->>'period_start' is distinct from cycle::text then return jsonb_build_object('allowed',false,'reason','Frozen routine recipient or useful period changed.');end if;
  if r.routine_context->>'merge_watch'='true' and choices->>'monday_watch' is distinct from 'true' then return jsonb_build_object('allowed',false,'reason','Ticket watch was disabled after composition.');end if;
  context:=r.routine_context;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('routine-budget:'||r.league_id||':'||u||':'||cycle,0));
 select * into prior from sportsbook_private.routine_dispatches where email_id=r.id;
 if found then
  if prior.user_id<>u or prior.period_start<>cycle or prior.nfl_season<>l.nfl_season then return jsonb_build_object('allowed',false,'reason','An earlier delivery attempt belongs to a different recipient or period.');end if;
 else
  select count(*) into used from sportsbook_private.routine_dispatches where league_id=r.league_id and user_id=u and period_start=cycle;
  if used>=3 then return jsonb_build_object('allowed',false,'reason','Three routine messages already admitted for this week.');end if;
  if used=0 and (select count(distinct user_id) from sportsbook_private.routine_dispatches where league_id=r.league_id and period_start=cycle)>=128 then return jsonb_build_object('allowed',false,'reason','Routine recipient capacity reached for this week.');end if;
  if p_commit then
   if r.payload is null or r.routine_context is null then raise exception 'Freeze verified routine composition before dispatch.';end if;
   insert into sportsbook_private.routine_dispatches(email_id,league_id,user_id,nfl_season,period_start,kind,merged_watch)
    values(r.id,r.league_id,u,l.nfl_season,cycle,r.kind,(context->>'merge_watch')::boolean);
  end if;
 end if;
 return jsonb_build_object('allowed',true,'context',context,'weekly_limit',3);
end $$;
revoke all on function sportsbook_private.routine_delivery_permission_at(uuid,boolean,timestamptz) from public,anon,authenticated,service_role;
create function public.routine_delivery_permission(p_email uuid,p_commit boolean default false) returns jsonb
language sql security definer set search_path='' as $$
 select sportsbook_private.routine_delivery_permission_at(p_email,p_commit,now())
$$;
revoke all on function public.routine_delivery_permission(uuid,boolean) from public,anon,authenticated;
grant execute on function public.routine_delivery_permission(uuid,boolean) to service_role;
commit;
