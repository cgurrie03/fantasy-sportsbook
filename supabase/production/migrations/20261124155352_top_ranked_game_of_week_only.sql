BEGIN;
DO $$DECLARE definition text; BEGIN
 IF coalesce(public.application_environment_identity()->>'project_ref','') NOT IN ('bmvjcdgxwxqalaohpsnw','whlcnlacueweaqpsupqs') THEN RAISE EXCEPTION 'Known Boff environment required'; END IF;
 SELECT pg_get_functiondef('boff_dev_internal.apply_feature_settings(uuid,integer,jsonb,jsonb,integer,integer,integer,integer)'::regprocedure) INTO definition;
 IF strpos(definition,'(''game'',8,true)')=0 THEN RAISE EXCEPTION 'Game of the Week eligibility definition changed'; END IF;
 EXECUTE replace(definition,'(''game'',8,true)','(''game'',8,c.matchup=(SELECT best.matchup FROM ranked best ORDER BY best.rating DESC,best.matchup LIMIT 1))');
END $$;
-- Current pregame assignments may refresh; accepted tickets and kickoff locks stay intact.
UPDATE public.dev_live_cache SET next_refresh_at='epoch' WHERE key IN('nfl','league:1312126153980391424');
COMMIT;
