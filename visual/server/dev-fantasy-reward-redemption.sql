DO $$
DECLARE body text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only'; END IF;
 SELECT pg_get_functiondef('boff_dev_internal.place_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) INTO body;
 IF strpos(body,'v_price_int:=round')=0 THEN RAISE EXCEPTION 'Placement price anchor changed'; END IF;
 body:=replace(body,'boff_dev_internal.place_ticket','boff_dev_internal.place_reward_ticket');
 body:=replace(body,'p_request uuid)','p_request uuid, p_reward_percent numeric)');
 body:=replace(body,'if (v_price-1)*100','v_price:=1+(v_price-1)*(1+p_reward_percent/100); if (v_price-1)*100');
 EXECUTE body;
 SELECT pg_get_functiondef('sportsbook_private.user_settle_weekly_ticket(uuid,jsonb)'::regprocedure) INTO body;
 IF strpos(body,'and kind=''boost''),0)/100')=0 THEN RAISE EXCEPTION 'Settlement boost anchor changed'; END IF;
 EXECUTE replace(body,'and kind=''boost''),0)/100','and kind=''boost''),(select percent from boff_dev_internal.fantasy_reward_awards where ticket_id=p_ticket),0)/100');
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.place_reward_ticket(uuid,integer,uuid[],numeric,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.place_dev_reward(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid,p_reward uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards; a boff_dev_internal.fantasy_reward_awards; placed jsonb; existing uuid;
BEGIN
 IF auth.uid() IS NULL OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev sign-in required'; END IF;
 SELECT * INTO STRICT b FROM public.sportsbook_boards WHERE id=p_board;
 IF NOT sportsbook_private.is_member(b.league_id) THEN RAISE EXCEPTION 'League membership required'; END IF;
 IF b.board_type='future' THEN
  PERFORM pg_advisory_xact_lock(hashtext('boff-dev-futures-rules'),hashtext(b.league_id::text));
 END IF;
 SELECT * INTO a FROM boff_dev_internal.fantasy_reward_awards
 WHERE id=p_reward AND league_id=b.league_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reward unavailable'; END IF;
 SELECT id INTO existing FROM public.tickets WHERE request_key=p_request;
 IF existing IS NOT NULL THEN
  IF a.ticket_id IS DISTINCT FROM existing THEN RAISE EXCEPTION 'Request already used'; END IF;
  RETURN boff_dev_internal.place_reward_ticket(p_board,p_revision,p_picks,p_stake,p_request,a.percent);
 END IF;
 IF a.ticket_id IS NOT NULL OR a.revoked_at IS NOT NULL OR a.expires_at<=clock_timestamp()
  OR (a.achievement='champion' AND b.nfl_season<>a.season+1)
  OR (a.achievement<>'champion' AND b.nfl_season<>a.season) THEN RAISE EXCEPTION 'Reward unavailable'; END IF;
 IF EXISTS(SELECT FROM public.sportsbook_boards sb JOIN public.sportsbook_markets sm ON sm.board_id=sb.id
  WHERE sb.league_id=b.league_id AND sb.nfl_season=b.nfl_season AND sm.kind='future_champion'
   AND sm.metadata->>'dev_futures'='true' AND sm.metadata->>'resolved'='true') THEN RAISE EXCEPTION 'This season has ended'; END IF;
 IF b.board_type='weekly' AND NOT EXISTS(SELECT FROM public.dev_current_book WHERE board_id=b.id AND valid_until>clock_timestamp() AND last_error IS NULL FOR SHARE)
 THEN RAISE EXCEPTION 'Prices expired'; END IF;
 IF b.board_type='future' AND NOT EXISTS(
  SELECT FROM boff_dev_internal.futures_board_state s
  JOIN LATERAL (SELECT revision,rules FROM boff_dev_internal.futures_rule_versions v WHERE v.league_id=s.league_id AND v.season=s.season ORDER BY revision DESC LIMIT 1) r ON true
  WHERE s.league_id=b.league_id AND s.season=b.nfl_season AND r.revision=s.rules_revision AND r.rules->>'rostersReady'='true'
 ) THEN RAISE EXCEPTION 'Futures prices changed'; END IF;
 IF EXISTS(SELECT FROM public.sportsbook_markets WHERE id=ANY(p_picks)
  AND (boost_pct>0 OR (b.board_type='future' AND ((metadata->>'cutoff')::timestamptz<=clock_timestamp() OR metadata->>'dev_futures' IS DISTINCT FROM 'true'))))
 THEN RAISE EXCEPTION 'Rewards require open selections without an existing boost'; END IF;
 IF EXISTS(SELECT FROM public.sportsbook_markets WHERE id=ANY(p_picks) GROUP BY metadata->>'ui_group' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Choose only one outcome per market'; END IF;
 placed:=boff_dev_internal.place_reward_ticket(p_board,p_revision,p_picks,p_stake,p_request,a.percent);
 IF (placed->>'duplicate')::boolean THEN RAISE EXCEPTION 'Request already used'; END IF;
 UPDATE boff_dev_internal.fantasy_reward_awards SET ticket_id=(placed->>'ticket_id')::uuid WHERE id=a.id;
 RETURN placed;
END $$;
REVOKE ALL ON FUNCTION public.place_dev_reward(uuid,integer,uuid[],numeric,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.place_dev_reward(uuid,integer,uuid[],numeric,uuid,uuid) TO authenticated;

CREATE FUNCTION public.list_dev_fantasy_rewards(p_league uuid,p_seen uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'League membership required'; END IF;
 IF p_seen IS NOT NULL THEN
  UPDATE boff_dev_internal.fantasy_reward_awards SET seen_at=clock_timestamp()
  WHERE league_id=p_league AND user_id=auth.uid() AND id=ANY(p_seen) AND seen_at IS NULL;
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'achievement',a.achievement,'percent',a.percent,
  'season',a.season,'week',a.week,'expiresAt',a.expires_at,'seen',a.seen_at IS NOT NULL,
  'ready',a.achievement<>'champion' OR l.nfl_season=a.season+1) ORDER BY a.week DESC,a.percent DESC)
  FROM boff_dev_internal.fantasy_reward_awards a JOIN public.leagues l ON l.id=a.league_id
  WHERE a.league_id=p_league AND a.user_id=auth.uid() AND a.ticket_id IS NULL AND a.revoked_at IS NULL
   AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())
   AND (a.season=l.nfl_season OR (a.achievement='champion' AND a.season=l.nfl_season-1))
   AND (a.achievement='champion' OR NOT EXISTS(SELECT FROM public.sportsbook_boards b JOIN public.sportsbook_markets m ON m.board_id=b.id
    WHERE b.league_id=a.league_id AND b.nfl_season=a.season AND m.kind='future_champion'
     AND m.metadata->>'dev_futures'='true' AND m.metadata->>'resolved'='true'))),'[]');
END $$;
REVOKE ALL ON FUNCTION public.list_dev_fantasy_rewards(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_dev_fantasy_rewards(uuid,uuid[]) TO authenticated;

CREATE FUNCTION public.dev_reward_worker_context(p_league uuid,p_season integer,p_week integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('issued',exists(select from boff_dev_internal.fantasy_reward_runs where league_id=p_league and season=p_season and week=p_week),
  'hasQualified',(select qualified IS NOT NULL from boff_dev_internal.fantasy_reward_runs where league_id=p_league and season=p_season and week=p_week),
  'rules',(select rules from boff_dev_internal.fantasy_reward_rules where league_id=p_league),
  'historicalHigh',(select max((value->>'points')::numeric) from public.league_result_weeks cross join lateral jsonb_each(results)
    where league_id=p_league and nfl_season<p_season and final and jsonb_typeof(value->'points')='number'))
$$;
CREATE FUNCTION public.dev_reward_feed(p_league uuid,p_season integer,p_week integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
  SELECT DISTINCT q.team_id,t.team_name,q.achievement,q.percent,r.week,
   EXISTS (SELECT FROM boff_dev_internal.fantasy_reward_awards a
    WHERE (a.league_id,a.season,a.week,a.team_id,a.achievement)=(r.league_id,r.season,r.week,q.team_id,q.achievement)
     AND a.revoked_at IS NULL) AS awarded
  FROM boff_dev_internal.fantasy_reward_runs r
  CROSS JOIN LATERAL jsonb_to_recordset(r.qualified) q(team_id uuid,achievement text,percent numeric)
  JOIN public.teams t ON t.id=q.team_id AND t.league_id=r.league_id
  WHERE r.league_id=p_league AND r.season=p_season AND r.week=p_week
   AND NOT EXISTS(SELECT FROM boff_dev_internal.fantasy_reward_awards a
    WHERE (a.league_id,a.season,a.week,a.team_id,a.achievement)=(r.league_id,r.season,r.week,q.team_id,q.achievement)
     AND a.revoked_at IS NOT NULL)
  ORDER BY q.percent DESC,q.team_id,q.achievement LIMIT 12
 ) x
$$;
REVOKE ALL ON FUNCTION public.dev_reward_worker_context(uuid,integer,integer),public.dev_reward_feed(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_reward_worker_context(uuid,integer,integer),public.dev_reward_feed(uuid,integer,integer) TO service_role;

CREATE FUNCTION public.update_dev_reward_scores(p_league uuid,p_season integer,p_week integer,p_before jsonb,p_results jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Development worker required'; END IF;
 UPDATE public.league_result_weeks SET results=p_results,fetched_at=clock_timestamp()
 WHERE league_id=p_league AND nfl_season=p_season AND market_week=p_week AND final AND results=p_before
  AND results IS DISTINCT FROM p_results;
END $$;
REVOKE ALL ON FUNCTION public.update_dev_reward_scores(uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_dev_reward_scores(uuid,integer,integer,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.dev_reward_corrections(p_league uuid,p_revoke uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 IF p_revoke IS NOT NULL THEN
  UPDATE boff_dev_internal.fantasy_reward_awards a SET revoked_at=clock_timestamp()
  FROM boff_dev_internal.fantasy_reward_runs r
  WHERE a.id=p_revoke AND a.league_id=p_league AND a.ticket_id IS NULL AND a.revoked_at IS NULL
   AND (r.league_id,r.season,r.week)=(a.league_id,a.season,a.week) AND r.correction_digest IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only unused awards in a flagged week can be removed'; END IF;
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('season',r.season,'week',r.week,'awards',
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'achievement',a.achievement,'percent',a.percent,
    'team',t.team_name,'used',a.ticket_id IS NOT NULL,'removed',a.revoked_at IS NOT NULL) ORDER BY t.team_name,a.achievement)
    FROM boff_dev_internal.fantasy_reward_awards a JOIN public.teams t ON t.id=a.team_id
    WHERE (a.league_id,a.season,a.week)=(r.league_id,r.season,r.week)),'[]'::jsonb)) ORDER BY r.season DESC,r.week DESC)
   FROM boff_dev_internal.fantasy_reward_runs r WHERE r.league_id=p_league AND r.correction_digest IS NOT NULL),'[]');
END $$;
REVOKE ALL ON FUNCTION public.dev_reward_corrections(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_reward_corrections(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
