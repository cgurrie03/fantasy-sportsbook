DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END $$;

CREATE TABLE boff_dev_internal.futures_rule_versions (
  league_id uuid REFERENCES public.leagues(id),
  season integer,
  revision integer CHECK (revision > 0),
  rules jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (league_id, season, revision)
);
ALTER TABLE boff_dev_internal.futures_rule_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.futures_rule_versions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.dev_futures_rules(p_league uuid, p_revision integer DEFAULT NULL, p_rules jsonb DEFAULT NULL, p_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  league public.leagues;
  saved boff_dev_internal.futures_rule_versions;
  sleeper jsonb;
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs'
    OR auth.uid() IS NULL OR NOT (sportsbook_private.is_admin(p_league) OR sportsbook_private.is_platform_owner()) THEN
    RAISE EXCEPTION 'Commissioner access required';
  END IF;
  SELECT * INTO STRICT league FROM public.leagues WHERE id = p_league;
  SELECT payload->'metadata' INTO sleeper FROM public.dev_live_cache
  WHERE key = 'league:' || league.sleeper_league_id AND payload->'metadata'->>'season' = league.nfl_season::text;
  IF p_rules IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('boff-dev-futures-rules'), hashtext(p_league::text));
  END IF;
  SELECT * INTO saved FROM boff_dev_internal.futures_rule_versions
  WHERE league_id = p_league AND season = league.nfl_season ORDER BY revision DESC LIMIT 1;
  IF p_rules IS NOT NULL THEN
    IF p_confirmed IS DISTINCT FROM true OR p_revision IS DISTINCT FROM COALESCE(saved.revision, 0) THEN
      RAISE EXCEPTION 'Confirm the change against the latest saved rules';
    END IF;
    IF jsonb_typeof(p_rules) <> 'object' OR octet_length(p_rules::text) > 1024
      OR (p_rules - ARRAY['qualification','firstPick','rostersReady']) <> '{}'::jsonb
      OR COALESCE(p_rules->>'qualification','') NOT IN ('sleeper','head_to_head','official_bracket')
      OR COALESCE(p_rules->>'firstPick','') NOT IN ('disabled','regular_season','toilet_bowl')
      OR jsonb_typeof(p_rules->'rostersReady') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Invalid futures rules';
    END IF;
    IF p_rules->>'firstPick' <> 'disabled' AND sleeper->'settings'->>'leagueType' IS DISTINCT FROM '2' THEN
      RAISE EXCEPTION '#1 Pick requires a verified Sleeper dynasty league';
    END IF;
    IF saved.rules IS DISTINCT FROM p_rules THEN
      INSERT INTO boff_dev_internal.futures_rule_versions(league_id, season, revision, rules, actor_id)
      VALUES (p_league, league.nfl_season, p_revision + 1, p_rules, auth.uid())
      RETURNING * INTO saved;
    END IF;
  END IF;
  RETURN jsonb_build_object('revision', COALESCE(saved.revision, 0), 'rules',
    COALESCE(saved.rules, '{"qualification":"sleeper","firstPick":"disabled","rostersReady":false}'::jsonb),
    'season', league.nfl_season, 'leagueSize', jsonb_array_length(sleeper->'teams'), 'sleeper', sleeper->'settings');
END $$;
REVOKE ALL ON FUNCTION public.dev_futures_rules(uuid, integer, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dev_futures_rules(uuid, integer, jsonb, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
