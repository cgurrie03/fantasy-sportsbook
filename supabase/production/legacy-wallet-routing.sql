-- Production-only reviewed wallet transition. Does not activate public betting.
BEGIN;
SELECT pg_advisory_xact_lock(20261101,17);
DO $$BEGIN IF NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Prepared Production schema required';END IF;END $$;
CREATE TABLE IF NOT EXISTS sportsbook_private.production_retired_jobs(job_id uuid PRIMARY KEY REFERENCES public.automation_jobs(id),
 original_record jsonb NOT NULL,actor uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE sportsbook_private.production_retired_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sportsbook_private.production_retired_jobs FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.review_production_jobs(p_league uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE jobs jsonb;BEGIN
 IF NOT sportsbook_private.release_environment_ready() OR NOT sportsbook_private.is_platform_owner() OR NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified Production platform owner required';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') INTO jobs FROM public.automation_jobs j WHERE league_id=p_league AND status NOT IN('done','canceled');
 RETURN jsonb_build_object('count',jsonb_array_length(jobs),'digest',md5(jobs::text));END $$;
CREATE OR REPLACE FUNCTION public.retire_production_jobs(p_league uuid,p_digest text,p_request uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb;job public.automation_jobs;count integer:=0;BEGIN
 PERFORM pg_advisory_xact_lock(20261101,17);
 review:=public.review_production_jobs(p_league);
 IF p_request IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 400 THEN RAISE EXCEPTION 'Record an explicit retirement request and reason';END IF;
 IF EXISTS(SELECT FROM sportsbook_private.production_retired_jobs WHERE request_id=p_request) THEN
  IF EXISTS(SELECT FROM sportsbook_private.production_retired_jobs r JOIN public.automation_jobs j ON j.id=r.job_id WHERE r.request_id=p_request AND (j.league_id<>p_league OR r.actor<>auth.uid() OR r.reason<>trim(p_reason))) THEN RAISE EXCEPTION 'Retirement request reused with other terms';END IF;
  RETURN jsonb_build_object('duplicate',true);END IF;
 IF EXISTS(SELECT FROM public.leagues WHERE id=p_league AND operations_enabled) OR EXISTS(SELECT FROM public.weekly_schedule WHERE league_id=p_league AND automation_enabled) THEN RAISE EXCEPTION 'Pause legacy scheduling before retiring jobs';END IF;
 IF review->>'digest' IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'Legacy job state changed; review again';END IF;
 IF EXISTS(SELECT FROM public.automation_jobs WHERE league_id=p_league AND status='running' AND (lease_until IS NULL OR lease_until>clock_timestamp())) THEN RAISE EXCEPTION 'A legacy job still has an active or unknown lease';END IF;
 FOR job IN SELECT * FROM public.automation_jobs WHERE league_id=p_league AND status NOT IN('done','canceled') ORDER BY id FOR UPDATE LOOP
  -- Log the original record before cancellation; never label an unexecuted job done.
  INSERT INTO sportsbook_private.production_retired_jobs VALUES(job.id,to_jsonb(job),auth.uid(),trim(p_reason),p_request,clock_timestamp());
  UPDATE public.automation_jobs SET status='canceled',lease_until=NULL,last_error='Retired during reviewed Production release: '||trim(p_reason) WHERE id=job.id;
  count:=count+1;
 END LOOP;
 RETURN jsonb_build_object('retired',count,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.review_production_jobs(uuid),public.retire_production_jobs(uuid,text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.review_production_jobs(uuid),public.retire_production_jobs(uuid,text,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION sportsbook_private.guard_retired_production_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF OLD.status='canceled' AND EXISTS(SELECT FROM sportsbook_private.production_retired_jobs WHERE job_id=OLD.id) THEN RAISE EXCEPTION 'Retired Production jobs cannot be restarted or erased';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION sportsbook_private.guard_retired_production_job() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS production_retired_job_guard ON public.automation_jobs;
CREATE TRIGGER production_retired_job_guard BEFORE UPDATE OR DELETE ON public.automation_jobs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.guard_retired_production_job();
DROP TRIGGER IF EXISTS migration_receipt_immutable ON sportsbook_private.production_retired_jobs;
CREATE TRIGGER migration_receipt_immutable BEFORE UPDATE OR DELETE ON sportsbook_private.production_retired_jobs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.promo_snapshot_immutable();
CREATE TABLE IF NOT EXISTS sportsbook_private.production_wallet_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),league_id uuid NOT NULL REFERENCES public.leagues(id),actor uuid NOT NULL REFERENCES auth.users(id),
 source_digest text NOT NULL,snapshot jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes');
CREATE TABLE IF NOT EXISTS sportsbook_private.production_wallet_transfers(
 team_id uuid PRIMARY KEY REFERENCES public.teams(id),wallet_id uuid NOT NULL UNIQUE REFERENCES public.user_wallets(id),
 original_membership jsonb NOT NULL,original_balance numeric NOT NULL,review_id uuid NOT NULL REFERENCES sportsbook_private.production_wallet_reviews(id));
CREATE TABLE IF NOT EXISTS sportsbook_private.production_legacy_routes(
 ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id),wallet_id uuid NOT NULL REFERENCES public.user_wallets(id),
 accepted_receipt jsonb NOT NULL,review_id uuid NOT NULL REFERENCES sportsbook_private.production_wallet_reviews(id));
CREATE TABLE IF NOT EXISTS sportsbook_private.production_legacy_payments(
 source_event_id uuid PRIMARY KEY REFERENCES public.wallet_ledger(id),ticket_id uuid NOT NULL REFERENCES sportsbook_private.production_legacy_routes(ticket_id),
 wallet_id uuid NOT NULL REFERENCES public.user_wallets(id),amount numeric NOT NULL CHECK(amount>0),
 entry_id uuid NOT NULL UNIQUE REFERENCES public.user_wallet_entries(id),transfer_event_id uuid NOT NULL UNIQUE REFERENCES public.wallet_ledger(id));
CREATE TABLE IF NOT EXISTS sportsbook_private.production_wallet_runs(
 request_id uuid PRIMARY KEY,review_id uuid NOT NULL UNIQUE REFERENCES sportsbook_private.production_wallet_reviews(id),
 league_id uuid NOT NULL REFERENCES public.leagues(id),actor uuid NOT NULL REFERENCES auth.users(id),result jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sportsbook_private.production_pending_wallets(
 team_id uuid PRIMARY KEY REFERENCES public.teams(id),recipient_email text NOT NULL,sleeper_user_id text NOT NULL,
 original_membership jsonb NOT NULL,amount numeric NOT NULL CHECK(amount>=0),review_id uuid NOT NULL REFERENCES sportsbook_private.production_wallet_reviews(id));
CREATE TABLE IF NOT EXISTS sportsbook_private.production_pending_claims(
 team_id uuid PRIMARY KEY REFERENCES sportsbook_private.production_pending_wallets(team_id),wallet_id uuid NOT NULL UNIQUE REFERENCES public.user_wallets(id),
 request_id uuid NOT NULL UNIQUE,actor uuid NOT NULL REFERENCES auth.users(id));
DO $$DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['production_wallet_reviews','production_wallet_transfers','production_legacy_routes','production_legacy_payments','production_wallet_runs','production_pending_wallets','production_pending_claims'] LOOP
 EXECUTE format('ALTER TABLE sportsbook_private.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON sportsbook_private.%I FROM PUBLIC,anon,authenticated,service_role',name);
 EXECUTE format('DROP TRIGGER IF EXISTS migration_receipt_immutable ON sportsbook_private.%I',name);
 EXECUTE format('CREATE TRIGGER migration_receipt_immutable BEFORE UPDATE OR DELETE ON sportsbook_private.%I FOR EACH ROW EXECUTE FUNCTION sportsbook_private.promo_snapshot_immutable()',name);
END LOOP;END $$;

CREATE OR REPLACE FUNCTION sportsbook_private.production_wallet_snapshot(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.league_memberships m WHERE m.league_id=p_league),
 'identities',(SELECT coalesce(jsonb_agg(jsonb_build_object('membership',m.id,'user',u.id,'verified',u.email_confirmed_at IS NOT NULL,'email_matches',lower(u.email)=lower(trim(m.invited_email))) ORDER BY m.id),'[]') FROM public.league_memberships m LEFT JOIN auth.users u ON u.id=m.user_id WHERE m.league_id=p_league),
 'wallets',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.team_id),'[]') FROM public.wallets w JOIN public.teams t ON t.id=w.team_id WHERE t.league_id=p_league),
 'rosters',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'owner',t.sleeper_owner_id,'co_owners',t.co_owner_ids) ORDER BY t.id),'[]') FROM public.teams t WHERE t.league_id=p_league),
 'open',(SELECT coalesce(jsonb_agg(jsonb_build_object('ticket',to_jsonb(t),'legs',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.leg_number) FROM public.ticket_legs_with_evidence l WHERE l.ticket_id=t.id)) ORDER BY t.id),'[]') FROM public.tickets t WHERE t.league_id=p_league AND t.status='OPEN'),
 'user_wallets',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]') FROM public.user_wallets w WHERE w.league_id=p_league))
$$;
REVOKE ALL ON FUNCTION sportsbook_private.production_wallet_snapshot(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.prepare_production_wallet_migration(p_league uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state_snapshot jsonb;review sportsbook_private.production_wallet_reviews;BEGIN
 IF NOT sportsbook_private.release_environment_ready() OR NOT sportsbook_private.is_platform_owner()
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified Production platform owner required';END IF;
 IF p_league<>'13121261-5398-4391-8240-000000000003' THEN RAISE EXCEPTION 'Reviewed Production league required';END IF;
 IF EXISTS(SELECT FROM public.leagues WHERE id=p_league AND operations_enabled)
 OR EXISTS(SELECT FROM public.weekly_schedule WHERE league_id=p_league AND automation_enabled)
 OR EXISTS(SELECT FROM public.automation_jobs WHERE league_id=p_league AND status NOT IN('done','canceled')) THEN RAISE EXCEPTION 'Pause competing operations and resolve old jobs before review';END IF;
 IF EXISTS(SELECT FROM public.user_wallets WHERE league_id=p_league) THEN RAISE EXCEPTION 'Existing person wallets require a separate reviewed transition';END IF;
 IF EXISTS(SELECT FROM public.tickets WHERE league_id=p_league AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future') THEN RAISE EXCEPTION 'Resolve open weekly liabilities first';END IF;
 IF EXISTS(SELECT FROM public.tickets t LEFT JOIN public.league_memberships m ON m.league_id=t.league_id AND m.team_id=t.team_id
 LEFT JOIN auth.users u ON u.id=m.user_id WHERE t.league_id=p_league AND t.status='OPEN'
 AND (u.id IS NULL OR u.email_confirmed_at IS NULL OR lower(u.email) IS DISTINCT FROM lower(trim(m.invited_email)))) THEN RAISE EXCEPTION 'Open futures need a verified reviewed bettor mapping';END IF;
 IF EXISTS(SELECT FROM public.league_memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.league_id=p_league AND lower(u.email) IS DISTINCT FROM lower(trim(m.invited_email))) THEN RAISE EXCEPTION 'Conflicting account/email mapping';END IF;
 state_snapshot:=sportsbook_private.production_wallet_snapshot(p_league);
 SELECT * INTO review FROM sportsbook_private.production_wallet_reviews WHERE league_id=p_league AND actor=auth.uid() AND source_digest=md5(state_snapshot::text) AND expires_at>clock_timestamp() ORDER BY expires_at DESC LIMIT 1;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM sportsbook_private.production_wallet_reviews WHERE league_id=p_league AND actor=auth.uid() AND expires_at>clock_timestamp()-interval '30 minutes')>=20 THEN RAISE EXCEPTION 'Review budget reached; resolve the existing review first';END IF;
  INSERT INTO sportsbook_private.production_wallet_reviews(league_id,actor,source_digest,snapshot) VALUES(p_league,auth.uid(),md5(state_snapshot::text),state_snapshot) RETURNING * INTO review;
 END IF;
 RETURN jsonb_build_object('reviewId',review.id,'sourceDigest',review.source_digest,'expiresAt',review.expires_at,
 'verifiedAccounts',(SELECT count(*) FROM public.league_memberships m JOIN auth.users u ON u.id=m.user_id AND u.email_confirmed_at IS NOT NULL WHERE m.league_id=p_league),
 'openFutures',(SELECT count(*) FROM public.tickets WHERE league_id=p_league AND status='OPEN'),'fundsMoved',false);
END $$;
REVOKE ALL ON FUNCTION public.prepare_production_wallet_migration(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_production_wallet_migration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_production_wallet_migration(p_review uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review sportsbook_private.production_wallet_reviews;prior sportsbook_private.production_wallet_runs;
 member record;old_balance numeric;wallet uuid;event uuid;result jsonb;transferred integer:=0;co_managers integer:=0;routed integer:=0;
BEGIN
 IF NOT sportsbook_private.release_environment_ready() OR NOT sportsbook_private.is_platform_owner()
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified Production platform owner required';END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'Idempotent request identifier required';END IF;
 PERFORM pg_advisory_xact_lock(20261101,17);
 LOCK TABLE public.league_memberships,public.user_wallets,boff_dev_internal.co_manager_links IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id IN(SELECT user_id FROM public.league_memberships WHERE league_id='13121261-5398-4391-8240-000000000003' AND user_id IS NOT NULL) FOR SHARE;
 SELECT * INTO prior FROM sportsbook_private.production_wallet_runs WHERE request_id=p_request;
 IF FOUND THEN IF prior.review_id<>p_review OR prior.actor<>auth.uid() THEN RAISE EXCEPTION 'Request identifier reused with other review';END IF;RETURN prior.result||jsonb_build_object('duplicate',true);END IF;
 SELECT * INTO STRICT review FROM sportsbook_private.production_wallet_reviews WHERE id=p_review FOR UPDATE;
 IF review.actor<>auth.uid() OR review.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Review expired or belongs to another actor';END IF;
 IF EXISTS(SELECT FROM sportsbook_private.production_wallet_runs WHERE review_id=p_review) THEN RAISE EXCEPTION 'Review already consumed';END IF;
 IF md5(sportsbook_private.production_wallet_snapshot(review.league_id)::text)<>review.source_digest THEN RAISE EXCEPTION 'Production identities, liabilities or balances changed; review again';END IF;
 IF EXISTS(SELECT FROM public.leagues WHERE id=review.league_id AND operations_enabled) OR EXISTS(SELECT FROM public.weekly_schedule WHERE league_id=review.league_id AND automation_enabled)
 OR EXISTS(SELECT FROM public.automation_jobs WHERE league_id=review.league_id AND status NOT IN('done','canceled')) THEN RAISE EXCEPTION 'Competing operations must remain paused';END IF;
 FOR member IN SELECT m.*,u.email_confirmed_at,t.sleeper_owner_id,t.co_owner_ids FROM public.league_memberships m JOIN auth.users u ON u.id=m.user_id
 JOIN public.teams t ON t.id=m.team_id AND t.league_id=m.league_id WHERE m.league_id=review.league_id AND u.email_confirmed_at IS NOT NULL ORDER BY m.team_id
 LOOP
  SELECT balance INTO STRICT old_balance FROM public.wallets WHERE team_id=member.team_id FOR UPDATE;
  IF old_balance IS NULL THEN RAISE EXCEPTION 'Unfunded legacy balance requires review';END IF;
  IF member.sleeper_user_id IS DISTINCT FROM member.sleeper_owner_id AND NOT coalesce(member.sleeper_user_id=ANY(member.co_owner_ids),false) THEN RAISE EXCEPTION 'Sleeper manager identity requires review';END IF;
  INSERT INTO public.user_wallets(league_id,user_id,team_id,display_name,balance) VALUES(member.league_id,member.user_id,member.team_id,member.display_name,old_balance) RETURNING id INTO wallet;
  INSERT INTO sportsbook_private.user_wallet_approvals(wallet_id,actor,reason) VALUES(wallet,auth.uid(),'Reviewed Production legacy wallet and future liability migration');
  INSERT INTO public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  VALUES(member.team_id,'account:transfer:'||wallet,'account_transfer_out',-old_balance,old_balance,0,'Reviewed Production migration to the existing mapped person') RETURNING id INTO event;
  UPDATE public.wallets SET balance=0,updated_at=clock_timestamp() WHERE team_id=member.team_id;
  INSERT INTO public.user_wallet_entries(wallet_id,league_id,team_id,event_key,request_key,kind,amount,balance_before,balance_after,reason,metadata)
  VALUES(wallet,member.league_id,member.team_id,'initialize',gen_random_uuid(),'legacy_transfer_in',old_balance,NULL,old_balance,
   'Reviewed Production wallet transfer with separately routed legacy futures',jsonb_build_object('review',review.id,'mode','transfer_legacy','legacyEvent',event));
  INSERT INTO sportsbook_private.production_wallet_transfers VALUES(member.team_id,wallet,to_jsonb(member)-'email_confirmed_at'-'sleeper_owner_id'-'co_owner_ids',old_balance,review.id);
  INSERT INTO sportsbook_private.production_legacy_routes(ticket_id,wallet_id,accepted_receipt,review_id)
  SELECT t.id,wallet,jsonb_build_object('ticket',to_jsonb(t),'legs',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.leg_number) FROM public.ticket_legs_with_evidence l WHERE l.ticket_id=t.id)),review.id
  FROM public.tickets t WHERE t.league_id=member.league_id AND t.team_id=member.team_id AND t.status='OPEN' AND t.ticket_type='future';
  GET DIAGNOSTICS routed=ROW_COUNT;
  IF member.sleeper_user_id IS DISTINCT FROM member.sleeper_owner_id THEN
   IF member.role<>'member' OR EXISTS(SELECT FROM sportsbook_private.platform_owner WHERE membership_id=member.id) THEN RAISE EXCEPTION 'Staff co-manager mapping requires separate review';END IF;
   INSERT INTO boff_dev_internal.co_manager_links(league_id,team_id,sleeper_user_id,user_id,display_name) VALUES(member.league_id,member.team_id,member.sleeper_user_id,member.user_id,member.display_name);
   DELETE FROM public.league_memberships WHERE id=member.id;
   co_managers:=co_managers+1;
  END IF;
  transferred:=transferred+1;
 END LOOP;
 INSERT INTO sportsbook_private.production_pending_wallets(team_id,recipient_email,sleeper_user_id,original_membership,amount,review_id)
 SELECT m.team_id,lower(trim(m.invited_email)),m.sleeper_user_id,to_jsonb(m),w.balance,review.id
 FROM public.league_memberships m JOIN public.wallets w ON w.team_id=m.team_id LEFT JOIN auth.users u ON u.id=m.user_id
 WHERE m.league_id=review.league_id AND (u.id IS NULL OR u.email_confirmed_at IS NULL);
 IF EXISTS(SELECT FROM public.tickets t WHERE t.league_id=review.league_id AND t.status='OPEN' AND NOT EXISTS(SELECT FROM sportsbook_private.production_legacy_routes r WHERE r.ticket_id=t.id)) THEN RAISE EXCEPTION 'A legacy future lacks its reviewed payout route';END IF;
 INSERT INTO sportsbook_private.user_finance_modes(league_id,enabled) VALUES(review.league_id,true) ON CONFLICT(league_id) DO UPDATE SET enabled=true;
 result:=jsonb_build_object('walletsTransferred',transferred,'coManagersPreserved',co_managers,'pendingEntitlements',(SELECT count(*) FROM sportsbook_private.production_pending_wallets WHERE review_id=review.id),'futuresRouted',(SELECT count(*) FROM sportsbook_private.production_legacy_routes r JOIN public.tickets t ON t.id=r.ticket_id WHERE t.league_id=review.league_id),'duplicate',false,'bettingActivated',false);
 INSERT INTO sportsbook_private.production_wallet_runs VALUES(p_request,p_review,review.league_id,auth.uid(),result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_production_wallet_migration(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.apply_production_wallet_migration(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.production_zero_opening_allowed(p_league uuid,p_user uuid,p_team uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT
 (NOT EXISTS(SELECT FROM public.wallets WHERE team_id=p_team AND balance>0)
  OR EXISTS(SELECT FROM sportsbook_private.production_pending_wallets p WHERE p.team_id=p_team AND NOT EXISTS(
   SELECT FROM boff_dev_internal.participant_links m WHERE m.league_id=p_league AND m.team_id=p_team AND m.user_id=p_user AND m.sleeper_user_id=p.sleeper_user_id)))
 AND NOT EXISTS(SELECT FROM public.tickets t WHERE t.team_id=p_team AND t.status='OPEN' AND t.user_wallet_id IS NULL AND NOT EXISTS(
  SELECT FROM sportsbook_private.production_legacy_routes r JOIN public.user_wallets w ON w.id=r.wallet_id WHERE r.ticket_id=t.id AND w.user_id<>p_user))
$$;
REVOKE ALL ON FUNCTION sportsbook_private.production_zero_opening_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE d text;anchor text;BEGIN
 IF to_regprocedure('sportsbook_private.production_base_initialize_wallet(uuid,uuid,text,numeric,text,uuid)') IS NULL THEN
  SELECT pg_get_functiondef('public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid)'::regprocedure) INTO d;
  d:=replace(d,'FUNCTION public.initialize_user_wallet','FUNCTION sportsbook_private.production_base_initialize_wallet');
  anchor:='if exists(select 1 from public.league_memberships m where m.league_id=p_league and m.team_id=w.team_id and m.user_id=p_user)';
  IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Zero opening guard source changed';END IF;
  d:=replace(d,anchor,'if NOT sportsbook_private.production_zero_opening_allowed(p_league,p_user,w.team_id)');
  -- The new predicate handles both reserved cash and reviewed open liabilities.
  d:=replace(d,'and (exists(select 1 from public.wallets where team_id=w.team_id and balance>0) or exists(select 1 from public.tickets where team_id=w.team_id and status=''OPEN''))','');
  EXECUTE d;
 END IF;
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.production_base_initialize_wallet(uuid,uuid,text,numeric,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.initialize_user_wallet(p_league uuid,p_user uuid,p_mode text,p_expected_legacy numeric,p_reason text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.user_wallets;pending sportsbook_private.production_pending_wallets;claim sportsbook_private.production_pending_claims;result jsonb;BEGIN
 IF NOT sportsbook_private.is_platform_owner() OR NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified platform owner required';END IF;
 PERFORM pg_advisory_xact_lock_shared(20261101,17);
 SELECT * INTO STRICT w FROM public.user_wallets WHERE league_id=p_league AND user_id=p_user FOR UPDATE;
 SELECT * INTO pending FROM sportsbook_private.production_pending_wallets WHERE team_id=w.team_id;
 IF FOUND AND p_mode='transfer_legacy' THEN
  SELECT * INTO claim FROM sportsbook_private.production_pending_claims WHERE team_id=w.team_id;
  IF claim.wallet_id IS NOT NULL AND claim.wallet_id<>w.id THEN RAISE EXCEPTION 'Reserved legacy credits were already claimed by their original person';END IF;
  IF NOT EXISTS(SELECT FROM auth.users a JOIN boff_dev_internal.participant_links m ON m.user_id=a.id WHERE a.id=p_user AND a.email_confirmed_at IS NOT NULL
   AND lower(trim(a.email))=pending.recipient_email AND m.league_id=p_league AND m.team_id=w.team_id AND m.sleeper_user_id=pending.sleeper_user_id)
  THEN RAISE EXCEPTION 'Legacy credits are reserved for the original verified Sleeper person';END IF;
  IF p_expected_legacy IS DISTINCT FROM pending.amount THEN RAISE EXCEPTION 'Reserved legacy amount changed';END IF;
 END IF;
 result:=sportsbook_private.production_base_initialize_wallet(p_league,p_user,p_mode,p_expected_legacy,p_reason,p_request);
 IF pending.team_id IS NOT NULL AND p_mode='transfer_legacy' THEN
  INSERT INTO sportsbook_private.production_pending_claims VALUES(w.team_id,w.id,p_request,auth.uid()) ON CONFLICT(team_id) DO NOTHING;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.route_production_legacy_payment(p_ticket uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE route sportsbook_private.production_legacy_routes;source public.wallet_ledger;wallet public.user_wallets;legacy numeric;entry uuid;transfer uuid;
BEGIN
 SELECT * INTO route FROM sportsbook_private.production_legacy_routes WHERE ticket_id=p_ticket;
 IF NOT FOUND THEN RETURN;END IF;
 -- Shared lock order: legacy wallet, person wallet, then settlement ticket.
 SELECT balance INTO STRICT legacy FROM public.wallets WHERE team_id=(SELECT team_id FROM public.tickets WHERE id=p_ticket) FOR UPDATE;
 SELECT * INTO STRICT wallet FROM public.user_wallets WHERE id=route.wallet_id FOR UPDATE;
 FOR source IN SELECT * FROM public.wallet_ledger WHERE ticket_id=p_ticket AND kind IN ('settlement','void_refund') AND amount>0 ORDER BY created_at,id LOOP
  IF EXISTS(SELECT FROM sportsbook_private.production_legacy_payments WHERE source_event_id=source.id) THEN CONTINUE;END IF;
  IF legacy<source.amount THEN RAISE EXCEPTION 'Legacy payout credit unavailable; reconcile before routing';END IF;
  INSERT INTO public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
  VALUES(source.team_id,p_ticket,'legacy-route:'||source.id,'legacy_payout_transfer',-source.amount,legacy,legacy-source.amount,'Routed legacy ticket payout to its reviewed person wallet') RETURNING id INTO transfer;
  UPDATE public.wallets SET balance=balance-source.amount,updated_at=clock_timestamp() WHERE team_id=source.team_id;
  INSERT INTO public.user_wallet_entries(wallet_id,league_id,team_id,event_key,kind,amount,balance_before,balance_after,reason,metadata)
  VALUES(wallet.id,wallet.league_id,wallet.team_id,'legacy-ticket:'||source.id,'adjustment',source.amount,wallet.balance,wallet.balance+source.amount,
   'Legacy future ticket payout/refund',jsonb_build_object('legacyTicket',p_ticket,'legacyEvent',source.id)) RETURNING id INTO entry;
  UPDATE public.user_wallets SET balance=balance+source.amount,updated_at=clock_timestamp() WHERE id=wallet.id;
  INSERT INTO sportsbook_private.production_legacy_payments VALUES(source.id,p_ticket,wallet.id,source.amount,entry,transfer);
  legacy:=legacy-source.amount;wallet.balance:=wallet.balance+source.amount;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.route_production_legacy_payment(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.settle_weekly_ticket(p_ticket uuid,p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock_shared(20261101,17);
 IF (SELECT user_wallet_id IS NOT NULL FROM public.tickets WHERE id=p_ticket) THEN RETURN sportsbook_private.user_settle_weekly_ticket(p_ticket,p_results);END IF;
 IF (SELECT status='OPEN' FROM public.tickets WHERE id=p_ticket) AND NOT EXISTS(SELECT FROM sportsbook_private.production_legacy_routes WHERE ticket_id=p_ticket) THEN RAISE EXCEPTION 'Legacy open liability requires a reviewed person route';END IF;
 PERFORM 1 FROM public.wallets WHERE team_id=(SELECT team_id FROM public.tickets WHERE id=p_ticket) FOR UPDATE;
 PERFORM 1 FROM public.user_wallets WHERE id=(SELECT wallet_id FROM sportsbook_private.production_legacy_routes WHERE ticket_id=p_ticket) FOR UPDATE;
 result:=sportsbook_private.legacy_settle_weekly_ticket(p_ticket,p_results);
 PERFORM sportsbook_private.route_production_legacy_payment(p_ticket);RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.void_sportsbook_ticket(p_ticket uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock_shared(20261101,17);
 IF (SELECT user_wallet_id IS NOT NULL FROM public.tickets WHERE id=p_ticket) THEN RETURN sportsbook_private.user_void_sportsbook_ticket(p_ticket,p_reason);END IF;
 IF (SELECT status='OPEN' FROM public.tickets WHERE id=p_ticket) AND NOT EXISTS(SELECT FROM sportsbook_private.production_legacy_routes WHERE ticket_id=p_ticket) THEN RAISE EXCEPTION 'Legacy open liability requires a reviewed person route';END IF;
 PERFORM 1 FROM public.wallets WHERE team_id=(SELECT team_id FROM public.tickets WHERE id=p_ticket) FOR UPDATE;
 PERFORM 1 FROM public.user_wallets WHERE id=(SELECT wallet_id FROM sportsbook_private.production_legacy_routes WHERE ticket_id=p_ticket) FOR UPDATE;
 result:=sportsbook_private.legacy_void_sportsbook_ticket(p_ticket,p_reason);
 PERFORM sportsbook_private.route_production_legacy_payment(p_ticket);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.settle_weekly_ticket(uuid,jsonb),public.void_sportsbook_ticket(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.settle_weekly_ticket(uuid,jsonb),public.void_sportsbook_ticket(uuid,text) TO authenticated;

-- Read models use the reviewed route without rewriting original ticket ownership.
DO $$DECLARE d text;anchor text;columns text;BEGIN
 SELECT pg_get_functiondef('public.dev_credit_claim(uuid,uuid)'::regprocedure) INTO d;
 anchor:='WHERE user_wallet_id = wallet.id AND status = ''OPEN'';';
 IF strpos(d,anchor)>0 THEN d:=replace(d,anchor,
  'WHERE (user_wallet_id = wallet.id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes r WHERE r.ticket_id=public.tickets.id AND r.wallet_id=wallet.id)) AND status = ''OPEN'';');
 ELSIF strpos(d,'production_legacy_routes')=0 THEN RAISE EXCEPTION 'Credit stake source changed';END IF;
 IF strpos(d,'Credit claim writes are paused')=0 THEN
  d:=regexp_replace(d,'\mBEGIN\M','BEGIN PERFORM pg_advisory_xact_lock_shared(20261101,17);IF p_request IS NOT NULL AND NOT sportsbook_private.release_writes_enabled() THEN RAISE EXCEPTION ''Credit claim writes are paused during release'';END IF;','i');
 END IF;EXECUTE d;
 SELECT pg_get_functiondef('boff_dev_internal.apply_futures_season_transition()'::regprocedure) INTO d;
 anchor:='AND user_wallet_id=wallet.id';
 IF strpos(d,anchor)>0 THEN d:=replace(d,anchor,
  'AND (user_wallet_id=wallet.id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes r WHERE r.ticket_id=public.tickets.id AND r.wallet_id=wallet.id))');
 ELSIF strpos(d,'production_legacy_routes')=0 THEN RAISE EXCEPTION 'Future carryover source changed';END IF;EXECUTE d;
 SELECT pg_get_functiondef('public.dev_ticket_history_page(uuid,boolean,text,integer,uuid,text,text,jsonb,integer)'::regprocedure) INTO d;
 anchor:='SELECT t.* FROM public.tickets t WHERE t.league_id=p_league';
 IF strpos(d,anchor)>0 THEN
  SELECT string_agg(CASE attname WHEN 'user_wallet_id' THEN 'coalesce(t.user_wallet_id,legacy.wallet_id) AS user_wallet_id'
   WHEN 'bettor_display_name' THEN 'coalesce(t.bettor_display_name,person.display_name) AS bettor_display_name' ELSE 't.'||quote_ident(attname) END,',' ORDER BY attnum)
  INTO columns FROM pg_attribute WHERE attrelid='public.tickets'::regclass AND attnum>0 AND NOT attisdropped;
  d:=replace(d,anchor,'SELECT '||columns||' FROM public.tickets t LEFT JOIN sportsbook_private.production_legacy_routes legacy ON legacy.ticket_id=t.id LEFT JOIN public.user_wallets person ON person.id=legacy.wallet_id WHERE t.league_id=p_league');
  d:=replace(d,'t.user_wallet_id IN(SELECT id','coalesce(t.user_wallet_id,legacy.wallet_id) IN(SELECT id');
 ELSIF strpos(d,'production_legacy_routes')=0 THEN RAISE EXCEPTION 'Ticket history source changed';END IF;EXECUTE d;
 SELECT pg_get_functiondef('public.dev_standings_wallets(uuid)'::regprocedure) INTO d;
 anchor:='t.user_wallet_id=w.id OR';
 IF strpos(d,'production_legacy_routes')=0 THEN
  IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Standings ticket scope changed';END IF;
  d:=replace(d,anchor,'t.user_wallet_id=w.id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes r WHERE r.ticket_id=t.id AND r.wallet_id=w.id) OR');
 END IF;EXECUTE d;
 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO d;
 anchor:='t.user_wallet_id=r.wallet_id';
 IF strpos(d,'production_legacy_routes')=0 THEN
  IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Notification ticket scope changed';END IF;
  d:=replace(d,anchor,'(t.user_wallet_id=r.wallet_id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes legacy WHERE legacy.ticket_id=t.id AND legacy.wallet_id=r.wallet_id))');
 END IF;EXECUTE d;
END $$;
COMMIT;
