BEGIN;
DO $$DECLARE definition text; region text; revised text; start_at integer; end_at integer; BEGIN
 IF coalesce(public.application_environment_identity()->>'project_ref','') NOT IN ('bmvjcdgxwxqalaohpsnw','whlcnlacueweaqpsupqs') THEN RAISE EXCEPTION 'Known Boff environment required'; END IF;
 SELECT pg_get_functiondef('boff_dev_internal.apply_feature_settings(uuid,integer,jsonb,jsonb,integer,integer,integer,integer)'::regprocedure) INTO definition;
 start_at:=strpos(definition,'WHEN ''playoff'' THEN CASE f.playoff_mode');
 IF start_at=0 THEN RAISE EXCEPTION 'Playoff recipient definition changed'; END IF;
 end_at:=strpos(substring(definition FROM start_at),'ELSE false END END');
 IF end_at=0 THEN RAISE EXCEPTION 'Playoff recipient boundary changed'; END IF;
 region:=substring(definition FROM start_at FOR end_at+length('ELSE false END END')-1);
 IF strpos(region,'WHEN ''away-racing'' THEN q->>''team_id''=f.home')=0 OR strpos(region,'WHEN ''home-racing'' THEN q->>''team_id''=f.away')=0 THEN RAISE EXCEPTION 'Expected spoiler rules required before reversal'; END IF;
 revised:=replace(replace(replace(region,'q->>''team_id''=f.home','q->>''team_id''=f.__swap'),'q->>''team_id''=f.away','q->>''team_id''=f.home'),'q->>''team_id''=f.__swap','q->>''team_id''=f.away');
 EXECUTE replace(definition,region,revised);
END $$;
-- Reprice unstarted current-week selections. Accepted ticket terms remain immutable.
UPDATE public.dev_live_cache SET next_refresh_at='epoch' WHERE key IN('nfl','league:1312126153980391424');
COMMIT;
