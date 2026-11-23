DO $$ DECLARE body text; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.dev_fantasy_reward_rules(uuid,integer,jsonb)'::regprocedure) INTO body;
 IF strpos(body,'ARRAY[''weeklyLimit'',''boost'']')=0 THEN RAISE EXCEPTION 'Reward rule definition changed'; END IF;
 body:=replace(body,'ARRAY[''weeklyLimit'',''boost'',''closeMargin''','ARRAY[''weeklyLimit'',''boost'',''enabled'',''maxRecipients'',''closeMargin''');
 body:=replace(body,'FOR item IN SELECT key, value FROM jsonb_each(p_rules - ARRAY[''weeklyLimit'',''boost''])', $validation$
 IF (p_rules ? 'enabled' AND jsonb_typeof(p_rules->'enabled') IS DISTINCT FROM 'object')
 OR (p_rules ? 'maxRecipients' AND jsonb_typeof(p_rules->'maxRecipients') IS DISTINCT FROM 'object')
 OR EXISTS (SELECT FROM jsonb_each(p_rules->'enabled') x WHERE jsonb_typeof(x.value)<>'boolean'
  OR x.key NOT IN ('topScorer','win3','win5','win7','win10','loss3','loss5','loss7','loss10','closeWin','upset','highLoss','beatProjection','seasonRecord','leagueRecord','playoffClinch','champion'))
 OR EXISTS (SELECT FROM jsonb_each(p_rules->'maxRecipients') x WHERE x.value::text !~ '^(0|[1-9][0-9]{0,2})$'
  OR CASE WHEN x.value::text ~ '^[0-9]+$' THEN x.value::text::integer>128 ELSE false END
  OR x.key NOT IN ('topScorer','win3','win5','win7','win10','loss3','loss5','loss7','loss10','closeWin','upset','highLoss','beatProjection','seasonRecord','leagueRecord','playoffClinch','champion'))
 THEN RAISE EXCEPTION 'Invalid award toggles or recipient limits'; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(p_rules - ARRAY['weeklyLimit','boost','enabled','maxRecipients'])
 $validation$);
 EXECUTE body;
 SELECT pg_get_functiondef('public.record_dev_fantasy_rewards(uuid,integer,integer,jsonb,jsonb,timestamptz,jsonb)'::regprocedure) INTO body;
 IF strpos(body,'FROM jsonb_to_recordset(p_awards) AS award(team_id uuid, achievement text, percent numeric)')=0 THEN RAISE EXCEPTION 'Reward award definition changed'; END IF;
 body:=replace(body,'FROM jsonb_to_recordset(p_awards) AS award(team_id uuid, achievement text, percent numeric)', $awards$
 FROM (
  SELECT ranked.* FROM (
   SELECT (value->>'team_id')::uuid AS team_id,value->>'achievement' AS achievement,(value->>'percent')::numeric AS percent,
    COALESCE(sum(eligible.users) OVER (PARTITION BY value->>'achievement' ORDER BY entry.ordinality ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS already_selected,
    COALESCE((settings.rules->'maxRecipients'->>(value->>'achievement'))::integer,0) AS cap
   FROM jsonb_array_elements(p_awards) WITH ORDINALITY AS entry(value,ordinality)
   LEFT JOIN boff_dev_internal.fantasy_reward_rules settings ON settings.league_id=p_league
   CROSS JOIN LATERAL (
    SELECT count(*) users FROM public.league_memberships m JOIN public.user_wallets w
       ON w.league_id=m.league_id AND w.team_id=m.team_id AND w.user_id=m.user_id AND w.status='approved'
    WHERE m.league_id=p_league AND m.team_id=(value->>'team_id')::uuid
   ) eligible
  ) ranked WHERE ranked.cap=0 OR ranked.already_selected<ranked.cap
 ) award
 $awards$);
 EXECUTE body;
END $$;
NOTIFY pgrst,'reload schema';
