-- Remove this round's agent-created inactive fixture, including its automatically
-- initialized baseline. Locking and one atomic block keep the history guard intact
-- for every other row and every other database session.
DO $cleanup$
DECLARE actors uuid[];fixture uuid;fixture_team uuid;digest_before text;digest_after text;
BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;
 SELECT l.id INTO fixture FROM public.leagues l WHERE l.name='AUD1213 Isolated Test League' AND NOT l.operations_enabled
 AND EXISTS(SELECT FROM public.league_memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.league_id=l.id AND u.email~'^aud1213-commissioner-[a-f0-9]{10}@example.invalid$') FOR UPDATE;
 IF fixture IS NULL THEN RETURN;END IF;
 SELECT array_agg(id) INTO actors FROM auth.users WHERE email~'^aud1213-(owner|commissioner|member|stranger)-[a-f0-9]{10}@example.invalid$' AND email_confirmed_at IS NOT NULL;
 IF cardinality(actors)<>4 OR(SELECT count(*) FROM public.teams WHERE league_id=fixture)<>1 THEN RAISE EXCEPTION 'Fixture scope changed';END IF;
 SELECT id INTO fixture_team FROM public.teams WHERE league_id=fixture;
 IF EXISTS(SELECT FROM public.tickets WHERE league_id=fixture)
 OR EXISTS(SELECT FROM public.user_wallet_entries e JOIN public.user_wallets w ON w.id=e.wallet_id WHERE w.user_id=ANY(actors))
 OR(SELECT count(*) FROM public.model_config_versions WHERE league_id=fixture)<>1
 OR EXISTS(SELECT FROM public.model_config_versions WHERE league_id=fixture AND parent_id IS NOT NULL)
 OR EXISTS(SELECT FROM public.model_forecast_runs WHERE league_id=fixture)
 OR EXISTS(SELECT FROM public.model_evaluation_samples WHERE league_id=fixture)
 OR EXISTS(SELECT FROM public.model_change_events WHERE league_id=fixture)
 OR EXISTS(SELECT FROM public.model_prospective_state WHERE league_id=fixture)
 THEN RAISE EXCEPTION 'Fixture contains unexpected business records';END IF;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY id)::text,'[]')) INTO digest_before FROM public.model_config_versions v WHERE league_id<>fixture;
 DELETE FROM auth.refresh_tokens WHERE user_id=ANY(ARRAY(SELECT x::text FROM unnest(actors)x));
 DELETE FROM auth.sessions WHERE user_id=ANY(actors);
 DELETE FROM auth.identities WHERE user_id=ANY(actors);
 DELETE FROM boff_dev_internal.support_requests WHERE user_id=ANY(actors);
 DELETE FROM boff_dev_internal.notification_choices WHERE user_id=ANY(actors);
 DELETE FROM boff_dev_internal.notification_capture WHERE user_id=ANY(actors);
 DELETE FROM sportsbook_private.platform_owners WHERE user_id=ANY(actors);
 DELETE FROM boff_dev_internal.co_manager_links WHERE user_id=ANY(actors);
 DELETE FROM public.league_memberships WHERE user_id=ANY(actors);
 DELETE FROM public.user_wallets WHERE user_id=ANY(actors);
 DELETE FROM public.admin_change_log WHERE league_id=fixture OR actor_id=ANY(actors);
 DELETE FROM public.wallets WHERE team_id=fixture_team;
 DELETE FROM public.teams WHERE id=fixture_team;
 DELETE FROM public.model_controls WHERE league_id=fixture;
 DELETE FROM public.evaluation_retention_health WHERE league_id=fixture;
 LOCK TABLE public.model_config_versions IN ACCESS EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.model_config_versions'::regclass AND tgname='immutable_model_history' AND tgenabled='O') THEN RAISE EXCEPTION 'Unexpected history guard state';END IF;
 ALTER TABLE public.model_config_versions DISABLE TRIGGER immutable_model_history;
 DELETE FROM public.model_config_versions WHERE league_id=fixture AND parent_id IS NULL;
 ALTER TABLE public.model_config_versions ENABLE TRIGGER immutable_model_history;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY id)::text,'[]')) INTO digest_after FROM public.model_config_versions v WHERE league_id<>fixture;
 IF digest_before IS DISTINCT FROM digest_after THEN RAISE EXCEPTION 'Original model history changed';END IF;
 DELETE FROM public.leagues WHERE id=fixture;
 DELETE FROM auth.users WHERE id=ANY(actors);
END $cleanup$;
