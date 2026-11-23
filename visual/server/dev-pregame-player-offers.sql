DO $$ DECLARE body text; updated text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
 SELECT pg_get_functiondef('boff_dev_internal.weekly_offer_options(uuid)'::regprocedure) INTO body;
 updated:=replace(body,
  'AND m.matchup_key IS NOT NULL AND m.metadata->>''alternate'' IS DISTINCT FROM ''true''',
  'AND m.matchup_key IS NOT NULL AND m.metadata->>''alternate'' IS DISTINCT FROM ''true''
   AND (m.kind<>''player_h2h'' OR (m.metadata->>''live''=''false'' AND (m.metadata->>''cutoff'')::timestamptz>now()))');
 IF updated=body THEN RAISE EXCEPTION 'Offer eligibility definition changed'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.place_dev_weekly_offer(uuid,integer,uuid[],numeric,uuid,text)'::regprocedure) INTO body;
 updated:=replace(body,'OR m.metadata->>''lineup_locked''=''true''',
  'OR m.metadata->>''lineup_locked''=''true'' OR m.metadata->>''live'' IS DISTINCT FROM ''false''');
 updated:=replace(updated,'Choose at least four unboosted Player Head-to-Head picks from different matchups',
  'Choose at least four unboosted pre-game Player Head-to-Head picks from different matchups');
 IF updated=body THEN RAISE EXCEPTION 'Offer placement definition changed'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
