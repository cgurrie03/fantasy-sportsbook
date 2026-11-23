DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE FUNCTION public.dev_league_intake_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.league_intake_owner() THEN RAISE EXCEPTION 'Verified platform owner required'; END IF;
 RETURN jsonb_build_object('season',coalesce((SELECT max(l.nfl_season) FROM public.leagues l JOIN boff_dev_internal.participant_links p ON p.league_id=l.id WHERE p.user_id=auth.uid()),extract(year from now())::integer),
  'sleeperUsers',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM(SELECT sleeper_user_id AS id,min(display_name) AS name FROM boff_dev_internal.participant_links
    WHERE user_id=auth.uid() AND sleeper_user_id~'^[0-9]{1,32}$' GROUP BY sleeper_user_id ORDER BY sleeper_user_id LIMIT 3)s),'[]'),
  'linked',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'sleeperId',sleeper_league_id,'name',name)) FROM(SELECT id,sleeper_league_id,name FROM public.leagues ORDER BY name LIMIT 1000)l),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.dev_league_intake_context() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_league_intake_context() TO authenticated;

CREATE FUNCTION boff_dev_internal.sleeper_manager_status(p_league uuid,p_team uuid,p_co boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_co THEN 'Co-Manager' WHEN coalesce((
  SELECT jsonb_array_length(s.value->'coManagers') FROM public.dev_live_cache c CROSS JOIN LATERAL jsonb_array_elements(c.payload->'metadata'->'teams')s
  WHERE c.key=(SELECT 'league:'||sleeper_league_id FROM public.leagues WHERE id=p_league) AND (s.value->>'rosterId')::integer=t.roster_id
 ),cardinality(t.co_owner_names),0)>0 THEN 'Primary Manager' ELSE 'Solo Manager' END
 FROM public.teams t WHERE t.id=p_team AND t.league_id=p_league
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.sleeper_manager_status(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE body text; anchor text; BEGIN
 SELECT pg_get_functiondef('public.save_league_intake_draft(uuid,jsonb,jsonb)'::regprocedure) INTO body;
 anchor:=' update public.league_intake_drafts set state=''expired''';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Intake definition changed'; END IF;
 body:=replace(body,anchor,E' IF EXISTS(SELECT FROM public.leagues WHERE sleeper_league_id=p_source->>''league_id'') THEN RAISE EXCEPTION ''This Sleeper league is already connected. Review its existing setup or renewal.''; END IF;\n'||anchor);
 anchor:=' if (select count(*) from public.league_intake_drafts where owner_id=auth.uid() and state=''draft'')>=4';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Intake admission definition changed'; END IF;
 body:=replace(body,anchor,E' SELECT * INTO d FROM public.league_intake_drafts WHERE owner_id=auth.uid() AND source_league_id=p_source->>''league_id'' AND state=''draft'' AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1;\n IF FOUND THEN\n IF d.payload_md5=h THEN RETURN jsonb_build_object(''id'',d.id,''revision'',d.revision,''state'',d.state,''duplicate'',true); END IF;\n UPDATE public.league_intake_drafts SET state=''expired'',source=''{}'',capabilities=''{}'',revision=revision+1 WHERE id=d.id;\n END IF;\n'||anchor);
 EXECUTE body;
 SELECT pg_get_functiondef('public.dev_prepare_member_invitation(uuid,uuid,text,boolean,uuid,text,text,uuid,text)'::regprocedure) INTO body;
 anchor:='jsonb_build_object(''id'',invitation.id,';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Invitation preparation definition changed'; END IF;
 EXECUTE replace(body,anchor,anchor||'''managerStatus'',boff_dev_internal.sleeper_manager_status(p_league,p_team,p_co),');
 SELECT pg_get_functiondef('public.dev_pending_member_invitations(uuid)'::regprocedure) INTO body;
 anchor:='jsonb_build_object(''id'',i.id,';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Pending invitation definition changed'; END IF;
 EXECUTE replace(body,anchor,anchor||'''managerStatus'',boff_dev_internal.sleeper_manager_status(i.league_id,i.team_id,i.co_manager),');
 SELECT pg_get_functiondef('public.dev_accept_member_invitation(text,boolean)'::regprocedure) INTO body;
 anchor:='jsonb_build_object(''league'',';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Invitation acceptance definition changed'; END IF;
 EXECUTE replace(body,anchor,'jsonb_build_object(''managerStatus'',boff_dev_internal.sleeper_manager_status(i.league_id,i.team_id,i.co_manager),''league'',');
END $$;
NOTIFY pgrst,'reload schema';
