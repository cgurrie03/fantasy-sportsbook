DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE FUNCTION boff_dev_internal.can_manage_members(p_league uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL)
 AND (sportsbook_private.is_platform_owner() OR EXISTS(
  SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid() AND role='admin'))
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.can_manage_members(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_commissioner_members(p_league uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 RETURN jsonb_build_object('teams',coalesce((
  SELECT jsonb_agg(jsonb_build_object('teamId',t.id,'team',t.team_name,'rosterId',t.roster_id,
   'memberId',m.id,'member',m.display_name,'role',m.role,'mappedSleeperId',m.sleeper_user_id,
   'sleeperId',source.value->>'ownerId','sleeperName',source.value->'managers'->>0,
   'walletStatus',w.status,'walletInitialized',w.balance IS NOT NULL) ORDER BY t.roster_id)
  FROM public.teams t JOIN public.leagues l ON l.id=t.league_id
  LEFT JOIN public.league_memberships m ON m.league_id=t.league_id AND m.team_id=t.id
  LEFT JOIN public.user_wallets w ON w.league_id=t.league_id AND w.user_id=m.user_id
  LEFT JOIN public.dev_live_cache cache ON cache.key='league:'||l.sleeper_league_id
   AND cache.payload->'metadata'->>'season'=l.nfl_season::text
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(cache.payload->'metadata'->'teams')
   WHERE (value->>'rosterId')::integer=t.roster_id LIMIT 1) source ON true
  WHERE t.league_id=p_league),'[]'));
END $$;

CREATE FUNCTION public.dev_change_commissioner_member(p_league uuid,p_team uuid,p_expected uuid,p_email text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.league_memberships; account auth.users; target record; wallet public.user_wallets;
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 400 THEN RAISE EXCEPTION 'Enter a reason between 8 and 400 characters'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('dev-commissioner-members'),hashtext(p_league::text));
 SELECT t.id,l.nfl_season,source.value->>'ownerId' sleeper_id,source.value->'managers'->>0 display_name
 INTO STRICT target FROM public.teams t JOIN public.leagues l ON l.id=t.league_id
 LEFT JOIN public.dev_live_cache c ON c.key='league:'||l.sleeper_league_id AND c.payload->'metadata'->>'season'=l.nfl_season::text
 LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(c.payload->'metadata'->'teams') WHERE (value->>'rosterId')::integer=t.roster_id LIMIT 1) source ON true
 WHERE t.id=p_team AND t.league_id=p_league;
 SELECT * INTO prior FROM public.league_memberships WHERE league_id=p_league AND team_id=p_team FOR UPDATE;
 IF prior.id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Mapping changed. Reload before saving'; END IF;
 IF prior.id IS NULL AND p_email IS NULL THEN RAISE EXCEPTION 'No mapped member to remove'; END IF;
 IF prior.role='admin' OR prior.user_id=auth.uid()
  OR EXISTS(SELECT FROM sportsbook_private.platform_owners WHERE user_id=prior.user_id)
  OR EXISTS(SELECT FROM public.league_staff_grants WHERE league_id=p_league AND user_id=prior.user_id AND active)
  OR EXISTS(SELECT FROM sportsbook_private.platform_owner WHERE membership_id=prior.id)
 THEN RAISE EXCEPTION 'Commissioner and staff access requires platform-owner review'; END IF;

 IF p_email IS NOT NULL THEN
  IF target.sleeper_id IS NULL THEN RAISE EXCEPTION 'Wait for a verified Sleeper roster sync'; END IF;
  SELECT * INTO account FROM auth.users WHERE lower(email)=lower(trim(p_email)) AND email_confirmed_at IS NOT NULL;
  IF account.id IS NULL THEN RAISE EXCEPTION 'The replacement needs an existing verified Boff account'; END IF;
  IF EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND (user_id=account.id OR invited_email=lower(account.email)))
   OR EXISTS(SELECT FROM public.user_wallets WHERE league_id=p_league AND user_id=account.id)
  THEN RAISE EXCEPTION 'An existing league or wallet identity requires platform-owner review'; END IF;
 END IF;

 IF prior.id IS NOT NULL THEN
  UPDATE public.user_wallets SET status='revoked',revision=revision+1,updated_at=clock_timestamp()
   WHERE league_id=p_league AND user_id=prior.user_id AND status='approved' RETURNING * INTO wallet;
  IF wallet.id IS NOT NULL THEN
   INSERT INTO sportsbook_private.user_wallet_approvals(wallet_id,actor,reason) VALUES(wallet.id,auth.uid(),trim(p_reason));
  END IF;
  DELETE FROM public.league_memberships WHERE id=prior.id;
 END IF;
 IF account.id IS NOT NULL THEN
  INSERT INTO public.league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id)
  VALUES(p_league,p_team,account.id,lower(account.email),left(coalesce(target.display_name,'Participant'),80),target.sleeper_id);
 END IF;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(p_league,auth.uid(),'commissioner_membership',trim(p_reason),
  jsonb_build_object('team_id',p_team,'user_id',prior.user_id,'sleeper_id',prior.sleeper_user_id),
  jsonb_build_object('team_id',p_team,'user_id',account.id,'sleeper_id',CASE WHEN account.id IS NOT NULL THEN target.sleeper_id END));
 RETURN public.dev_commissioner_members(p_league);
END $$;
REVOKE ALL ON FUNCTION public.dev_commissioner_members(uuid),public.dev_change_commissioner_member(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.dev_commissioner_members(uuid),public.dev_change_commissioner_member(uuid,uuid,uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
