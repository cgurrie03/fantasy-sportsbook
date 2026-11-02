begin;
create function sportsbook_private.is_alert_staff(p_league uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users a where a.id=p_user and a.email_confirmed_at is not null and(
  exists(select 1 from sportsbook_private.platform_owners where user_id=a.id)
  or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=a.id and active and role='operator')
  or exists(select 1 from public.league_memberships where league_id=p_league and user_id=a.id and role='admin')))
$$;
revoke all on function sportsbook_private.is_alert_staff(uuid,uuid) from public,anon,authenticated,service_role;
create table sportsbook_private.staff_alert_budget(
 league_id uuid not null references public.leagues,user_id uuid not null references auth.users,
 budget_day date not null,queued integer not null check(queued between 0 and 4),last_queued_at timestamptz not null,
 last_job uuid not null references public.automation_jobs,last_category text not null,
 primary key(league_id,user_id));
alter table sportsbook_private.staff_alert_budget enable row level security;
revoke all on sportsbook_private.staff_alert_budget from public,anon,authenticated,service_role;
alter table public.outbound_emails add column staff_user_id uuid references auth.users,
 add column staff_context jsonb check(staff_context is null or octet_length(staff_context::text)<=512);

create function sportsbook_private.staff_alert_identity_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' and old.staff_user_id is not null and row(new.league_id,new.kind,new.recipient,new.team_id,new.ticket_id,new.staff_user_id) is distinct from row(old.league_id,old.kind,old.recipient,old.team_id,old.ticket_id,old.staff_user_id) then raise exception 'Staff alert identity is immutable.';end if;
 if tg_op='UPDATE' and current_user='boff_routine_retention' and old.body_retired_at is null and new.body_retired_at is not null and new.payload is null then new.staff_context:=null;return new;end if;
 if tg_op='UPDATE' and old.staff_context is not null and new.staff_context is distinct from old.staff_context then raise exception 'Staff alert context is immutable.';end if;
 if new.staff_context is not null and new.staff_user_id is null then raise exception 'Staff context requires a verified user binding.';end if;
 if new.staff_user_id is not null and (new.kind<>'attention' or new.team_id is not null or new.ticket_id is not null or (new.staff_context is null and new.body_retired_at is null)
  or (new.staff_context is not null and(new.staff_context->>'contract' is distinct from 'staff-attention-v1' or new.staff_context->>'league_id' is distinct from new.league_id::text or new.staff_context->>'user_id' is distinct from new.staff_user_id::text))) then raise exception 'Invalid staff alert scope.';end if;
 return new;
end $$;
revoke all on function sportsbook_private.staff_alert_identity_guard() from public,anon,authenticated,service_role;
create trigger staff_alert_identity before insert or update on public.outbound_emails for each row execute function sportsbook_private.staff_alert_identity_guard();

-- Keep all existing receipt/participant protections, adding a distinct teamless
-- staff branch. Preserve the entire validated participant trigger body and OID.
do $$declare d text;pos integer;branch text:=$staff$begin
 if new.kind='attention' and new.staff_user_id is not null then
  if tg_op='INSERT' then
   perform 1 from public.leagues where id=new.league_id for share;
   new.wallet_model:=case when exists(select 1 from sportsbook_private.user_finance_modes where league_id=new.league_id and enabled)then 'user' else 'legacy'end;
  elsif new.wallet_model is distinct from old.wallet_model then raise exception 'Queued financial model is immutable.';end if;
  if tg_op='UPDATE' and new.payload is null and old.payload is not null and row(new.league_id,new.team_id,new.ticket_id,new.recipient,new.kind,new.staff_user_id)is not distinct from row(old.league_id,old.team_id,old.ticket_id,old.recipient,old.kind,old.staff_user_id)then return new;end if;
  if not sportsbook_private.is_alert_staff(new.league_id,new.staff_user_id) or not exists(select 1 from auth.users where id=new.staff_user_id and email=new.recipient and email_confirmed_at is not null)then raise exception 'Verified current league staff recipient required.';end if;
  if new.team_id is not null or new.ticket_id is not null then raise exception 'Operational staff alerts cannot borrow a participant account.';end if;
  if new.payload is not null and (new.payload->'to' is distinct from jsonb_build_array(new.recipient) or new.payload?'cc' or new.payload?'bcc')then raise exception 'Email payload recipients must match the outbox recipient.';end if;
  return new;
 end if;
 if tg_op='INSERT' and new.kind='attention' then raise exception 'New attention messages require a verified staff binding.';end if;
$staff$;begin
 select pg_get_functiondef('sportsbook_private.guard_outbox_recipient()'::regprocedure)into d;
 pos:=position('begin' in lower(d));
 if pos=0 or strpos(d,'Confirmation must target')=0 or strpos(d,'Email payload recipients')=0 then raise exception 'Participant guard source drift';end if;
 execute overlay(d placing branch from pos for 5);
end $$;
revoke all on function sportsbook_private.guard_outbox_recipient() from public,anon,authenticated,service_role;
drop trigger outbox_recipient_guard on public.outbound_emails;
create trigger outbox_recipient_guard before insert or update of league_id,team_id,ticket_id,recipient,payload,wallet_model,staff_user_id on public.outbound_emails for each row execute function sportsbook_private.guard_outbox_recipient();

create function sportsbook_private.queue_staff_attention_at(p_job uuid,p_category text,p_now timestamptz) returns jsonb
language plpgsql set search_path='' as $$
declare j public.automation_jobs;l public.leagues;a record;s sportsbook_private.staff_alert_budget;c jsonb;day date:= (p_now at time zone 'America/New_York')::date;
 sent integer:=0;cooldown integer:=0;daily integer:=0;capacity integer:=0;audience integer;next_count integer;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 if p_category is null or p_category not in('results','futures','lineup','automation') or p_now is null then raise exception 'Supported staff alert category/time required.';end if;
 select * into j from public.automation_jobs where id=p_job;
 if not found then raise exception 'Scoped operation job required.';end if;
 select * into l from public.leagues where id=j.league_id;
 perform pg_advisory_xact_lock(hashtextextended('staff-attention:'||j.league_id,0));
 select count(*) into audience from auth.users u where sportsbook_private.is_alert_staff(j.league_id,u.id);
 if audience>128 then return jsonb_build_object('queued',0,'capacity_suppressed',audience);end if;
 for a in select id,email from auth.users u where sportsbook_private.is_alert_staff(j.league_id,u.id)order by id loop
  select * into s from sportsbook_private.staff_alert_budget where league_id=j.league_id and user_id=a.id;
  if exists(select 1 from public.outbound_emails where league_id=j.league_id and staff_user_id=a.id and kind='attention'
   and staff_context->>'job_id'=j.id::text and staff_context->>'category'=p_category
   and ((staff_context->>'queued_at')::timestamptz at time zone 'America/New_York')::date=day)then cooldown:=cooldown+1;continue;end if;
  if s.last_queued_at>p_now-interval '30 minutes'then cooldown:=cooldown+1;continue;end if;
  if found and s.budget_day=day then
   if s.queued>=4 then daily:=daily+1;continue;end if;
   if s.last_queued_at>p_now-interval '30 minutes' or(s.last_job=j.id and s.last_category=p_category)then cooldown:=cooldown+1;continue;end if;
   next_count:=s.queued+1;
  else
   if not found and(select count(*)from sportsbook_private.staff_alert_budget where league_id=j.league_id)>=128 then capacity:=capacity+1;continue;end if;
   next_count:=1;
  end if;
  c:=jsonb_build_object('contract','staff-attention-v1','league_id',j.league_id,'user_id',a.id,'job_id',j.id,'category',p_category,'operation',case when j.operation~'^[a-z_]{1,40}$' then j.operation else 'scheduled_step'end,'nfl_season',l.nfl_season,'market_week',j.market_week,'queued_at',p_now);
  insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,market_week,staff_user_id,staff_context)
   values(j.league_id,'staff-attention-v1:'||j.league_id||':'||day||':'||a.id||':'||next_count,'attention',a.email,null,j.market_week,a.id,c)on conflict(event_key)do nothing;
  if found then
   insert into sportsbook_private.staff_alert_budget(league_id,user_id,budget_day,queued,last_queued_at,last_job,last_category)values(j.league_id,a.id,day,next_count,p_now,j.id,p_category)
    on conflict(league_id,user_id)do update set budget_day=excluded.budget_day,queued=excluded.queued,last_queued_at=excluded.last_queued_at,last_job=excluded.last_job,last_category=excluded.last_category;
   sent:=sent+1;
  end if;
 end loop;
 return jsonb_build_object('queued',sent,'cooldown_suppressed',cooldown,'daily_suppressed',daily,'capacity_suppressed',capacity);
end $$;
revoke all on function sportsbook_private.queue_staff_attention_at(uuid,text,timestamptz) from public,anon,authenticated,service_role;
create function public.queue_staff_attention(p_job uuid,p_category text)returns jsonb language sql security definer set search_path=''as $$select sportsbook_private.queue_staff_attention_at(p_job,p_category,now())$$;
revoke all on function public.queue_staff_attention(uuid,text)from public,anon,authenticated;
grant execute on function public.queue_staff_attention(uuid,text)to service_role;
create function public.staff_alert_context(p_email uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r public.outbound_emails;l public.leagues;email text;confirmed timestamptz;begin
 if auth.role()is distinct from 'service_role'then raise exception 'Mail worker only.';end if;
 select * into r from public.outbound_emails where id=p_email;
 if not found or r.kind<>'attention' or r.staff_user_id is null or r.staff_context is null or r.team_id is not null or r.ticket_id is not null then raise exception 'Verified staff-bound alert required.';end if;
 select a.email,a.email_confirmed_at into email,confirmed from auth.users a where id=r.staff_user_id;
 select * into l from public.leagues where id=r.league_id;
 if not sportsbook_private.is_alert_staff(r.league_id,r.staff_user_id) or email is distinct from r.recipient or confirmed is null then raise exception 'Staff permission or verified contact changed.';end if;
 if r.staff_context->>'nfl_season' is distinct from l.nfl_season::text or(r.staff_context->>'queued_at')::timestamptz<now()-interval '24 hours' or(r.staff_context->>'queued_at')::timestamptz>now()+interval '30 seconds'then raise exception 'Staff alert useful window expired.';end if;
 return r.staff_context||jsonb_build_object('recipient',r.recipient);
end $$;
revoke all on function public.staff_alert_context(uuid)from public,anon,authenticated;
grant execute on function public.staff_alert_context(uuid)to service_role;

create function sportsbook_private.notification_calendar_week(p_league uuid,p_now timestamptz)returns integer language sql stable security definer set search_path=''as $$
 select l.active_week+greatest(0,floor(extract(epoch from((p_now at time zone 'America/New_York')-(l.week_anchor at time zone 'America/New_York')))/604800)::integer)from public.leagues l where id=p_league
$$;
revoke all on function sportsbook_private.notification_calendar_week(uuid,timestamptz)from public,anon,authenticated,service_role;
create function sportsbook_private.final_weekly_recap_ready(p_league uuid,p_season integer,p_now timestamptz)returns boolean language sql stable security definer set search_path=''as $$
 select sportsbook_private.notification_calendar_week(p_league,p_now)=19 and exists(select 1 from public.leagues where id=p_league and nfl_season=p_season)
  and exists(select 1 from public.league_result_weeks where league_id=p_league and nfl_season=p_season and market_week=18 and final)
$$;
revoke all on function sportsbook_private.final_weekly_recap_ready(uuid,integer,timestamptz)from public,anon,authenticated,service_role;

create function public.recap_financial_context(p_league uuid,p_team uuid,p_recipient text,p_season integer,p_week integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare w public.user_wallets;balance numeric;credit numeric;entry_time timestamptz;u uuid;key text;pending boolean;run boolean;state text;begin
 if auth.role()is distinct from 'service_role'then raise exception 'Mail worker only.';end if;
 if p_week is null or p_week not between 1 and 19 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season)or(p_week=19 and not sportsbook_private.final_weekly_recap_ready(p_league,p_season,now()))then raise exception 'Current recap season/period required.';end if;
 if exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and enabled)then
  select x.* into w from public.user_wallets x join auth.users a on a.id=x.user_id where x.league_id=p_league and x.team_id=p_team and x.status='approved' and a.email=p_recipient and a.email_confirmed_at is not null;
  if not found then raise exception 'Approved financial recap recipient required.';end if;
  u:=w.user_id;balance:=w.balance;key:='weekly:replenish:'||p_season||':'||p_week||':'||w.id;
  select amount,created_at into credit,entry_time from public.user_wallet_entries where wallet_id=w.id and event_key=key and kind='weekly_replenishment';
  select exists(select 1 from public.tickets t where t.user_wallet_id=w.id and t.nfl_season=p_season and t.ticket_type<>'future' and t.market_week<p_week and t.status='OPEN')into pending;
 else
  select m.user_id into u from public.league_memberships m join auth.users a on a.id=m.user_id where m.league_id=p_league and m.team_id=p_team and m.invited_email=p_recipient and a.email=p_recipient and a.email_confirmed_at is not null;
  if u is null then raise exception 'Approved legacy recap recipient required.';end if;
  select x.balance into balance from public.wallets x where x.team_id=p_team;
  key:='weekly:replenish:'||p_season||':'||p_week||':'||p_team;
  select amount,created_at into credit,entry_time from public.wallet_ledger where team_id=p_team and event_key=key and kind='weekly_replenishment';
  select exists(select 1 from public.tickets t where t.team_id=p_team and t.user_wallet_id is null and t.nfl_season=p_season and t.ticket_type<>'future' and t.market_week<p_week and t.status='OPEN')into pending;
 end if;
 select exists(select 1 from public.weekly_execution_runs where league_id=p_league and nfl_season=p_season and market_week=p_week and operation='replenishment')into run;
 state:=case when p_week=19 then 'weekly_calendar_complete' when credit>0 then 'credited' when credit=0 then 'no_topup_needed' when balance is null then 'funding_pending' when pending then 'results_pending' else 'review_pending'end;
 return jsonb_build_object('league_id',p_league,'team_id',p_team,'recipient',p_recipient,'nfl_season',p_season,'replenishment_week',p_week,'ready',p_week=19 or credit is not null or run,'state',state,'credited',case when p_week=19 then null else credit end,'balance',balance,'recorded_at',entry_time);
end $$;
revoke all on function public.recap_financial_context(uuid,uuid,text,integer,integer)from public,anon,authenticated;
grant execute on function public.recap_financial_context(uuid,uuid,text,integer,integer)to service_role;

-- Extend the immutable hosted admission contract additively. Exact source anchors
-- ensure a changed upstream body cannot silently lose its authorization/cap gates.
do $$declare d text;needle text;begin
 select pg_get_functiondef('sportsbook_private.routine_delivery_permission_at(uuid,boolean,timestamptz)'::regprocedure)into d;
 needle:='prior sportsbook_private.routine_dispatches;';if strpos(d,needle)=0 then raise exception 'Routine admission declaration drift';end if;
 d:=replace(d,needle,needle||'recap jsonb;');
 needle:=' if (r.kind=''recap'' and r.market_week<>period.week-1) or (r.kind<>''recap'' and r.market_week<>period.week) then';
 if strpos(d,needle)=0 then raise exception 'Routine period source drift';end if;
 d:=replace(d,needle,$patch$ if r.market_week not between 1 and 18 or(sportsbook_private.notification_calendar_week(r.league_id,p_now)>18 and r.kind not in('recap','reopening'))
  or(r.kind='recap' and not((sportsbook_private.notification_calendar_week(r.league_id,p_now)<=18 and r.market_week=period.week-1)
   or(r.market_week=18 and sportsbook_private.final_weekly_recap_ready(r.league_id,l.nfl_season,p_now))))
  or(r.kind not in('recap')and r.market_week<>period.week)then$patch$);
 needle:=' if r.payload is not null then';if strpos(d,needle)=0 then raise exception 'Routine composition source drift';end if;
 d:=replace(d,needle,$patch$ if r.kind='reminder' then
  c:=public.notification_window(r.league_id,l.nfl_season,r.market_week,'reminder');
  if c->>'eligible' is distinct from 'true' or c->>'window_key' is distinct from r.notification_context->>'window_key' or(c->>'send_after')::timestamptz>p_now
   or coalesce((case when wallet is not null then(select balance from public.user_wallets where id=wallet)else(select balance from public.wallets where team_id=r.team_id)end),0)<(c->>'minimum_stake')::numeric
  then return jsonb_build_object('allowed',false,'reason','Reminder opportunity or minimum available funds changed.');end if;
 end if;
 if r.kind='recap' then
  recap:=public.recap_financial_context(r.league_id,r.team_id,r.recipient,l.nfl_season,r.market_week+1);
  if recap->>'ready' is distinct from 'true' then return jsonb_build_object('allowed',false,'reason','Recap waits for the recorded replenishment review.');end if;
  context:=context||jsonb_build_object('recap',jsonb_build_object('state',recap->'state','credited',recap->'credited'));
 end if;
 if r.payload is not null then$patch$);
 needle:='  context:=r.routine_context;';if strpos(d,needle)=0 then raise exception 'Frozen routine context source drift';end if;
 d:=replace(d,needle,$patch$  if r.kind='recap' and r.routine_context->'recap' is distinct from context->'recap' then return jsonb_build_object('allowed',false,'reason','Recap financial snapshot changed after preparation.');end if;
  context:=r.routine_context;$patch$);
 execute d;
end $$;
commit;
