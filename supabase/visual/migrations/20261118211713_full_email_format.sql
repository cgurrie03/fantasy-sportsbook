DO $$ BEGIN IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;END $$;
-- Compatibility argument retained; email/push channel opt-outs remain unchanged.
CREATE OR REPLACE FUNCTION boff_dev_internal.communication_details(p_choices jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION boff_dev_internal.email_league_report(p_user uuid, p_league uuid, p_kind text, p_week integer, p_details boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE member record; league public.leagues; payload jsonb; week integer;
BEGIN
 p_details:=true;
 IF p_kind NOT IN ('opening','recap','monday_watch','credit') THEN RAISE EXCEPTION 'Unsupported report'; END IF;
 SELECT * INTO member FROM boff_dev_internal.participant_links WHERE league_id=p_league AND user_id=p_user;
 IF member.team_id IS NULL OR NOT EXISTS(SELECT FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Active verified membership required' USING ERRCODE='42501'; END IF;
 SELECT * INTO league FROM public.leagues WHERE id=p_league;
 SELECT b.payload INTO payload FROM public.dev_current_book b WHERE b.league_id=p_league;
 IF payload IS NULL THEN RAISE EXCEPTION 'League report unavailable'; END IF;
 week:=coalesce(p_week,league.active_week);
 IF week NOT BETWEEN 1 AND 18 THEN RAISE EXCEPTION 'Invalid report week'; END IF;
 RETURN jsonb_build_object('id',league.id,'name',league.name,'path','/'||league.sleeper_league_id,'week',week,
  'teamId',member.team_id,'details',coalesce(p_details,false),'payload',jsonb_build_object('teams',payload->'teams','leagueAvatar',coalesce(payload->'leagueAvatar',to_jsonb(league.avatar_url)),'leagueName',league.name),
  'edition',CASE WHEN p_details THEN boff_dev_internal.email_edition_for_user(p_league,p_user,p_kind,week,NULL) ELSE '{}'::jsonb END);
END $function$;

CREATE OR REPLACE FUNCTION public.dev_email_switcher(p_user uuid, p_kind text, p_week integer, p_primary uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE options jsonb; item jsonb; reports jsonb:='[]'; choice jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Mail worker required'; END IF;
 IF p_kind NOT IN ('opening','recap','monday_watch','credit') THEN RAISE EXCEPTION 'Unsupported report'; END IF;
 options:=boff_dev_internal.email_league_options(p_user);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(options) x WHERE x->>'id'=p_primary::text)
 THEN RAISE EXCEPTION 'Primary membership unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(options) x ORDER BY x->>'id'=p_primary::text DESC,x->>'name' LIMIT 12 LOOP
  SELECT c.choices->p_kind INTO choice FROM boff_dev_internal.notification_choices c WHERE c.user_id=p_user AND c.league_id=(item->>'id')::uuid;
  IF coalesce((choice->>'email')::boolean,true) THEN
   reports:=reports||jsonb_build_array(boff_dev_internal.email_league_report(p_user,(item->>'id')::uuid,p_kind,p_week,true));
  END IF;
 END LOOP;
 RETURN reports;
END $function$;

CREATE OR REPLACE FUNCTION public.dev_email_switcher_scope(p_recipient text, p_kind text, p_leagues jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE account uuid; item jsonb; choice jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Mail worker required'; END IF;
 IF p_kind NOT IN ('opening','recap','monday_watch','credit') OR jsonb_typeof(p_leagues) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_leagues) NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
 SELECT id INTO account FROM auth.users WHERE lower(email)=lower(p_recipient) AND email_confirmed_at IS NOT NULL;
 IF account IS NULL THEN RETURN false; END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(p_leagues) x LOOP
  IF NOT EXISTS(SELECT FROM boff_dev_internal.participant_links WHERE league_id=(item->>'id')::uuid AND user_id=account)
  THEN RETURN false; END IF;
  SELECT c.choices->p_kind INTO choice FROM boff_dev_internal.notification_choices c WHERE c.user_id=account AND c.league_id=(item->>'id')::uuid;
  IF NOT coalesce((choice->>'email')::boolean,true)
  THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $function$;
