DO $$ DECLARE body text; BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.dev_ticket_history_page(uuid,boolean,text,integer,uuid,text,text,jsonb,integer)'::regprocedure) INTO body;
 IF strpos(body,'p_participant IS NULL OR t.user_wallet_id=p_participant')=0 THEN RAISE EXCEPTION 'History definition changed';END IF;
 body:=replace(body,'p_participant IS NULL OR t.user_wallet_id=p_participant','p_participant IS NULL OR t.user_wallet_id=p_participant OR (t.user_wallet_id IS NULL AND t.team_id=p_participant)');
 IF strpos(body,'SELECT user_wallet_id AS id,max(coalesce(bettor_display_name,''Historical Participant'')) AS name FROM scope WHERE user_wallet_id IS NOT NULL GROUP BY user_wallet_id')=0 THEN RAISE EXCEPTION 'Participant definition changed';END IF;
 body:=replace(body,'SELECT user_wallet_id AS id,max(coalesce(bettor_display_name,''Historical Participant'')) AS name FROM scope WHERE user_wallet_id IS NOT NULL GROUP BY user_wallet_id',
 'SELECT coalesce(s.user_wallet_id,s.team_id) AS id,max(coalesce(s.bettor_display_name,t.team_name||'' · Historical Team'')) AS name FROM scope s JOIN public.teams t ON t.id=s.team_id GROUP BY coalesce(s.user_wallet_id,s.team_id)');
 EXECUTE body;
END $$;
