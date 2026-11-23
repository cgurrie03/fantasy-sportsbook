DO $$DECLARE body text;BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;
 SELECT pg_get_functiondef('public.dev_submit_support(uuid,text,text,text,uuid)'::regprocedure) INTO body;
 body:=replace(body,'IF NOT sportsbook_private.is_member(p_league)', 'IF p_league IS NULL OR NOT EXISTS(SELECT FROM public.leagues WHERE id=p_league) OR NOT sportsbook_private.is_member(p_league)');
 IF strpos(body,'person:=coalesce(person,''Platform Owner'')')=0 THEN RAISE EXCEPTION 'Support identity definition changed';END IF;
 body:=replace(body,'person:=coalesce(person,''Platform Owner'')',
 'person:=coalesce(person,(SELECT display_name FROM public.league_memberships WHERE league_id=p_league AND user_id=actor),CASE WHEN sportsbook_private.is_platform_owner() THEN ''Platform Owner'' ELSE ''League Member'' END)');
 EXECUTE body;
END $$;
