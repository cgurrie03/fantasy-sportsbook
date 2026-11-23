DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE FUNCTION boff_dev_internal.keep_weekly_features(p_book jsonb, prior jsonb, p_board uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE assignments jsonb; priced jsonb;
BEGIN
 IF (p_book->'payload'->>'scoringStarted')::boolean IS DISTINCT FROM true THEN
  RETURN p_book;
 END IF;
 IF prior->>'season'=p_book->>'season' AND prior->>'week'=p_book->>'week' THEN
  assignments:=prior->'featureAssignments';
 END IF;
 IF assignments IS NULL THEN
  SELECT coalesce(jsonb_object_agg(m.metadata->>'ui_id',jsonb_build_object(
   'featured',m.featured,'boost_pct',m.boost_pct,'source',m.metadata->>'feature_source')),'{}')
  INTO assignments FROM public.sportsbook_markets m
  WHERE board_id=p_board AND m.active AND m.boost_pct>0 AND m.metadata->>'ui_id' IS NOT NULL;
 END IF;
 SELECT jsonb_agg(q||jsonb_build_object('featured',coalesce(f->>'featured',''),'boost_pct',coalesce((f->>'boost_pct')::integer,0),
  'metadata',(coalesce(q->'metadata','{}')-'feature_source')||
   CASE WHEN f->>'source' IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('feature_source',f->>'source') END) ORDER BY ord)
 INTO priced
 FROM jsonb_array_elements(p_book->'quotes') WITH ORDINALITY items(q,ord)
 CROSS JOIN LATERAL (SELECT assignments->(q->>'ui_id') f) match;
 RETURN jsonb_set(jsonb_set(p_book,'{quotes}',priced),'{payload,featureAssignments}',assignments);
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.keep_weekly_features(jsonb,jsonb,uuid) FROM public,anon,authenticated,service_role;

DO $$ DECLARE body text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 updated:=replace(body,' h:=md5((p_book->''quotes'')::text);',
  ' p_book:=boff_dev_internal.keep_weekly_features(p_book,old.payload,b.id); h:=md5((p_book->''quotes'')::text);');
 IF updated=body THEN RAISE EXCEPTION 'Missing feature publisher hook'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.publish_dev_futures(uuid,integer,integer,jsonb,jsonb,boolean)'::regprocedure) INTO body;
 updated:=replace(body,'board_status=''published'' AND quote->''metadata''->>''result'' IS NULL',
  'board_status=''published'' AND quote->''metadata''->>''result'' IS NULL AND quote->''metadata''->>''close_reason'' IS NULL');
 updated:=replace(updated,'CASE WHEN quote->''metadata''->>''result'' IS NOT NULL THEN ''closed'' ELSE ''open'' END',
  'CASE WHEN quote->''metadata''->>''result'' IS NOT NULL OR quote->''metadata''->>''close_reason'' IS NOT NULL THEN ''closed'' ELSE ''open'' END');
 IF updated=body THEN RAISE EXCEPTION 'Missing futures publication hook'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_league_feed_preferences(uuid,jsonb)'::regprocedure) INTO body;
 updated:=replace(body,'''tradeHistory'',''injuryBody'',''featuredOdds''','''tradeHistory'',''injuryBody'',''featuredOdds'',''includeTaxi'',''injuriesMyMatchup''');
 IF updated=body THEN RAISE EXCEPTION 'Missing feed setting hook'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_commissioner_members(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'''sleeperName'',source.value->''managers''->>0,',
  '''sleeperName'',coalesce(source.value->>''ownerName'',source.value->''managers''->>0),''coManagers'',source.value->''coManagers'',''avatar'',coalesce(source.value->>''avatar'',t.avatar_url),''hasAccount'',m.user_id IS NOT NULL,');
 IF updated=body THEN RAISE EXCEPTION 'Missing membership display hook'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_change_commissioner_member(uuid,uuid,uuid,text,text)'::regprocedure) INTO body;
 updated:=replace(body,'source.value->''managers''->>0 display_name',
  'coalesce(source.value->>''ownerName'',source.value->''managers''->>0) display_name');
 IF updated=body THEN RAISE EXCEPTION 'Missing membership owner hook'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
DO $$ DECLARE body text; updated text;
BEGIN
 SELECT pg_get_functiondef('boff_dev_internal.weekly_offer_options(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'PARTITION BY matchup_key, (odds>0) ORDER BY abs(odds),deadline DESC,id',
  'PARTITION BY matchup_key, (odds>0), (kind=''player_h2h'') ORDER BY abs(odds),deadline DESC,id');
 updated:=replace(updated,'FROM eligible e WHERE kind=''player_h2h''',
  'FROM eligible e WHERE kind IN (''moneyline'',''spread'',''match_total'',''player_h2h'')');
 updated:=replace(updated,'a.id AS first_id,b.id AS second_id,c.id AS third_id,',
  'a.id AS first_id,b.id AS second_id,c.id AS third_id, (a.kind<>''player_h2h'')::int+(b.kind<>''player_h2h'')::int+(c.kind<>''player_h2h'')::int AS matchup_legs,');
 updated:=replace(updated,'AND (a.odds<0 OR b.odds<0 OR c.odds<0)',
  'AND (a.odds<0 OR b.odds<0 OR c.odds<0) AND ''player_h2h'' IN (a.kind,b.kind,c.kind)');
 updated:=replace(updated,'ORDER BY base,deadline DESC,first_id,second_id,third_id LIMIT 1',
  'ORDER BY matchup_legs DESC,base,deadline DESC,first_id,second_id,third_id LIMIT 1');
 updated:=replace(updated,'ORDER BY (SELECT count(*) FROM duel_sprint',
  'ORDER BY matchup_legs DESC,(SELECT count(*) FROM duel_sprint');
 updated:=replace(updated,'''Player favorites and underdogs across three fantasy matchups.''',
  '''A parlay across three fantasy matchups, favoring matchup markets when eligible.''');
 updated:=replace(updated,'''A second set of player duels, with favorites and underdogs in the mix.''',
  '''A second three-matchup parlay, using the available matchup and player markets.''');
 IF updated=body THEN RAISE EXCEPTION 'Missing weekly offer hook'; END IF;
 EXECUTE updated;
END $$;
