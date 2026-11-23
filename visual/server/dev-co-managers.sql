DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE TABLE boff_dev_internal.co_manager_links (
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 team_id uuid NOT NULL REFERENCES public.teams(id),
 sleeper_user_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 display_name text NOT NULL,
 PRIMARY KEY(league_id,team_id,sleeper_user_id), UNIQUE(league_id,user_id)
);
ALTER TABLE boff_dev_internal.co_manager_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.co_manager_links FROM PUBLIC,anon,authenticated,service_role;

CREATE VIEW boff_dev_internal.participant_links AS
 SELECT league_id,team_id,user_id,display_name,sleeper_user_id FROM public.league_memberships
 UNION ALL SELECT league_id,team_id,user_id,display_name,sleeper_user_id FROM boff_dev_internal.co_manager_links;
REVOKE ALL ON boff_dev_internal.participant_links FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_co_manager_account(p_league uuid,p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('team_id',m.team_id,'display_name',m.display_name,'role','member')
 FROM boff_dev_internal.co_manager_links m JOIN auth.users u ON u.id=m.user_id
 WHERE m.league_id=p_league AND m.user_id=p_user AND u.email_confirmed_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.dev_co_manager_account(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_co_manager_account(uuid,uuid) TO service_role;

CREATE FUNCTION public.dev_change_co_manager(p_league uuid,p_team uuid,p_sleeper text,p_expected uuid,p_email text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior boff_dev_internal.co_manager_links; account auth.users; manager jsonb; wallet_id uuid;
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 400 THEN RAISE EXCEPTION 'Enter a reason between 8 and 400 characters'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('dev-commissioner-members'),hashtext(p_league::text));
 SELECT person.value INTO manager
 FROM public.teams t JOIN public.leagues l ON l.id=t.league_id
 JOIN public.dev_live_cache c ON c.key='league:'||l.sleeper_league_id AND c.payload->'metadata'->>'season'=l.nfl_season::text
 CROSS JOIN LATERAL jsonb_array_elements(c.payload->'metadata'->'teams') source
 CROSS JOIN LATERAL jsonb_array_elements(source.value->'coManagers') person
 WHERE t.id=p_team AND l.id=p_league AND (source.value->>'rosterId')::integer=t.roster_id AND person.value->>'id'=p_sleeper;
 SELECT * INTO prior FROM boff_dev_internal.co_manager_links WHERE league_id=p_league AND team_id=p_team AND sleeper_user_id=p_sleeper FOR UPDATE;
 IF prior.user_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Mapping changed. Reload before saving'; END IF;
 IF prior.user_id IS NOT NULL AND (
  prior.user_id=auth.uid() OR EXISTS(SELECT FROM sportsbook_private.platform_owners WHERE user_id=prior.user_id)
  OR EXISTS(SELECT FROM public.league_staff_grants WHERE league_id=p_league AND user_id=prior.user_id AND active))
 THEN RAISE EXCEPTION 'Staff access requires platform-owner review'; END IF;
 IF p_email IS NOT NULL THEN
  IF manager IS NULL THEN RAISE EXCEPTION 'This person is not a verified Sleeper co-manager for the selected team'; END IF;
  SELECT * INTO account FROM auth.users WHERE lower(email)=lower(trim(p_email)) AND email_confirmed_at IS NOT NULL;
  IF account.id IS NULL THEN RAISE EXCEPTION 'This person needs an existing verified Boff account'; END IF;
  IF account.id=prior.user_id THEN RETURN public.dev_commissioner_members(p_league); END IF;
  IF EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND (user_id=account.id OR invited_email=lower(account.email)))
   OR EXISTS(SELECT FROM boff_dev_internal.co_manager_links WHERE league_id=p_league AND user_id=account.id)
   OR EXISTS(SELECT FROM public.user_wallets WHERE league_id=p_league AND user_id=account.id AND (team_id<>p_team OR status<>'approved'))
  THEN RAISE EXCEPTION 'An existing league or wallet identity requires platform-owner review'; END IF;
 ELSIF prior.user_id IS NULL THEN RAISE EXCEPTION 'No linked co-manager to remove';
 END IF;

 IF prior.user_id IS NOT NULL THEN
  UPDATE public.user_wallets SET status='revoked',revision=revision+1,updated_at=clock_timestamp()
   WHERE league_id=p_league AND user_id=prior.user_id AND status='approved' RETURNING id INTO wallet_id;
  IF wallet_id IS NOT NULL THEN INSERT INTO sportsbook_private.user_wallet_approvals(wallet_id,actor,reason)
   VALUES(wallet_id,auth.uid(),trim(p_reason)); END IF;
  DELETE FROM boff_dev_internal.co_manager_links WHERE league_id=p_league AND team_id=p_team AND sleeper_user_id=p_sleeper;
 END IF;
 IF account.id IS NOT NULL THEN
  INSERT INTO boff_dev_internal.co_manager_links VALUES(p_league,p_team,p_sleeper,account.id,
   left(coalesce(nullif(account.raw_user_meta_data->>'display_name',''),nullif(account.raw_user_meta_data->>'full_name',''),manager->>'name'),80));
 END IF;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value) VALUES(
  p_league,auth.uid(),'commissioner_membership',trim(p_reason),
  jsonb_build_object('team_id',p_team,'user_id',prior.user_id,'sleeper_id',p_sleeper),
  jsonb_build_object('team_id',p_team,'user_id',account.id,'sleeper_id',p_sleeper));
 RETURN public.dev_commissioner_members(p_league);
END $$;
REVOKE ALL ON FUNCTION public.dev_change_co_manager(uuid,uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_change_co_manager(uuid,uuid,text,uuid,text,text) TO authenticated;

DO $$ DECLARE body text; updated text; fn regprocedure; BEGIN
 SELECT pg_get_functiondef('sportsbook_private.is_member(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'select sportsbook_private.is_platform_owner()',
  'select sportsbook_private.is_platform_owner() or public.dev_co_manager_account(p_league,auth.uid()) is not null');
 IF updated=body THEN RAISE EXCEPTION 'Missing membership scope hook'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_change_commissioner_member(uuid,uuid,uuid,text,text)'::regprocedure) INTO body;
 updated:=replace(body,'IF EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND (user_id=account.id OR invited_email=lower(account.email)))',
  'IF EXISTS(SELECT FROM boff_dev_internal.co_manager_links WHERE league_id=p_league AND user_id=account.id)
   OR EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND (user_id=account.id OR invited_email=lower(account.email)))');
 IF updated=body THEN RAISE EXCEPTION 'Missing primary mapping check'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_commissioner_members(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'''coManagers'',source.value->''coManagers''', $co$
 'coManagers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',person.id,'name',person.name,'avatar',person.avatar,'accountId',link.user_id,'member',link.display_name,
  'walletStatus',wallet.status,'walletInitialized',wallet.balance IS NOT NULL,'departed',person.departed)
 ORDER BY person.departed,person.name),'[]') FROM (
   SELECT j->>'id' id,j->>'name' name,j->>'avatar' avatar,false departed
   FROM jsonb_array_elements(source.value->'coManagers') j
   UNION ALL SELECT x.sleeper_user_id,x.display_name,NULL,true FROM boff_dev_internal.co_manager_links x
   WHERE x.league_id=t.league_id AND x.team_id=t.id
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(source.value->'coManagers') j WHERE j->>'id'=x.sleeper_user_id)
  ) person LEFT JOIN boff_dev_internal.co_manager_links link
   ON link.league_id=t.league_id AND link.team_id=t.id AND link.sleeper_user_id=person.id
  LEFT JOIN public.user_wallets wallet ON wallet.league_id=t.league_id AND wallet.user_id=link.user_id)
 $co$);
 IF updated=body THEN RAISE EXCEPTION 'Missing co-manager directory hook'; END IF;
 EXECUTE updated;

 FOREACH fn IN ARRAY ARRAY[
   'public.dev_standings_wallets(uuid)'::regprocedure,
   'public.dev_credit_claim(uuid,uuid)'::regprocedure,
   'public.record_dev_fantasy_rewards(uuid,integer,integer,jsonb,jsonb,timestamptz,jsonb)'::regprocedure,
   'public.dev_notification_choices(uuid,jsonb)'::regprocedure,
   'public.dev_notification_candidates(uuid)'::regprocedure,
   'public.dev_capture_notification(uuid,uuid,text,text,text,text,text)'::regprocedure,
   'public.dev_push_device(uuid,text,jsonb)'::regprocedure,
   'boff_dev_internal.apply_futures_season_transition()'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(fn) INTO body;
  EXECUTE replace(body,'public.league_memberships','boff_dev_internal.participant_links');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';

