BEGIN;
DO $$DECLARE definition text; BEGIN
 IF public.application_environment_identity()->>'project_ref' NOT IN ('bmvjcdgxwxqalaohpsnw','whlcnlacueweaqpsupqs') THEN RAISE EXCEPTION 'Known Boff environment required'; END IF;
 SELECT pg_get_functiondef('boff_dev_internal.apply_feature_settings(uuid,integer,jsonb,jsonb,integer,integer,integer,integer)'::regprocedure) INTO definition;
 IF strpos(definition,'slot<=cap AND ')=0 OR strpos(definition,'count(*) OVER ()/2 cap,')=0 THEN RAISE EXCEPTION 'Featured limit definition changed; review before migration'; END IF;
 -- Every eligible matchup may receive its highest-priority category. Keep one Game of the Week.
 EXECUTE replace(replace(definition,'count(*) OVER ()/2 cap,',''),'slot<=cap AND ','');
END $$;
CREATE OR REPLACE FUNCTION public.dev_co_manager_account(p_league uuid,p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('team_id',m.team_id,'display_name',m.display_name,'role','member','sleeper_user_id',m.sleeper_user_id)
 FROM boff_dev_internal.co_manager_links m JOIN auth.users u ON u.id=m.user_id
 WHERE m.league_id=p_league AND m.user_id=p_user AND u.email_confirmed_at IS NOT NULL
$$;
-- No privilege changes: CREATE OR REPLACE retains the existing restricted ACL.
UPDATE public.dev_live_cache SET next_refresh_at='epoch' WHERE key IN('nfl','league:1312126153980391424');
COMMIT;
