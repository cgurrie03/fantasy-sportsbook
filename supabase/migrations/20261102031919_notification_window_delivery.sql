begin;
alter table public.outbound_emails add column notification_context jsonb
 check(notification_context is null or octet_length(notification_context::text)<=2048);

-- This is an event/window deadline, not a promise that prices stay fresh until it.
-- Quote freshness and authoritative reopening/game observations are checked below.
create function sportsbook_private.notification_quote_deadline(q public.sportsbook_markets,b public.sportsbook_boards)
returns timestamptz language plpgsql stable set search_path='' as $$
declare d timestamptz:=b.closes_at;e jsonb;begin
 if not q.active or q.kind like 'future_%' or q.market_state is distinct from 'open' or q.suspension_reason is not null
  or coalesce((q.metadata->>'resolved')::boolean,false) or coalesce((q.metadata->>'lineup_locked')::boolean,false)
  or coalesce((q.metadata->>'reopening_locked')::boolean,false) then return null;end if;
 if b.reopening_id is not null then d:=least(d,b.reopening_until);end if;
 if q.metadata->>'cutoff_at' is not null then
  if q.metadata->>'cutoff_at'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}:?[0-9]{2})$' then return null;end if;
  d:=least(d,(q.metadata->>'cutoff_at')::timestamptz);end if;
 for e in select value from jsonb_array_elements(coalesce(q.metadata->'reopening_events','[]')) loop
  if e->>'state'='scheduled' then
   if coalesce(e->>'starts_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}:?[0-9]{2})$' then return null;end if;
   d:=least(d,(e->>'starts_at')::timestamptz);end if;
 end loop;
 return d;
exception when others then return null;
end $$;
revoke all on function sportsbook_private.notification_quote_deadline(public.sportsbook_markets,public.sportsbook_boards) from public,anon,authenticated,service_role;

create function public.notification_window(p_league uuid,p_season integer,p_week integer,p_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.leagues;s public.weekly_schedule;b public.sportsbook_boards;r public.line_refresh_runtime;period record;
 q public.sportsbook_markets;prior public.sportsbook_markets;choices public.sportsbook_markets[]:='{}';d timestamptz;deadline timestamptz;
 reopening boolean;settings_found boolean;policy jsonb;seen integer:=0;base jsonb;
begin
 if auth.role() is distinct from 'service_role' and not sportsbook_private.is_admin(p_league) then raise exception 'League operator required.';end if;
 if p_kind is null or p_kind not in('opening','reminder','reopening') or p_season is null or p_week is null or p_week not between 1 and 18 then raise exception 'Invalid promotional window scope.';end if;
 base:=jsonb_build_object('contract','weekly-notification-window-v1','league_id',p_league,'nfl_season',p_season,'market_week',p_week,'kind',p_kind,'eligible',false);
 select * into l from public.leagues where id=p_league;
 if not found or l.nfl_season<>p_season then return base||jsonb_build_object('reason','season_changed');end if;
 select * into s from public.weekly_schedule where league_id=p_league;settings_found:=found;
 if not l.operations_enabled or (settings_found and s.publication_paused) or (not settings_found and p_kind<>'reopening') then return base||jsonb_build_object('reason','paused');end if;
 if (p_kind='opening' and not s.opening_email) or (p_kind='reminder' and not s.reminder_email) then return base||jsonb_build_object('reason','disabled');end if;
 select * into b from public.sportsbook_boards where league_id=p_league and nfl_season=p_season and market_week=p_week and board_type='weekly';
 if not found or b.status<>'published' then return base||jsonb_build_object('reason','not_published');end if;
 if now()<b.opens_at or now()>=b.closes_at then return base||jsonb_build_object('reason','closed');end if;
 if b.suspension_reason is not null or (b.quote_valid_until is not null and b.quote_valid_until<=now()) then return base||jsonb_build_object('reason','stale_or_suspended');end if;
 reopening:=b.reopening_id is not null or b.phase='live';
 if reopening and not sportsbook_private.valid_reopening(b,'{}'::uuid[]) then return base||jsonb_build_object('reason','reopening_unavailable');end if;
 if (p_kind='reopening' and not reopening) or (p_kind='opening' and reopening) then return base||jsonb_build_object('reason','window_kind_changed');end if;
 select * into r from public.line_refresh_runtime where league_id=p_league;
 if found and r.market_week=b.market_week and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.last_error is not null or (r.week_started and not reopening))
 then return base||jsonb_build_object('reason','game_state_unavailable');end if;
 if (select count(*) from public.sportsbook_markets where board_id=b.id and active)>4096 then return base||jsonb_build_object('reason','selection_budget');end if;
 -- Descending deadlines make the first valid single/pair the last supported
 -- weekly opportunity; opposite outcomes alone never justify a reminder.
 for q in select m.* from public.sportsbook_markets m where m.board_id=b.id and m.active
  and sportsbook_private.notification_quote_deadline(m,b)>now()
  order by sportsbook_private.notification_quote_deadline(m,b) desc,m.id loop
  seen:=seen+1;if seen>4096 then return base||jsonb_build_object('reason','selection_budget');end if;
  if reopening and not sportsbook_private.valid_reopening(b,array[q.id]) then continue;end if;
  d:=sportsbook_private.notification_quote_deadline(q,b);
  if q.kind in('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','player_h2h','player_milestone','team_milestone','winning_margin') then deadline:=d;exit;end if;
  foreach prior in array choices loop
   if q.market_key<>prior.market_key and not coalesce(public.sportsbook_special_conflict(q,prior),false)
    and not(q.matchup_key is not null and prior.matchup_key is not null and q.matchup_key=prior.matchup_key and ((q.kind='spread' and prior.kind='moneyline') or (q.kind='moneyline' and prior.kind='spread')))
   then deadline:=d;exit;end if;
  end loop;
  if deadline is not null then exit;end if;
  choices:=array_append(choices,q);
 end loop;
 if deadline is null then return base||jsonb_build_object('reason','no_eligible_ticket');end if;
 select * into period from public.sportsbook_period(p_league);
 policy:=sportsbook_private.wallet_policy(p_league,p_season,period.week);
 return base||jsonb_build_object('eligible',true,'reason',null,'board_id',b.id,'opens_at',b.opens_at,'board_closes_at',b.closes_at,
  'deadline',deadline,'reopening_id',b.reopening_id,'window_type',case when reopening then 'reopening' else 'pregame' end,
  'minimum_stake',(policy->'values'->>'minimum_stake')::numeric,'policy_revision',(policy->>'revision')::integer,
  'send_before',case when p_kind='opening' then least(deadline,now()+interval '12 hours') else deadline end,
  'window_key',md5(jsonb_build_array(p_league,p_season,p_week,p_kind,b.id,b.opens_at,b.closes_at,b.phase,b.reopening_id,b.reopening_until,deadline,policy->'revision',case when p_kind='opening' then jsonb_build_array(b.revision,b.content_version) else null end)::text));
end $$;
revoke all on function public.notification_window(uuid,integer,integer,text) from public,anon;
grant execute on function public.notification_window(uuid,integer,integer,text) to authenticated,service_role;

create function sportsbook_private.notification_context_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and current_user='boff_routine_retention' and old.body_retired_at is null and new.body_retired_at is not null and new.payload is null
 then new.notification_context:=null;return new;end if;
 if tg_op='UPDATE' and old.notification_context is not null and new.notification_context is distinct from old.notification_context then raise exception 'Queued promotional window is immutable.';end if;
 if tg_op='UPDATE' and old.notification_context is null and new.notification_context is not null and (old.attempts>0 or old.payload is not null) then raise exception 'An attempted or frozen message cannot adopt a new window.';end if;
 if new.notification_context is not null then
  if new.kind not in('opening','reminder','reopening') or new.notification_context->>'contract' is distinct from 'weekly-notification-window-v1'
   or new.notification_context->>'league_id' is distinct from new.league_id::text or new.notification_context->>'market_week' is distinct from new.market_week::text
   or new.notification_context->>'kind' is distinct from new.kind or new.notification_context->>'eligible' is distinct from 'true'
   or coalesce(new.notification_context->>'window_key','')!~'^[0-9a-f]{32}$' then raise exception 'Invalid queued promotional window scope.';end if;
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.notification_context_guard() from public,anon,authenticated,service_role;
create trigger notification_context_guard before insert or update on public.outbound_emails for each row execute function sportsbook_private.notification_context_guard();

-- The existing scoped/manual reopening gate and financial audience stay intact.
alter function public.queue_reopening_announcement(uuid) rename to base_queue_reopening_announcement;
alter function public.base_queue_reopening_announcement(uuid) set schema sportsbook_private;
revoke all on function sportsbook_private.base_queue_reopening_announcement(uuid) from public,anon,authenticated,service_role;
create function public.queue_reopening_announcement(p_review uuid) returns integer language plpgsql security definer set search_path='' as $$
declare w public.sportsbook_reopening_reviews;c jsonb;n integer;begin
 select * into w from public.sportsbook_reopening_reviews where id=p_review;
 if not found or not sportsbook_private.is_admin(w.league_id) then raise exception 'Only this league admin can send this announcement.';end if;
 c:=public.notification_window(w.league_id,w.nfl_season,w.market_week,'reopening');
 if c->>'eligible' is distinct from 'true' or c->>'reopening_id' is distinct from w.id::text then raise exception 'An actionable approved reopening is required.';end if;
 n:=sportsbook_private.base_queue_reopening_announcement(p_review);
 update public.outbound_emails set notification_context=c where reopening_id=w.id and kind='reopening' and status='pending' and attempts=0 and payload is null and notification_context is null;
 return n;
end $$;
revoke all on function public.queue_reopening_announcement(uuid) from public,anon,service_role;
grant execute on function public.queue_reopening_announcement(uuid) to authenticated;
commit;
