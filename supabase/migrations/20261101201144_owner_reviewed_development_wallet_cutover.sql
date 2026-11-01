begin;
-- A rare cutover takes the exclusive lock; normal financial writers share it.
-- Acquire it at each public entry point before reading routing or locking cash.
do $fence$declare signature text;d text;pos integer;begin
 foreach signature in array array[
  'public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)',
  'public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid)',
  'public.place_fixed_ticket(uuid,numeric,uuid)',
  'public.settle_weekly_ticket(uuid,jsonb)','public.void_sportsbook_ticket(uuid,text)',
  'public.replenish_weekly_balances(uuid,integer,integer)',
  'public.approve_user_wallet(uuid,uuid,uuid,text,text)',
  'public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid)',
  'public.set_user_wallet_balance(uuid,numeric,numeric,text,uuid)',
  'public.set_user_wallet_status(uuid,integer,text,text)',
  'public.set_team_balance(uuid,numeric,text,uuid)'] loop
  select pg_get_functiondef(signature::regprocedure) into d;pos:=position('begin' in lower(d));
  if pos=0 then raise exception 'Financial transition entry point changed: %',signature;end if;
  d:=overlay(d placing 'begin perform pg_advisory_xact_lock_shared(20261101,17);' from pos for 5);
  execute d;
 end loop;
end $fence$;
create function sportsbook_private.financial_transition_fence() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 perform pg_advisory_xact_lock_shared(20261101,17);
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function sportsbook_private.financial_transition_fence() from public,anon,authenticated,service_role;
create trigger financial_transition_fence before insert or update or delete on public.outbound_emails
 for each row execute function sportsbook_private.financial_transition_fence();
create trigger financial_transition_fence before insert or update or delete on public.automation_jobs
 for each row execute function sportsbook_private.financial_transition_fence();
create trigger financial_transition_fence before insert or update or delete on public.weekly_schedule
 for each row execute function sportsbook_private.financial_transition_fence();

-- Preserve the read-only preflight and bind all reviewed identities/cash/legacy
-- liabilities, rather than trusting counts or a client-supplied timestamp.
alter function public.user_finance_cutover_preflight(uuid) rename to legacy_user_finance_cutover_preflight;
alter function public.legacy_user_finance_cutover_preflight(uuid) set schema sportsbook_private;
revoke all on function sportsbook_private.legacy_user_finance_cutover_preflight(uuid) from public,anon,authenticated,service_role;
create function public.user_finance_cutover_preflight(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;state jsonb;begin
 result:=sportsbook_private.legacy_user_finance_cutover_preflight(p_league);
 if (select count(*) from public.teams where league_id=p_league)>128
  or (select count(*) from public.league_memberships where league_id=p_league)>128
  or (select count(*) from public.user_wallets where league_id=p_league)>128
  or (select count(*) from public.tickets where league_id=p_league and user_wallet_id is null and status='OPEN')>1024
 then return result||jsonb_build_object('ready',false,'blockers',(result->'blockers')||'"Cutover review exceeds its admission budget"'::jsonb);end if;
 state:=jsonb_build_object('review',result,'actor',auth.uid(),
  'wallets',(select coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]') from public.user_wallets w where w.league_id=p_league),
  'identities',(select coalesce(jsonb_agg(jsonb_build_array(a.id,a.email,a.email_confirmed_at) order by a.id),'[]')
   from auth.users a where exists(select 1 from public.user_wallets w where w.league_id=p_league and w.user_id=a.id)),
  'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.league_memberships m where m.league_id=p_league),
  'legacy_cash',(select coalesce(jsonb_agg(to_jsonb(w) order by w.team_id),'[]') from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=p_league),
  'legacy_open',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.tickets t where t.league_id=p_league and t.user_wallet_id is null and t.status='OPEN'));
 return result||jsonb_build_object('state_fingerprint',md5(state::text));
end $$;
revoke all on function public.user_finance_cutover_preflight(uuid) from public,anon,service_role;
grant execute on function public.user_finance_cutover_preflight(uuid) to authenticated;

create unique index wallet_cutover_request_once on public.admin_change_log(league_id,(after_value->>'request_key'))
 where category='user_finance_cutover';
create unique index wallet_cutover_review_once on public.admin_change_log((after_value->>'review_id'))
 where category='user_finance_cutover';
create function public.prepare_user_finance_cutover(p_league uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare review jsonb;v_id uuid:=gen_random_uuid();v_time timestamptz:=clock_timestamp();begin
 perform pg_advisory_xact_lock(20261101,17);
 review:=public.user_finance_cutover_preflight(p_league);
 if p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Record the financial review reason (8-400 characters).';end if;
 if (review->>'routing_enabled')::boolean then raise exception 'Independent wallets are already active.';end if;
 if (review->>'ready')::boolean is distinct from true then raise exception 'Resolve the cutover blockers before preparing approval.';end if;
 if (select count(*) from public.admin_change_log where league_id=p_league and category='user_finance_cutover_review')>=64
 then raise exception 'Cutover review admission budget reached; owner maintenance review required.';end if;
 insert into public.admin_change_log(id,league_id,actor_id,category,reason,before_value,after_value,created_at)
 values(v_id,p_league,auth.uid(),'user_finance_cutover_review',trim(p_reason),review,
  jsonb_build_object('expires_at',v_time+interval '5 minutes'),v_time);
 return review||jsonb_build_object('review_id',v_id,'expires_at',v_time+interval '5 minutes');
end $$;
revoke all on function public.prepare_user_finance_cutover(uuid,text) from public,anon,service_role;
grant execute on function public.prepare_user_finance_cutover(uuid,text) to authenticated;
create function public.activate_user_finance_cutover(p_league uuid,p_review uuid,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_review jsonb;r public.admin_change_log;used public.admin_change_log;begin
 perform pg_advisory_xact_lock(20261101,17);
 -- The preflight checks fresh owner/verified identity and fixed DEV environment.
 current_review:=public.user_finance_cutover_preflight(p_league);
 perform 1 from public.leagues where id=p_league for update;
 if p_review is null or p_request is null or p_reason is null or length(trim(p_reason)) not between 8 and 400
 then raise exception 'Explicit review, request and reason required.';end if;
 select * into used from public.admin_change_log where league_id=p_league and category='user_finance_cutover' and after_value->>'request_key'=p_request::text;
 if found then
  if used.actor_id<>auth.uid() or used.after_value->>'review_id'<>p_review::text or used.reason<>trim(p_reason)
  then raise exception 'Cutover request already used with different terms.';end if;
  return jsonb_build_object('league_id',p_league,'activated',true,'duplicate',true,'opening_funds_moved',false);
 end if;
 select * into r from public.admin_change_log where id=p_review and league_id=p_league
  and category='user_finance_cutover_review' and actor_id=auth.uid() for update;
 if not found or r.reason<>trim(p_reason) then raise exception 'This owner must prepare and review the selected league first.';end if;
 if (r.after_value->>'expires_at')::timestamptz<=clock_timestamp() then raise exception 'Cutover review expired; prepare a fresh review.';end if;
 if r.before_value->>'state_fingerprint' is distinct from current_review->>'state_fingerprint'
 then raise exception 'Financial state changed; prepare a fresh cutover review.';end if;
 if (current_review->>'ready')::boolean is distinct from true or (current_review->>'routing_enabled')::boolean
 then raise exception 'Cutover is blocked or already active.';end if;
 insert into sportsbook_private.user_finance_modes(league_id,enabled) values(p_league,true)
 on conflict(league_id) do update set enabled=true;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 values(p_league,auth.uid(),'user_finance_cutover',trim(p_reason),current_review,
  jsonb_build_object('review_id',p_review,'request_key',p_request,'routing_enabled',true,'opening_funds_moved',false));
 return jsonb_build_object('league_id',p_league,'activated',true,'duplicate',false,'opening_funds_moved',false);
end $$;
revoke all on function public.activate_user_finance_cutover(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.activate_user_finance_cutover(uuid,uuid,uuid,text) to authenticated;
commit;
