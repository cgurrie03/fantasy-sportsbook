BEGIN;
DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END $$;

CREATE TABLE boff_dev_internal.fantasy_reward_runs (
  league_id uuid REFERENCES public.leagues(id),
  season integer,
  week integer CHECK (week BETWEEN 1 AND 18),
  source_digest text NOT NULL,
  correction_digest text,
  qualified jsonb,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (league_id, season, week)
);
CREATE TABLE boff_dev_internal.fantasy_reward_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  achievement text NOT NULL,
  expires_at timestamptz,
  seen_at timestamptz,
  revoked_at timestamptz,
  ticket_id uuid UNIQUE REFERENCES public.tickets(id),
  percent numeric NOT NULL CHECK (percent > 0 AND percent <= 100),
  FOREIGN KEY (league_id, season, week) REFERENCES boff_dev_internal.fantasy_reward_runs(league_id, season, week),
  FOREIGN KEY (team_id, league_id) REFERENCES public.teams(id, league_id),
  UNIQUE (league_id, season, week, user_id, achievement)
);
ALTER TABLE boff_dev_internal.fantasy_reward_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.fantasy_reward_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.fantasy_reward_runs, boff_dev_internal.fantasy_reward_awards
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION boff_dev_internal.flag_fantasy_reward_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE digest text;
BEGIN
  digest := CASE WHEN NEW.final THEN md5(NEW.results::text) ELSE 'not-final' END;
  UPDATE boff_dev_internal.fantasy_reward_runs
  SET correction_digest = CASE WHEN source_digest <> digest THEN digest ELSE NULL END
  WHERE league_id = NEW.league_id AND season = NEW.nfl_season AND week = NEW.market_week
    AND correction_digest IS DISTINCT FROM CASE WHEN source_digest <> digest THEN digest ELSE NULL END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.flag_fantasy_reward_correction() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER flag_dev_fantasy_reward_correction
AFTER UPDATE OF results, final ON public.league_result_weeks
FOR EACH ROW WHEN (OLD.results IS DISTINCT FROM NEW.results OR OLD.final IS DISTINCT FROM NEW.final)
EXECUTE FUNCTION boff_dev_internal.flag_fantasy_reward_correction();

CREATE FUNCTION public.record_dev_fantasy_rewards(
  p_league uuid, p_season integer, p_week integer, p_awards jsonb, p_results jsonb, p_expires timestamptz, p_qualified jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  source jsonb;
  digest text;
  prior boff_dev_internal.fantasy_reward_runs;
  issued integer;
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
  IF p_season IS NULL OR p_week IS NULL OR p_week NOT BETWEEN 1 AND 18
    OR jsonb_typeof(p_qualified) IS DISTINCT FROM 'array' OR jsonb_array_length(p_qualified)>400
    OR jsonb_typeof(p_awards) IS DISTINCT FROM 'array' OR jsonb_array_length(p_awards) > 400 THEN
    RAISE EXCEPTION 'Invalid fantasy reward batch';
  END IF;
  SELECT results INTO source FROM public.league_result_weeks
  WHERE league_id = p_league AND nfl_season = p_season AND market_week = p_week AND final
  FOR SHARE;
  IF source IS NULL OR source IS DISTINCT FROM p_results THEN RAISE EXCEPTION 'Final fantasy results required'; END IF;
  digest := md5(source::text);
  PERFORM pg_advisory_xact_lock(hashtext('boff-dev-fantasy-rewards'), hashtext(p_league::text));
  SELECT * INTO prior FROM boff_dev_internal.fantasy_reward_runs
  WHERE league_id = p_league AND season = p_season AND week = p_week;
  IF FOUND THEN
    UPDATE boff_dev_internal.fantasy_reward_runs SET qualified=p_qualified
    WHERE league_id=p_league AND season=p_season AND week=p_week AND qualified IS NULL AND source_digest=digest;
    UPDATE boff_dev_internal.fantasy_reward_runs
    SET correction_digest = CASE WHEN prior.source_digest <> digest THEN digest ELSE NULL END
    WHERE league_id = p_league AND season = p_season AND week = p_week
      AND correction_digest IS DISTINCT FROM CASE WHEN prior.source_digest <> digest THEN digest ELSE NULL END;
    RETURN jsonb_build_object('alreadyIssued', true, 'correctionPending', prior.source_digest <> digest);
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_to_recordset(p_awards) AS award(team_id uuid, achievement text, percent numeric)
    WHERE award.team_id IS NULL OR award.achievement IS NULL OR award.percent IS NULL
      OR award.percent NOT BETWEEN 0.01 AND 100
      OR award.achievement NOT IN ('topScorer','win3','win5','win7','win10','loss3','loss5','loss7','loss10','closeWin','upset','highLoss','beatProjection','seasonRecord','leagueRecord','playoffClinch','champion')
      OR NOT source ? award.team_id::text
  ) THEN RAISE EXCEPTION 'Invalid fantasy reward'; END IF;

  INSERT INTO boff_dev_internal.fantasy_reward_runs (league_id, season, week, source_digest, qualified)
  VALUES (p_league, p_season, p_week, digest, p_qualified);
  INSERT INTO boff_dev_internal.fantasy_reward_awards (league_id, season, week, team_id, user_id, achievement, percent, expires_at)
  SELECT p_league, p_season, p_week, award.team_id, member.user_id, award.achievement, award.percent, CASE WHEN award.achievement <> 'champion' THEN p_expires END
  FROM jsonb_to_recordset(p_awards) AS award(team_id uuid, achievement text, percent numeric)
  JOIN public.league_memberships member ON member.league_id = p_league AND member.team_id = award.team_id
  JOIN public.user_wallets wallet ON wallet.league_id = member.league_id AND wallet.team_id = member.team_id
    AND wallet.user_id = member.user_id AND wallet.status = 'approved'
  ON CONFLICT (league_id, season, week, user_id, achievement) DO NOTHING;
  GET DIAGNOSTICS issued = ROW_COUNT;
  RETURN jsonb_build_object('alreadyIssued', false, 'awards', issued);
END $$;
REVOKE ALL ON FUNCTION public.record_dev_fantasy_rewards(uuid, integer, integer, jsonb, jsonb, timestamptz, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_dev_fantasy_rewards(uuid, integer, integer, jsonb, jsonb, timestamptz, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
