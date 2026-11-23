DO $$ DECLARE body text; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 ALTER TABLE boff_dev_internal.weekly_offer_claims DROP CONSTRAINT weekly_offer_claims_slot_check;
 ALTER TABLE boff_dev_internal.weekly_offer_claims ADD CONSTRAINT weekly_offer_claims_slot_check CHECK(slot IN ('underdogs','favorites','duels','milestone'));
 SELECT pg_get_functiondef('boff_dev_internal.weekly_offer_options(uuid)'::regprocedure) INTO body;
 IF strpos(body,'), options AS (')=0 THEN RAISE EXCEPTION 'Weekly offer definition changed'; END IF;
 body:=replace(body,'), options AS (', $offer$
 ), milestone AS (
  SELECT 'milestone'::text AS slot, 'Ten-Point Spotlight'::text AS title,
    'A single fantasy scoring milestone with a profit boost.'::text AS description,
    deadline, jsonb_build_array(jsonb_build_object('id',id,'label',label,'odds',odds,'subject',subject,'kind',kind,'matchup',matchup_key)) AS picks,
    1+100.0/abs(odds) AS base, 50 AS percent
  FROM eligible WHERE kind='player_milestone' AND line=10 AND odds BETWEEN -500 AND -160
  ORDER BY abs(odds+300),deadline DESC,id LIMIT 1
 ), options AS (
  SELECT * FROM milestone
  UNION ALL
 $offer$);
 EXECUTE body;
END $$;
