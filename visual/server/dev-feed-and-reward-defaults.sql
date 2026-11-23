DO $$ DECLARE definition text; old text:='COALESCE((settings.rules->''maxRecipients''->>(value->>''achievement''))::integer,0)'; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.record_dev_fantasy_rewards(uuid,integer,integer,jsonb,jsonb,timestamptz,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Reward cap definition changed'; END IF;
 EXECUTE replace(definition,old,$cap$
 COALESCE((settings.rules->'maxRecipients'->>(value->>'achievement'))::integer,
  CASE WHEN value->>'achievement'='highLoss' THEN 3
    WHEN value->>'achievement'~'^(win|loss)' OR value->>'achievement'='playoffClinch' THEN 2 ELSE 1 END)
 $cap$);
END $$;

CREATE TABLE boff_dev_internal.league_feed_preferences (
 league_id uuid PRIMARY KEY REFERENCES public.leagues(id),
 choices jsonb NOT NULL
);
ALTER TABLE boff_dev_internal.league_feed_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.league_feed_preferences FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_league_feed_preferences(p_league uuid,p_choices jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (sportsbook_private.is_member(p_league) OR sportsbook_private.is_platform_owner()) THEN
  RAISE EXCEPTION 'League membership required';
 END IF;
 IF p_choices IS NOT NULL THEN
  IF NOT (sportsbook_private.is_platform_owner() OR EXISTS (
   SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid() AND role='admin'
  )) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
  IF jsonb_typeof(p_choices)<>'object' OR octet_length(p_choices::text)>1024 OR EXISTS(
   SELECT FROM jsonb_each(p_choices) x WHERE jsonb_typeof(x.value)<>'boolean' OR x.key NOT IN (
    'Trade','This Week in History','Playoff History','Injury Report','Injury Update','Fantasy Reward',
    'Featured','Big Win','Underdog Watch','Live Score','Parlay Watch','Ticket Placed','Week Recap')
  ) THEN RAISE EXCEPTION 'Invalid feed categories'; END IF;
  INSERT INTO boff_dev_internal.league_feed_preferences VALUES(p_league,p_choices)
  ON CONFLICT(league_id) DO UPDATE SET choices=excluded.choices;
 END IF;
 RETURN COALESCE((SELECT choices FROM boff_dev_internal.league_feed_preferences WHERE league_id=p_league),'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.dev_league_feed_preferences(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.dev_league_feed_preferences(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
