--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: sportsbook_private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA sportsbook_private;


--
-- Name: activate_reopening_review(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_reopening_review(p_review uuid, p_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '90s'
    SET work_mem TO '16MB'
    AS $$
declare w public.sportsbook_reopening_reviews;r public.line_refresh_runtime;b public.sportsbook_boards;v_quotes jsonb;
begin
 select * into w from public.sportsbook_reopening_reviews where id=p_review;
 if not found or not sportsbook_private.is_admin(w.league_id) then raise exception 'Only this league admin can approve a reopening.'; end if;
 perform pg_advisory_xact_lock(hashtext('reopening:'||w.league_id));
 select * into w from public.sportsbook_reopening_reviews where id=p_review for update;
 if w.snapshot_hash is distinct from p_hash then raise exception 'Review the exact reopening snapshot before approval.'; end if;
 if w.status='approved' then return jsonb_build_object('id',w.id,'duplicate',true); end if;
 if w.status<>'review' or w.checked_at<now()-interval '3 minutes' or w.closes_at<=now() then raise exception 'This preview expired. Refresh and review the current lines.'; end if;
 select * into r from public.line_refresh_runtime where league_id=w.league_id;
 if not found or r.market_week<>w.market_week or r.observed_at<now()-interval '3 minutes' or r.observed_at is null or r.last_error is not null then raise exception 'The current game-state source is unavailable.'; end if;
 if exists(select 1 from public.sportsbook_reopening_reviews where league_id=w.league_id and status='approved' and closes_at>now()) then raise exception 'A reopening window is already approved.'; end if;
 update public.sportsbook_reopening_reviews set status='expired' where league_id=w.league_id and status='approved' and closes_at<=now();
 perform 1 from public.sportsbook_boards where id in(w.weekly_board,w.future_board) order by id for update;
 if exists(select 1 from public.sportsbook_boards where (id=w.weekly_board and revision<>w.weekly_revision) or(id=w.future_board and revision<>w.future_revision)) then raise exception 'The board changed. Refresh and review the updated prices.'; end if;
 if not exists(select 1 from jsonb_array_elements(w.weekly_quotes) q where not coalesce((q->'metadata'->>'reopening_locked')::boolean,false) and not coalesce((q->'metadata'->>'lineup_locked')::boolean,false)) then raise exception 'No eligible weekly bets are available.'; end if;
 for b in select * from public.sportsbook_boards where id in(w.weekly_board,w.future_board) order by id loop
  select jsonb_agg(x||jsonb_build_object('metadata',x->'metadata'||jsonb_build_object('reopening_review_id',w.id))) into v_quotes from jsonb_array_elements(case when b.board_type='weekly' then w.weekly_quotes else w.future_quotes end)x;
  if v_quotes is null or jsonb_array_length(v_quotes)=0 then continue; end if;
  if b.board_type='weekly' then perform public.save_market_board(b.id,b.league_id,b.market_week,now(),w.closes_at,v_quotes,'published');
  else perform public.save_future_board(b.id,b.league_id,v_quotes,'published'); end if;
  update public.sportsbook_boards set reopening_id=w.id,reopening_until=w.closes_at,closes_at=least(w.closes_at,case when board_type='weekly' then w.closes_at else closes_at end),suspension_reason=null,source_observed_at=w.checked_at,quote_valid_until=least(w.closes_at,w.checked_at+interval '130 minutes') where id=b.id;
 end loop;
 update public.sportsbook_reopening_reviews set status='approved',approved_by=auth.uid(),approved_at=now() where id=w.id;
 update public.line_refresh_runtime set next_due_at=now() where league_id=w.league_id;
 return jsonb_build_object('id',w.id,'closes_at',w.closes_at,'email_queued',false);
end $$;


--
-- Name: approve_member(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_team public.teams; v_email text; v_id uuid; v_existing public.league_memberships;
begin
  select * into v_team from public.teams where id = p_team;
  if not found or not sportsbook_private.is_admin(v_team.league_id) then
    raise exception 'Admin access required';
  end if;
  v_email := lower(trim(p_email));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter the owner name';
  end if;
  if p_sleeper_user is null or p_sleeper_user <> v_team.sportsbook_owner_id then
    raise exception 'Use the approved sportsbook owner for this team'; end if;
  -- Serialize changes to one team; never detach an existing linked account silently.
  perform 1 from public.teams where id = p_team for update;
  select * into v_existing from public.league_memberships where team_id = p_team;
  if found then
    if v_existing.invited_email <> v_email or v_existing.sleeper_user_id <> p_sleeper_user then
      raise exception 'This team is already mapped. Account reassignment requires a separate review.';
    end if;
    update public.league_memberships set display_name = trim(p_name) where id = v_existing.id;
    return v_existing.id;
  end if;
  insert into public.league_memberships(league_id, team_id, invited_email, display_name, sleeper_user_id)
    values(v_team.league_id, p_team, v_email, trim(p_name), p_sleeper_user) returning id into v_id;
  return v_id;
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: automation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    event_key text NOT NULL,
    operation text NOT NULL,
    market_week integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    lease_until timestamp with time zone,
    summary jsonb,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    refresh_cycle_id uuid,
    scheduled_for timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT automation_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: claim_automation_job(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_automation_job() RETURNS SETOF public.automation_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
end $_$;


--
-- Name: claim_memberships(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_memberships() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_email text; v_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select lower(email) into v_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  update public.league_memberships set user_id = auth.uid()
    where invited_email = v_email and user_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: outbound_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    event_key text NOT NULL,
    kind text NOT NULL,
    recipient text NOT NULL,
    team_id uuid,
    ticket_id uuid,
    market_week integer NOT NULL,
    payload jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    last_error text,
    lease_until timestamp with time zone,
    first_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    reopening_id uuid,
    CONSTRAINT outbound_emails_kind_check CHECK ((kind = ANY (ARRAY['opening'::text, 'reminder'::text, 'recap'::text, 'attention'::text, 'confirmation'::text, 'monday_watch'::text, 'reopening'::text]))),
    CONSTRAINT outbound_emails_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'needs_review'::text, 'skipped'::text])))
);


--
-- Name: claim_outbound_emails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_outbound_emails() RETURNS SETOF public.outbound_emails
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 -- Resend idempotency expires after 24 hours. Ambiguous older sends need human review.
 update public.outbound_emails set status='needs_review',last_error='Retry window expired; verify provider delivery before resending.'
 where status in ('sending','failed','pending') and first_attempt_at<now()-interval '23 hours';
 return query update public.outbound_emails set status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
 where id in(select id from public.outbound_emails where status in ('pending','failed','sending') and attempts<5 and coalesce(lease_until,'-infinity')<now() order by created_at for update skip locked limit 4) returning *;
end $$;


--
-- Name: claim_promo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_promo(p_offer uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare o public.promo_offers;
begin
 select * into o from public.promo_offers where id=p_offer for share;
 if not found or not sportsbook_private.is_member(o.league_id) or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 insert into public.promo_claims(offer_id,league_id,user_id) values(o.id,o.league_id,auth.uid()) on conflict do nothing;
 if found then insert into public.promo_events(league_id,offer_id,user_id,event) values(o.league_id,o.id,auth.uid(),'claimed');end if;
end $$;


--
-- Name: claim_scoped_outbound_emails(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_scoped_outbound_emails(p_ticket uuid DEFAULT NULL::uuid) RETURNS SETOF public.outbound_emails
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 update public.outbound_emails set status='needs_review',last_error='Retry window expired; verify provider delivery before resending.'
 where status in ('sending','failed','pending') and first_attempt_at<now()-interval '23 hours' and (p_ticket is null or ticket_id=p_ticket);
 return query update public.outbound_emails set status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
 where id in(select id from public.outbound_emails where status in ('pending','failed','sending') and attempts<5
 and (p_ticket is null or ticket_id=p_ticket) and coalesce(lease_until,'-infinity')<now()
 order by created_at for update skip locked limit 4) returning *;
end $$;


--
-- Name: configure_weekly_schedule(uuid, boolean, boolean, boolean, boolean, time without time zone, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can configure the schedule.'; end if;
 if p_paused is null or p_opening is null or p_reminder is null or p_recap is null or p_opening_time is null or p_reminder_time is null or p_recap_time is null then raise exception 'Schedule fields are required.'; end if;
 update public.weekly_schedule set publication_paused=p_paused,opening_email=p_opening,reminder_email=p_reminder,recap_email=p_recap,opening_time=p_opening_time,reminder_time=p_reminder_time,recap_time=p_recap_time,updated_at=now() where league_id=p_league;
end $$;


--
-- Name: configure_weekly_schedule_v2(uuid, boolean, boolean, boolean, boolean, time without time zone, time without time zone, time without time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can configure the schedule.'; end if;
 if jsonb_typeof(p_job_times) is distinct from 'object' or not (p_job_times ?& array['settlement','recheck','replenishment','generation','refresh','cutoff']) then raise exception 'Every scheduled job requires a time.'; end if;
 if exists(select 1 from jsonb_each_text(p_job_times) x where x.key not in ('settlement','recheck','replenishment','generation','refresh','cutoff') or x.value is null or x.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Use valid HH:MM job times.'; end if;
 perform public.configure_weekly_schedule(p_league,p_paused,p_opening,p_reminder,p_recap,p_opening_time,p_reminder_time,p_recap_time);
 update public.weekly_schedule set job_times=p_job_times where league_id=p_league;
end $_$;


--
-- Name: confirm_scheduled_publication(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_scheduled_publication(p_board uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare b public.sportsbook_boards; r public.line_refresh_runtime;
 required text[]; op text; latest_status text; oldest timestamptz; finished timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select * into b from public.sportsbook_boards where id=p_board for update;
 if not found or b.status<>'published' or b.phase<>'pregame' or b.closes_at<=now() then return false; end if;
 select * into r from public.line_refresh_runtime where league_id=b.league_id;
 if not found or r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.last_error is not null or r.week_started or (b.board_type='weekly' and b.market_week<>r.market_week) then return false; end if;
 required:=case when b.board_type='future' then array['refresh_futures'] else array['refresh_matchups','refresh_players','refresh_specials'] end;
 foreach op in array required loop
  select status,coalesce(completed_at,created_at) into latest_status,finished
   from public.automation_jobs where league_id=b.league_id and market_week=r.market_week
    and operation=op and created_at>now()-interval '7 days' order by created_at desc limit 1;
  if latest_status is distinct from 'done' or finished is null or finished<now()-interval '130 minutes' then return false; end if;
 end loop;
 if not exists(select 1 from public.sportsbook_markets where board_id=b.id and active) or exists(select 1 from public.sportsbook_markets where board_id=b.id and active and metadata->>'generated_at' is null) then return false; end if;
 select min((metadata->>'generated_at')::timestamptz) into oldest from public.sportsbook_markets where board_id=b.id and active;
 if oldest<now()-interval '130 minutes' or oldest>now()+interval '1 minute' then return false; end if;
 update public.sportsbook_boards set suspension_reason=null,source_observed_at=r.observed_at,quote_valid_until=now()+interval '130 minutes' where id=b.id;
 return true;
end $$;


--
-- Name: control_model(uuid, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid DEFAULT NULL::uuid, p_expected uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare c public.model_controls;v public.model_config_versions;r public.model_weekly_reviews;target uuid;config jsonb;begin
 if p_action in ('promote','auto_rollback') then
  if auth.role() is distinct from 'service_role' then raise exception 'Validated worker only.';end if;
 elsif not sportsbook_private.is_admin(p_league) then raise exception 'League admin only.';end if;
 if length(trim(p_reason)) not between 5 and 500 then raise exception 'Provide an audit reason.';end if;
 select * into strict c from public.model_controls where league_id=p_league for update;
 if p_expected is not null and c.active_id<>p_expected then raise exception 'Active model changed; recompute assessment.';end if;
 target:=c.active_id;
 if p_action='promote' then
  if c.paused then raise exception 'Automatic promotion paused.';end if;
  select * into strict r from public.model_weekly_reviews where id=p_review and league_id=p_league;
  if exists(select 1 from public.model_change_events where review_id=p_review and kind='promote') then return c.active_id;end if;
  if r.created_at<now()-interval '1 day' or r.comparison->>'passed' is distinct from 'true' or jsonb_array_length(r.comparison->'reasons')<>0 then raise exception 'Promotion gates failed.';end if;
  if coalesce((r.comparison->>'training_weeks')::integer,0)<8 or coalesce((r.comparison->'gates'->>'max_step')::numeric,1)>.02 then raise exception 'Promotion policy mismatch.';end if;
  if coalesce(jsonb_array_length(r.comparison->'tests'),0)<>2 or exists(select 1 from jsonb_array_elements(r.comparison->'tests') t where t->>'pass' is distinct from 'true' or coalesce((t->>'observations')::integer,0)<case when t->>'phase'='holdout' then 40 else 120 end or coalesce((t->'interval'->>'low')::numeric,-1)<=0 or coalesce((t->'frozen_interval'->>'low')::numeric,-1)<0 or coalesce((t->>'weeks')::integer,0)<case when t->>'phase'='holdout' then 4 else 12 end) then raise exception 'Confidence/sample gates failed.';end if;
  select * into strict v from public.model_config_versions where id=c.active_id;
  if v.parent_id is not null and v.created_at>now()-interval '7 days' then raise exception 'Promotion cooldown active.';end if;
  if r.comparison->'current'<>v.config then raise exception 'Baseline comparison changed.';end if;
  config:=r.comparison->'candidate';
  if abs((config->>'score_scale')::numeric/(v.config->>'score_scale')::numeric-1)>.020000001 or abs((config->>'variance_scale')::numeric/(v.config->>'variance_scale')::numeric-1)>.020000001 then raise exception 'Weekly parameter bound exceeded.';end if;
  insert into public.model_config_versions(league_id,parent_id,config,reason) values(p_league,c.active_id,config,p_reason) returning id into target;
 elsif p_action in ('rollback','auto_rollback') then
  select coalesce(parent_id,c.baseline_id) into target from public.model_config_versions where id=c.active_id;
 elsif p_action not in ('pause','resume') then raise exception 'Unknown model action.';end if;
 update public.model_controls set active_id=target,paused=case when p_action in ('pause','rollback','auto_rollback') then true when p_action='resume' then false else paused end,updated_at=now() where league_id=p_league;
 insert into public.model_change_events(league_id,kind,from_id,to_id,review_id,reason) values(p_league,p_action,c.active_id,target,p_review,p_reason);
 return target;
end $$;


--
-- Name: label_future_leg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.label_future_leg() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 new.market_type:=case new.settlement_context->>'kind' when 'future_champion' then 'League Winner' when 'future_playoffs' then 'Make / Miss Playoffs' when 'future_first_pick' then '#1 Pick' when 'future_win_total' then 'Regular-season Wins' else new.market_type end;
 return new;
end $$;


--
-- Name: league_leaderboard(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.league_leaderboard(p_league uuid) RETURNS TABLE(team_id uuid, bets_placed bigint, bets_won bigint, bets_lost bigint, bets_push bigint, total_wagered numeric, total_payout numeric, net_profit numeric, roi numeric, win_percentage numeric, biggest_parlay_legs bigint, biggest_parlay_odds integer, biggest_payout numeric, current_balance numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select t.id,count(b.id),count(b.id) filter(where b.status='WON'),count(b.id) filter(where b.status='LOST'),count(b.id) filter(where b.status='PUSH'),coalesce(sum(b.stake),0),coalesce(sum(b.actual_payout),0),coalesce(sum(b.net_profit) filter(where b.status<>'OPEN'),0),
 coalesce(100*sum(b.net_profit) filter(where b.status<>'OPEN')/nullif(sum(b.stake) filter(where b.status<>'OPEN'),0),0),coalesce(100.0*count(b.id) filter(where b.status='WON')/nullif(count(b.id) filter(where b.status in ('WON','LOST')),0),0),
 coalesce(max((select count(*) from public.ticket_legs l where l.ticket_id=b.id)) filter(where b.status='WON'),0),max(b.accepted_combined_odds) filter(where b.status='WON'),coalesce(max(b.actual_payout),0),w.balance
 from public.teams t join public.wallets w on w.team_id=t.id left join public.tickets b on b.team_id=t.id and b.status<>'VOIDED'
 where t.league_id=p_league and sportsbook_private.is_member(p_league)
 group by t.id,w.balance order by 8 desc,14 desc,2 desc;
$$;


--
-- Name: list_promos(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_promos(p_league uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League membership required.';end if;
 return coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('claimed',c.offer_id is not null,'used',c.used_ticket is not null) order by slot)
 from public.promo_offers o left join public.promo_claims c on c.offer_id=o.id and c.user_id=auth.uid()
 where o.league_id=p_league and sportsbook_private.promo_available(o)),'[]');
end $$;


--
-- Name: observe_line_refresh(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.observe_line_refresh(p_status jsonb, p_error text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare s record; w integer; r public.line_refresh_runtime; c uuid; minutes integer; recovering boolean; slot bigint; family text; b public.sportsbook_boards; f public.sportsbook_boards;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 if p_error is null and (jsonb_typeof(p_status->'games') is distinct from 'array' or jsonb_typeof(p_status->'any_in_progress') is distinct from 'boolean' or jsonb_typeof(p_status->'week_started') is distinct from 'boolean') then raise exception 'Invalid game observation.'; end if;
 delete from public.line_refresh_sources where cycle_id in (select id from public.line_refresh_cycles where status<>'staging' or created_at<now()-interval '20 minutes'); for s in select * from public.weekly_schedule where automation_enabled order by league_id loop
  select week into w from public.sportsbook_period(s.league_id); perform sportsbook_private.maintain_reopenings(s.league_id,w);
  insert into public.line_refresh_runtime(league_id,market_week) values(s.league_id,w) on conflict do nothing;
  select * into r from public.line_refresh_runtime where league_id=s.league_id for update;
  recovering:=not s.publication_paused and (not (coalesce((p_status->>'week_started')::boolean,false) or (r.market_week=w and r.week_started)) or sportsbook_private.active_reopening(s.league_id,w) is not null) and not exists(select 1 from public.line_refresh_cycles active_cycle where active_cycle.league_id=s.league_id and active_cycle.market_week=w and active_cycle.status='staging' and active_cycle.created_at>now()-interval '20 minutes') and p_error is null and p_status->>'reason' is null and (r.last_error is not null or exists(select 1 from public.sportsbook_boards held where held.league_id=s.league_id and held.status='published' and held.closes_at>now() and (held.market_week=w or held.board_type='future') and (held.suspension_reason ~* 'timeout|timed out|fetch|gateway|ECONN|source unavailable|connection|aborted' or held.quote_valid_until<=now()))); minutes:=case when coalesce((p_status->>'any_in_progress')::boolean,r.any_in_progress) then 15 else 120 end;
  update public.line_refresh_runtime set market_week=w,observed_at=case when p_error is null then now() else observed_at end,
   any_in_progress=coalesce((p_status->>'any_in_progress')::boolean,any_in_progress),
   week_started=case when r.market_week<>w then coalesce((p_status->>'week_started')::boolean,false) else week_started or coalesce((p_status->>'week_started')::boolean,false) end,
   games=coalesce(p_status->'games',games),interval_minutes=minutes,last_error=coalesce(p_error,p_status->>'reason'),
   next_due_at=case when recovering or r.market_week<>w or minutes<>r.interval_minutes then now() else next_due_at end
  where league_id=s.league_id returning * into r;
  if r.last_error is not null or r.week_started then
   update public.sportsbook_boards set phase=case when r.week_started and board_type='weekly' then 'live' else phase end,suspension_reason=coalesce(r.last_error,'Live pricing unavailable: observed starter points and a validated remaining-points model are required.')
   where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and (market_week=w or board_type='future') and (reopening_id is null or reopening_until<=now() or r.last_error is not null);
  end if;
  insert into public.automation_jobs(league_id,event_key,operation,market_week)
 select distinct s.league_id,'model-review:'||logged.nfl_season||':'||logged.market_week||':'||(now() at time zone 'America/New_York')::date,'model_review',logged.market_week
 from (select league_id,nfl_season,market_week from public.live_forecast_runs union select league_id,nfl_season,market_week from public.model_forecast_runs) logged where logged.league_id=s.league_id and logged.nfl_season=(select nfl_season from public.leagues where id=s.league_id) and (logged.market_week=w-1 or (logged.market_week=18 and w=18 and ((p_status->>'season_year')::integer>logged.nfl_season or ((p_status->>'season_year')::integer=logged.nfl_season and (p_status->>'season_type')::integer=3))))
 on conflict do nothing; if p_error is not null or r.last_error is not null or (r.next_due_at>now() and not exists(select 1 from public.line_refresh_cycles expired where expired.league_id=s.league_id and expired.status='staging' and expired.created_at<=now()-interval '20 minutes')) then continue; end if;
  -- One bounded cycle at a time. Abandoned cycles expire; missed slots coalesce.
  if exists(select 1 from public.line_refresh_cycles where league_id=s.league_id and market_week=w and status='staging' and created_at>now()-interval '20 minutes') then continue; end if;
  update public.line_refresh_cycles set status='superseded',completed_at=now() where league_id=s.league_id and status='staging';
  update public.automation_jobs set status='done',completed_at=now(),summary='{"superseded":true}' where league_id=s.league_id and refresh_cycle_id is not null and status in ('pending','failed') and refresh_cycle_id in(select id from public.line_refresh_cycles where status='superseded');
  select * into b from public.sportsbook_boards where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and market_week=w and board_type='weekly';
  select * into f from public.sportsbook_boards where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and board_type='future';
  slot:=floor(extract(epoch from now())/ (minutes*60));
  insert into public.line_refresh_cycles(league_id,market_week,slot,source_recovery,weekly_board,weekly_revision,future_board,future_revision)
  values(s.league_id,w,slot,recovering,b.id,b.revision,f.id,f.revision) on conflict do nothing returning id into c;
  if c is null then continue; end if;
  foreach family in array array['matchups','players','specials','futures'] loop
   insert into public.automation_jobs(league_id,event_key,operation,market_week,refresh_cycle_id)
   values(s.league_id,'interval:'||c||':'||family,'interval_'||family,w,c) on conflict do nothing;
  end loop;
  update public.line_refresh_runtime set next_due_at=now()+make_interval(mins=>minutes) where league_id=s.league_id;
 end loop;
end $$;


--
-- Name: pause_promo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pause_promo(p_offer uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare o public.promo_offers;
begin
 select * into o from public.promo_offers where id=p_offer for update;
 if not found or not sportsbook_private.is_admin(o.league_id) then raise exception 'League admin required.';end if;
 update public.promo_offers set status='disabled' where id=p_offer;
 insert into public.promo_events(league_id,offer_id,user_id,event) values(o.league_id,o.id,auth.uid(),'disabled');
end $$;


--
-- Name: place_boosted_ticket(uuid, integer, uuid[], numeric, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare promo public.promo_offers; base_price numeric; v_board public.sportsbook_boards; v_member public.league_memberships; v_wallet public.wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from public.league_memberships where league_id=v_board.league_id and user_id=auth.uid();
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.wallets where team_id=v_member.team_id for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then
   if not exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id and offer_id=p_offer and user_id=auth.uid()) then raise exception 'Request identifier already used for another offer.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 promo:=sportsbook_private.validate_boost(p_offer,p_board,p_picks,p_stake);
if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.phase='live' then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.week_started or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 base_price:=v_price; v_price:=1+(v_price-1)*(1+(promo.terms->>'percent')::numeric/100);
v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   select h.team_name||' vs. '||a.team_name into v_matchup from public.teams h, public.teams a where h.id=v_quote.home_team_id and a.id=v_quote.away_team_id;
   insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
   values(v_id,v_number,v_quote.id,v_quote.label,case v_quote.kind when 'moneyline' then 'Moneyline' when 'spread' then 'Spread' when 'match_total' then 'Match Total' when 'team_total' then 'Team Total' when 'player_points' then 'Player Points' when 'weekly_high' then 'Weekly High Scorer' else 'Weekly Low Scorer' end,v_matchup,round(case when v_legprice>=2 then (v_legprice-1)*100 else -100/(v_legprice-1) end),v_quote.line,v_legprice,'OPEN','Accepted board revision '||p_revision,jsonb_build_object('kind',v_quote.kind,'side',v_quote.side,'team_id',v_quote.team_id,'home_team_id',v_quote.home_team_id,'away_team_id',v_quote.away_team_id,'metadata',v_quote.metadata,'boost_pct',v_quote.boost_pct));
 end loop;
 update public.wallets set balance=balance-p_stake,updated_at=now() where team_id=v_member.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(v_member.team_id,v_id,'ticket:wager:'||v_id,'wager',-p_stake,v_wallet.balance,v_wallet.balance-p_stake,'Ticket placed');
 insert into public.email_deliveries(ticket_id,recipient) values(v_id,v_member.invited_email);
 insert into public.ticket_promotions values(v_id,promo.league_id,v_member.team_id,auth.uid(),promo.id,'boost',(promo.terms->>'percent')::numeric,base_price,to_jsonb(promo));
 update public.promo_claims set used_ticket=v_id where offer_id=promo.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(promo.league_id,promo.id,auth.uid(),'redeemed',v_id);return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $_$;


--
-- Name: place_fixed_ticket(uuid, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare o public.promo_offers;m public.league_memberships;w public.wallets;c public.promo_claims;t public.tickets;q public.sportsbook_markets;price numeric:=1;lp numeric;i uuid:=gen_random_uuid();n integer:=0;
begin
 -- Read league identity first; take wallet before offer/claim to match acceptance
 -- and void settlement. Admin pause never waits on a wallet.
 select * into o from public.promo_offers where id=p_offer;
 select * into m from public.league_memberships where league_id=o.league_id and user_id=auth.uid();
 if not found then raise exception 'League membership required.';end if;
 select * into strict w from public.wallets where team_id=m.team_id for update;
 select * into t from public.tickets where request_key=p_request;
 if found then
  if t.team_id<>m.team_id or t.stake is distinct from p_stake or not exists(select 1 from public.ticket_promotions where ticket_id=t.id and offer_id=p_offer and kind='fixed' and user_id=auth.uid()) then raise exception 'Request identifier already used.';end if;
  return jsonb_build_object('ticket_id',t.id,'balance',w.balance,'duplicate',true);
 end if;
 select * into o from public.promo_offers where id=p_offer for share;
 if o.kind<>'fixed' or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 insert into public.promo_claims(offer_id,league_id,user_id) values(o.id,o.league_id,auth.uid()) on conflict do nothing;
 select * into c from public.promo_claims where offer_id=o.id and user_id=auth.uid() for update;
 if c.used_ticket is not null then raise exception 'This offer has already been used.';end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>w.balance or w.balance is null then raise exception 'Enter a whole-cent wager within your balance.';end if;
 if o.terms->>'fixed_stake' is not null and p_stake<>(o.terms->>'fixed_stake')::numeric then raise exception 'This offer requires its fixed wager.';end if;
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;price:=price*lp;end loop;
 if round(price*p_stake,2)>9999999999.99 or (price-1)*100>2147483647 then raise exception 'Potential payout exceeds supported ticket limit.';end if;
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(i,o.league_id,m.team_id,p_request,(select league_season from public.leagues where id=o.league_id),o.nfl_season,o.market_week,o.market_week,now(),round(case when price>=2 then (price-1)*100 else -100/(price-1) end),p_stake,round(price*p_stake,2),'OPEN',0);
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop
  n:=n+1;lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;
  insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
  values(i,n,q.id,q.label,q.kind,q.subject,q.odds,q.line,lp,'OPEN','Fixed offer version '||o.version,jsonb_build_object('kind',q.kind,'side',q.side,'team_id',q.team_id,'home_team_id',q.home_team_id,'away_team_id',q.away_team_id,'metadata',q.metadata,'boost_pct',0));
 end loop;
 insert into public.ticket_promotions values(i,o.league_id,m.team_id,auth.uid(),o.id,'fixed',0,price,to_jsonb(o));
 update public.wallets set balance=balance-p_stake,updated_at=now() where team_id=m.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(m.team_id,i,'ticket:wager:'||i,'wager',-p_stake,w.balance,w.balance-p_stake,'Fixed offer accepted');
 update public.promo_claims set used_ticket=i where offer_id=o.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(o.league_id,o.id,auth.uid(),'redeemed',i);
 insert into public.email_deliveries(ticket_id,recipient) values(i,m.invited_email);
 return jsonb_build_object('ticket_id',i,'balance',w.balance-p_stake,'duplicate',false);
end $$;


--
-- Name: place_sportsbook_ticket(uuid, integer, uuid[], numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_board public.sportsbook_boards; v_member public.league_memberships; v_wallet public.wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from public.league_memberships where league_id=v_board.league_id and user_id=auth.uid();
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.wallets where team_id=v_member.team_id for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then
   if exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id) then raise exception 'Request identifier already used for a promotion.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.reopening_id is not null and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Reopening prices or game state changed. Refresh your picks.'; end if; if v_board.phase='live' and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or (r.week_started and not sportsbook_private.valid_reopening(v_board,p_picks)) or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','player_h2h','player_milestone','team_milestone','winning_margin')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   select h.team_name||' vs. '||a.team_name into v_matchup from public.teams h, public.teams a where h.id=v_quote.home_team_id and a.id=v_quote.away_team_id;
   insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
   values(v_id,v_number,v_quote.id,v_quote.label,case v_quote.kind when 'moneyline' then 'Moneyline' when 'spread' then 'Spread' when 'match_total' then 'Match Total' when 'team_total' then 'Team Total' when 'player_points' then 'Player Points' when 'weekly_high' then 'Weekly High Scorer' else 'Weekly Low Scorer' end,v_matchup,round(case when v_legprice>=2 then (v_legprice-1)*100 else -100/(v_legprice-1) end),v_quote.line,v_legprice,'OPEN','Accepted board revision '||p_revision,jsonb_build_object('kind',v_quote.kind,'side',v_quote.side,'team_id',v_quote.team_id,'home_team_id',v_quote.home_team_id,'away_team_id',v_quote.away_team_id,'metadata',v_quote.metadata,'boost_pct',v_quote.boost_pct));
 end loop;
 update public.wallets set balance=balance-p_stake,updated_at=now() where team_id=v_member.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(v_member.team_id,v_id,'ticket:wager:'||v_id,'wager',-p_stake,v_wallet.balance,v_wallet.balance-p_stake,'Ticket placed');
 insert into public.email_deliveries(ticket_id,recipient) values(v_id,v_member.invited_email);
 return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $_$;


--
-- Name: promo_usage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_usage(p_league uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('offer_id',o.id,
 'claims',(select count(*) from public.promo_claims c where c.offer_id=o.id),
 'redemptions',(select count(*) from public.ticket_promotions p where p.offer_id=o.id),
 'extra_paid',coalesce((select sum(round((t.actual_payout-t.stake)*p.boost_pct/(100+p.boost_pct),2)) from public.ticket_promotions p join public.tickets t on t.id=p.ticket_id where p.offer_id=o.id and p.kind='boost' and t.status='WON'),0),
 'extra_liability',coalesce((select sum(t.accepted_potential_payout-round(t.stake*p.base_decimal,2)) from public.ticket_promotions p join public.tickets t on t.id=p.ticket_id where p.offer_id=o.id and p.kind='boost' and t.status='OPEN'),0))) from public.promo_offers o where o.league_id=p_league),'[]');
end $$;


--
-- Name: queue_reopening_announcement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_reopening_announcement(p_review uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare w public.sportsbook_reopening_reviews;n integer;
begin
 select * into w from public.sportsbook_reopening_reviews where id=p_review;
 if not found or not sportsbook_private.is_admin(w.league_id) then raise exception 'Only this league admin can send this announcement.'; end if;
 if w.status<>'approved' or w.closes_at<=now() or not exists(select 1 from public.line_refresh_runtime where league_id=w.league_id and market_week=w.market_week and observed_at>=now()-interval '3 minutes' and last_error is null) or not exists(select 1 from public.sportsbook_boards where id=w.weekly_board and status='published' and reopening_id=w.id and suspension_reason is null and quote_valid_until>now()) then raise exception 'The reopening must be verified and open before sending.'; end if;
 insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,market_week,reopening_id)
 select w.league_id,'reopening:'||w.id||':'||m.id,'reopening',m.invited_email,m.team_id,w.market_week,w.id from public.league_memberships m where m.league_id=w.league_id on conflict(event_key) do nothing;
 get diagnostics n=row_count;return n;
end $$;


--
-- Name: read_promo_image(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_promo_image(p_image uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i public.promo_images;
begin
 select * into i from public.promo_images where id=p_image;
 if not found or not sportsbook_private.is_member(i.league_id) then raise exception 'Image unavailable.';end if;
 if not sportsbook_private.is_admin(i.league_id) and not exists(select 1 from public.promo_offers o where o.image_id=i.id and sportsbook_private.promo_available(o)) then raise exception 'Image unavailable.';end if;
 return i.png;
end $$;


--
-- Name: replenish_weekly_balances(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare w record; k text; added integer:=0; blocked integer:=0; skipped integer:=0; committed numeric; target numeric;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.'; end if;
 if p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.'; end if;
 for w in select x.* from public.wallets x join public.teams t on t.id=x.team_id where t.league_id=p_league order by x.team_id for update of x loop
  k:='weekly:replenish:'||p_season||':'||p_week||':'||w.team_id;
  if exists(select 1 from public.wallet_ledger where event_key=k) then skipped:=skipped+1; continue; end if;
  if w.balance is null or exists(select 1 from public.tickets where team_id=w.team_id and ticket_type<>'future' and nfl_season=p_season and ((market_week>=p_week and status<>'VOIDED') or (market_week<p_week and status='OPEN'))) then blocked:=blocked+1; continue; end if;
  select coalesce(sum(stake),0) into committed from public.tickets where team_id=w.team_id and ticket_type='future' and status='OPEN';
  target:=greatest(25,100-committed);
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(w.team_id,k,'weekly_replenishment',greatest(0,target-w.balance),w.balance,greatest(target,w.balance),'Week '||p_week||' replenishment; open futures stakes $'||committed||'; cash floor $'||target);
  if w.balance<target then update public.wallets set balance=target,updated_at=now() where team_id=w.team_id; added:=added+1; end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(p_league,p_season,p_week,'replenishment',jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped));
 return jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped);
end $_$;


--
-- Name: resolve_future_markets(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_future_markets(p_league uuid, p_kinds text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare affected integer;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can resolve futures.'; end if;
 if p_kinds is null or not (p_kinds <@ array['future_champion','future_playoffs','future_first_pick','future_win_total']) then raise exception 'Invalid season market kinds.'; end if;
 update public.sportsbook_markets m set active=false,metadata=metadata||jsonb_build_object('resolved',true)
 from public.sportsbook_boards b join public.leagues l on l.id=b.league_id
 where m.board_id=b.id and b.league_id=p_league and b.nfl_season=l.nfl_season and b.board_type='future' and m.kind=any(p_kinds);
 get diagnostics affected=row_count;
 return affected;
end $$;


--
-- Name: review_admin_exception(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare old public.admin_exception_reviews;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can review exceptions.'; end if;
 if p_key is null or length(p_key) not between 3 and 200 or length(trim(p_reason)) not between 5 and 500 or p_decision not in ('keep_locked','acknowledge_delivery') or p_decision is null then raise exception 'Choose a decision and provide a reason.'; end if;
 select * into old from public.admin_exception_reviews where league_id=p_league and exception_key=p_key for update;
 insert into public.admin_exception_reviews(league_id,exception_key,actor_id,decision,reason) values(p_league,p_key,auth.uid(),p_decision,trim(p_reason))
 on conflict(league_id,exception_key) do update set actor_id=excluded.actor_id,decision=excluded.decision,reason=excluded.reason,reviewed_at=now();
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value) values(p_league,auth.uid(),'exception_review',trim(p_reason),coalesce(to_jsonb(old),'{}'::jsonb),jsonb_build_object('key',p_key,'decision',p_decision));
end $$;


--
-- Name: round_future_odds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.round_future_odds() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if new.kind like 'future_%' then new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/10.0)*10); end if;
 return new;
end $$;


--
-- Name: save_future_board(uuid, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text DEFAULT 'draft'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '45s'
    SET work_mem TO '16MB'
    AS $$
declare l public.leagues; b public.sportsbook_boards; q jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage futures.'; end if;
 if p_status not in ('draft','published','closed') or p_status is null or jsonb_typeof(p_quotes) is distinct from 'array' or jsonb_array_length(p_quotes)>100 then raise exception 'Invalid futures board.'; end if;
 select * into l from public.leagues where id=p_league;
 if not found then raise exception 'League unavailable.'; end if;
 select * into b from public.sportsbook_boards where id=p_board for update;
 if found and (b.league_id<>p_league or b.nfl_season<>l.nfl_season or b.board_type<>'future') then raise exception 'Futures board identity does not match.'; end if;
 if p_status='published' and jsonb_array_length(p_quotes)=0 then raise exception 'Generate futures before publishing.'; end if;
 for q in select value from jsonb_array_elements(p_quotes) loop
  if q->>'kind' is null or q->>'kind' not in ('future_champion','future_playoffs','future_first_pick','future_win_total') or coalesce((q->>'boost_pct')::integer,0)<>0 then raise exception 'Futures board accepts only standalone season markets.'; end if;
  if not exists(select 1 from public.teams where id=(q->>'team_id')::uuid and league_id=p_league) then raise exception 'Future selection must belong to this league.'; end if;
  if not exists(select 1 from public.teams where id=(q->>'team_id')::uuid and roster_id=(q->'metadata'->>'roster_id')::int) then raise exception 'Accepted season roster does not match its team.'; end if;
  if (q->>'kind'='future_playoffs' and q->>'side' not in ('make','miss')) or (q->>'kind' not in ('future_playoffs','future_win_total') and q->>'side' is distinct from q->>'team_id') or (q->>'kind'='future_win_total' and q->>'side' not in ('over','under')) then raise exception 'Invalid futures selection.'; end if;
  if exists(select 1 from public.sportsbook_markets where id=(q->>'id')::uuid and board_id<>p_board) then raise exception 'A quote belongs to a different board.'; end if;
  if q->>'kind'='future_first_pick' and (q->'metadata'->>'last_place_basis' is distinct from 'regular_season' or not exists(select 1 from public.teams where id=(q->'metadata'->>'pick_owner_team_id')::uuid and league_id=p_league)) then raise exception 'First-pick outcome or owner is unavailable.'; end if;
 end loop;
 insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,board_type,opens_at,closes_at,status)
 values(p_board,p_league,1,l.nfl_season,l.league_season,'future',now()-interval '1 second',make_timestamptz(l.nfl_season+1,3,1,0,0,0,'America/New_York'),p_status)
 on conflict(id) do update set status=excluded.status,revision=public.sportsbook_boards.revision+1;
 update public.sportsbook_markets set active=false where board_id=p_board;
 for q in select value from jsonb_array_elements(p_quotes) loop
  insert into public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,team_id,home_projection,metadata)
  values((q->>'id')::uuid,p_board,q->>'market_key',q->>'kind',q->>'label',q->>'subject',q->>'side',(q->>'line')::numeric,(q->>'odds')::integer,(q->>'team_id')::uuid,(q->>'home_projection')::numeric,q->'metadata')
  on conflict(board_id,market_key,side) do update set label=excluded.label,subject=excluded.subject,line=excluded.line,odds=excluded.odds,home_projection=excluded.home_projection,metadata=excluded.metadata||case when public.sportsbook_markets.metadata->>'resolved'='true' then jsonb_build_object('resolved',true) else '{}'::jsonb end,active=coalesce(public.sportsbook_markets.metadata->>'resolved','false')<>'true';
 end loop;
 perform sportsbook_private.capture_forecast(p_board); return p_board;
end $$;


--
-- Name: save_league_identity(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare old public.leagues;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can edit settings.'; end if;
 if length(trim(p_name)) not between 3 and 100 or length(trim(p_reason)) not between 5 and 500 or (p_avatar<>'' and p_avatar !~ '^https://') or length(p_avatar)>1000 then raise exception 'Provide a league name, HTTPS image URL, and change reason.'; end if;
 select * into strict old from public.leagues where id=p_league for update;
 update public.leagues set name=trim(p_name),avatar_url=nullif(trim(p_avatar),'') where id=p_league;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value) values(p_league,auth.uid(),'identity',trim(p_reason),jsonb_build_object('name',old.name,'avatar_url',old.avatar_url),jsonb_build_object('name',trim(p_name),'avatar_url',nullif(trim(p_avatar),'')));
end $$;


--
-- Name: save_live_model_review(uuid, integer, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j public.automation_jobs;result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Model review lease lost.';end if;
 if ((select week from public.sportsbook_period(j.league_id))<=j.market_week and j.market_week<>18) or p_report->>'status' is distinct from 'complete' then raise exception 'Model review requires a completed week.';end if;
 insert into public.live_model_reviews(league_id,nfl_season,market_week,outcome_hash,forecast_hash,outcomes,report)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,p_outcome_hash,p_forecast_hash,p_outcomes,p_report)
 on conflict(league_id,nfl_season,market_week,outcome_hash,forecast_hash) do nothing returning id into result;
 if result is null then select id into result from public.live_model_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and outcome_hash=p_outcome_hash and forecast_hash=p_forecast_hash;end if;
 return result;
end $$;


--
-- Name: save_live_shadow(uuid, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j public.automation_jobs;c public.line_refresh_cycles;result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'interval_matchups' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Live shadow lease lost.';end if;
 perform 1 from public.line_refresh_runtime where league_id=j.league_id for update;
 select * into strict c from public.line_refresh_cycles where id=j.refresh_cycle_id for update;
 if c.status<>'staging' or c.market_week<>j.market_week or c.league_id<>j.league_id or c.created_at<now()-interval '20 minutes' then raise exception 'Live shadow cycle expired.';end if;
 if (select week from public.sportsbook_period(j.league_id))<>j.market_week then raise exception 'Live shadow week changed.';end if;
 if p_snapshot->'model_config'->>'mode' is distinct from 'shadow' or coalesce(p_snapshot->'payload'->>'status','') not in ('shadow','blocked') or jsonb_typeof(p_snapshot->'payload'->'teams') is distinct from 'array' or jsonb_typeof(p_snapshot->'payload'->'quotes') is distinct from 'array' then raise exception 'Shadow logging cannot enable acceptance.';end if;
 insert into public.live_forecast_runs(cycle_id,league_id,nfl_season,market_week,observed_at,model_version,model_config,source_hash,status,sources,payload)
 values(c.id,j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,(p_snapshot->>'observed_at')::timestamptz,p_snapshot->>'model_version',p_snapshot->'model_config',p_snapshot->>'source_hash',p_snapshot->'payload'->>'status',p_snapshot->'sources',p_snapshot->'payload')
 on conflict(cycle_id) do nothing returning id into result;
 if result is null then select id into result from public.live_forecast_runs where cycle_id=c.id;end if;
 return result;
end $$;


--
-- Name: save_market_board(uuid, uuid, integer, timestamp with time zone, timestamp with time zone, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text DEFAULT 'draft'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET work_mem TO '16MB'
    SET statement_timeout TO '45s'
    AS $$
declare v_league public.leagues; v_board public.sportsbook_boards;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage markets.'; end if;
 if p_status is null or p_quotes is null or p_status not in ('draft','published','closed') or jsonb_typeof(p_quotes)<>'array' or jsonb_array_length(p_quotes)>1500 then raise exception 'Invalid market board.'; end if;
 if p_status='published' and (p_closes<=now() or jsonb_array_length(p_quotes)=0) then raise exception 'Add markets and a future cutoff before publishing.'; end if;
 select * into v_league from public.leagues where id=p_league;
 select * into v_board from public.sportsbook_boards where id=p_board for update;
 if found and (v_board.league_id<>p_league or v_board.market_week<>p_week or v_board.board_type<>'weekly') then raise exception 'Board identity does not match this league and week.'; end if;
 -- Validate the complete replacement before any quote changes.
 if exists(select 1 from jsonb_array_elements(p_quotes) q join public.sportsbook_markets m on m.id=(q->>'id')::uuid where m.board_id<>p_board) then raise exception 'A quote belongs to a different board.'; end if;
 if exists(select 1 from jsonb_array_elements(p_quotes) q cross join lateral (values(nullif(q->>'team_id','')::uuid),(nullif(q->>'home_team_id','')::uuid),(nullif(q->>'away_team_id','')::uuid)) x(id) where x.id is not null and not exists(select 1 from public.teams t where t.id=x.id and t.league_id=p_league)) then raise exception 'Market teams must belong to this league.'; end if;
 if exists(select 1 from jsonb_array_elements(p_quotes) q where (q->>'boost_pct')::int=25 and not ((q->>'featured'='Game of the Week' and q->>'kind'='moneyline') or (q->>'featured'='Tank Bowl' and (q->>'kind'='moneyline' or (q->>'kind'='match_total' and q->>'side'='over'))))) then raise exception 'This selection is not eligible for the featured boost.'; end if;
 insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status)
 values(p_board,p_league,p_week,v_league.nfl_season,v_league.league_season,p_opens,p_closes,p_status)
 on conflict(id) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,status=excluded.status,revision=public.sportsbook_boards.revision+1;
 update public.sportsbook_markets m set active=false where m.board_id=p_board and m.active and not exists(select 1 from jsonb_array_elements(p_quotes) q where q->>'market_key'=m.market_key and q->>'side'=m.side);
 insert into public.sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,boost_pct,team_id,home_team_id,away_team_id,home_projection,away_projection,featured,metadata)
 select q.id,p_board,q.market_key,nullif(q.matchup_key,''),q.kind,q.label,q.subject,q.side,q.line,q.odds,coalesce(q.boost_pct,0),q.team_id,q.home_team_id,q.away_team_id,q.home_projection,q.away_projection,coalesce(q.featured,''),coalesce(q.metadata,'{}'::jsonb)
 from jsonb_to_recordset(p_quotes) as q(id uuid,market_key text,matchup_key text,kind text,label text,subject text,side text,line numeric,odds integer,boost_pct integer,team_id uuid,home_team_id uuid,away_team_id uuid,home_projection numeric,away_projection numeric,featured text,metadata jsonb)
 on conflict(board_id,market_key,side) do update set market_key=excluded.market_key,matchup_key=excluded.matchup_key,kind=excluded.kind,label=excluded.label,subject=excluded.subject,side=excluded.side,line=excluded.line,odds=excluded.odds,boost_pct=excluded.boost_pct,team_id=excluded.team_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,home_projection=excluded.home_projection,away_projection=excluded.away_projection,featured=excluded.featured,metadata=excluded.metadata,active=true
 where ROW(public.sportsbook_markets.market_key,public.sportsbook_markets.matchup_key,public.sportsbook_markets.kind,public.sportsbook_markets.label,public.sportsbook_markets.subject,public.sportsbook_markets.side,public.sportsbook_markets.line,public.sportsbook_markets.odds,public.sportsbook_markets.boost_pct,public.sportsbook_markets.team_id,public.sportsbook_markets.home_team_id,public.sportsbook_markets.away_team_id,public.sportsbook_markets.home_projection,public.sportsbook_markets.away_projection,public.sportsbook_markets.featured,public.sportsbook_markets.metadata,public.sportsbook_markets.active) IS DISTINCT FROM ROW(excluded.market_key,excluded.matchup_key,excluded.kind,excluded.label,excluded.subject,excluded.side,excluded.line,excluded.odds,excluded.boost_pct,excluded.team_id,excluded.home_team_id,excluded.away_team_id,excluded.home_projection,excluded.away_projection,excluded.featured,excluded.metadata,true);
 perform sportsbook_private.capture_forecast(p_board);
 return p_board;
end $$;


--
-- Name: save_model_assessment(uuid, integer, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j public.automation_jobs;o uuid;r uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Assessment lease lost.';end if;
 if p_outcome->>'final' is distinct from 'true' or p_outcome->>'completed_period' is distinct from 'true' or p_outcome->>'confirmed_games_final' is distinct from 'true' or p_report->>'status' is distinct from 'complete' then raise exception 'Confirmed outcomes required.';end if;
 if exists(select 1 from public.tickets where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and ticket_type<>'future' and status='OPEN') then raise exception 'Weekly settlement reconciliation pending.';end if;
 insert into public.model_outcome_revisions(league_id,nfl_season,market_week,outcome_hash,outcome)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,md5(p_outcome::text),p_outcome)
 on conflict(league_id,nfl_season,market_week,outcome_hash) do nothing returning id into o;
 if o is null then select id into o from public.model_outcome_revisions where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and outcome_hash=md5(p_outcome::text);end if;
 insert into public.model_weekly_reviews(league_id,nfl_season,market_week,outcome_id,input_hash,report,comparison)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,o,p_hash,p_report,p_comparison)
 on conflict(league_id,nfl_season,market_week,input_hash) do nothing returning id into r;
 if r is null then select id into r from public.model_weekly_reviews where league_id=j.league_id and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week and input_hash=p_hash;end if;
 return r;
end $$;


--
-- Name: save_model_forecast(uuid, uuid, integer, integer, text, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '20s'
    AS $$
declare c public.model_config_versions;begin
 if auth.role() is distinct from 'service_role' and not sportsbook_private.is_admin(p_league) then raise exception 'League admin only.';end if;
 if not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Season mismatch.';end if;
 select * into strict c from public.model_config_versions where league_id=p_league and id=p_version;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q where q->'metadata'->>'assessment_run_id' is distinct from p_run::text) then raise exception 'Forecast run context mismatch.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quotes') q cross join lateral unnest(array[q->>'team_id',q->>'home_team_id',q->>'away_team_id']) t(id) where t.id is not null and not exists(select 1 from public.teams where id=t.id::uuid and league_id=p_league)) then raise exception 'Forecast team outside league.';end if;
 insert into public.model_forecast_runs(id,league_id,nfl_season,market_week,category,phase,provenance,model_version,model_config,source_hash,sources,payload)
 values(p_run,p_league,p_season,p_week,p_category,'pregame','as_of',p_version,c.config,md5(p_sources::text),p_sources,p_payload)
 on conflict(id) do nothing;
 if not exists(select 1 from public.model_forecast_runs where id=p_run and league_id=p_league and model_version=p_version and payload=p_payload and sources=p_sources) then raise exception 'Immutable run collision.';end if;
 return p_run;
end $$;


--
-- Name: save_promo(uuid, uuid, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare o public.promo_offers;l public.leagues;t jsonb:=p_offer->'terms';q public.sportsbook_markets; leg jsonb; frozen jsonb:='[]'; st text:=p_offer->>'status'; at timestamptz;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required.';end if;
 select * into strict l from public.leagues where id=p_league;
 if p_offer->>'kind' not in ('boost','fixed') or st not in ('draft','scheduled') or st is null or p_offer->>'kind' is null then raise exception 'Invalid offer type or state.';end if;
 if (p_offer->>'expires_at')::timestamptz<=now() then raise exception 'Choose a future expiry.';end if;
 if p_id is not null then
  select * into o from public.promo_offers where id=p_id and league_id=p_league for update;
  if not found or o.version is distinct from p_version then raise exception 'Offer changed. Reload before saving.';end if;
  if o.status<>'draft' then raise exception 'Advertised terms are locked. Create a new draft version.';end if;
 end if;
 if p_offer->>'kind'='boost' then
  if t->>'criterion' not in ('points_min','points_exact','spreads_min','parlay_min','category','featured') or t->>'criterion' is null or
   (t->>'count')::int not between 1 and 10 or (t->>'count') is null or (t->>'percent')::numeric not between 1 and 1000 or t->>'percent' is null or
   (t->>'max_stake')::numeric<1 or t->>'max_stake' is null then raise exception 'Choose valid eligibility, percentage and maximum wager.';end if;
  if t->>'criterion'='category' and (t->>'category' is null or t->>'category' not in ('player_points','spread','moneyline','match_total','team_total','weekly')) then raise exception 'Choose an approved category.';end if;
  if length(coalesce(t->>'code',''))>40 or (t->>'max_stake')::numeric<>round((t->>'max_stake')::numeric,2) or (t->>'max_stake')::numeric>9999999999.99 then raise exception 'Use a code up to 40 characters and a whole-cent maximum wager.';end if;
  if t->>'criterion'='featured' and not exists(select 1 from public.sportsbook_markets m join public.sportsbook_boards b on b.id=m.board_id where b.league_id=p_league and b.nfl_season=l.nfl_season and b.market_week=(p_offer->>'week')::int and m.matchup_key=t->>'matchup') then raise exception 'Choose a matchup from this league and week.';end if;
  t:=jsonb_build_object('criterion',t->>'criterion','count',(t->>'count')::int,'percent',(t->>'percent')::numeric,'max_stake',(t->>'max_stake')::numeric,'category',t->>'category','matchup',t->>'matchup','code',upper(trim(coalesce(t->>'code',''))));
 else
  if jsonb_typeof(t->'legs') is distinct from 'array' or jsonb_array_length(t->'legs') not between 2 and 10 then raise exception 'Choose 2–10 fixed selections.';end if;
  for leg in select value from jsonb_array_elements(t->'legs') loop
   select m.* into q from public.sportsbook_markets m join public.sportsbook_boards b on b.id=m.board_id where m.id=(leg->>'id')::uuid and b.league_id=p_league and b.market_week=(p_offer->>'week')::int and b.nfl_season=l.nfl_season and b.board_type='weekly';
   if not found then raise exception 'Fixed selections must belong to this league and week.';end if;
   if q.boost_pct>0 or q.kind like 'future_%' then raise exception 'Fixed offers cannot stack featured boosts or futures.';end if;
   q.line:=coalesce((leg->>'line')::numeric,q.line);q.odds:=(leg->>'odds')::int;q.label:=leg->>'label';q.active:=true;q.market_state:='open';q.suspension_reason:=null;
   if abs(q.odds::bigint) not between 100 and 100000 or q.odds is null or length(q.label) not between 1 and 160 or q.label is null then raise exception 'Enter valid saved labels and odds.';end if;
   if exists(select 1 from jsonb_populate_recordset(null::public.sportsbook_markets,frozen) f where f.id=q.id or f.market_key=q.market_key or public.sportsbook_special_conflict(f,q) or (f.matchup_key=q.matchup_key and ((f.kind='spread' and q.kind='moneyline') or (f.kind='moneyline' and q.kind='spread')))) then raise exception 'Fixed selections are incompatible.';end if;
   frozen:=frozen||jsonb_build_array(to_jsonb(q));
  end loop;
  if t->>'fixed_stake' is not null and ((t->>'fixed_stake')::numeric<1 or (t->>'fixed_stake')::numeric<>round((t->>'fixed_stake')::numeric,2)) then raise exception 'Fixed wager must be whole cents and at least $1.';end if;
  t:=jsonb_build_object('legs',frozen,'fixed_stake',(t->>'fixed_stake')::numeric);
 end if;
 if st='scheduled' then select greatest(now(),b.opens_at) into at from public.sportsbook_boards b where b.league_id=p_league and b.nfl_season=l.nfl_season and b.market_week=(p_offer->>'week')::int and b.board_type='weekly' and b.status='published';end if;
 if p_id is null then
  insert into public.promo_offers(league_id,nfl_season,market_week,slot,kind,title,description,image_id,expires_at,status,terms,activated_at)
  values(p_league,l.nfl_season,(p_offer->>'week')::int,(p_offer->>'slot')::int,p_offer->>'kind',trim(p_offer->>'title'),trim(p_offer->>'description'),(p_offer->>'image_id')::uuid,(p_offer->>'expires_at')::timestamptz,st,t,at) returning id into p_id;
 else
  update public.promo_offers set market_week=(p_offer->>'week')::int,slot=(p_offer->>'slot')::int,kind=p_offer->>'kind',title=trim(p_offer->>'title'),description=trim(p_offer->>'description'),image_id=(p_offer->>'image_id')::uuid,expires_at=(p_offer->>'expires_at')::timestamptz,status=st,terms=t,activated_at=at,version=version+1 where id=p_id;
 end if;
 insert into public.promo_events(league_id,offer_id,user_id,event,details) values(p_league,p_id,auth.uid(),st,jsonb_build_object('title',p_offer->>'title'));
 return p_id;
end $_$;


--
-- Name: save_report_results(uuid, integer, integer, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can refresh reports.'; end if;
 if not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) or jsonb_typeof(p_results) is distinct from 'object' then raise exception 'Invalid report results.'; end if;
 insert into public.league_result_weeks values(p_league,p_season,p_week,p_final,'Sleeper',now(),p_results)
 on conflict(league_id,nfl_season,market_week) do update set final=excluded.final,fetched_at=excluded.fetched_at,results=excluded.results;
end $$;


--
-- Name: set_team_balance(uuid, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_league uuid; v_previous numeric; v_event public.balance_events; v_id uuid;
begin
  select league_id into v_league from public.teams where id = p_team;
  if v_league is null or not sportsbook_private.is_admin(v_league) then raise exception 'Admin access required'; end if;
  if p_balance is null or p_balance < 0 or p_balance > 9999999999.99 or p_balance <> round(p_balance, 2) then
    raise exception 'Enter a nonnegative balance with at most two decimal places'; end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 500 or p_request is null then
    raise exception 'A reason and request reference are required'; end if;
  select balance into v_previous from public.wallets where team_id = p_team for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into v_event from public.balance_events where team_id = p_team and request_id = p_request;
  if found then
    if v_event.new_balance <> p_balance or v_event.reason <> trim(p_reason) or v_event.actor_id <> auth.uid() then
      raise exception 'Request already used for a different adjustment'; end if;
    return v_event.id;
  end if;
  update public.wallets set balance = p_balance, updated_at = now() where team_id = p_team;
  insert into public.balance_events(team_id, actor_id, request_id, previous_balance, new_balance, reason, kind)
    values(p_team, auth.uid(), p_request, v_previous, p_balance, trim(p_reason),
      case when v_previous is null then 'opening_balance' else 'admin_adjustment' end) returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: set_weekly_automation(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_weekly_automation(p_league uuid, p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can change automation.'; end if;
 -- Enabling first verifies the deployed server. Disabling stops work immediately.
 update public.weekly_schedule set automation_enabled=false,activation_requested=p_enabled,worker_probe_id=null,updated_at=now() where league_id=p_league;
end $$;


--
-- Name: settle_weekly_ticket(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_ticket public.tickets; v_wallet public.wallets; v_leg public.ticket_legs; v_result jsonb;
 v_status text; v_price numeric:=1; v_payout numeric; v_pending boolean:=false; v_lost boolean:=false; v_won boolean:=false;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can settle tickets.'; end if;
 -- Use the same wallet-before-ticket lock order as bet placement.
 select * into v_wallet from public.wallets where team_id=v_ticket.team_id for update;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status<>'OPEN' then return jsonb_build_object('duplicate',true,'status',v_ticket.status,'payout',v_ticket.actual_payout); end if;
 
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>(select count(*) from public.ticket_legs where ticket_id=p_ticket) then raise exception 'Every ticket leg requires exactly one result.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_results))<>jsonb_array_length(p_results) then raise exception 'Duplicate leg result.'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) x where not exists(select 1 from public.ticket_legs l where l.id=(x->>'id')::uuid and l.ticket_id=p_ticket)) then raise exception 'Result belongs to another ticket.'; end if;
 for v_leg in select * from public.ticket_legs where ticket_id=p_ticket order by leg_number loop
  select value into v_result from jsonb_array_elements(p_results) where value->>'id'=v_leg.id::text;
  v_status:=v_result->>'status';
  if v_status is null or v_status not in ('OPEN','WON','LOST','PUSH') or coalesce(v_result->>'evidence','')='' then raise exception 'Invalid leg result.'; end if;
  if v_leg.status<>'OPEN' and v_leg.status<>v_status then raise exception 'A confirmed leg result cannot be overwritten.'; end if;
  update public.ticket_legs set status=v_status,actual_value=(v_result->>'actual_value')::numeric,result_evidence=v_result->>'evidence' where id=v_leg.id;
  v_pending:=v_pending or v_status='OPEN'; v_lost:=v_lost or v_status='LOST'; v_won:=v_won or v_status='WON';
  if v_status='WON' then
   if v_leg.accepted_decimal_odds is null or v_leg.accepted_decimal_odds<1 then raise exception 'Accepted leg odds are missing.'; end if;
   v_price:=v_price*v_leg.accepted_decimal_odds;
  end if;
 end loop;
 if v_pending then return jsonb_build_object('status','OPEN','pending',true); end if;
 v_status:=case when v_lost then 'LOST' when v_won then 'WON' else 'PUSH' end;
 if v_won and not v_lost then v_price:=1+(v_price-1)*(1+coalesce((select boost_pct from public.ticket_promotions where ticket_id=p_ticket and kind='boost'),0)/100);end if; v_payout:=case when v_lost then 0 when not v_won then v_ticket.stake else round(v_ticket.stake*v_price,2) end;
 update public.tickets set status=v_status,actual_payout=v_payout,settled_at=now() where id=p_ticket;
 if v_payout>0 then
  insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_ticket.team_id,p_ticket,'ticket:settle:'||p_ticket,'settlement',v_payout,v_wallet.balance,v_wallet.balance+v_payout,'Ticket '||lower(v_status));
  update public.wallets set balance=balance+v_payout,updated_at=now() where team_id=v_ticket.team_id;
 end if;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(v_ticket.league_id,v_ticket.nfl_season,v_ticket.market_week,'settlement',jsonb_build_object('ticket_id',p_ticket,'status',v_status,'payout',v_payout));
 return jsonb_build_object('status',v_status,'payout',v_payout,'duplicate',false);
end $$;


--
-- Name: sportsbook_current_snapshot(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sportsbook_current_snapshot(p_league uuid, p_type text DEFAULT 'weekly'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare period record; board_id uuid; snapshot jsonb; member_markets jsonb;
begin
 if p_type not in ('weekly','future') then raise exception 'Unknown board type.'; end if;
 if not sportsbook_private.is_member(p_league) then return null; end if;
 select * into period from public.sportsbook_period(p_league);
 select b.id into board_id from public.sportsbook_boards b
  where b.league_id=p_league and b.nfl_season=period.nfl_season and b.board_type=p_type
   and (p_type='future' or b.market_week=period.week)
  order by b.market_week desc,b.id limit 1;
 snapshot:=case when board_id is null then null else public.sportsbook_quote_snapshot(board_id) end;
 select coalesce(jsonb_agg(q||jsonb_build_object('metadata',sportsbook_private.member_quote_metadata(q->'metadata'))),'[]'::jsonb)
  into member_markets from jsonb_array_elements(coalesce(snapshot->'markets','[]'::jsonb))q;
 return jsonb_build_object('week',period.week,'board',snapshot->'board','markets',member_markets);
end $$;


--
-- Name: sportsbook_period(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sportsbook_period(p_league uuid) RETURNS TABLE(league_season integer, nfl_season integer, week integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select l.league_season,l.nfl_season,
 least(18,l.active_week+greatest(0,floor(extract(epoch from ((now() at time zone 'America/New_York')-(l.week_anchor at time zone 'America/New_York')))/604800)::integer))
 from public.leagues l where l.id=p_league;
$$;


--
-- Name: FUNCTION sportsbook_period(p_league uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sportsbook_period(p_league uuid) IS 'Public season/week label only. Does not advance markets, settle tickets or replenish balances. The weekly operational job must use this same period.';


--
-- Name: sportsbook_quote_snapshot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sportsbook_quote_snapshot(p_board uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    SET work_mem TO '16MB'
    AS $$
declare b public.sportsbook_boards; result jsonb;
begin
 select * into b from public.sportsbook_boards where id=p_board;
 if not found or not sportsbook_private.is_member(b.league_id)
    or (b.status='draft' and not sportsbook_private.is_admin(b.league_id)) then
  return null;
 end if;
 select jsonb_build_object('board',to_jsonb(b),'markets',coalesce(
  (select jsonb_agg((to_jsonb(m) || jsonb_build_object('metadata',m.metadata - array['home_lineup','away_lineup','home_eligible_players','away_eligible_players','scoring_settings'])) order by m.market_key,m.side)
   from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb)) into result;
 return result;
end $$;


--
-- Name: sportsbook_readiness(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sportsbook_readiness(p_league uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare result jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only this league admin can read readiness diagnostics.'; end if;
 select jsonb_build_object(
 'runtime',(select jsonb_build_object('observed_at',observed_at,'last_success_at',last_success_at,'last_error',last_error,'next_due_at',next_due_at,'week_started',week_started,'any_in_progress',any_in_progress) from public.line_refresh_runtime where league_id=p_league),
 'boards',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'type',b.board_type,'week',b.market_week,'status',b.status,'phase',b.phase,'closes_at',b.closes_at,'suspension_reason',b.suspension_reason,'valid_until',b.quote_valid_until,'reopening_until',b.reopening_until,
 'categories',(select jsonb_agg(x) from(select m.kind,count(*) as quotes,count(*)filter(where m.metadata->>'lineup_locked'='true' or m.metadata->>'reopening_locked'='true') as locked,min(m.metadata->>'generated_at') as oldest_generated_at from public.sportsbook_markets m where m.board_id=b.id and m.active group by m.kind)x))) from public.sportsbook_boards b where b.league_id=p_league and b.nfl_season=(select nfl_season from public.leagues where id=p_league) and (b.board_type='future' or b.market_week=(select week from public.sportsbook_period(p_league)))),'[]'::jsonb)
 ) into result;
 return result;
end $$;


--
-- Name: sportsbook_markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sportsbook_markets (
    id uuid NOT NULL,
    board_id uuid NOT NULL,
    market_key text NOT NULL,
    matchup_key text,
    kind text NOT NULL,
    label text NOT NULL,
    subject text NOT NULL,
    side text NOT NULL,
    line numeric(8,2),
    odds integer NOT NULL,
    boost_pct integer DEFAULT 0 NOT NULL,
    team_id uuid,
    home_team_id uuid,
    away_team_id uuid,
    home_projection numeric(8,2),
    away_projection numeric(8,2),
    featured text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    market_state text DEFAULT 'open'::text NOT NULL,
    suspension_reason text,
    CONSTRAINT head_to_head_shape CHECK (((kind <> 'player_h2h'::text) OR (((side = ANY (ARRAY['home'::text, 'away'::text])) AND ((metadata ->> 'player_id'::text) IS NOT NULL) AND ((metadata ->> 'opponent_player_id'::text) IS NOT NULL) AND (((metadata ->> 'player_id'::text) <> (metadata ->> 'opponent_player_id'::text)) OR ((metadata ->> 'lineup_locked'::text) = 'true'::text)) AND ((metadata ->> 'slot'::text) IS NOT NULL)) IS TRUE))),
    CONSTRAINT margin_shape CHECK (((kind <> 'winning_margin'::text) OR ((((team_id = home_team_id) OR (team_id = away_team_id)) AND (((metadata ->> 'margin_lower'::text))::numeric >= (0)::numeric) AND (metadata ? 'margin_upper'::text) AND (((metadata ->> 'margin_upper'::text) IS NULL) OR (((metadata ->> 'margin_upper'::text))::numeric > ((metadata ->> 'margin_lower'::text))::numeric))) IS TRUE))),
    CONSTRAINT milestone_shape CHECK (((kind <> ALL (ARRAY['player_milestone'::text, 'team_milestone'::text])) OR (((line > (0)::numeric) AND (side = 'at_least'::text) AND (team_id IS NOT NULL) AND ((kind <> 'player_milestone'::text) OR ((metadata ->> 'player_id'::text) IS NOT NULL))) IS TRUE))),
    CONSTRAINT sportsbook_markets_boost_pct_check CHECK ((boost_pct = ANY (ARRAY[0, 25]))),
    CONSTRAINT sportsbook_markets_check CHECK (((home_team_id IS NULL) OR (home_team_id <> away_team_id))),
    CONSTRAINT sportsbook_markets_featured_check CHECK ((featured = ANY (ARRAY[''::text, 'Game of the Week'::text, 'Tank Bowl'::text]))),
    CONSTRAINT sportsbook_markets_kind_check CHECK ((kind = ANY (ARRAY['spread'::text, 'moneyline'::text, 'match_total'::text, 'team_total'::text, 'player_points'::text, 'weekly_high'::text, 'weekly_low'::text, 'weekly_count_150'::text, 'weekly_any_below_100'::text, 'weekly_any_200'::text, 'weekly_count_projection'::text, 'weekly_average'::text, 'weekly_highest_score'::text, 'future_champion'::text, 'future_playoffs'::text, 'future_first_pick'::text, 'future_win_total'::text, 'player_h2h'::text, 'player_milestone'::text, 'team_milestone'::text, 'winning_margin'::text]))),
    CONSTRAINT sportsbook_markets_label_check CHECK (((length(label) >= 1) AND (length(label) <= 160))),
    CONSTRAINT sportsbook_markets_market_state_check CHECK ((market_state = ANY (ARRAY['open'::text, 'suspended'::text, 'closed'::text, 'settled'::text]))),
    CONSTRAINT sportsbook_markets_odds_check CHECK (((abs((odds)::bigint) >= 100) AND (abs((odds)::bigint) <= 100000))),
    CONSTRAINT win_total_half_line CHECK (((kind <> 'future_win_total'::text) OR ((line IS NOT NULL) AND (line >= 0.5) AND (line <= 17.5) AND (mod(line, (1)::numeric) = 0.5) AND (side = ANY (ARRAY['over'::text, 'under'::text])))))
);


--
-- Name: sportsbook_special_conflict(public.sportsbook_markets, public.sportsbook_markets); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sportsbook_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare c public.sportsbook_markets; l public.sportsbook_markets; t public.sportsbook_markets; s public.sportsbook_markets;
begin
 if (a.kind in ('player_h2h','player_milestone','team_milestone','winning_margin') or b.kind in ('player_h2h','player_milestone','team_milestone','winning_margin')) and a.matchup_key is not null and a.matchup_key=b.matchup_key then return true; end if;
 if ((a.kind='weekly_high' and b.kind='weekly_low') or (a.kind='weekly_low' and b.kind='weekly_high')) and a.team_id=b.team_id then return true; end if;
 if a.kind='weekly_count_150' then c:=a; elsif b.kind='weekly_count_150' then c:=b; end if;
 if a.kind='weekly_any_below_100' then l:=a; elsif b.kind='weekly_any_below_100' then l:=b; end if;
 if c.id is not null and l.side='yes' and c.line=coalesce((c.metadata->>'expected_team_count')::integer,12) then return true; end if;
 if a.kind='team_total' then t:=a;s:=b; elsif b.kind='team_total' then t:=b;s:=a; end if;
 if t.id is not null then
   if s.kind='weekly_any_below_100' and s.side='no' and t.side='under' and t.line<=100 then return true; end if;
   if s.kind='weekly_any_200' and s.side='no' and t.side='over' and t.line>=200 then return true; end if;
   if c.id is not null and t.side='under' and t.line<=150 and c.line=coalesce((c.metadata->>'expected_team_count')::integer,12) then return true; end if;
 end if;
 return sportsbook_private.more_special_conflict(a,b);
end $$;


--
-- Name: stage_line_refresh(uuid, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '45s'
    SET work_mem TO '16MB'
    AS $$
declare j public.automation_jobs; c public.line_refresh_cycles; r public.line_refresh_runtime; b public.sportsbook_boards; q jsonb; v_family text; reason text; result jsonb; published_count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Refresh lease lost.'; end if;
 select * into strict r from public.line_refresh_runtime where league_id=j.league_id for update;
 select * into strict c from public.line_refresh_cycles where id=j.refresh_cycle_id for update;
 if c.status<>'staging' then return jsonb_build_object('superseded',true); end if;
 if c.market_week<>r.market_week then raise exception 'Refresh week changed.'; end if;
 v_family:=replace(j.operation,'interval_','');
 if v_family not in ('matchups','players','specials','futures') or jsonb_typeof(p_quotes) is distinct from 'array' then raise exception 'Invalid refresh stage.'; end if;
 insert into public.line_refresh_stages values(c.id,v_family,p_quotes,now()) on conflict(cycle_id,family) do update set quotes=excluded.quotes,observed_at=excluded.observed_at;
 if (select count(*) from public.line_refresh_stages where cycle_id=c.id)<>4 then return '{"staged":true}'; end if;
 reason:=case when r.observed_at is null or r.observed_at<now()-interval '3 minutes' then 'NFL status source is stale.' when r.last_error is not null then r.last_error when r.week_started and sportsbook_private.active_reopening(j.league_id,j.market_week) is null then 'Live pricing unavailable: observed starter points and a validated remaining-points model are required.' else null end;
 perform 1 from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id for update;
 if exists(select 1 from public.sportsbook_boards where (id=c.weekly_board and revision<>c.weekly_revision) or (id=c.future_board and revision<>c.future_revision)) then
  update public.line_refresh_cycles set status='superseded',completed_at=now() where id=c.id;
  update public.line_refresh_runtime set next_due_at=now(),last_error='Board changed during refresh; retry with current revision.' where league_id=j.league_id;
  return '{"superseded":true}';
 end if;
 if (select publication_paused from public.weekly_schedule where league_id=j.league_id) then reason:='Publication paused by administrator.'; end if;
 if reason is null and (c.created_at<now()-interval '10 minutes' or exists(select 1 from public.line_refresh_stages where cycle_id=c.id and observed_at<now()-interval '10 minutes')) then reason:='Staged pricing inputs expired.'; end if;
 if sportsbook_private.active_reopening(j.league_id,j.market_week) is not null and exists(select 1 from public.line_refresh_stages st cross join lateral jsonb_array_elements(st.quotes) as rq(value) where st.cycle_id=c.id and (rq.value->'metadata'->>'reopening_review_id' is distinct from sportsbook_private.active_reopening(j.league_id,j.market_week)::text or rq.value->'metadata'->>'reopening_model' is distinct from 'between-games-conditional-v1')) then raise exception 'All categories must use the approved reopening inputs.'; end if; for b in select * from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id loop
  if reason is not null then update public.sportsbook_boards set suspension_reason=reason where id=b.id; continue; end if;
  -- Closed/draft boards and Thursday promo deadlines remain authoritative.
  if b.status<>'published' or b.closes_at<=now() then continue; end if;
  select coalesce(jsonb_agg(x.value),'[]') into q from public.line_refresh_stages st cross join lateral jsonb_array_elements(st.quotes) x
   where st.cycle_id=c.id and case when b.board_type='future' then st.family='futures' else st.family<>'futures' end;
  if jsonb_array_length(q)=0 then raise exception 'A complete refresh cannot publish an empty board.'; end if;
  result:=public.worker_operation(j.league_id,case when b.board_type='future' then 'save_future_board' else 'save_board' end,
   jsonb_build_object('board',b.id,'week',b.market_week,'opens',b.opens_at,'closes',b.closes_at,'quotes',q,'status',b.status));
  update public.sportsbook_boards set source_observed_at=r.observed_at,quote_valid_until=least(b.closes_at,now()+interval '130 minutes'),suspension_reason=null where id=b.id;
  published_count:=published_count+1;
 end loop;
 update public.line_refresh_cycles set status=case when reason is not null then 'suspended' when published_count>0 then 'published' else 'skipped' end,completed_at=now() where id=c.id;
 update public.line_refresh_runtime set last_success_at=case when published_count>0 then now() else last_success_at end,last_error=reason where league_id=j.league_id;
 return jsonb_build_object('published',published_count>0,'boards_published',published_count,'suspension_reason',reason);
end $$;


--
-- Name: stage_reopening_review(uuid, integer, integer, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '90s'
    SET work_mem TO '16MB'
    AS $$
declare b public.sportsbook_boards; f public.sportsbook_boards; result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 if p_closes<=now() or p_closes>now()+interval '7 days' or extract(isodow from p_closes at time zone 'America/New_York')<>7 or (p_closes at time zone 'America/New_York')::time<>'12:00:00'::time then raise exception 'Reopening ends at Sunday noon Eastern.'; end if;
 if p_checked<now()-interval '3 minutes' or p_checked>now()+interval '30 seconds' or p_context->>'model' is distinct from 'between-games-conditional-v1' or jsonb_typeof(p_context->'games') is distinct from 'array' then raise exception 'Fresh verified reopening inputs are required.'; end if;
 select * into b from public.sportsbook_boards where league_id=p_league and nfl_season=p_season and market_week=p_week and board_type='weekly';
 if not found then raise exception 'The current weekly board is unavailable.'; end if;
 select * into f from public.sportsbook_boards where league_id=p_league and nfl_season=p_season and board_type='future';
 if exists(select 1 from jsonb_array_elements(p_weekly||p_futures) q where q->'metadata'->>'reopening_model' is distinct from 'between-games-conditional-v1' or jsonb_typeof(q->'metadata'->'reopening_game_ids') is distinct from 'array') then raise exception 'Every quote needs reopening provenance.'; end if;
 insert into public.sportsbook_reopening_reviews(league_id,nfl_season,market_week,weekly_board,future_board,weekly_revision,future_revision,original_future_closes,original_future_status,checked_at,closes_at,snapshot_hash,weekly_quotes,future_quotes,context)
 values(p_league,p_season,p_week,b.id,f.id,b.revision,f.revision,f.closes_at,f.status,p_checked,p_closes,p_hash,p_weekly,p_futures,p_context) returning id into result;
 return result;
end $$;


--
-- Name: store_promo_image(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.store_promo_image(p_league uuid, p_user uuid, p_png text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i uuid;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.league_memberships where league_id=p_league and user_id=p_user and role='admin') then raise exception 'League admin required.';end if;
 insert into public.promo_images(league_id,png) values(p_league,p_png) returning id into i;return i;
end $$;


--
-- Name: void_sportsbook_ticket(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_sportsbook_ticket(p_ticket uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_ticket public.tickets; v_wallet public.wallets;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can void tickets.'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Provide a cancellation reason.'; end if;
 select * into v_wallet from public.wallets where team_id=v_ticket.team_id for update;
 if not found or v_wallet.balance is null then raise exception 'Wallet unavailable; no ticket was changed.'; end if;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='VOIDED' then return jsonb_build_object('duplicate',true,'balance',v_wallet.balance); end if;
 if v_ticket.status<>'OPEN' then raise exception 'Only open tickets can be voided.'; end if;
 update public.tickets set status='VOIDED',actual_payout=stake,settled_at=now() where id=p_ticket;
 update public.ticket_legs set status='VOIDED',result_evidence='Voided by league admin: '||trim(p_reason) where ticket_id=p_ticket;
 update public.wallets set balance=balance+v_ticket.stake,updated_at=now() where team_id=v_ticket.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
 values(v_ticket.team_id,p_ticket,'ticket:void:'||p_ticket,'void_refund',v_ticket.stake,v_wallet.balance,v_wallet.balance+v_ticket.stake,'Ticket voided by admin: '||trim(p_reason));
 update public.email_deliveries set status='failed',last_error='Ticket voided; confirmation cancelled' where ticket_id=p_ticket and status<>'sent';
 return jsonb_build_object('duplicate',false,'balance',v_wallet.balance+v_ticket.stake,'refund',v_ticket.stake);
end $$;


--
-- Name: worker_operation(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_operation(p_league uuid, p_operation text, p_args jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '45s'
    AS $$
declare v_admin uuid; v_result jsonb; v_board uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select user_id into v_admin from public.league_memberships where league_id=p_league and role='admin' and user_id is not null limit 1;
 if v_admin is null then raise exception 'An approved admin must sign in before automation is enabled.'; end if;
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 if p_operation='settle' then
  if not exists(select 1 from public.tickets where id=(p_args->>'ticket')::uuid and league_id=p_league) then raise exception 'Ticket league mismatch.'; end if;
  return public.settle_weekly_ticket((p_args->>'ticket')::uuid,p_args->'results');
 elsif p_operation='replenish' then return public.replenish_weekly_balances(p_league,(p_args->>'season')::int,(p_args->>'week')::int);
 elsif p_operation='save_board' then
  v_board:=public.save_market_board((p_args->>'board')::uuid,p_league,(p_args->>'week')::int,(p_args->>'opens')::timestamptz,(p_args->>'closes')::timestamptz,p_args->'quotes',p_args->>'status');
  return to_jsonb(v_board);
 elsif p_operation='save_future_board' then
  return to_jsonb(public.save_future_board((p_args->>'board')::uuid,p_league,p_args->'quotes',p_args->>'status'));
 elsif p_operation='resolve_futures' then
  return to_jsonb(public.resolve_future_markets(p_league,array(select jsonb_array_elements_text(p_args->'kinds'))));
 else raise exception 'Unknown worker operation.'; end if;
end $$;


--
-- Name: activate_promos(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.activate_promos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.status='published' and new.board_type='weekly' then update public.promo_offers set activated_at=greatest(now(),new.opens_at) where league_id=new.league_id and nfl_season=new.nfl_season and market_week=new.market_week and status='scheduled' and activated_at is null;end if;return new;
end $$;


--
-- Name: active_reopening(uuid, integer); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.active_reopening(p_league uuid, p_week integer) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select id from public.sportsbook_reopening_reviews where league_id=p_league and market_week=p_week and status='approved' and closes_at>now() limit 1
$$;


--
-- Name: can_view_wallet(uuid); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.can_view_wallet(p_team uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.teams t
    join public.league_memberships m on m.league_id = t.league_id
    where t.id = p_team and m.user_id = (select auth.uid())
      and (m.team_id = p_team or m.role = 'admin'));
$$;


--
-- Name: capture_forecast(uuid); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.capture_forecast(p_board uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 insert into public.forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,opens_at,closes_at,quotes)
 select b.league_id,b.id,b.revision,b.nfl_season,b.market_week,b.board_type,b.opens_at,b.closes_at,
 coalesce((select jsonb_agg(to_jsonb(m) order by m.market_key,m.side) from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb)
 from public.sportsbook_boards b where b.id=p_board and b.status='published'
 on conflict(board_id,revision) do nothing;
end $$;


--
-- Name: confirmation_delivered(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.confirmation_delivered() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.status='sent' then
  update public.outbound_emails set status='sent',provider_id=new.provider_id,sent_at=new.sent_at,last_error=null
  where ticket_id=new.ticket_id and status<>'sent';
 end if;
 return new;
end $$;


--
-- Name: enqueue_weekly_jobs(timestamp with time zone); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.enqueue_weekly_jobs(p_now timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: guard_launch_approval(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_launch_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not exists(select 1 from sportsbook_private.platform_owner o
  join public.league_memberships m on m.id=o.membership_id
  where o.membership_id=new.owner_membership_id and m.user_id=auth.uid()) then
  raise exception 'Only the platform owner can approve a live league.';
 end if;
 return new;
end $$;


--
-- Name: guard_league_rollout(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_league_rollout() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.automation_enabled and not exists(
   select 1 from public.leagues where id=new.league_id and operations_enabled) then
  raise exception 'League operations are disabled pending verified rollout.';
 end if;
 return new;
end $$;


--
-- Name: guard_live_league_activation(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_live_league_activation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.operations_enabled then
  if tg_op='UPDATE' then
   if old.operations_enabled then return new; end if;
  end if;
  if not exists(select 1 from sportsbook_private.league_launch_approvals a
   join sportsbook_private.platform_owner o on o.membership_id=a.owner_membership_id
   where a.league_id=new.id) then
   raise exception 'Platform owner approval is required before a league goes live.';
  end if;
 end if;
 return new;
end $$;


--
-- Name: guard_market_league(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_market_league() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_league uuid;
begin
 select league_id into v_league from public.sportsbook_boards where id=new.board_id;
 if exists(select 1 from (values(new.team_id),(new.home_team_id),(new.away_team_id)) x(id)
   where x.id is not null and not exists(select 1 from public.teams where id=x.id and league_id=v_league)) then
  raise exception 'Market teams must belong to this league.';
 end if;
 return new;
end $$;


--
-- Name: guard_outbox_recipient(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_outbox_recipient() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.team_id is null or not exists(select 1 from public.league_memberships m
   where m.league_id=new.league_id and m.team_id=new.team_id and m.invited_email=new.recipient
     and (new.kind<>'attention' or m.role='admin')) then
  raise exception 'Email recipient must match the approved league membership.';
 end if;
 if new.payload is not null and (new.payload->'to' is distinct from jsonb_build_array(new.recipient)
   or new.payload ? 'cc' or new.payload ? 'bcc') then
  raise exception 'Email payload recipients must match the outbox recipient.';
 end if;
 return new;
end $$;


--
-- Name: guard_platform_owner_identity(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_platform_owner_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if exists(select 1 from sportsbook_private.platform_owner where membership_id=old.id) then
  if row(new.invited_email,new.role,new.league_id,new.team_id) is distinct from
     row(old.invited_email,old.role,old.league_id,old.team_id)
   or (old.user_id is not null and new.user_id is distinct from old.user_id) then
   raise exception 'Platform owner identity cannot be reassigned by league administration.';
  end if;
  if old.user_id is null and new.user_id is not null and not exists(
   select 1 from auth.users where id=new.user_id and lower(email)=old.invited_email and email_confirmed_at is not null) then
   raise exception 'Platform owner requires a verified matching email account.';
  end if;
 end if;
 return new;
end $$;


--
-- Name: guard_report_league(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_report_league() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if jsonb_typeof(new.results) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(new.results) k where not exists(
   select 1 from public.teams t where t.id::text=k and t.league_id=new.league_id)) then
  raise exception 'Report result teams must belong to this league.';
 end if;
 return new;
end $$;


--
-- Name: guard_ticket_rollout(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.guard_ticket_rollout() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.source_batch is null and not exists(select 1 from public.leagues where id=new.league_id and operations_enabled) then
  raise exception 'League operations are disabled pending verified rollout.';
 end if;
 return new;
end $$;


--
-- Name: initialize_model(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.initialize_model() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v uuid;begin
 insert into public.model_config_versions(league_id,config,reason) values(new.id,'{"score_scale":1,"variance_scale":1}','Frozen weekly-lineup-v3 baseline.') returning id into v;
 insert into public.model_controls(league_id,baseline_id,active_id) values(new.id,v,v);return new;
end $$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.is_admin(p_league uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.league_memberships
    where league_id = p_league and user_id = (select auth.uid()) and role = 'admin');
$$;


--
-- Name: is_member(uuid); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.is_member(p_league uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.league_memberships
    where league_id = p_league and user_id = (select auth.uid()));
$$;


--
-- Name: keep_forecast_history(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.keep_forecast_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin raise exception 'Forecast and review history is append-only.'; end $$;


--
-- Name: label_weekly_special(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.label_weekly_special() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 case new.settlement_context->>'kind'
 when 'weekly_count_projection' then new.market_type:='Teams Beating Projection';
 when 'weekly_average' then new.market_type:='League Average Score';
 when 'weekly_highest_score' then new.market_type:='Highest Weekly Score';
  when 'weekly_count_150' then new.market_type:='Teams Scoring 150+';
  when 'weekly_any_below_100' then new.market_type:='Any Team Below 100';
  when 'weekly_any_200' then new.market_type:='Any Team Scoring 200+';
  else null;
 end case;
 return new;
end $$;


--
-- Name: maintain_reopenings(uuid, integer); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.maintain_reopenings(p_league uuid, p_week integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare w public.sportsbook_reopening_reviews;
begin
 update public.sportsbook_reopening_reviews set status='expired' where league_id=p_league and status='approved' and closes_at<=now();
 update public.sportsbook_boards set status='closed' where league_id=p_league and reopening_id is not null and reopening_until<=now() and status<>'closed';
 for w in select * from public.sportsbook_reopening_reviews where league_id=p_league and market_week<>p_week and status in('approved','expired') loop
  update public.sportsbook_boards set reopening_id=null,reopening_until=null,phase='pregame',closes_at=w.original_future_closes,status=w.original_future_status,quote_valid_until=now(),suspension_reason='Waiting for the new week refresh.' where id=w.future_board and reopening_id=w.id;
  update public.sportsbook_reopening_reviews set status='expired' where id=w.id and status='approved';
 end loop;
end $$;


--
-- Name: member_quote_metadata(jsonb); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.member_quote_metadata(p_metadata jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select coalesce(jsonb_object_agg(key,case
  when key='reopening_events' and jsonb_typeof(value)='array' then
   coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','state',e->'state','starts_at',e->'starts_at')) from jsonb_array_elements(value)e),'[]'::jsonb)
  else value end),'{}'::jsonb)
 from jsonb_each(p_metadata) where key=any(array[
  'player_id','position','nfl_team','season_average','projection','expected_points','game_info','cutoff_at','generated_at',
  'left_player','right_player','slot','slot_index','margin_lower','margin_upper',
  'expected_wins','pick_owner_name','pick_owner_team_id','simulated_probability',
  'projection_targets','expected_team_count','lineup_locked','lock_reason','resolved',
  'reopening_locked','reopening_lock_reason','reopening_events'
 ]);
$$;


--
-- Name: more_special_conflict(public.sportsbook_markets, public.sportsbook_markets); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.more_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare h public.sportsbook_markets; s public.sportsbook_markets; c public.sportsbook_markets; target numeric;
begin
 if a.kind='weekly_highest_score' then h:=a;s:=b; elsif b.kind='weekly_highest_score' then h:=b;s:=a; end if;
 if h.id is not null and h.side='under' then
  if s.kind='weekly_any_200' and s.side='yes' and h.line<=200 then return true; end if;
  if s.kind in ('team_total','weekly_average') and s.side='over' and s.line>=h.line then return true; end if;
  if s.kind='weekly_count_150' and s.line>0 and h.line<=150 then return true; end if;
 end if;
 if h.id is not null and h.side='over' and s.kind='weekly_any_200' and s.side='no' and h.line>=200 then return true; end if;
 if a.kind='weekly_count_projection' then c:=a;s:=b; elsif b.kind='weekly_count_projection' then c:=b;s:=a; end if;
 if c.id is not null then
  if s.kind='team_total' then
   target:=(c.metadata->'projection_targets'->>s.team_id::text)::numeric;
   if c.line=0 and s.side='over' and s.line>=target then return true; end if;
   if c.line=(c.metadata->>'expected_team_count')::int and s.side='under' and s.line<=target then return true; end if;
  elsif s.kind='weekly_average' then
   select avg(value::numeric) into target from jsonb_each_text(c.metadata->'projection_targets');
   if c.line=0 and s.side='over' and s.line>=target then return true; end if;
   if c.line=(c.metadata->>'expected_team_count')::int and s.side='under' and s.line<=target then return true; end if;
  end if;
 end if;
 return false;
end $$;


--
-- Name: no_win_total_push(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.no_win_total_push() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if new.settlement_context->>'kind'='future_win_total' and new.status='PUSH' then raise exception 'Win totals cannot push; settle wins/losses or void the ticket with a reason.'; end if;
 return new;
end $$;


--
-- Name: preserve_accepted_terms(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.preserve_accepted_terms() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if tg_table_name='ticket_legs' then
  if (to_jsonb(new)-array['status','actual_value','result_evidence']) is distinct from (to_jsonb(old)-array['status','actual_value','result_evidence']) then raise exception 'Accepted leg terms are immutable.'; end if;
 else
  if (to_jsonb(new)-array['status','actual_payout','settled_at','ticket_type','net_profit']) is distinct from (to_jsonb(old)-array['status','actual_payout','settled_at','ticket_type','net_profit']) then raise exception 'Accepted ticket terms are immutable.'; end if;
 end if;
 return new;
end $$;


--
-- Name: promo_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    slot integer NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    image_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    activated_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    terms jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_offers_description_check CHECK (((length(description) >= 1) AND (length(description) <= 500))),
    CONSTRAINT promo_offers_kind_check CHECK ((kind = ANY (ARRAY['boost'::text, 'fixed'::text]))),
    CONSTRAINT promo_offers_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT promo_offers_slot_check CHECK (((slot >= 1) AND (slot <= 3))),
    CONSTRAINT promo_offers_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'disabled'::text]))),
    CONSTRAINT promo_offers_title_check CHECK (((length(title) >= 1) AND (length(title) <= 120)))
);


--
-- Name: promo_available(public.promo_offers); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.promo_available(o public.promo_offers) RETURNS boolean
    LANGUAGE sql
    SET search_path TO ''
    AS $$
 select o.status='scheduled' and o.activated_at is not null and o.activated_at<=clock_timestamp() and o.expires_at>clock_timestamp()
 and exists(select 1 from public.sportsbook_period(o.league_id) p where p.week=o.market_week and p.nfl_season=o.nfl_season)
$$;


--
-- Name: promo_snapshot_immutable(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.promo_snapshot_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$begin raise exception 'Promotion snapshots and events are immutable.';end $$;


--
-- Name: promo_void_restore(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.promo_void_restore() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare p public.ticket_promotions;
begin
 if new.status='VOIDED' and old.status<>'VOIDED' then
  select * into p from public.ticket_promotions where ticket_id=new.id;
  -- Fixed offers stay used; no separate restoration decision was approved.
  if found and p.kind='boost' then
   update public.promo_claims set used_ticket=null where offer_id=p.offer_id and user_id=p.user_id and used_ticket=new.id;
   if found then insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(p.league_id,p.offer_id,p.user_id,'restored',new.id);end if;
  end if;
 end if;return new;
end $$;


--
-- Name: queue_confirmation(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.queue_confirmation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,ticket_id,market_week)
 select league_id,'confirmation:'||id,'confirmation',new.recipient,team_id,id,market_week from public.tickets where id=new.ticket_id
 on conflict(event_key) do nothing;
 return new;
end $$;


--
-- Name: reject_locked_quote(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.reject_locked_quote() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.market_quote_id is not null and exists(select 1 from public.sportsbook_markets m where m.id=new.market_quote_id and m.metadata->>'lineup_locked'='true') then
  raise exception 'This market is locked because a complete projected lineup is unavailable. Regenerate lines before accepting bets.';
 end if;
 return new;
end $$;


--
-- Name: release_refresh_sources(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.release_refresh_sources() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.status<>'staging' then
  delete from public.line_refresh_sources where cycle_id=new.id;
 end if;
 return new;
end $$;


--
-- Name: round_market_odds(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.round_market_odds() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare increment integer;
begin
 increment:=case when new.kind like 'future_%' then 50 when new.kind like 'weekly_%' then 25 else 10 end;
 new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/increment::numeric)*increment);
 if new.kind like 'future_%' then new.odds:=greatest(-10000,least(10000,new.odds)); end if;
 return new;
end $$;


--
-- Name: round_special_odds(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.round_special_odds() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if new.kind like 'weekly_%' then
  new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/10.0)*10);
 end if;
 return new;
end $$;


--
-- Name: sportsbook_boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sportsbook_boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    market_week integer NOT NULL,
    nfl_season integer NOT NULL,
    league_season integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    board_type text DEFAULT 'weekly'::text NOT NULL,
    phase text DEFAULT 'pregame'::text NOT NULL,
    source_observed_at timestamp with time zone,
    quote_valid_until timestamp with time zone,
    suspension_reason text,
    reopening_id uuid,
    reopening_until timestamp with time zone,
    CONSTRAINT sportsbook_boards_board_type_check CHECK ((board_type = ANY (ARRAY['weekly'::text, 'future'::text]))),
    CONSTRAINT sportsbook_boards_check CHECK ((closes_at > opens_at)),
    CONSTRAINT sportsbook_boards_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT sportsbook_boards_phase_check CHECK ((phase = ANY (ARRAY['pregame'::text, 'live'::text]))),
    CONSTRAINT sportsbook_boards_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text])))
);


--
-- Name: valid_reopening(public.sportsbook_boards, uuid[]); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.valid_reopening(p_board public.sportsbook_boards, p_picks uuid[]) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare w public.sportsbook_reopening_reviews;r public.line_refresh_runtime;q public.sportsbook_markets; game_id text; g jsonb;
begin
 if p_board.reopening_id is null or p_board.reopening_until<=now() then return false; end if;
 select * into w from public.sportsbook_reopening_reviews where id=p_board.reopening_id and league_id=p_board.league_id and status='approved' and closes_at>now();
 if not found then return false; end if;
 select * into r from public.line_refresh_runtime where league_id=w.league_id;
 if not found or r.market_week<>w.market_week or r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.last_error is not null then return false; end if;
 for q in select * from public.sportsbook_markets where id=any(p_picks) and board_id=p_board.id and active loop
  if q.metadata->>'reopening_model' is distinct from 'between-games-conditional-v1' or q.metadata->>'reopening_review_id' is distinct from w.id::text or coalesce((q.metadata->>'reopening_locked')::boolean,true) or coalesce((q.metadata->>'lineup_locked')::boolean,false) or coalesce(jsonb_array_length(q.metadata->'reopening_game_ids'),0)=0 then return false; end if;
  for game_id in select jsonb_array_elements_text(q.metadata->'reopening_game_ids') loop
   select value into g from jsonb_array_elements(r.games) where value->>'id'=game_id;
   if g is null or not exists(select 1 from jsonb_array_elements(q.metadata->'reopening_events') as prior(value) where prior.value->>'id'=game_id and prior.value->>'state'=g->>'state' and prior.value->>'starts_at'=g->>'starts_at') or g->>'state' not in ('scheduled','final') or (g->>'state'='scheduled' and (g->>'starts_at')::timestamptz<=now()) or (coalesce((q.metadata->>'reopening_player_market')::boolean,false) and g->>'state'<>'scheduled') then return false; end if;
  end loop;
 end loop;
 return true;
end $$;


--
-- Name: validate_boost(uuid, uuid, uuid[], numeric); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.validate_boost(p_offer uuid, p_board uuid, p_picks uuid[], p_stake numeric) RETURNS public.promo_offers
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare o public.promo_offers;c public.promo_claims;b public.sportsbook_boards;n integer;distinct_n integer;
begin
 select * into o from public.promo_offers where id=p_offer for share;
 select * into b from public.sportsbook_boards where id=p_board;
 if not found or o.id is null or o.kind<>'boost' or o.league_id<>b.league_id or o.nfl_season<>b.nfl_season or o.market_week<>b.market_week or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 select * into c from public.promo_claims where offer_id=o.id and user_id=auth.uid() for update;
 if not found or c.used_ticket is not null then raise exception 'Claim this boost first; each boost can be used once.';end if;
 if p_stake>(o.terms->>'max_stake')::numeric then raise exception 'Maximum wager with this boost is %.',o.terms->>'max_stake';end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and (boost_pct>0 or kind like 'future_%')) then raise exception 'Boosts cannot stack with featured boosts or futures.';end if;
 n:=cardinality(p_picks);
 if n<(o.terms->>'count')::int or (o.terms->>'criterion'='points_exact' and n<>(o.terms->>'count')::int) then raise exception 'Selection count does not qualify.';end if;
 if o.terms->>'criterion' in ('points_min','points_exact') then
  select count(distinct metadata->>'player_id') into distinct_n from public.sportsbook_markets where id=any(p_picks) and kind='player_points';
  if distinct_n<>n then raise exception 'Every selection must be Player Points from a distinct player.';end if;
 elsif o.terms->>'criterion'='spreads_min' then
  select count(distinct matchup_key) into distinct_n from public.sportsbook_markets where id=any(p_picks) and kind='spread';
  if distinct_n<>n then raise exception 'Every selection must be a spread from a distinct matchup.';end if;
 elsif o.terms->>'criterion'='category' then
  if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and case when o.terms->>'category'='weekly' then kind not like 'weekly_%' else kind<>o.terms->>'category' end) then raise exception 'Selections do not match the approved category.';end if;
 elsif o.terms->>'criterion'='featured' then
  if not exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key=o.terms->>'matchup') then raise exception 'Include the designated matchup.';end if;
 end if;
 return o;
end $$;


--
-- Name: validate_extra_leg(); Type: FUNCTION; Schema: sportsbook_private; Owner: -
--

CREATE FUNCTION sportsbook_private.validate_extra_leg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare k text:=new.settlement_context->>'kind'; cutoff timestamptz;
begin
 if k not in ('player_h2h','player_milestone','team_milestone','winning_margin') then return new; end if;
 if k in ('player_h2h','player_milestone') then
  cutoff:=(new.settlement_context->'metadata'->>'cutoff_at')::timestamptz;
  if cutoff is null or cutoff<=now() then raise exception 'This player market has reached kickoff or its kickoff is unavailable.'; end if;
 end if;
 if exists(select 1 from public.ticket_legs l where l.ticket_id=new.ticket_id and l.settlement_context->>'home_team_id'=new.settlement_context->>'home_team_id' and l.settlement_context->>'away_team_id'=new.settlement_context->>'away_team_id') then raise exception 'New market selections require separate fantasy matchups in a parlay.'; end if;
 new.market_type:=case k when 'player_h2h' then 'Head to Head' when 'player_milestone' then 'Player Milestone' when 'team_milestone' then 'Team Milestone' else 'Winning Margin' end;
 return new;
end $$;


--
-- Name: admin_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    category text NOT NULL,
    reason text NOT NULL,
    before_value jsonb NOT NULL,
    after_value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_exception_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_exception_reviews (
    league_id uuid NOT NULL,
    exception_key text NOT NULL,
    actor_id uuid NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_exception_reviews_decision_check CHECK ((decision = ANY (ARRAY['keep_locked'::text, 'acknowledge_delivery'::text]))),
    CONSTRAINT admin_exception_reviews_reason_check CHECK (((length(reason) >= 5) AND (length(reason) <= 500)))
);


--
-- Name: balance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    request_id uuid NOT NULL,
    previous_balance numeric(12,2),
    new_balance numeric(12,2) NOT NULL,
    reason text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_events_kind_check CHECK ((kind = ANY (ARRAY['opening_balance'::text, 'admin_adjustment'::text]))),
    CONSTRAINT balance_events_new_balance_check CHECK ((new_balance >= (0)::numeric)),
    CONSTRAINT balance_events_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 3) AND (length(TRIM(BOTH FROM reason)) <= 500)))
);


--
-- Name: TABLE balance_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.balance_events IS 'Append-only balance administration; these changes do not contribute to betting profit.';


--
-- Name: email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    recipient text NOT NULL,
    kind text DEFAULT 'ticket_confirmation'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT email_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: forecast_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forecast_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    board_id uuid NOT NULL,
    revision integer NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    board_type text NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    provenance text DEFAULT 'published_snapshot'::text NOT NULL,
    quotes jsonb NOT NULL,
    CONSTRAINT forecast_snapshots_provenance_check CHECK ((provenance = ANY (ARRAY['published_snapshot'::text, 'existing_board_at_install'::text]))),
    CONSTRAINT forecast_snapshots_quotes_check CHECK ((jsonb_typeof(quotes) = 'array'::text))
);


--
-- Name: league_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid,
    invited_email text NOT NULL,
    display_name text NOT NULL,
    sleeper_user_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_memberships_display_name_check CHECK (((length(TRIM(BOTH FROM display_name)) >= 1) AND (length(TRIM(BOTH FROM display_name)) <= 80))),
    CONSTRAINT league_memberships_invited_email_check CHECK ((invited_email = lower(TRIM(BOTH FROM invited_email)))),
    CONSTRAINT league_memberships_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text])))
);


--
-- Name: league_result_weeks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_result_weeks (
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    final boolean NOT NULL,
    source text DEFAULT 'Sleeper'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    results jsonb NOT NULL,
    CONSTRAINT league_result_weeks_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18)))
);


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sleeper_league_id text NOT NULL,
    nfl_season integer NOT NULL,
    league_season integer NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active_week integer DEFAULT 5 NOT NULL,
    week_anchor timestamp with time zone DEFAULT '2026-10-06 12:00:00+00'::timestamp with time zone NOT NULL,
    sportsbook_url text,
    email_sender text,
    operations_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT leagues_active_week_check CHECK (((active_week >= 1) AND (active_week <= 18))),
    CONSTRAINT leagues_email_sender_check CHECK ((email_sender !~ '[\r\n]'::text)),
    CONSTRAINT leagues_league_season_check CHECK ((league_season > 0)),
    CONSTRAINT leagues_sportsbook_url_check CHECK ((sportsbook_url ~ '^https://[^[:space:]]+$'::text))
);


--
-- Name: COLUMN leagues.operations_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leagues.operations_enabled IS 'Service-only rollout gate. Enable a new league only after isolation, provider/configuration, recipient and capacity checks pass.';


--
-- Name: line_refresh_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_refresh_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    market_week integer NOT NULL,
    slot bigint NOT NULL,
    status text DEFAULT 'staging'::text NOT NULL,
    weekly_board uuid,
    weekly_revision integer,
    future_board uuid,
    future_revision integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    source_recovery boolean DEFAULT false NOT NULL,
    CONSTRAINT line_refresh_cycles_status_check CHECK ((status = ANY (ARRAY['staging'::text, 'published'::text, 'suspended'::text, 'superseded'::text, 'skipped'::text])))
);


--
-- Name: line_refresh_runtime; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_refresh_runtime (
    league_id uuid NOT NULL,
    market_week integer NOT NULL,
    source text DEFAULT 'ESPN public scoreboard (cadence only)'::text NOT NULL,
    observed_at timestamp with time zone,
    any_in_progress boolean DEFAULT false NOT NULL,
    week_started boolean DEFAULT false NOT NULL,
    interval_minutes integer DEFAULT 120 NOT NULL,
    next_due_at timestamp with time zone DEFAULT now() NOT NULL,
    last_success_at timestamp with time zone,
    last_error text,
    games jsonb DEFAULT '[]'::jsonb NOT NULL,
    live_families jsonb DEFAULT '{"futures": false, "players": false, "matchups": false, "specials": false}'::jsonb NOT NULL,
    CONSTRAINT line_refresh_runtime_interval_minutes_check CHECK ((interval_minutes = ANY (ARRAY[15, 120])))
);


--
-- Name: line_refresh_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_refresh_sources (
    cycle_id uuid NOT NULL,
    path text NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: line_refresh_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_refresh_stages (
    cycle_id uuid NOT NULL,
    family text NOT NULL,
    quotes jsonb NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    CONSTRAINT line_refresh_stages_family_check CHECK ((family = ANY (ARRAY['matchups'::text, 'players'::text, 'specials'::text, 'futures'::text]))),
    CONSTRAINT line_refresh_stages_quotes_check CHECK ((jsonb_typeof(quotes) = 'array'::text))
);


--
-- Name: live_forecast_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_forecast_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    model_version text NOT NULL,
    model_config jsonb NOT NULL,
    source_hash text NOT NULL,
    status text NOT NULL,
    sources jsonb NOT NULL,
    payload jsonb NOT NULL,
    CONSTRAINT live_forecast_runs_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT live_forecast_runs_payload_check CHECK (((jsonb_typeof((payload -> 'teams'::text)) = 'array'::text) AND (jsonb_typeof((payload -> 'quotes'::text)) = 'array'::text))),
    CONSTRAINT live_forecast_runs_source_hash_check CHECK ((source_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT live_forecast_runs_status_check CHECK ((status = ANY (ARRAY['shadow'::text, 'blocked'::text])))
);


--
-- Name: live_model_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_model_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome_hash text NOT NULL,
    forecast_hash text NOT NULL,
    outcomes jsonb NOT NULL,
    report jsonb NOT NULL,
    CONSTRAINT live_model_reviews_forecast_hash_check CHECK ((forecast_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT live_model_reviews_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT live_model_reviews_outcome_hash_check CHECK ((outcome_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT live_model_reviews_outcomes_check CHECK ((jsonb_typeof(outcomes) = 'array'::text))
);


--
-- Name: model_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_change_events (
    id bigint NOT NULL,
    league_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    review_id uuid,
    reason text NOT NULL,
    CONSTRAINT model_change_events_kind_check CHECK ((kind = ANY (ARRAY['promote'::text, 'pause'::text, 'resume'::text, 'rollback'::text, 'auto_rollback'::text])))
);


--
-- Name: model_change_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.model_change_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.model_change_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: model_config_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_config_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    config jsonb NOT NULL,
    reason text NOT NULL,
    CONSTRAINT model_config_versions_config_check CHECK (((jsonb_typeof(config) = 'object'::text) AND (config ?& ARRAY['score_scale'::text, 'variance_scale'::text]) AND ((((config ->> 'score_scale'::text))::numeric >= 0.9) AND (((config ->> 'score_scale'::text))::numeric <= 1.1)) AND ((((config ->> 'variance_scale'::text))::numeric >= 0.9) AND (((config ->> 'variance_scale'::text))::numeric <= 1.1)) AND (((config - 'score_scale'::text) - 'variance_scale'::text) = '{}'::jsonb)))
);


--
-- Name: model_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_controls (
    league_id uuid NOT NULL,
    baseline_id uuid NOT NULL,
    active_id uuid NOT NULL,
    paused boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_forecast_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_forecast_runs (
    id uuid NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    category text NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    phase text NOT NULL,
    provenance text NOT NULL,
    model_version uuid NOT NULL,
    model_config jsonb NOT NULL,
    source_hash text NOT NULL,
    sources jsonb NOT NULL,
    payload jsonb NOT NULL,
    CONSTRAINT model_forecast_runs_category_check CHECK ((category = ANY (ARRAY['Matchups'::text, 'Player Points'::text, 'Weekly Specials'::text, 'Season Futures'::text]))),
    CONSTRAINT model_forecast_runs_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT model_forecast_runs_payload_check CHECK (((jsonb_typeof((payload -> 'quotes'::text)) = 'array'::text) AND (jsonb_typeof((payload -> 'models'::text)) = 'array'::text) AND (jsonb_typeof((payload -> 'pool'::text)) = 'array'::text))),
    CONSTRAINT model_forecast_runs_phase_check CHECK ((phase = 'pregame'::text)),
    CONSTRAINT model_forecast_runs_provenance_check CHECK ((provenance = 'as_of'::text))
);


--
-- Name: model_outcome_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_outcome_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome_hash text NOT NULL,
    outcome jsonb NOT NULL
);


--
-- Name: model_weekly_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_weekly_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome_id uuid NOT NULL,
    input_hash text NOT NULL,
    report jsonb NOT NULL,
    comparison jsonb NOT NULL
);


--
-- Name: promo_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_claims (
    offer_id uuid NOT NULL,
    league_id uuid NOT NULL,
    user_id uuid NOT NULL,
    used_ticket uuid,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: promo_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    user_id uuid,
    event text NOT NULL,
    ticket_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: promo_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    png text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_images_png_check CHECK (((length(png) >= 32) AND (length(png) <= 6990508)))
);


--
-- Name: sportsbook_reopening_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sportsbook_reopening_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    weekly_board uuid NOT NULL,
    future_board uuid,
    weekly_revision integer NOT NULL,
    future_revision integer,
    original_future_closes timestamp with time zone,
    original_future_status text,
    checked_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    status text DEFAULT 'review'::text NOT NULL,
    snapshot_hash text NOT NULL,
    weekly_quotes jsonb NOT NULL,
    future_quotes jsonb NOT NULL,
    context jsonb NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    CONSTRAINT sportsbook_reopening_reviews_future_quotes_check CHECK (((jsonb_typeof(future_quotes) = 'array'::text) AND (jsonb_array_length(future_quotes) <= 1500))),
    CONSTRAINT sportsbook_reopening_reviews_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT sportsbook_reopening_reviews_snapshot_hash_check CHECK ((snapshot_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT sportsbook_reopening_reviews_status_check CHECK ((status = ANY (ARRAY['review'::text, 'approved'::text, 'expired'::text, 'superseded'::text]))),
    CONSTRAINT sportsbook_reopening_reviews_weekly_quotes_check CHECK (((jsonb_typeof(weekly_quotes) = 'array'::text) AND ((jsonb_array_length(weekly_quotes) >= 1) AND (jsonb_array_length(weekly_quotes) <= 1500))))
);


--
-- Name: sportsbook_report_forecast_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sportsbook_report_forecast_details WITH (security_invoker='true') AS
 SELECT id,
    league_id,
    nfl_season,
    COALESCE(( SELECT jsonb_agg(((entry.value - 'metadata'::text) || jsonb_build_object('metadata', (COALESCE((entry.value -> 'metadata'::text), '{}'::jsonb) - ARRAY['home_lineup'::text, 'away_lineup'::text, 'scoring_settings'::text]))) ORDER BY entry.ord) AS jsonb_agg
           FROM jsonb_array_elements(f.quotes) WITH ORDINALITY entry(value, ord)), '[]'::jsonb) AS quotes
   FROM public.forecast_snapshots f;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    roster_id integer NOT NULL,
    team_name text NOT NULL,
    sleeper_owner_id text NOT NULL,
    owner_name text NOT NULL,
    sportsbook_owner_id text NOT NULL,
    sportsbook_owner_name text NOT NULL,
    co_owner_ids text[] DEFAULT '{}'::text[] NOT NULL,
    co_owner_names text[] DEFAULT '{}'::text[] NOT NULL,
    avatar_url text,
    wins integer DEFAULT 0 NOT NULL,
    losses integer DEFAULT 0 NOT NULL,
    ties integer DEFAULT 0 NOT NULL,
    CONSTRAINT teams_check CHECK ((cardinality(co_owner_ids) = cardinality(co_owner_names)))
);


--
-- Name: ticket_legs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_legs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    leg_number integer NOT NULL,
    selection text NOT NULL,
    market_type text NOT NULL,
    matchup text,
    accepted_odds integer NOT NULL,
    accepted_line numeric,
    status text NOT NULL,
    actual_value numeric,
    result_evidence text NOT NULL,
    market_quote_id uuid,
    accepted_decimal_odds numeric(18,10),
    settlement_context jsonb,
    CONSTRAINT ticket_legs_leg_number_check CHECK ((leg_number > 0)),
    CONSTRAINT ticket_legs_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'WON'::text, 'LOST'::text, 'PUSH'::text, 'VOIDED'::text])))
);


--
-- Name: ticket_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_promotions (
    ticket_id uuid NOT NULL,
    league_id uuid NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    kind text NOT NULL,
    boost_pct numeric DEFAULT 0 NOT NULL,
    base_decimal numeric NOT NULL,
    terms jsonb NOT NULL,
    CONSTRAINT ticket_promotions_base_decimal_check CHECK ((base_decimal > (1)::numeric)),
    CONSTRAINT ticket_promotions_kind_check CHECK ((kind = ANY (ARRAY['boost'::text, 'fixed'::text])))
);


--
-- Name: ticket_score_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_score_observations (
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    cadence_minutes integer NOT NULL,
    payload jsonb NOT NULL,
    CONSTRAINT ticket_score_observations_cadence_minutes_check CHECK ((cadence_minutes = ANY (ARRAY[15, 120]))),
    CONSTRAINT ticket_score_observations_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT ticket_score_observations_nfl_season_check CHECK (((nfl_season >= 2020) AND (nfl_season <= 2100))),
    CONSTRAINT ticket_score_observations_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text))
);


--
-- Name: TABLE ticket_score_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ticket_score_observations IS 'Provisional fantasy scores, updated by the worker at 15 minutes in games and two hours otherwise; fetched_at is not provider observation time.';


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    team_id uuid NOT NULL,
    source_batch text,
    legacy_ticket_id text,
    league_season integer NOT NULL,
    nfl_season integer NOT NULL,
    placement_week integer NOT NULL,
    market_week integer NOT NULL,
    ticket_type text DEFAULT 'parlay'::text NOT NULL,
    placed_at timestamp with time zone NOT NULL,
    accepted_combined_odds integer NOT NULL,
    stake numeric(12,2) NOT NULL,
    accepted_potential_payout numeric(12,2) NOT NULL,
    status text NOT NULL,
    actual_payout numeric(12,2) NOT NULL,
    net_profit numeric(12,2) GENERATED ALWAYS AS ((actual_payout - stake)) STORED,
    settled_at timestamp with time zone,
    source_record jsonb,
    request_key uuid,
    CONSTRAINT tickets_accepted_potential_payout_check CHECK ((accepted_potential_payout >= (0)::numeric)),
    CONSTRAINT tickets_actual_payout_check CHECK ((actual_payout >= (0)::numeric)),
    CONSTRAINT tickets_check CHECK (((status = 'OPEN'::text) = (settled_at IS NULL))),
    CONSTRAINT tickets_stake_check CHECK ((stake > (0)::numeric)),
    CONSTRAINT tickets_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'WON'::text, 'LOST'::text, 'PUSH'::text, 'VOIDED'::text])))
);


--
-- Name: wallet_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    ticket_id uuid,
    source_batch text,
    event_key text NOT NULL,
    kind text NOT NULL,
    amount numeric(12,2) NOT NULL,
    balance_before numeric(12,2),
    balance_after numeric(12,2) NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_ledger_balance_after_check CHECK ((balance_after >= (0)::numeric)),
    CONSTRAINT wallet_ledger_check CHECK (((balance_before IS NULL) OR (balance_after = (balance_before + amount)))),
    CONSTRAINT wallet_ledger_kind_check CHECK ((kind = ANY (ARRAY['historical_opening'::text, 'settlement'::text, 'weekly_replenishment'::text, 'wager'::text, 'void_refund'::text])))
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    team_id uuid NOT NULL,
    balance numeric(12,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_balance_check CHECK ((balance >= (0)::numeric))
);


--
-- Name: COLUMN wallets.balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.wallets.balance IS 'NULL until an approved opening balance or historical migration. Never replenish pending wallets.';


--
-- Name: weekly_execution_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_execution_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    nfl_season integer NOT NULL,
    market_week integer NOT NULL,
    operation text NOT NULL,
    summary jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weekly_execution_runs_market_week_check CHECK (((market_week >= 1) AND (market_week <= 18))),
    CONSTRAINT weekly_execution_runs_operation_check CHECK ((operation = ANY (ARRAY['settlement'::text, 'replenishment'::text])))
);


--
-- Name: weekly_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_schedule (
    league_id uuid NOT NULL,
    automation_enabled boolean DEFAULT false NOT NULL,
    publication_paused boolean DEFAULT false NOT NULL,
    opening_email boolean DEFAULT true NOT NULL,
    reminder_email boolean DEFAULT true NOT NULL,
    recap_email boolean DEFAULT true NOT NULL,
    opening_time time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    reminder_time time without time zone DEFAULT '19:00:00'::time without time zone NOT NULL,
    recap_time time without time zone DEFAULT '08:15:00'::time without time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_times jsonb DEFAULT '{"cutoff": "20:00", "recheck": "07:00", "refresh": "07:30", "generation": "08:30", "settlement": "00:30", "replenishment": "08:00"}'::jsonb NOT NULL,
    activation_requested boolean DEFAULT false NOT NULL,
    worker_probe_id bigint
);


--
-- Name: import_batches; Type: TABLE; Schema: sportsbook_private; Owner: -
--

CREATE TABLE sportsbook_private.import_batches (
    id text NOT NULL,
    source_url text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: league_launch_approvals; Type: TABLE; Schema: sportsbook_private; Owner: -
--

CREATE TABLE sportsbook_private.league_launch_approvals (
    league_id uuid NOT NULL,
    owner_membership_id uuid NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    verification_note text NOT NULL,
    CONSTRAINT league_launch_approvals_verification_note_check CHECK (((length(TRIM(BOTH FROM verification_note)) >= 10) AND (length(TRIM(BOTH FROM verification_note)) <= 2000)))
);


--
-- Name: TABLE league_launch_approvals; Type: COMMENT; Schema: sportsbook_private; Owner: -
--

COMMENT ON TABLE sportsbook_private.league_launch_approvals IS 'Future owner-only activation process must validate isolation, provider configuration and capacity before recording approval. No client/API onboarding exists yet.';


--
-- Name: platform_owner; Type: TABLE; Schema: sportsbook_private; Owner: -
--

CREATE TABLE sportsbook_private.platform_owner (
    singleton boolean DEFAULT true NOT NULL,
    membership_id uuid NOT NULL,
    CONSTRAINT platform_owner_singleton_check CHECK (singleton)
);


--
-- Name: admin_change_log admin_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_change_log
    ADD CONSTRAINT admin_change_log_pkey PRIMARY KEY (id);


--
-- Name: admin_exception_reviews admin_exception_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_exception_reviews
    ADD CONSTRAINT admin_exception_reviews_pkey PRIMARY KEY (league_id, exception_key);


--
-- Name: automation_jobs automation_jobs_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_event_key_key UNIQUE (event_key);


--
-- Name: automation_jobs automation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_pkey PRIMARY KEY (id);


--
-- Name: balance_events balance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_events
    ADD CONSTRAINT balance_events_pkey PRIMARY KEY (id);


--
-- Name: balance_events balance_events_team_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_events
    ADD CONSTRAINT balance_events_team_id_request_id_key UNIQUE (team_id, request_id);


--
-- Name: sportsbook_boards boards_id_league_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_boards
    ADD CONSTRAINT boards_id_league_key UNIQUE (id, league_id);


--
-- Name: line_refresh_cycles cycles_id_league_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT cycles_id_league_key UNIQUE (id, league_id);


--
-- Name: email_deliveries email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: email_deliveries email_deliveries_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_ticket_id_key UNIQUE (ticket_id);


--
-- Name: forecast_snapshots forecast_snapshots_board_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_snapshots
    ADD CONSTRAINT forecast_snapshots_board_id_revision_key UNIQUE (board_id, revision);


--
-- Name: forecast_snapshots forecast_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_snapshots
    ADD CONSTRAINT forecast_snapshots_pkey PRIMARY KEY (id);


--
-- Name: league_memberships league_memberships_league_id_invited_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_league_id_invited_email_key UNIQUE (league_id, invited_email);


--
-- Name: league_memberships league_memberships_league_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_league_id_user_id_key UNIQUE (league_id, user_id);


--
-- Name: league_memberships league_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_pkey PRIMARY KEY (id);


--
-- Name: league_memberships league_memberships_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_team_id_key UNIQUE (team_id);


--
-- Name: league_result_weeks league_result_weeks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_result_weeks
    ADD CONSTRAINT league_result_weeks_pkey PRIMARY KEY (league_id, nfl_season, market_week);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: leagues leagues_sleeper_league_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_sleeper_league_id_key UNIQUE (sleeper_league_id);


--
-- Name: line_refresh_cycles line_refresh_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT line_refresh_cycles_pkey PRIMARY KEY (id);


--
-- Name: line_refresh_runtime line_refresh_runtime_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_runtime
    ADD CONSTRAINT line_refresh_runtime_pkey PRIMARY KEY (league_id);


--
-- Name: line_refresh_sources line_refresh_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_sources
    ADD CONSTRAINT line_refresh_sources_pkey PRIMARY KEY (cycle_id, path);


--
-- Name: line_refresh_stages line_refresh_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_stages
    ADD CONSTRAINT line_refresh_stages_pkey PRIMARY KEY (cycle_id, family);


--
-- Name: live_forecast_runs live_forecast_runs_cycle_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_forecast_runs
    ADD CONSTRAINT live_forecast_runs_cycle_id_key UNIQUE (cycle_id);


--
-- Name: live_forecast_runs live_forecast_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_forecast_runs
    ADD CONSTRAINT live_forecast_runs_pkey PRIMARY KEY (id);


--
-- Name: live_model_reviews live_model_reviews_league_id_nfl_season_market_week_outcome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_model_reviews
    ADD CONSTRAINT live_model_reviews_league_id_nfl_season_market_week_outcome_key UNIQUE (league_id, nfl_season, market_week, outcome_hash, forecast_hash);


--
-- Name: live_model_reviews live_model_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_model_reviews
    ADD CONSTRAINT live_model_reviews_pkey PRIMARY KEY (id);


--
-- Name: model_change_events model_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_change_events
    ADD CONSTRAINT model_change_events_pkey PRIMARY KEY (id);


--
-- Name: model_config_versions model_config_versions_league_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_config_versions
    ADD CONSTRAINT model_config_versions_league_id_id_key UNIQUE (league_id, id);


--
-- Name: model_config_versions model_config_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_config_versions
    ADD CONSTRAINT model_config_versions_pkey PRIMARY KEY (id);


--
-- Name: model_controls model_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_controls
    ADD CONSTRAINT model_controls_pkey PRIMARY KEY (league_id);


--
-- Name: model_forecast_runs model_forecast_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_forecast_runs
    ADD CONSTRAINT model_forecast_runs_pkey PRIMARY KEY (id);


--
-- Name: model_outcome_revisions model_outcome_revisions_league_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_outcome_revisions
    ADD CONSTRAINT model_outcome_revisions_league_id_id_key UNIQUE (league_id, id);


--
-- Name: model_outcome_revisions model_outcome_revisions_league_id_nfl_season_market_week_ou_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_outcome_revisions
    ADD CONSTRAINT model_outcome_revisions_league_id_nfl_season_market_week_ou_key UNIQUE (league_id, nfl_season, market_week, outcome_hash);


--
-- Name: model_outcome_revisions model_outcome_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_outcome_revisions
    ADD CONSTRAINT model_outcome_revisions_pkey PRIMARY KEY (id);


--
-- Name: model_weekly_reviews model_weekly_reviews_league_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_weekly_reviews
    ADD CONSTRAINT model_weekly_reviews_league_id_id_key UNIQUE (league_id, id);


--
-- Name: model_weekly_reviews model_weekly_reviews_league_id_nfl_season_market_week_input_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_weekly_reviews
    ADD CONSTRAINT model_weekly_reviews_league_id_nfl_season_market_week_input_key UNIQUE (league_id, nfl_season, market_week, input_hash);


--
-- Name: model_weekly_reviews model_weekly_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_weekly_reviews
    ADD CONSTRAINT model_weekly_reviews_pkey PRIMARY KEY (id);


--
-- Name: outbound_emails outbound_emails_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_event_key_key UNIQUE (event_key);


--
-- Name: outbound_emails outbound_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_pkey PRIMARY KEY (id);


--
-- Name: promo_claims promo_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_claims
    ADD CONSTRAINT promo_claims_pkey PRIMARY KEY (offer_id, user_id);


--
-- Name: promo_events promo_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_events
    ADD CONSTRAINT promo_events_pkey PRIMARY KEY (id);


--
-- Name: promo_images promo_images_id_league_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_images
    ADD CONSTRAINT promo_images_id_league_id_key UNIQUE (id, league_id);


--
-- Name: promo_images promo_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_images
    ADD CONSTRAINT promo_images_pkey PRIMARY KEY (id);


--
-- Name: promo_offers promo_offers_id_league_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_offers
    ADD CONSTRAINT promo_offers_id_league_id_key UNIQUE (id, league_id);


--
-- Name: promo_offers promo_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_offers
    ADD CONSTRAINT promo_offers_pkey PRIMARY KEY (id);


--
-- Name: sportsbook_boards sportsbook_boards_league_id_nfl_season_market_week_board_ty_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_boards
    ADD CONSTRAINT sportsbook_boards_league_id_nfl_season_market_week_board_ty_key UNIQUE (league_id, nfl_season, market_week, board_type);


--
-- Name: sportsbook_boards sportsbook_boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_boards
    ADD CONSTRAINT sportsbook_boards_pkey PRIMARY KEY (id);


--
-- Name: sportsbook_markets sportsbook_markets_board_id_market_key_side_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_board_id_market_key_side_key UNIQUE (board_id, market_key, side);


--
-- Name: sportsbook_markets sportsbook_markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_pkey PRIMARY KEY (id);


--
-- Name: sportsbook_reopening_reviews sportsbook_reopening_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_reopening_reviews
    ADD CONSTRAINT sportsbook_reopening_reviews_pkey PRIMARY KEY (id);


--
-- Name: teams teams_id_league_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_id_league_id_key UNIQUE (id, league_id);


--
-- Name: teams teams_league_id_roster_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_roster_id_key UNIQUE (league_id, roster_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: ticket_legs ticket_legs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_legs
    ADD CONSTRAINT ticket_legs_pkey PRIMARY KEY (id);


--
-- Name: ticket_legs ticket_legs_ticket_id_leg_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_legs
    ADD CONSTRAINT ticket_legs_ticket_id_leg_number_key UNIQUE (ticket_id, leg_number);


--
-- Name: ticket_promotions ticket_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_promotions
    ADD CONSTRAINT ticket_promotions_pkey PRIMARY KEY (ticket_id);


--
-- Name: ticket_score_observations ticket_score_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_score_observations
    ADD CONSTRAINT ticket_score_observations_pkey PRIMARY KEY (league_id, nfl_season, market_week);


--
-- Name: tickets tickets_id_league_team_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_id_league_team_key UNIQUE (id, league_id, team_id);


--
-- Name: tickets tickets_id_team_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_id_team_key UNIQUE (id, team_id);


--
-- Name: tickets tickets_league_id_legacy_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_league_id_legacy_ticket_id_key UNIQUE (league_id, legacy_ticket_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_request_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_request_key_key UNIQUE (request_key);


--
-- Name: wallet_ledger wallet_ledger_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_event_key_key UNIQUE (event_key);


--
-- Name: wallet_ledger wallet_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (team_id);


--
-- Name: weekly_execution_runs weekly_execution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_execution_runs
    ADD CONSTRAINT weekly_execution_runs_pkey PRIMARY KEY (id);


--
-- Name: weekly_schedule weekly_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_schedule
    ADD CONSTRAINT weekly_schedule_pkey PRIMARY KEY (league_id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: league_launch_approvals league_launch_approvals_pkey; Type: CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.league_launch_approvals
    ADD CONSTRAINT league_launch_approvals_pkey PRIMARY KEY (league_id);


--
-- Name: platform_owner platform_owner_membership_id_key; Type: CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.platform_owner
    ADD CONSTRAINT platform_owner_membership_id_key UNIQUE (membership_id);


--
-- Name: platform_owner platform_owner_pkey; Type: CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.platform_owner
    ADD CONSTRAINT platform_owner_pkey PRIMARY KEY (singleton);


--
-- Name: admin_change_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_change_league_idx ON public.admin_change_log USING btree (league_id, created_at DESC);


--
-- Name: automation_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_jobs_claim_idx ON public.automation_jobs USING btree (status, lease_until, created_at);


--
-- Name: automation_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_jobs_due_idx ON public.automation_jobs USING btree (lease_until, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text, 'running'::text]));


--
-- Name: automation_refresh_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_refresh_cycle_idx ON public.automation_jobs USING btree (refresh_cycle_id) WHERE (refresh_cycle_id IS NOT NULL);


--
-- Name: balance_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_events_actor_idx ON public.balance_events USING btree (actor_id);


--
-- Name: balance_events_team_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_events_team_date_idx ON public.balance_events USING btree (team_id, created_at DESC);


--
-- Name: cycle_future_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cycle_future_league_idx ON public.line_refresh_cycles USING btree (future_board, league_id) WHERE (future_board IS NOT NULL);


--
-- Name: cycle_weekly_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cycle_weekly_league_idx ON public.line_refresh_cycles USING btree (weekly_board, league_id) WHERE (weekly_board IS NOT NULL);


--
-- Name: email_deliveries_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_pending_idx ON public.email_deliveries USING btree (created_at) WHERE (status <> 'sent'::text);


--
-- Name: forecast_league_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forecast_league_season_idx ON public.forecast_snapshots USING btree (league_id, nfl_season, market_week, captured_at);


--
-- Name: line_refresh_active_slot_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX line_refresh_active_slot_key ON public.line_refresh_cycles USING btree (league_id, market_week, slot) WHERE ((status = ANY (ARRAY['staging'::text, 'published'::text, 'skipped'::text])) AND (NOT source_recovery));


--
-- Name: line_refresh_league_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX line_refresh_league_created_idx ON public.line_refresh_cycles USING btree (league_id, created_at DESC);


--
-- Name: live_forecast_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_forecast_week_idx ON public.live_forecast_runs USING btree (league_id, nfl_season, market_week, captured_at DESC);


--
-- Name: live_review_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_review_week_idx ON public.live_model_reviews USING btree (league_id, nfl_season, market_week, created_at DESC);


--
-- Name: memberships_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_league_idx ON public.league_memberships USING btree (league_id);


--
-- Name: memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_user_idx ON public.league_memberships USING btree (user_id, league_id);


--
-- Name: model_events_league; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_events_league ON public.model_change_events USING btree (league_id, created_at DESC);


--
-- Name: model_review_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_review_week ON public.model_weekly_reviews USING btree (league_id, nfl_season, market_week, created_at DESC);


--
-- Name: model_runs_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_runs_week ON public.model_forecast_runs USING btree (league_id, nfl_season, market_week, captured_at, id);


--
-- Name: outbound_email_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbound_email_claim_idx ON public.outbound_emails USING btree (status, lease_until, created_at);


--
-- Name: outbox_team_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_team_league_idx ON public.outbound_emails USING btree (team_id, league_id);


--
-- Name: outbox_ticket_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_ticket_scope_idx ON public.outbound_emails USING btree (ticket_id, league_id, team_id) WHERE (ticket_id IS NOT NULL);


--
-- Name: promo_claim_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_claim_user_idx ON public.promo_claims USING btree (league_id, user_id);


--
-- Name: promo_events_offer_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_events_offer_date_idx ON public.promo_events USING btree (league_id, offer_id, created_at DESC);


--
-- Name: promo_images_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_images_league_idx ON public.promo_images USING btree (league_id);


--
-- Name: promo_league_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_league_week_idx ON public.promo_offers USING btree (league_id, nfl_season, market_week);


--
-- Name: promo_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promo_slot_idx ON public.promo_offers USING btree (league_id, nfl_season, market_week, slot) WHERE (status = 'scheduled'::text);


--
-- Name: reopening_league_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reopening_league_created_idx ON public.sportsbook_reopening_reviews USING btree (league_id, created_at DESC);


--
-- Name: reopening_one_approved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reopening_one_approved_idx ON public.sportsbook_reopening_reviews USING btree (league_id) WHERE (status = 'approved'::text);


--
-- Name: sportsbook_boards_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sportsbook_boards_league_idx ON public.sportsbook_boards USING btree (league_id);


--
-- Name: sportsbook_future_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sportsbook_future_season_idx ON public.sportsbook_boards USING btree (league_id, nfl_season) WHERE (board_type = 'future'::text);


--
-- Name: sportsbook_markets_away_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sportsbook_markets_away_idx ON public.sportsbook_markets USING btree (away_team_id);


--
-- Name: sportsbook_markets_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sportsbook_markets_board_idx ON public.sportsbook_markets USING btree (board_id);


--
-- Name: sportsbook_markets_home_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sportsbook_markets_home_idx ON public.sportsbook_markets USING btree (home_team_id);


--
-- Name: sportsbook_markets_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sportsbook_markets_team_idx ON public.sportsbook_markets USING btree (team_id);


--
-- Name: ticket_legs_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_legs_quote_idx ON public.ticket_legs USING btree (market_quote_id);


--
-- Name: ticket_promotions_offer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_promotions_offer_idx ON public.ticket_promotions USING btree (offer_id, user_id);


--
-- Name: tickets_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_batch_idx ON public.tickets USING btree (source_batch);


--
-- Name: tickets_league_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_league_week_idx ON public.tickets USING btree (league_id, market_week);


--
-- Name: tickets_team_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_team_date_idx ON public.tickets USING btree (team_id, placed_at DESC);


--
-- Name: wallet_ledger_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_ledger_batch_idx ON public.wallet_ledger USING btree (source_batch);


--
-- Name: wallet_ledger_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_ledger_team_idx ON public.wallet_ledger USING btree (team_id, created_at);


--
-- Name: wallet_ledger_ticket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_ledger_ticket_idx ON public.wallet_ledger USING btree (ticket_id);


--
-- Name: weekly_runs_league_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weekly_runs_league_date_idx ON public.weekly_execution_runs USING btree (league_id, created_at DESC);


--
-- Name: sportsbook_boards activate_promos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER activate_promos AFTER INSERT OR UPDATE OF status ON public.sportsbook_boards FOR EACH ROW EXECUTE FUNCTION sportsbook_private.activate_promos();


--
-- Name: email_deliveries confirmation_delivery_bridge; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER confirmation_delivery_bridge AFTER UPDATE OF status ON public.email_deliveries FOR EACH ROW EXECUTE FUNCTION sportsbook_private.confirmation_delivered();


--
-- Name: ticket_legs extra_leg_validation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER extra_leg_validation BEFORE INSERT ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.validate_extra_leg();


--
-- Name: model_change_events immutable_model_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_model_history BEFORE DELETE OR UPDATE ON public.model_change_events FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: model_config_versions immutable_model_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_model_history BEFORE DELETE OR UPDATE ON public.model_config_versions FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: model_forecast_runs immutable_model_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_model_history BEFORE DELETE OR UPDATE ON public.model_forecast_runs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: model_outcome_revisions immutable_model_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_model_history BEFORE DELETE OR UPDATE ON public.model_outcome_revisions FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: model_weekly_reviews immutable_model_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_model_history BEFORE DELETE OR UPDATE ON public.model_weekly_reviews FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: leagues initialize_league_model; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER initialize_league_model AFTER INSERT ON public.leagues FOR EACH ROW EXECUTE FUNCTION sportsbook_private.initialize_model();


--
-- Name: live_forecast_runs keep_live_forecasts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER keep_live_forecasts BEFORE DELETE OR UPDATE ON public.live_forecast_runs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: live_model_reviews keep_live_reviews; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER keep_live_reviews BEFORE DELETE OR UPDATE ON public.live_model_reviews FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: forecast_snapshots keep_published_forecasts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER keep_published_forecasts BEFORE DELETE OR UPDATE ON public.forecast_snapshots FOR EACH ROW EXECUTE FUNCTION sportsbook_private.keep_forecast_history();


--
-- Name: ticket_legs label_weekly_special; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER label_weekly_special BEFORE INSERT ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.label_weekly_special();


--
-- Name: leagues live_league_activation_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER live_league_activation_guard BEFORE INSERT OR UPDATE OF operations_enabled ON public.leagues FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_live_league_activation();


--
-- Name: sportsbook_markets market_league_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER market_league_guard BEFORE INSERT OR UPDATE OF board_id, team_id, home_team_id, away_team_id ON public.sportsbook_markets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_market_league();


--
-- Name: ticket_legs no_win_total_push; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER no_win_total_push BEFORE INSERT OR UPDATE OF status ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.no_win_total_push();


--
-- Name: outbound_emails outbox_recipient_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outbox_recipient_guard BEFORE INSERT OR UPDATE OF league_id, team_id, ticket_id, recipient, payload ON public.outbound_emails FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_outbox_recipient();


--
-- Name: league_memberships platform_owner_identity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER platform_owner_identity_guard BEFORE UPDATE OF invited_email, role, league_id, team_id, user_id ON public.league_memberships FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_platform_owner_identity();


--
-- Name: ticket_legs preserve_accepted_leg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER preserve_accepted_leg BEFORE UPDATE ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.preserve_accepted_terms();


--
-- Name: tickets preserve_accepted_ticket; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER preserve_accepted_ticket BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.preserve_accepted_terms();


--
-- Name: promo_events promo_event_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER promo_event_immutable BEFORE DELETE OR UPDATE ON public.promo_events FOR EACH ROW EXECUTE FUNCTION sportsbook_private.promo_snapshot_immutable();


--
-- Name: ticket_promotions promo_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER promo_snapshot_immutable BEFORE DELETE OR UPDATE ON public.ticket_promotions FOR EACH ROW EXECUTE FUNCTION sportsbook_private.promo_snapshot_immutable();


--
-- Name: tickets promo_void_restore; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER promo_void_restore AFTER UPDATE OF status ON public.tickets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.promo_void_restore();


--
-- Name: ticket_legs reject_locked_quote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reject_locked_quote BEFORE INSERT ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.reject_locked_quote();


--
-- Name: line_refresh_cycles release_refresh_sources; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_refresh_sources AFTER UPDATE OF status ON public.line_refresh_cycles FOR EACH ROW EXECUTE FUNCTION sportsbook_private.release_refresh_sources();


--
-- Name: league_result_weeks report_league_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER report_league_guard BEFORE INSERT OR UPDATE OF league_id, results ON public.league_result_weeks FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_report_league();


--
-- Name: sportsbook_markets round_market_odds; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER round_market_odds BEFORE INSERT OR UPDATE OF odds, kind ON public.sportsbook_markets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.round_market_odds();


--
-- Name: weekly_schedule schedule_rollout_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER schedule_rollout_guard BEFORE INSERT OR UPDATE OF automation_enabled, league_id ON public.weekly_schedule FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_league_rollout();


--
-- Name: email_deliveries ticket_confirmation_outbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ticket_confirmation_outbox AFTER INSERT ON public.email_deliveries FOR EACH ROW EXECUTE FUNCTION sportsbook_private.queue_confirmation();


--
-- Name: tickets ticket_rollout_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ticket_rollout_guard BEFORE INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_ticket_rollout();


--
-- Name: ticket_legs zz_label_future_leg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_label_future_leg BEFORE INSERT ON public.ticket_legs FOR EACH ROW EXECUTE FUNCTION public.label_future_leg();


--
-- Name: league_launch_approvals launch_approval_owner_guard; Type: TRIGGER; Schema: sportsbook_private; Owner: -
--

CREATE TRIGGER launch_approval_owner_guard BEFORE INSERT OR UPDATE ON sportsbook_private.league_launch_approvals FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_launch_approval();


--
-- Name: admin_change_log admin_change_log_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_change_log
    ADD CONSTRAINT admin_change_log_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: admin_exception_reviews admin_exception_reviews_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_exception_reviews
    ADD CONSTRAINT admin_exception_reviews_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: automation_jobs automation_jobs_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: automation_jobs automation_jobs_refresh_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_refresh_cycle_id_fkey FOREIGN KEY (refresh_cycle_id) REFERENCES public.line_refresh_cycles(id);


--
-- Name: balance_events balance_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_events
    ADD CONSTRAINT balance_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);


--
-- Name: balance_events balance_events_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_events
    ADD CONSTRAINT balance_events_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.wallets(team_id);


--
-- Name: line_refresh_cycles cycle_future_league_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT cycle_future_league_fk FOREIGN KEY (future_board, league_id) REFERENCES public.sportsbook_boards(id, league_id);


--
-- Name: line_refresh_cycles cycle_weekly_league_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT cycle_weekly_league_fk FOREIGN KEY (weekly_board, league_id) REFERENCES public.sportsbook_boards(id, league_id);


--
-- Name: email_deliveries email_deliveries_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);


--
-- Name: forecast_snapshots forecast_board_league_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_snapshots
    ADD CONSTRAINT forecast_board_league_fk FOREIGN KEY (board_id, league_id) REFERENCES public.sportsbook_boards(id, league_id);


--
-- Name: forecast_snapshots forecast_snapshots_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_snapshots
    ADD CONSTRAINT forecast_snapshots_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.sportsbook_boards(id);


--
-- Name: forecast_snapshots forecast_snapshots_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_snapshots
    ADD CONSTRAINT forecast_snapshots_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: automation_jobs job_cycle_league_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT job_cycle_league_fk FOREIGN KEY (refresh_cycle_id, league_id) REFERENCES public.line_refresh_cycles(id, league_id);


--
-- Name: league_memberships league_memberships_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: league_memberships league_memberships_team_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_team_id_league_id_fkey FOREIGN KEY (team_id, league_id) REFERENCES public.teams(id, league_id);


--
-- Name: league_memberships league_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_memberships
    ADD CONSTRAINT league_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: league_result_weeks league_result_weeks_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_result_weeks
    ADD CONSTRAINT league_result_weeks_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: wallet_ledger ledger_ticket_team_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT ledger_ticket_team_fk FOREIGN KEY (ticket_id, team_id) REFERENCES public.tickets(id, team_id);


--
-- Name: line_refresh_cycles line_refresh_cycles_future_board_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT line_refresh_cycles_future_board_fkey FOREIGN KEY (future_board) REFERENCES public.sportsbook_boards(id);


--
-- Name: line_refresh_cycles line_refresh_cycles_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT line_refresh_cycles_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: line_refresh_cycles line_refresh_cycles_weekly_board_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_cycles
    ADD CONSTRAINT line_refresh_cycles_weekly_board_fkey FOREIGN KEY (weekly_board) REFERENCES public.sportsbook_boards(id);


--
-- Name: line_refresh_runtime line_refresh_runtime_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_runtime
    ADD CONSTRAINT line_refresh_runtime_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: line_refresh_sources line_refresh_sources_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_sources
    ADD CONSTRAINT line_refresh_sources_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.line_refresh_cycles(id);


--
-- Name: line_refresh_stages line_refresh_stages_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_refresh_stages
    ADD CONSTRAINT line_refresh_stages_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.line_refresh_cycles(id);


--
-- Name: live_forecast_runs live_forecast_runs_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_forecast_runs
    ADD CONSTRAINT live_forecast_runs_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.line_refresh_cycles(id);


--
-- Name: live_forecast_runs live_forecast_runs_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_forecast_runs
    ADD CONSTRAINT live_forecast_runs_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: live_model_reviews live_model_reviews_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_model_reviews
    ADD CONSTRAINT live_model_reviews_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_change_events model_change_events_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_change_events
    ADD CONSTRAINT model_change_events_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_change_events model_change_events_league_id_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_change_events
    ADD CONSTRAINT model_change_events_league_id_from_id_fkey FOREIGN KEY (league_id, from_id) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_change_events model_change_events_league_id_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_change_events
    ADD CONSTRAINT model_change_events_league_id_review_id_fkey FOREIGN KEY (league_id, review_id) REFERENCES public.model_weekly_reviews(league_id, id);


--
-- Name: model_change_events model_change_events_league_id_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_change_events
    ADD CONSTRAINT model_change_events_league_id_to_id_fkey FOREIGN KEY (league_id, to_id) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_config_versions model_config_versions_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_config_versions
    ADD CONSTRAINT model_config_versions_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_config_versions model_config_versions_league_id_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_config_versions
    ADD CONSTRAINT model_config_versions_league_id_parent_id_fkey FOREIGN KEY (league_id, parent_id) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_controls model_controls_league_id_active_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_controls
    ADD CONSTRAINT model_controls_league_id_active_id_fkey FOREIGN KEY (league_id, active_id) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_controls model_controls_league_id_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_controls
    ADD CONSTRAINT model_controls_league_id_baseline_id_fkey FOREIGN KEY (league_id, baseline_id) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_controls model_controls_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_controls
    ADD CONSTRAINT model_controls_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_forecast_runs model_forecast_runs_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_forecast_runs
    ADD CONSTRAINT model_forecast_runs_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_forecast_runs model_forecast_runs_league_id_model_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_forecast_runs
    ADD CONSTRAINT model_forecast_runs_league_id_model_version_fkey FOREIGN KEY (league_id, model_version) REFERENCES public.model_config_versions(league_id, id);


--
-- Name: model_outcome_revisions model_outcome_revisions_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_outcome_revisions
    ADD CONSTRAINT model_outcome_revisions_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_weekly_reviews model_weekly_reviews_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_weekly_reviews
    ADD CONSTRAINT model_weekly_reviews_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: model_weekly_reviews model_weekly_reviews_league_id_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_weekly_reviews
    ADD CONSTRAINT model_weekly_reviews_league_id_outcome_id_fkey FOREIGN KEY (league_id, outcome_id) REFERENCES public.model_outcome_revisions(league_id, id);


--
-- Name: outbound_emails outbound_emails_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: outbound_emails outbound_emails_reopening_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_reopening_id_fkey FOREIGN KEY (reopening_id) REFERENCES public.sportsbook_reopening_reviews(id);


--
-- Name: outbound_emails outbound_emails_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: outbound_emails outbound_emails_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbound_emails_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);


--
-- Name: outbound_emails outbox_team_league_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbox_team_league_fk FOREIGN KEY (team_id, league_id) REFERENCES public.teams(id, league_id);


--
-- Name: outbound_emails outbox_ticket_league_team_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_emails
    ADD CONSTRAINT outbox_ticket_league_team_fk FOREIGN KEY (ticket_id, league_id, team_id) REFERENCES public.tickets(id, league_id, team_id);


--
-- Name: promo_claims promo_claims_offer_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_claims
    ADD CONSTRAINT promo_claims_offer_id_league_id_fkey FOREIGN KEY (offer_id, league_id) REFERENCES public.promo_offers(id, league_id);


--
-- Name: promo_claims promo_claims_used_ticket_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_claims
    ADD CONSTRAINT promo_claims_used_ticket_fkey FOREIGN KEY (used_ticket) REFERENCES public.tickets(id);


--
-- Name: promo_events promo_events_offer_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_events
    ADD CONSTRAINT promo_events_offer_id_league_id_fkey FOREIGN KEY (offer_id, league_id) REFERENCES public.promo_offers(id, league_id);


--
-- Name: promo_events promo_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_events
    ADD CONSTRAINT promo_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);


--
-- Name: promo_images promo_images_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_images
    ADD CONSTRAINT promo_images_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: promo_offers promo_offers_image_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_offers
    ADD CONSTRAINT promo_offers_image_id_league_id_fkey FOREIGN KEY (image_id, league_id) REFERENCES public.promo_images(id, league_id);


--
-- Name: promo_offers promo_offers_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_offers
    ADD CONSTRAINT promo_offers_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: sportsbook_boards sportsbook_boards_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_boards
    ADD CONSTRAINT sportsbook_boards_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: sportsbook_boards sportsbook_boards_reopening_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_boards
    ADD CONSTRAINT sportsbook_boards_reopening_id_fkey FOREIGN KEY (reopening_id) REFERENCES public.sportsbook_reopening_reviews(id);


--
-- Name: sportsbook_markets sportsbook_markets_away_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id);


--
-- Name: sportsbook_markets sportsbook_markets_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.sportsbook_boards(id);


--
-- Name: sportsbook_markets sportsbook_markets_home_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id);


--
-- Name: sportsbook_markets sportsbook_markets_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_markets
    ADD CONSTRAINT sportsbook_markets_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: sportsbook_reopening_reviews sportsbook_reopening_reviews_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_reopening_reviews
    ADD CONSTRAINT sportsbook_reopening_reviews_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);


--
-- Name: sportsbook_reopening_reviews sportsbook_reopening_reviews_future_board_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_reopening_reviews
    ADD CONSTRAINT sportsbook_reopening_reviews_future_board_fkey FOREIGN KEY (future_board) REFERENCES public.sportsbook_boards(id);


--
-- Name: sportsbook_reopening_reviews sportsbook_reopening_reviews_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_reopening_reviews
    ADD CONSTRAINT sportsbook_reopening_reviews_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: sportsbook_reopening_reviews sportsbook_reopening_reviews_weekly_board_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbook_reopening_reviews
    ADD CONSTRAINT sportsbook_reopening_reviews_weekly_board_fkey FOREIGN KEY (weekly_board) REFERENCES public.sportsbook_boards(id);


--
-- Name: teams teams_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: ticket_legs ticket_legs_market_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_legs
    ADD CONSTRAINT ticket_legs_market_quote_id_fkey FOREIGN KEY (market_quote_id) REFERENCES public.sportsbook_markets(id);


--
-- Name: ticket_legs ticket_legs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_legs
    ADD CONSTRAINT ticket_legs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);


--
-- Name: ticket_promotions ticket_promotions_offer_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_promotions
    ADD CONSTRAINT ticket_promotions_offer_id_league_id_fkey FOREIGN KEY (offer_id, league_id) REFERENCES public.promo_offers(id, league_id);


--
-- Name: ticket_promotions ticket_promotions_ticket_id_league_id_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_promotions
    ADD CONSTRAINT ticket_promotions_ticket_id_league_id_team_id_fkey FOREIGN KEY (ticket_id, league_id, team_id) REFERENCES public.tickets(id, league_id, team_id);


--
-- Name: ticket_score_observations ticket_score_observations_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_score_observations
    ADD CONSTRAINT ticket_score_observations_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: tickets tickets_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: tickets tickets_source_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_source_batch_fkey FOREIGN KEY (source_batch) REFERENCES sportsbook_private.import_batches(id);


--
-- Name: tickets tickets_team_id_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_team_id_league_id_fkey FOREIGN KEY (team_id, league_id) REFERENCES public.teams(id, league_id);


--
-- Name: wallet_ledger wallet_ledger_source_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_source_batch_fkey FOREIGN KEY (source_batch) REFERENCES sportsbook_private.import_batches(id);


--
-- Name: wallet_ledger wallet_ledger_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.wallets(team_id);


--
-- Name: wallet_ledger wallet_ledger_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);


--
-- Name: wallets wallets_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: weekly_execution_runs weekly_execution_runs_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_execution_runs
    ADD CONSTRAINT weekly_execution_runs_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: weekly_schedule weekly_schedule_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_schedule
    ADD CONSTRAINT weekly_schedule_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: league_launch_approvals league_launch_approvals_league_id_fkey; Type: FK CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.league_launch_approvals
    ADD CONSTRAINT league_launch_approvals_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: league_launch_approvals league_launch_approvals_owner_membership_id_fkey; Type: FK CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.league_launch_approvals
    ADD CONSTRAINT league_launch_approvals_owner_membership_id_fkey FOREIGN KEY (owner_membership_id) REFERENCES sportsbook_private.platform_owner(membership_id);


--
-- Name: platform_owner platform_owner_membership_id_fkey; Type: FK CONSTRAINT; Schema: sportsbook_private; Owner: -
--

ALTER TABLE ONLY sportsbook_private.platform_owner
    ADD CONSTRAINT platform_owner_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.league_memberships(id);


--
-- Name: admin_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_change_log admin_change_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_change_read ON public.admin_change_log FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: admin_exception_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_exception_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_jobs automation_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_admin_read ON public.automation_jobs FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: automation_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_events balance_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY balance_events_read ON public.balance_events FOR SELECT TO authenticated USING (sportsbook_private.can_view_wallet(team_id));


--
-- Name: sportsbook_boards board_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_read ON public.sportsbook_boards FOR SELECT TO authenticated USING ((sportsbook_private.is_member(league_id) AND ((status <> 'draft'::text) OR sportsbook_private.is_admin(league_id))));


--
-- Name: email_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_exception_reviews exception_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY exception_admin_read ON public.admin_exception_reviews FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: forecast_snapshots forecast_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY forecast_admin_read ON public.forecast_snapshots FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: forecast_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forecast_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: league_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: league_result_weeks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_result_weeks ENABLE ROW LEVEL SECURITY;

--
-- Name: leagues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

--
-- Name: leagues leagues_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leagues_read ON public.leagues FOR SELECT TO authenticated USING (sportsbook_private.is_member(id));


--
-- Name: line_refresh_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_refresh_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: line_refresh_runtime; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_refresh_runtime ENABLE ROW LEVEL SECURITY;

--
-- Name: line_refresh_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_refresh_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: line_refresh_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_refresh_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: live_forecast_runs live_forecast_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY live_forecast_admin_read ON public.live_forecast_runs FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: live_forecast_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.live_forecast_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: live_model_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.live_model_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: live_model_reviews live_review_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY live_review_admin_read ON public.live_model_reviews FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: sportsbook_markets market_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_read ON public.sportsbook_markets FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.sportsbook_boards b
  WHERE (b.id = sportsbook_markets.board_id))));


--
-- Name: league_memberships memberships_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_read ON public.league_memberships FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR sportsbook_private.is_admin(league_id)));


--
-- Name: model_change_events model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_change_events FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_config_versions model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_config_versions FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_controls model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_controls FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_forecast_runs model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_forecast_runs FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_outcome_revisions model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_outcome_revisions FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_weekly_reviews model_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY model_admin_read ON public.model_weekly_reviews FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: model_change_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_change_events ENABLE ROW LEVEL SECURITY;

--
-- Name: model_config_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_config_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: model_controls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_controls ENABLE ROW LEVEL SECURITY;

--
-- Name: model_forecast_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_forecast_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: model_outcome_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_outcome_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: model_weekly_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_weekly_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: outbound_emails outbound_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbound_admin_read ON public.outbound_emails FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: outbound_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbound_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_offers promo_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_admin_read ON public.promo_offers FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: promo_claims promo_claim_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_claim_read ON public.promo_claims FOR SELECT TO authenticated USING ((sportsbook_private.is_member(league_id) AND ((user_id = ( SELECT auth.uid() AS uid)) OR sportsbook_private.is_admin(league_id))));


--
-- Name: promo_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_events ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_events promo_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_events_read ON public.promo_events FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: promo_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_images ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: line_refresh_cycles refresh_cycle_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_cycle_read ON public.line_refresh_cycles FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: line_refresh_runtime refresh_runtime_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_runtime_read ON public.line_refresh_runtime FOR SELECT TO authenticated USING (sportsbook_private.is_member(league_id));


--
-- Name: sportsbook_reopening_reviews reopening_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reopening_admin_read ON public.sportsbook_reopening_reviews FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: league_result_weeks results_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY results_admin_read ON public.league_result_weeks FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: weekly_execution_runs runs_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY runs_admin_read ON public.weekly_execution_runs FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: weekly_schedule schedule_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_admin_read ON public.weekly_schedule FOR SELECT TO authenticated USING (sportsbook_private.is_admin(league_id));


--
-- Name: sportsbook_boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sportsbook_boards ENABLE ROW LEVEL SECURITY;

--
-- Name: sportsbook_markets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sportsbook_markets ENABLE ROW LEVEL SECURITY;

--
-- Name: sportsbook_reopening_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sportsbook_reopening_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: teams teams_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teams_read ON public.teams FOR SELECT TO authenticated USING (sportsbook_private.is_member(league_id));


--
-- Name: ticket_legs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ticket_legs ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_legs ticket_legs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ticket_legs_read ON public.ticket_legs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.tickets t
  WHERE (t.id = ticket_legs.ticket_id))));


--
-- Name: ticket_score_observations ticket_observations_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ticket_observations_member_read ON public.ticket_score_observations FOR SELECT TO authenticated USING (sportsbook_private.is_member(league_id));


--
-- Name: ticket_promotions ticket_promo_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ticket_promo_read ON public.ticket_promotions FOR SELECT TO authenticated USING (sportsbook_private.is_member(league_id));


--
-- Name: ticket_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ticket_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_score_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ticket_score_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets tickets_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tickets_read ON public.tickets FOR SELECT TO authenticated USING (sportsbook_private.is_member(league_id));


--
-- Name: wallet_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_ledger wallet_ledger_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wallet_ledger_read ON public.wallet_ledger FOR SELECT TO authenticated USING (sportsbook_private.can_view_wallet(team_id));


--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wallets_read ON public.wallets FOR SELECT TO authenticated USING (sportsbook_private.can_view_wallet(team_id));


--
-- Name: weekly_execution_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_execution_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches; Type: ROW SECURITY; Schema: sportsbook_private; Owner: -
--

ALTER TABLE sportsbook_private.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: league_launch_approvals; Type: ROW SECURITY; Schema: sportsbook_private; Owner: -
--

ALTER TABLE sportsbook_private.league_launch_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_owner; Type: ROW SECURITY; Schema: sportsbook_private; Owner: -
--

ALTER TABLE sportsbook_private.platform_owner ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;


--
-- Name: SCHEMA sportsbook_private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA sportsbook_private TO authenticated;


--
-- Name: FUNCTION activate_reopening_review(p_review uuid, p_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activate_reopening_review(p_review uuid, p_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_reopening_review(p_review uuid, p_hash text) TO authenticated;


--
-- Name: FUNCTION approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) TO authenticated;


--
-- Name: TABLE automation_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.automation_jobs TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.automation_jobs TO service_role;


--
-- Name: FUNCTION claim_automation_job(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_automation_job() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_automation_job() TO service_role;


--
-- Name: FUNCTION claim_memberships(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_memberships() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_memberships() TO authenticated;


--
-- Name: TABLE outbound_emails; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.outbound_emails TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.outbound_emails TO service_role;


--
-- Name: FUNCTION claim_outbound_emails(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_outbound_emails() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_outbound_emails() TO service_role;


--
-- Name: FUNCTION claim_promo(p_offer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_promo(p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_promo(p_offer uuid) TO authenticated;


--
-- Name: FUNCTION claim_scoped_outbound_emails(p_ticket uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_scoped_outbound_emails(p_ticket uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_scoped_outbound_emails(p_ticket uuid) TO service_role;


--
-- Name: FUNCTION configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) TO authenticated;


--
-- Name: FUNCTION configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) TO authenticated;


--
-- Name: FUNCTION confirm_scheduled_publication(p_board uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_scheduled_publication(p_board uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_scheduled_publication(p_board uuid) TO service_role;


--
-- Name: FUNCTION control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) TO authenticated;
GRANT ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) TO service_role;


--
-- Name: FUNCTION label_future_leg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.label_future_leg() FROM PUBLIC;


--
-- Name: FUNCTION league_leaderboard(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.league_leaderboard(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.league_leaderboard(p_league uuid) TO authenticated;


--
-- Name: FUNCTION list_promos(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_promos(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_promos(p_league uuid) TO authenticated;


--
-- Name: FUNCTION observe_line_refresh(p_status jsonb, p_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.observe_line_refresh(p_status jsonb, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.observe_line_refresh(p_status jsonb, p_error text) TO service_role;


--
-- Name: FUNCTION pause_promo(p_offer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pause_promo(p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pause_promo(p_offer uuid) TO authenticated;


--
-- Name: FUNCTION place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) TO authenticated;


--
-- Name: FUNCTION place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) TO authenticated;


--
-- Name: FUNCTION place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) TO authenticated;


--
-- Name: FUNCTION promo_usage(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.promo_usage(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.promo_usage(p_league uuid) TO authenticated;


--
-- Name: FUNCTION queue_reopening_announcement(p_review uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.queue_reopening_announcement(p_review uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_reopening_announcement(p_review uuid) TO authenticated;


--
-- Name: FUNCTION read_promo_image(p_image uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.read_promo_image(p_image uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_promo_image(p_image uuid) TO authenticated;


--
-- Name: FUNCTION replenish_weekly_balances(p_league uuid, p_season integer, p_week integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) TO authenticated;


--
-- Name: FUNCTION resolve_future_markets(p_league uuid, p_kinds text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_future_markets(p_league uuid, p_kinds text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_future_markets(p_league uuid, p_kinds text[]) TO authenticated;


--
-- Name: FUNCTION review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) TO authenticated;


--
-- Name: FUNCTION round_future_odds(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.round_future_odds() FROM PUBLIC;


--
-- Name: FUNCTION save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text) TO authenticated;


--
-- Name: FUNCTION save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) TO authenticated;


--
-- Name: FUNCTION save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) TO service_role;


--
-- Name: FUNCTION save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) TO service_role;


--
-- Name: FUNCTION save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text) TO authenticated;


--
-- Name: FUNCTION save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) TO service_role;


--
-- Name: FUNCTION save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) TO authenticated;


--
-- Name: FUNCTION save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) TO authenticated;


--
-- Name: FUNCTION set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) TO authenticated;


--
-- Name: FUNCTION set_weekly_automation(p_league uuid, p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_weekly_automation(p_league uuid, p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_weekly_automation(p_league uuid, p_enabled boolean) TO authenticated;


--
-- Name: FUNCTION settle_weekly_ticket(p_ticket uuid, p_results jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) TO authenticated;


--
-- Name: FUNCTION sportsbook_current_snapshot(p_league uuid, p_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sportsbook_current_snapshot(p_league uuid, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_current_snapshot(p_league uuid, p_type text) TO authenticated;


--
-- Name: FUNCTION sportsbook_period(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sportsbook_period(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO anon;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO service_role;


--
-- Name: FUNCTION sportsbook_quote_snapshot(p_board uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sportsbook_quote_snapshot(p_board uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_quote_snapshot(p_board uuid) TO authenticated;


--
-- Name: FUNCTION sportsbook_readiness(p_league uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sportsbook_readiness(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_readiness(p_league uuid) TO authenticated;


--
-- Name: TABLE sportsbook_markets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sportsbook_markets TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_markets TO service_role;


--
-- Name: FUNCTION sportsbook_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sportsbook_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) FROM PUBLIC;


--
-- Name: FUNCTION stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) TO service_role;


--
-- Name: FUNCTION stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) TO service_role;


--
-- Name: FUNCTION store_promo_image(p_league uuid, p_user uuid, p_png text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.store_promo_image(p_league uuid, p_user uuid, p_png text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_promo_image(p_league uuid, p_user uuid, p_png text) TO service_role;


--
-- Name: FUNCTION void_sportsbook_ticket(p_ticket uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.void_sportsbook_ticket(p_ticket uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_sportsbook_ticket(p_ticket uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION worker_operation(p_league uuid, p_operation text, p_args jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_operation(p_league uuid, p_operation text, p_args jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_operation(p_league uuid, p_operation text, p_args jsonb) TO service_role;


--
-- Name: FUNCTION activate_promos(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.activate_promos() FROM PUBLIC;


--
-- Name: FUNCTION active_reopening(p_league uuid, p_week integer); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.active_reopening(p_league uuid, p_week integer) FROM PUBLIC;


--
-- Name: FUNCTION can_view_wallet(p_team uuid); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.can_view_wallet(p_team uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.can_view_wallet(p_team uuid) TO authenticated;


--
-- Name: FUNCTION capture_forecast(p_board uuid); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.capture_forecast(p_board uuid) FROM PUBLIC;


--
-- Name: FUNCTION confirmation_delivered(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.confirmation_delivered() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_weekly_jobs(p_now timestamp with time zone); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.enqueue_weekly_jobs(p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION guard_launch_approval(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_launch_approval() FROM PUBLIC;


--
-- Name: FUNCTION guard_league_rollout(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_league_rollout() FROM PUBLIC;


--
-- Name: FUNCTION guard_live_league_activation(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_live_league_activation() FROM PUBLIC;


--
-- Name: FUNCTION guard_market_league(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_market_league() FROM PUBLIC;


--
-- Name: FUNCTION guard_outbox_recipient(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_outbox_recipient() FROM PUBLIC;


--
-- Name: FUNCTION guard_platform_owner_identity(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_platform_owner_identity() FROM PUBLIC;


--
-- Name: FUNCTION guard_report_league(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_report_league() FROM PUBLIC;


--
-- Name: FUNCTION guard_ticket_rollout(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.guard_ticket_rollout() FROM PUBLIC;


--
-- Name: FUNCTION initialize_model(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.initialize_model() FROM PUBLIC;


--
-- Name: FUNCTION is_admin(p_league uuid); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.is_admin(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.is_admin(p_league uuid) TO authenticated;


--
-- Name: FUNCTION is_member(p_league uuid); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.is_member(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.is_member(p_league uuid) TO authenticated;


--
-- Name: FUNCTION keep_forecast_history(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.keep_forecast_history() FROM PUBLIC;


--
-- Name: FUNCTION label_weekly_special(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.label_weekly_special() FROM PUBLIC;


--
-- Name: FUNCTION maintain_reopenings(p_league uuid, p_week integer); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.maintain_reopenings(p_league uuid, p_week integer) FROM PUBLIC;


--
-- Name: FUNCTION member_quote_metadata(p_metadata jsonb); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.member_quote_metadata(p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION more_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.more_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) FROM PUBLIC;


--
-- Name: FUNCTION no_win_total_push(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.no_win_total_push() FROM PUBLIC;


--
-- Name: FUNCTION preserve_accepted_terms(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.preserve_accepted_terms() FROM PUBLIC;


--
-- Name: TABLE promo_offers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.promo_offers TO authenticated;


--
-- Name: FUNCTION promo_available(o public.promo_offers); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.promo_available(o public.promo_offers) FROM PUBLIC;


--
-- Name: FUNCTION promo_snapshot_immutable(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.promo_snapshot_immutable() FROM PUBLIC;


--
-- Name: FUNCTION promo_void_restore(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.promo_void_restore() FROM PUBLIC;


--
-- Name: FUNCTION reject_locked_quote(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.reject_locked_quote() FROM PUBLIC;


--
-- Name: FUNCTION release_refresh_sources(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.release_refresh_sources() FROM PUBLIC;


--
-- Name: FUNCTION round_market_odds(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.round_market_odds() FROM PUBLIC;


--
-- Name: FUNCTION round_special_odds(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.round_special_odds() FROM PUBLIC;


--
-- Name: TABLE sportsbook_boards; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sportsbook_boards TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_boards TO service_role;


--
-- Name: COLUMN sportsbook_boards.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.sportsbook_boards TO service_role;


--
-- Name: FUNCTION valid_reopening(p_board public.sportsbook_boards, p_picks uuid[]); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.valid_reopening(p_board public.sportsbook_boards, p_picks uuid[]) FROM PUBLIC;


--
-- Name: FUNCTION validate_boost(p_offer uuid, p_board uuid, p_picks uuid[], p_stake numeric); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.validate_boost(p_offer uuid, p_board uuid, p_picks uuid[], p_stake numeric) FROM PUBLIC;


--
-- Name: FUNCTION validate_extra_leg(); Type: ACL; Schema: sportsbook_private; Owner: -
--

REVOKE ALL ON FUNCTION sportsbook_private.validate_extra_leg() FROM PUBLIC;


--
-- Name: TABLE admin_change_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.admin_change_log TO authenticated;


--
-- Name: TABLE admin_exception_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.admin_exception_reviews TO authenticated;


--
-- Name: TABLE balance_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.balance_events TO authenticated;


--
-- Name: TABLE email_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.email_deliveries TO service_role;


--
-- Name: TABLE forecast_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.forecast_snapshots TO authenticated;
GRANT SELECT ON TABLE public.forecast_snapshots TO service_role;


--
-- Name: TABLE league_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.league_memberships TO authenticated;
GRANT SELECT ON TABLE public.league_memberships TO service_role;


--
-- Name: TABLE league_result_weeks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.league_result_weeks TO authenticated;
GRANT SELECT ON TABLE public.league_result_weeks TO service_role;


--
-- Name: TABLE leagues; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.leagues TO authenticated;
GRANT SELECT ON TABLE public.leagues TO service_role;


--
-- Name: COLUMN leagues.sportsbook_url; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(sportsbook_url) ON TABLE public.leagues TO service_role;


--
-- Name: COLUMN leagues.email_sender; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(email_sender) ON TABLE public.leagues TO service_role;


--
-- Name: COLUMN leagues.operations_enabled; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(operations_enabled) ON TABLE public.leagues TO service_role;


--
-- Name: TABLE line_refresh_cycles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.line_refresh_cycles TO authenticated;
GRANT SELECT ON TABLE public.line_refresh_cycles TO service_role;


--
-- Name: TABLE line_refresh_runtime; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.line_refresh_runtime TO authenticated;
GRANT SELECT ON TABLE public.line_refresh_runtime TO service_role;


--
-- Name: TABLE line_refresh_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.line_refresh_sources TO service_role;


--
-- Name: TABLE line_refresh_stages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.line_refresh_stages TO service_role;


--
-- Name: TABLE live_forecast_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.live_forecast_runs TO authenticated;
GRANT SELECT ON TABLE public.live_forecast_runs TO service_role;


--
-- Name: TABLE live_model_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.live_model_reviews TO authenticated;
GRANT SELECT ON TABLE public.live_model_reviews TO service_role;


--
-- Name: TABLE model_change_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_change_events TO authenticated;
GRANT SELECT ON TABLE public.model_change_events TO service_role;


--
-- Name: TABLE model_config_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_config_versions TO authenticated;
GRANT SELECT ON TABLE public.model_config_versions TO service_role;


--
-- Name: TABLE model_controls; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_controls TO authenticated;
GRANT SELECT ON TABLE public.model_controls TO service_role;


--
-- Name: TABLE model_forecast_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_forecast_runs TO authenticated;
GRANT SELECT ON TABLE public.model_forecast_runs TO service_role;


--
-- Name: TABLE model_outcome_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_outcome_revisions TO authenticated;
GRANT SELECT ON TABLE public.model_outcome_revisions TO service_role;


--
-- Name: TABLE model_weekly_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.model_weekly_reviews TO authenticated;
GRANT SELECT ON TABLE public.model_weekly_reviews TO service_role;


--
-- Name: TABLE promo_claims; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.promo_claims TO authenticated;


--
-- Name: TABLE promo_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.promo_events TO authenticated;


--
-- Name: TABLE sportsbook_reopening_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sportsbook_reopening_reviews TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_reopening_reviews TO service_role;


--
-- Name: TABLE sportsbook_report_forecast_details; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sportsbook_report_forecast_details TO authenticated;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.teams TO authenticated;
GRANT SELECT ON TABLE public.teams TO service_role;


--
-- Name: COLUMN teams.wins; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(wins) ON TABLE public.teams TO service_role;


--
-- Name: COLUMN teams.losses; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(losses) ON TABLE public.teams TO service_role;


--
-- Name: COLUMN teams.ties; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(ties) ON TABLE public.teams TO service_role;


--
-- Name: TABLE ticket_legs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.ticket_legs TO authenticated;
GRANT SELECT ON TABLE public.ticket_legs TO service_role;


--
-- Name: TABLE ticket_promotions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.ticket_promotions TO authenticated;


--
-- Name: TABLE ticket_score_observations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.ticket_score_observations TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.ticket_score_observations TO service_role;


--
-- Name: TABLE tickets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.tickets TO authenticated;
GRANT SELECT ON TABLE public.tickets TO service_role;


--
-- Name: TABLE wallet_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.wallet_ledger TO authenticated;
GRANT SELECT ON TABLE public.wallet_ledger TO service_role;


--
-- Name: TABLE wallets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT SELECT ON TABLE public.wallets TO service_role;


--
-- Name: TABLE weekly_execution_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.weekly_execution_runs TO authenticated;
GRANT SELECT ON TABLE public.weekly_execution_runs TO service_role;


--
-- Name: TABLE weekly_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.weekly_schedule TO authenticated;
GRANT SELECT ON TABLE public.weekly_schedule TO service_role;


--
-- PostgreSQL database dump complete
--



-- Explicit application ACL baseline for hosted Supabase defaults.
alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated,service_role;
set search_path=public;
revoke all on table public.balance_events from public,anon,authenticated,service_role;
revoke all on table public.teams from public,anon,authenticated,service_role;
revoke all on table public.league_memberships from public,anon,authenticated,service_role;
revoke all on table sportsbook_private.import_batches from public,anon,authenticated,service_role;
revoke all on table public.leagues from public,anon,authenticated,service_role;
revoke all on table public.tickets from public,anon,authenticated,service_role;
revoke all on table public.ticket_legs from public,anon,authenticated,service_role;
revoke all on table public.sportsbook_markets from public,anon,authenticated,service_role;
revoke all on table public.sportsbook_boards from public,anon,authenticated,service_role;
revoke all on table public.email_deliveries from public,anon,authenticated,service_role;
revoke all on table public.outbound_emails from public,anon,authenticated,service_role;
revoke all on table public.automation_jobs from public,anon,authenticated,service_role;
revoke all on table public.wallets from public,anon,authenticated,service_role;
revoke all on table public.wallet_ledger from public,anon,authenticated,service_role;
revoke all on table public.weekly_execution_runs from public,anon,authenticated,service_role;
revoke all on table public.weekly_schedule from public,anon,authenticated,service_role;
revoke all on table public.forecast_snapshots from public,anon,authenticated,service_role;
revoke all on table public.admin_exception_reviews from public,anon,authenticated,service_role;
revoke all on table public.league_result_weeks from public,anon,authenticated,service_role;
revoke all on table public.admin_change_log from public,anon,authenticated,service_role;
revoke all on table public.line_refresh_sources from public,anon,authenticated,service_role;
revoke all on table public.live_forecast_runs from public,anon,authenticated,service_role;
revoke all on table public.line_refresh_runtime from public,anon,authenticated,service_role;
revoke all on table public.line_refresh_stages from public,anon,authenticated,service_role;
revoke all on table public.line_refresh_cycles from public,anon,authenticated,service_role;
revoke all on table public.live_model_reviews from public,anon,authenticated,service_role;
revoke all on sequence public.model_change_events_id_seq from public,anon,authenticated,service_role;
revoke all on table sportsbook_private.platform_owner from public,anon,authenticated,service_role;
revoke all on table sportsbook_private.league_launch_approvals from public,anon,authenticated,service_role;
revoke all on table public.model_config_versions from public,anon,authenticated,service_role;
revoke all on table public.model_forecast_runs from public,anon,authenticated,service_role;
revoke all on table public.model_outcome_revisions from public,anon,authenticated,service_role;
revoke all on table public.model_weekly_reviews from public,anon,authenticated,service_role;
revoke all on table public.model_change_events from public,anon,authenticated,service_role;
revoke all on table public.model_controls from public,anon,authenticated,service_role;
revoke all on table public.promo_images from public,anon,authenticated,service_role;
revoke all on table public.sportsbook_reopening_reviews from public,anon,authenticated,service_role;
revoke all on table public.promo_offers from public,anon,authenticated,service_role;
revoke all on table public.promo_claims from public,anon,authenticated,service_role;
revoke all on table public.ticket_promotions from public,anon,authenticated,service_role;
revoke all on table public.promo_events from public,anon,authenticated,service_role;
revoke all on table public.sportsbook_report_forecast_details from public,anon,authenticated,service_role;
revoke all on table public.ticket_score_observations from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.is_member(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.is_admin(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.can_view_wallet(p_team uuid) from public,anon,authenticated,service_role;
revoke all on function public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) from public,anon,authenticated,service_role;
revoke all on function public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) from public,anon,authenticated,service_role;
revoke all on function public.round_future_odds() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_outbox_recipient() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_ticket_rollout() from public,anon,authenticated,service_role;
revoke all on function public.resolve_future_markets(p_league uuid, p_kinds text[]) from public,anon,authenticated,service_role;
revoke all on function public.label_future_leg() from public,anon,authenticated,service_role;
revoke all on function public.claim_memberships() from public,anon,authenticated,service_role;
revoke all on function public.league_leaderboard(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) from public,anon,authenticated,service_role;
revoke all on function public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) from public,anon,authenticated,service_role;
revoke all on function public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) from public,anon,authenticated,service_role;
revoke all on function public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text) from public,anon,authenticated,service_role;
revoke all on function public.void_sportsbook_ticket(p_ticket uuid, p_reason text) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.reject_locked_quote() from public,anon,authenticated,service_role;
revoke all on function public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.capture_forecast(p_board uuid) from public,anon,authenticated,service_role;
revoke all on function public.worker_operation(p_league uuid, p_operation text, p_args jsonb) from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_period(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.queue_confirmation() from public,anon,authenticated,service_role;
revoke all on function public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_platform_owner_identity() from public,anon,authenticated,service_role;
revoke all on function public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) from public,anon,authenticated,service_role;
revoke all on function public.claim_outbound_emails() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.no_win_total_push() from public,anon,authenticated,service_role;
revoke all on function public.observe_line_refresh(p_status jsonb, p_error text) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.round_special_odds() from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_special_conflict(a sportsbook_markets, b sportsbook_markets) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.confirmation_delivered() from public,anon,authenticated,service_role;
revoke all on function public.set_weekly_automation(p_league uuid, p_enabled boolean) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.label_weekly_special() from public,anon,authenticated,service_role;
revoke all on function public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.more_special_conflict(a sportsbook_markets, b sportsbook_markets) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.round_market_odds() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.preserve_accepted_terms() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.release_refresh_sources() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.keep_forecast_history() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.initialize_model() from public,anon,authenticated,service_role;
revoke all on function public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text) from public,anon,authenticated,service_role;
revoke all on function public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) from public,anon,authenticated,service_role;
revoke all on function public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) from public,anon,authenticated,service_role;
revoke all on function public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) from public,anon,authenticated,service_role;
revoke all on function public.store_promo_image(p_league uuid, p_user uuid, p_png text) from public,anon,authenticated,service_role;
revoke all on function public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_market_league() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_report_league() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_league_rollout() from public,anon,authenticated,service_role;
revoke all on function public.list_promos(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_scoped_outbound_emails(p_ticket uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_launch_approval() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.guard_live_league_activation() from public,anon,authenticated,service_role;
revoke all on function public.read_promo_image(p_image uuid) from public,anon,authenticated,service_role;
revoke all on function public.pause_promo(p_offer uuid) from public,anon,authenticated,service_role;
revoke all on function public.promo_usage(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) from public,anon,authenticated,service_role;
revoke all on function public.claim_promo(p_offer uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) from public,anon,authenticated,service_role;
revoke all on function public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.promo_available(o promo_offers) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.activate_promos() from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.promo_snapshot_immutable() from public,anon,authenticated,service_role;
revoke all on function public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.validate_boost(p_offer uuid, p_board uuid, p_picks uuid[], p_stake numeric) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.promo_void_restore() from public,anon,authenticated,service_role;
revoke all on function public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.validate_extra_leg() from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_quote_snapshot(p_board uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.member_quote_metadata(p_metadata jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) from public,anon,authenticated,service_role;
revoke all on function public.activate_reopening_review(p_review uuid, p_hash text) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.valid_reopening(p_board sportsbook_boards, p_picks uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.queue_reopening_announcement(p_review uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.active_reopening(p_league uuid, p_week integer) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.maintain_reopenings(p_league uuid, p_week integer) from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_readiness(p_league uuid) from public,anon,authenticated,service_role;
revoke all on function public.confirm_scheduled_publication(p_board uuid) from public,anon,authenticated,service_role;
revoke all on function sportsbook_private.enqueue_weekly_jobs(p_now timestamp with time zone) from public,anon,authenticated,service_role;
revoke all on function public.claim_automation_job() from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_current_snapshot(p_league uuid, p_type text) from public,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA sportsbook_private TO authenticated;
REVOKE ALL ON FUNCTION public.activate_reopening_review(p_review uuid, p_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_reopening_review(p_review uuid, p_hash text) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text) TO authenticated;
GRANT SELECT ON TABLE public.automation_jobs TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.automation_jobs TO service_role;
REVOKE ALL ON FUNCTION public.claim_automation_job() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_automation_job() TO service_role;
REVOKE ALL ON FUNCTION public.claim_memberships() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_memberships() TO authenticated;
GRANT SELECT ON TABLE public.outbound_emails TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.outbound_emails TO service_role;
REVOKE ALL ON FUNCTION public.claim_outbound_emails() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_outbound_emails() TO service_role;
REVOKE ALL ON FUNCTION public.claim_promo(p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_promo(p_offer uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_scoped_outbound_emails(p_ticket uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_scoped_outbound_emails(p_ticket uuid) TO service_role;
REVOKE ALL ON FUNCTION public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_weekly_schedule(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone) TO authenticated;
REVOKE ALL ON FUNCTION public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_weekly_schedule_v2(p_league uuid, p_paused boolean, p_opening boolean, p_reminder boolean, p_recap boolean, p_opening_time time without time zone, p_reminder_time time without time zone, p_recap_time time without time zone, p_job_times jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_scheduled_publication(p_board uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_scheduled_publication(p_board uuid) TO service_role;
REVOKE ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) TO authenticated;
GRANT ALL ON FUNCTION public.control_model(p_league uuid, p_action text, p_reason text, p_review uuid, p_expected uuid) TO service_role;
REVOKE ALL ON FUNCTION public.label_future_leg() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_leaderboard(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.league_leaderboard(p_league uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_promos(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_promos(p_league uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.observe_line_refresh(p_status jsonb, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.observe_line_refresh(p_status jsonb, p_error text) TO service_role;
REVOKE ALL ON FUNCTION public.pause_promo(p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pause_promo(p_offer uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.promo_usage(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.promo_usage(p_league uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.queue_reopening_announcement(p_review uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_reopening_announcement(p_review uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.read_promo_image(p_image uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_promo_image(p_image uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.replenish_weekly_balances(p_league uuid, p_season integer, p_week integer) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_future_markets(p_league uuid, p_kinds text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_future_markets(p_league uuid, p_kinds text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_admin_exception(p_league uuid, p_key text, p_decision text, p_reason text) TO authenticated;
REVOKE ALL ON FUNCTION public.round_future_odds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_future_board(p_board uuid, p_league uuid, p_quotes jsonb, p_status text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_league_identity(p_league uuid, p_name text, p_avatar text, p_reason text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_live_model_review(p_job uuid, p_attempt integer, p_outcome_hash text, p_forecast_hash text, p_outcomes jsonb, p_report jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_live_shadow(p_job uuid, p_attempt integer, p_snapshot jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_market_board(p_board uuid, p_league uuid, p_week integer, p_opens timestamp with time zone, p_closes timestamp with time zone, p_quotes jsonb, p_status text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_model_assessment(p_job uuid, p_attempt integer, p_hash text, p_outcome jsonb, p_report jsonb, p_comparison jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_model_forecast(p_run uuid, p_league uuid, p_season integer, p_week integer, p_category text, p_version uuid, p_sources jsonb, p_payload jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_promo(p_league uuid, p_id uuid, p_version integer, p_offer jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_report_results(p_league uuid, p_season integer, p_week integer, p_final boolean, p_results jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_weekly_automation(p_league uuid, p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_weekly_automation(p_league uuid, p_enabled boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_weekly_ticket(p_ticket uuid, p_results jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.sportsbook_current_snapshot(p_league uuid, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_current_snapshot(p_league uuid, p_type text) TO authenticated;
REVOKE ALL ON FUNCTION public.sportsbook_period(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO anon;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sportsbook_period(p_league uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sportsbook_quote_snapshot(p_board uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_quote_snapshot(p_board uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sportsbook_readiness(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_readiness(p_league uuid) TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_markets TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_markets TO service_role;
REVOKE ALL ON FUNCTION public.sportsbook_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.stage_line_refresh(p_job uuid, p_attempt integer, p_quotes jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.stage_reopening_review(p_league uuid, p_week integer, p_season integer, p_closes timestamp with time zone, p_checked timestamp with time zone, p_hash text, p_weekly jsonb, p_futures jsonb, p_context jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.store_promo_image(p_league uuid, p_user uuid, p_png text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_promo_image(p_league uuid, p_user uuid, p_png text) TO service_role;
REVOKE ALL ON FUNCTION public.void_sportsbook_ticket(p_ticket uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_sportsbook_ticket(p_ticket uuid, p_reason text) TO authenticated;
REVOKE ALL ON FUNCTION public.worker_operation(p_league uuid, p_operation text, p_args jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_operation(p_league uuid, p_operation text, p_args jsonb) TO service_role;
REVOKE ALL ON FUNCTION sportsbook_private.activate_promos() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.active_reopening(p_league uuid, p_week integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.can_view_wallet(p_team uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.can_view_wallet(p_team uuid) TO authenticated;
REVOKE ALL ON FUNCTION sportsbook_private.capture_forecast(p_board uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.confirmation_delivered() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.enqueue_weekly_jobs(p_now timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_launch_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_league_rollout() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_live_league_activation() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_market_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_outbox_recipient() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_platform_owner_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_report_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.guard_ticket_rollout() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.initialize_model() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.is_admin(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.is_admin(p_league uuid) TO authenticated;
REVOKE ALL ON FUNCTION sportsbook_private.is_member(p_league uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION sportsbook_private.is_member(p_league uuid) TO authenticated;
REVOKE ALL ON FUNCTION sportsbook_private.keep_forecast_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.label_weekly_special() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.maintain_reopenings(p_league uuid, p_week integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.member_quote_metadata(p_metadata jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.more_special_conflict(a public.sportsbook_markets, b public.sportsbook_markets) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.no_win_total_push() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.preserve_accepted_terms() FROM PUBLIC;
GRANT SELECT ON TABLE public.promo_offers TO authenticated;
REVOKE ALL ON FUNCTION sportsbook_private.promo_available(o public.promo_offers) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.promo_snapshot_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.promo_void_restore() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.reject_locked_quote() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.release_refresh_sources() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.round_market_odds() FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.round_special_odds() FROM PUBLIC;
GRANT SELECT ON TABLE public.sportsbook_boards TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_boards TO service_role;
GRANT UPDATE(status) ON TABLE public.sportsbook_boards TO service_role;
REVOKE ALL ON FUNCTION sportsbook_private.valid_reopening(p_board public.sportsbook_boards, p_picks uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.validate_boost(p_offer uuid, p_board uuid, p_picks uuid[], p_stake numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION sportsbook_private.validate_extra_leg() FROM PUBLIC;
GRANT SELECT ON TABLE public.admin_change_log TO authenticated;
GRANT SELECT ON TABLE public.admin_exception_reviews TO authenticated;
GRANT SELECT ON TABLE public.balance_events TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.email_deliveries TO service_role;
GRANT SELECT ON TABLE public.forecast_snapshots TO authenticated;
GRANT SELECT ON TABLE public.forecast_snapshots TO service_role;
GRANT SELECT ON TABLE public.league_memberships TO authenticated;
GRANT SELECT ON TABLE public.league_memberships TO service_role;
GRANT SELECT ON TABLE public.league_result_weeks TO authenticated;
GRANT SELECT ON TABLE public.league_result_weeks TO service_role;
GRANT SELECT ON TABLE public.leagues TO authenticated;
GRANT SELECT ON TABLE public.leagues TO service_role;
GRANT UPDATE(sportsbook_url) ON TABLE public.leagues TO service_role;
GRANT UPDATE(email_sender) ON TABLE public.leagues TO service_role;
GRANT UPDATE(operations_enabled) ON TABLE public.leagues TO service_role;
GRANT SELECT ON TABLE public.line_refresh_cycles TO authenticated;
GRANT SELECT ON TABLE public.line_refresh_cycles TO service_role;
GRANT SELECT ON TABLE public.line_refresh_runtime TO authenticated;
GRANT SELECT ON TABLE public.line_refresh_runtime TO service_role;
GRANT SELECT,INSERT ON TABLE public.line_refresh_sources TO service_role;
GRANT SELECT ON TABLE public.line_refresh_stages TO service_role;
GRANT SELECT ON TABLE public.live_forecast_runs TO authenticated;
GRANT SELECT ON TABLE public.live_forecast_runs TO service_role;
GRANT SELECT ON TABLE public.live_model_reviews TO authenticated;
GRANT SELECT ON TABLE public.live_model_reviews TO service_role;
GRANT SELECT ON TABLE public.model_change_events TO authenticated;
GRANT SELECT ON TABLE public.model_change_events TO service_role;
GRANT SELECT ON TABLE public.model_config_versions TO authenticated;
GRANT SELECT ON TABLE public.model_config_versions TO service_role;
GRANT SELECT ON TABLE public.model_controls TO authenticated;
GRANT SELECT ON TABLE public.model_controls TO service_role;
GRANT SELECT ON TABLE public.model_forecast_runs TO authenticated;
GRANT SELECT ON TABLE public.model_forecast_runs TO service_role;
GRANT SELECT ON TABLE public.model_outcome_revisions TO authenticated;
GRANT SELECT ON TABLE public.model_outcome_revisions TO service_role;
GRANT SELECT ON TABLE public.model_weekly_reviews TO authenticated;
GRANT SELECT ON TABLE public.model_weekly_reviews TO service_role;
GRANT SELECT ON TABLE public.promo_claims TO authenticated;
GRANT SELECT ON TABLE public.promo_events TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_reopening_reviews TO authenticated;
GRANT SELECT ON TABLE public.sportsbook_reopening_reviews TO service_role;
GRANT SELECT ON TABLE public.sportsbook_report_forecast_details TO authenticated;
GRANT SELECT ON TABLE public.teams TO authenticated;
GRANT SELECT ON TABLE public.teams TO service_role;
GRANT UPDATE(wins) ON TABLE public.teams TO service_role;
GRANT UPDATE(losses) ON TABLE public.teams TO service_role;
GRANT UPDATE(ties) ON TABLE public.teams TO service_role;
GRANT SELECT ON TABLE public.ticket_legs TO authenticated;
GRANT SELECT ON TABLE public.ticket_legs TO service_role;
GRANT SELECT ON TABLE public.ticket_promotions TO authenticated;
GRANT SELECT ON TABLE public.ticket_score_observations TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.ticket_score_observations TO service_role;
GRANT SELECT ON TABLE public.tickets TO authenticated;
GRANT SELECT ON TABLE public.tickets TO service_role;
GRANT SELECT ON TABLE public.wallet_ledger TO authenticated;
GRANT SELECT ON TABLE public.wallet_ledger TO service_role;
GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT SELECT ON TABLE public.wallets TO service_role;
GRANT SELECT ON TABLE public.weekly_execution_runs TO authenticated;
GRANT SELECT ON TABLE public.weekly_execution_runs TO service_role;
GRANT SELECT ON TABLE public.weekly_schedule TO authenticated;
GRANT SELECT ON TABLE public.weekly_schedule TO service_role;
do $$begin if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke all on function public.rls_auto_enable() from public,anon,authenticated;
end if; end$$;
