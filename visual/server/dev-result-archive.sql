DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END $$;

CREATE FUNCTION public.archive_dev_result_week(p_league uuid, p_season integer, p_week integer, p_results jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development result worker required';
  END IF;
  IF NOT EXISTS (SELECT FROM public.leagues WHERE id = p_league AND nfl_season = p_season)
    OR jsonb_typeof(p_results) IS DISTINCT FROM 'object'
    OR p_results = '{}'::jsonb
    OR EXISTS (SELECT FROM jsonb_each(p_results) AS t WHERE jsonb_typeof(t.value->'points') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'Invalid weekly results';
  END IF;
  INSERT INTO public.league_result_weeks AS w (league_id, nfl_season, market_week, final, source, results)
  VALUES (p_league, p_season, p_week, true, 'Sleeper', p_results)
  ON CONFLICT (league_id, nfl_season, market_week) DO UPDATE SET
    final = true, fetched_at = clock_timestamp(), results = excluded.results
  WHERE NOT w.final;
END $$;

REVOKE ALL ON FUNCTION public.archive_dev_result_week(uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_dev_result_week(uuid, integer, integer, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
