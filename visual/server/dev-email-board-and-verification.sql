DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
END $$;

CREATE FUNCTION public.dev_email_standings(p_league uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.tickets>0 DESC,s.profit DESC,s.name),'[]') FROM (
  SELECT p.display_name AS name,w.team_id AS "teamId",w.balance,count(t.id) AS tickets,
   coalesce(sum(CASE WHEN t.status='WON' THEN coalesce(t.actual_payout,t.accepted_potential_payout)-t.stake
    WHEN t.status='LOST' THEN -t.stake ELSE 0 END),0) AS profit
  FROM public.user_wallets w JOIN public.leagues l ON l.id=w.league_id
  JOIN boff_dev_internal.participant_links p ON (p.league_id,p.user_id,p.team_id)=(w.league_id,w.user_id,w.team_id)
  LEFT JOIN public.tickets t ON t.league_id=w.league_id AND t.nfl_season=l.nfl_season AND
   (t.user_wallet_id=w.id OR (t.user_wallet_id IS NULL AND t.team_id=w.team_id AND t.bettor_display_name=p.display_name))
  WHERE w.league_id=p_league AND w.status='approved'
  GROUP BY w.id,p.display_name
  ORDER BY count(t.id)>0 DESC,profit DESC,p.display_name LIMIT 5
 ) s
$$;

CREATE FUNCTION public.dev_outbound_email_is_verified(p_email uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.outbound_emails o JOIN auth.users u ON lower(u.email)=lower(o.recipient)
  WHERE o.id=p_email AND u.email_confirmed_at IS NOT NULL)
$$;

DO $$ DECLARE original text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO original;
 updated:=replace(original,'w.id wallet_id','w.id wallet_id,w.team_id');
 updated:=replace(updated,'''userId'',user_id,''kind''','''userId'',user_id,''teamId'',team_id,''kind''');
 IF updated NOT LIKE '%w.id wallet_id,w.team_id%' OR updated NOT LIKE '%''teamId'',team_id%' THEN
  RAISE EXCEPTION 'Notification candidate definition changed';
 END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_capture_notification(uuid,uuid,text,text,text,text,text)'::regprocedure) INTO original;
 updated:=replace(original,'BEGIN','BEGIN
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN RETURN; END IF;');
 IF updated=original THEN RAISE EXCEPTION 'Notification capture definition changed'; END IF;
 EXECUTE updated;
END $$;

CREATE FUNCTION boff_dev_internal.unverified_league_accounts(p_league uuid)
RETURNS TABLE(account_id uuid,team_id uuid,email text)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT DISTINCT ON (u.id) u.id,m.team_id,u.email
 FROM (
  SELECT l.team_id,l.invited_email FROM public.league_memberships l WHERE l.league_id=p_league
  UNION ALL
  SELECT i.team_id,i.invited_email FROM sportsbook_private.team_invitations i
   WHERE i.league_id=p_league AND i.invited_email IS NOT NULL AND i.state='open' AND i.expires_at>now()
  UNION ALL
  SELECT c.team_id,a.email FROM boff_dev_internal.co_manager_links c JOIN auth.users a ON a.id=c.user_id
   WHERE c.league_id=p_league
 ) m JOIN auth.users u ON lower(u.email)=lower(m.invited_email)
 WHERE u.email_confirmed_at IS NULL AND u.deleted_at IS NULL AND coalesce(u.banned_until,'-infinity')<=now()
 ORDER BY u.id,m.team_id NULLS LAST
$$;

CREATE FUNCTION public.dev_commissioner_verifications(p_league uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.account_id,'team',coalesce(t.team_name,'League Invitation'),
  'emailHint',left(u.email,1)||'•••@'||split_part(u.email,'@',2)) ORDER BY t.team_name,u.account_id)
  FROM boff_dev_internal.unverified_league_accounts(p_league) u LEFT JOIN public.teams t ON t.id=u.team_id),'[]');
END $$;

CREATE FUNCTION public.dev_member_verification_resend(p_league uuid,p_account uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text;
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('verification-resend:'||p_account,0));
 SELECT email INTO address FROM boff_dev_internal.unverified_league_accounts(p_league) WHERE account_id=p_account;
 IF address IS NULL THEN RAISE EXCEPTION 'No pending verification for this league account'; END IF;
 IF EXISTS(SELECT FROM public.admin_change_log WHERE league_id=p_league AND category='verification_resend'
  AND after_value->>'account_id'=p_account::text AND created_at>now()-interval '60 seconds')
  THEN RAISE EXCEPTION 'Wait one minute before resending'; END IF;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(p_league,auth.uid(),'verification_resend','Commissioner verification resend requested','{}',jsonb_build_object('account_id',p_account));
 RETURN address;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.unverified_league_accounts(uuid),public.dev_email_standings(uuid),
 public.dev_outbound_email_is_verified(uuid),public.dev_commissioner_verifications(uuid),
 public.dev_member_verification_resend(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_email_standings(uuid),public.dev_outbound_email_is_verified(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_commissioner_verifications(uuid),public.dev_member_verification_resend(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
