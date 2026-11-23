BEGIN;
DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END $$;

CREATE TABLE boff_dev_internal.fantasy_reward_rules (
  league_id uuid PRIMARY KEY REFERENCES public.leagues(id),
  revision integer NOT NULL,
  rules jsonb NOT NULL
);
CREATE TABLE boff_dev_internal.fantasy_reward_rule_changes (
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  revision integer NOT NULL,
  actor uuid NOT NULL REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rules jsonb NOT NULL,
  PRIMARY KEY (league_id, revision)
);
ALTER TABLE boff_dev_internal.fantasy_reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.fantasy_reward_rule_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.fantasy_reward_rules, boff_dev_internal.fantasy_reward_rule_changes
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.dev_fantasy_reward_rules(p_league uuid, p_revision integer DEFAULT NULL, p_rules jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE saved boff_dev_internal.fantasy_reward_rules; item record;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT FROM public.leagues WHERE id = p_league)
    OR NOT (sportsbook_private.is_platform_owner() OR EXISTS (
      SELECT FROM public.league_memberships
      WHERE league_id = p_league AND user_id = auth.uid() AND role = 'admin'
    )) THEN
    RAISE EXCEPTION 'Commissioner access required';
  END IF;
  IF p_rules IS NOT NULL THEN
    IF p_revision IS NULL OR jsonb_typeof(p_rules) <> 'object'
      OR jsonb_typeof(p_rules->'weeklyLimit') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(p_rules->'boost') IS DISTINCT FROM 'object'
      OR octet_length(p_rules::text) > 2048
      OR (p_rules - ARRAY['weeklyLimit','boost','closeMargin','upsetSpread','projectionMargin']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid fantasy reward settings';
    END IF;
    FOR item IN SELECT key, value FROM jsonb_each(p_rules->'boost') LOOP
      IF item.key NOT IN ('topScorer','win3','win5','win7','win10','loss3','loss5','loss7','loss10','closeWin','upset','highLoss','beatProjection','seasonRecord','leagueRecord','playoffClinch','champion')
        OR jsonb_typeof(item.value) <> 'number'
        OR (item.value::text)::numeric NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'Invalid reward percentage';
      END IF;
    END LOOP;
    FOR item IN SELECT key, value FROM jsonb_each(p_rules - ARRAY['weeklyLimit','boost']) LOOP
      IF jsonb_typeof(item.value) <> 'number' OR (item.value::text)::numeric NOT BETWEEN 0.01 AND 1000 THEN
        RAISE EXCEPTION 'Invalid reward threshold';
      END IF;
    END LOOP;
    PERFORM pg_advisory_xact_lock(hashtext('boff-dev-fantasy-reward-rules'), hashtext(p_league::text));
    SELECT * INTO saved FROM boff_dev_internal.fantasy_reward_rules WHERE league_id = p_league;
    IF COALESCE(saved.revision, 0) <> p_revision THEN RAISE EXCEPTION 'Reward rules changed. Reload and try again.'; END IF;
    INSERT INTO boff_dev_internal.fantasy_reward_rules AS current_rules (league_id, revision, rules)
    VALUES (p_league, p_revision + 1, p_rules)
    ON CONFLICT (league_id) DO UPDATE SET revision = EXCLUDED.revision, rules = EXCLUDED.rules
    RETURNING current_rules.* INTO saved;
    INSERT INTO boff_dev_internal.fantasy_reward_rule_changes (league_id, revision, actor, rules)
    VALUES (p_league, saved.revision, auth.uid(), saved.rules);
  ELSE
    SELECT * INTO saved FROM boff_dev_internal.fantasy_reward_rules WHERE league_id = p_league;
  END IF;
  RETURN jsonb_build_object('revision', COALESCE(saved.revision, 0), 'rules', COALESCE(saved.rules, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.dev_fantasy_reward_rules(uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dev_fantasy_reward_rules(uuid, integer, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
