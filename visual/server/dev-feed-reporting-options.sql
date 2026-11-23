DO $$ DECLARE definition text; anchor text:='jsonb_typeof(x.value)<>''boolean'' OR x.key NOT IN ('; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.dev_league_feed_preferences(uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Feed preferences definition changed'; END IF;
 definition:=replace(definition,'WHERE '||anchor,$options$
 WHERE CASE
  WHEN x.key IN ('tradeHistory','injuryBody','featuredOdds') THEN jsonb_typeof(x.value)<>'boolean'
  WHEN x.key IN ('bigWinProfit','bigWinOdds','underdogLead','parlayProgress','ticketStake','ticketLegs') THEN
    CASE WHEN x.value::text !~ '^[0-9]{1,5}$' THEN true ELSE x.value::text::integer NOT BETWEEN
     CASE x.key WHEN 'bigWinOdds' THEN 100 WHEN 'parlayProgress' THEN 1 WHEN 'ticketLegs' THEN 1 ELSE 0 END AND
     CASE x.key WHEN 'bigWinOdds' THEN 99900 WHEN 'underdogLead' THEN 200 WHEN 'parlayProgress' THEN 10 WHEN 'ticketLegs' THEN 10 ELSE 10000 END
    END
  ELSE jsonb_typeof(x.value)<>'boolean' OR x.key NOT IN (
 $options$);
 definition:=replace(definition,'''Featured'',''Big Win'',''Underdog Watch'',''Live Score'',''Parlay Watch'',''Ticket Placed'',''Week Recap'')','''Featured'',''Big Win'',''Underdog Watch'',''Live Score'',''Parlay Watch'',''Ticket Placed'',''Week Recap'') END');
 EXECUTE definition;
END $$;
