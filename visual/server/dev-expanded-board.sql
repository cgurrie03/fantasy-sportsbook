DO $$ BEGIN IF application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only';END IF;END $$;
CREATE OR REPLACE FUNCTION sportsbook_private.capture_forecast(p_board uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards;
BEGIN
 SELECT * INTO b FROM public.sportsbook_boards WHERE id=p_board;
 IF NOT FOUND OR b.status<>'published' OR b.phase<>'pregame' OR b.board_type<>'weekly' OR b.closes_at<=clock_timestamp() THEN RETURN;END IF;
 INSERT INTO public.opening_market_benchmarks(league_id,nfl_season,market_week,market_key,kind,source_quote_id,home_team_id,away_team_id,team_id,side,line,odds)
 SELECT b.league_id,b.nfl_season,b.market_week,coalesce(m.metadata->>'ui_group',m.market_key)||':'||m.side,m.kind,m.id,m.home_team_id,m.away_team_id,m.team_id,m.side,m.line,m.odds
 FROM public.sportsbook_markets m WHERE m.board_id=b.id AND m.active AND m.kind IN ('spread','moneyline','match_total') AND m.metadata->>'alternate' IS DISTINCT FROM 'true'
 ON CONFLICT(league_id,nfl_season,market_week,market_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.capture_forecast(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.publish_dev_book(p_league uuid,p_book jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards;old public.dev_current_book;q jsonb;m public.sportsbook_markets;ident uuid;ids uuid[]:='{}';h text;rev integer;deadline timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs'
 OR NOT EXISTS(SELECT 1 FROM public.leagues WHERE id=p_league AND sleeper_league_id='1312126153980391424') THEN RAISE EXCEPTION 'Dev publisher only';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('dev-current-book'),hashtext(p_league::text));
 IF (p_book->>'observed_at')::timestamptz<clock_timestamp()-interval '3 minutes' OR (p_book->>'observed_at')::timestamptz>clock_timestamp()+interval '30 seconds'
 OR jsonb_array_length(p_book->'quotes') NOT BETWEEN 36 AND 1000 OR octet_length((p_book->'payload')::text)>262144 THEN RAISE EXCEPTION 'Invalid current book';END IF;
 deadline:=(p_book->>'valid_until')::timestamptz;
 IF deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '70 minutes' THEN RAISE EXCEPTION 'Invalid quote freshness';END IF;
 SELECT * INTO old FROM public.dev_current_book WHERE league_id=p_league;
 IF old.observed_at>(p_book->>'observed_at')::timestamptz THEN RETURN jsonb_build_object('skipped','older_observation');END IF;
 SELECT * INTO b FROM public.sportsbook_boards WHERE league_id=p_league AND nfl_season=(p_book->>'season')::integer AND market_week=(p_book->>'week')::integer AND board_type='weekly' FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.sportsbook_boards(league_id,nfl_season,league_season,market_week,opens_at,closes_at,status)
  SELECT p_league,(p_book->>'season')::integer,league_season,(p_book->>'week')::integer,clock_timestamp(),(p_book->>'closes_at')::timestamptz,'draft' FROM public.leagues WHERE id=p_league RETURNING * INTO b;
 END IF;
 p_book:=jsonb_set(p_book,'{quotes}',boff_dev_internal.feature_weekly_quotes(
  p_book->'quotes', p_book->'payload'->'teams', (p_book->>'week')::integer,
  (p_book->'payload'->>'regularSeasonWeeks')::integer,
  (sportsbook_private.sportsbook_policy(p_league,(p_book->>'season')::integer,(p_book->>'week')::integer)
   ->'values'->>'featured_boost_pct')::integer,
  (SELECT (cache.payload->'metadata'->'settings'->>'playoffTeams')::integer
   FROM public.dev_live_cache cache
   JOIN public.leagues league ON league.id=p_league
   WHERE cache.key='league:'||league.sleeper_league_id
    AND cache.payload->'metadata'->>'season'=p_book->>'season')
 ));
 h:=md5((p_book->'quotes')::text);rev:=b.revision+CASE WHEN old.source_hash IS DISTINCT FROM h THEN 1 ELSE 0 END;
 UPDATE public.sportsbook_boards SET status='draft',revision=rev,source_observed_at=(p_book->>'observed_at')::timestamptz,quote_valid_until=deadline,suspension_reason=NULL WHERE id=b.id;
 FOR q IN SELECT value FROM jsonb_array_elements(p_book->'quotes') LOOP
  IF NOT(q->>'kind'=ANY(ARRAY['spread','moneyline','match_total','team_total','player_points','player_h2h','player_milestone','team_milestone','winning_margin','weekly_high','weekly_low','weekly_any_below_100','weekly_any_200','weekly_average','weekly_highest_score','weekly_count_150','weekly_count_projection'])) THEN RAISE EXCEPTION 'Unsupported dev market';END IF;
  IF q->>'kind' IN ('spread','match_total','team_total','player_points') AND abs(mod((q->>'line')::numeric,1))<>.5 THEN RAISE EXCEPTION 'Half-point line required';END IF;
  q:=q||jsonb_build_object('metadata',coalesce(q->'metadata','{}')||jsonb_build_object('ui_id',q->>'ui_id','ui_group',q->>'ui_group','quote_key',coalesce(q->>'variant_key',q->>'ui_group')||':'||(q->>'side'),'sportsbook_policy_revision',sportsbook_private.sportsbook_policy(p_league,(p_book->>'season')::integer,(p_book->>'week')::integer)->>'revision'));
  SELECT * INTO m FROM public.sportsbook_markets WHERE board_id=b.id AND active AND coalesce(metadata->>'quote_key',metadata->>'ui_id')=coalesce(q->'metadata'->>'quote_key',q->>'ui_id') LIMIT 1;
  ident:=m.id;
  IF ident IS NOT NULL AND EXISTS(SELECT 1 FROM public.ticket_legs WHERE market_quote_id=ident)
   AND (m.odds IS DISTINCT FROM (q->>'odds')::integer OR m.line IS DISTINCT FROM (q->>'line')::numeric OR m.metadata IS DISTINCT FROM q->'metadata'
    OR m.boost_pct IS DISTINCT FROM (q->>'boost_pct')::integer
    OR m.featured IS DISTINCT FROM q->>'featured') THEN
   UPDATE public.sportsbook_markets SET active=false WHERE id=ident;ident:=NULL;
  END IF;
  IF ident IS NULL THEN
   ident:=gen_random_uuid();
   INSERT INTO public.sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,boost_pct,featured,team_id,home_team_id,away_team_id,home_projection,away_projection,metadata,active)
   VALUES(ident,b.id,coalesce(q->>'variant_key',q->>'ui_group')||':'||rev,q->>'matchup_key',q->>'kind',q->>'label',q->>'subject',q->>'side',(q->>'line')::numeric,(q->>'odds')::integer,(q->>'boost_pct')::integer,q->>'featured',(q->>'team_id')::uuid,(q->>'home_team_id')::uuid,(q->>'away_team_id')::uuid,(q->>'home_projection')::numeric,(q->>'away_projection')::numeric,q->'metadata',true);
  ELSE
   UPDATE public.sportsbook_markets SET line=(q->>'line')::numeric,odds=(q->>'odds')::integer,boost_pct=(q->>'boost_pct')::integer,featured=q->>'featured',label=q->>'label',subject=q->>'subject',home_projection=(q->>'home_projection')::numeric,away_projection=(q->>'away_projection')::numeric,metadata=q->'metadata',active=true,market_state='open' WHERE id=ident;
  END IF;
  ids:=array_append(ids,ident);
 END LOOP;
 UPDATE public.sportsbook_markets SET active=false WHERE board_id=b.id AND active AND NOT(id=ANY(ids));
 DELETE FROM public.sportsbook_markets obsolete WHERE obsolete.board_id=b.id AND NOT obsolete.active AND NOT EXISTS(SELECT 1 FROM public.ticket_legs WHERE market_quote_id=obsolete.id)
 AND NOT EXISTS(SELECT 1 FROM public.promo_offers o WHERE to_jsonb(o)::text LIKE '%'||obsolete.id::text||'%');
 UPDATE public.sportsbook_boards SET status='published',phase=CASE WHEN (p_book->'payload'->>'gamesActive')::boolean THEN 'live' ELSE 'pregame' END WHERE id=b.id;
 PERFORM sportsbook_private.capture_forecast(b.id);
 UPDATE public.sportsbook_boards SET status='closed' WHERE league_id=p_league AND board_type='weekly' AND id<>b.id AND closes_at<=clock_timestamp() AND status<>'closed';
 UPDATE public.sportsbook_markets m0 SET active=false FROM public.sportsbook_boards b0 WHERE m0.board_id=b0.id AND b0.league_id=p_league AND b0.board_type='weekly' AND b0.status='closed' AND m0.active;
 INSERT INTO public.dev_current_book(league_id,board_id,payload,source_hash,observed_at,valid_until)
 VALUES(p_league,b.id,p_book->'payload',h,(p_book->>'observed_at')::timestamptz,deadline)
 ON CONFLICT(league_id) DO UPDATE SET board_id=excluded.board_id,payload=excluded.payload,source_hash=excluded.source_hash,observed_at=excluded.observed_at,valid_until=excluded.valid_until,last_error=NULL;
 RETURN jsonb_build_object('board_id',b.id,'revision',rev,'quotes',cardinality(ids));
END $$;
REVOKE ALL ON FUNCTION public.publish_dev_book(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_dev_book(uuid,jsonb) TO service_role;

