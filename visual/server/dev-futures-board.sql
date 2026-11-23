DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only'; END IF;
END $$;

ALTER TABLE public.sportsbook_markets DROP CONSTRAINT sportsbook_markets_kind_check;
ALTER TABLE public.sportsbook_markets ADD CONSTRAINT sportsbook_markets_kind_check CHECK (kind IN (
 'spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','future_champion','future_playoffs','future_first_pick','future_win_total','player_h2h','player_milestone','team_milestone','winning_margin','future_first_clinch','future_first_elimination'));

CREATE TABLE boff_dev_internal.futures_board_state (
 league_id uuid REFERENCES public.leagues(id),
 season integer,
 rules_revision integer NOT NULL,
 source_hash text NOT NULL,
 PRIMARY KEY (league_id,season)
);
ALTER TABLE boff_dev_internal.futures_board_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.futures_board_state FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_futures_worker_rules(p_league uuid,p_season integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('revision',v.revision,'rules',v.rules)
 FROM boff_dev_internal.futures_rule_versions v JOIN public.leagues l ON l.id=v.league_id
 WHERE v.league_id=p_league AND v.season=p_season AND l.nfl_season=p_season
 ORDER BY v.revision DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.dev_futures_worker_rules(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_futures_worker_rules(uuid,integer) TO service_role;

CREATE FUNCTION public.publish_dev_futures(p_league uuid,p_season integer,p_revision integer,p_quotes jsonb,p_settlements jsonb,p_complete boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 league public.leagues;
 board public.sportsbook_boards;
 saved boff_dev_internal.futures_rule_versions;
 prior boff_dev_internal.futures_board_state;
 quote jsonb;
 ticket record;
 owner_id uuid;
 hash text;
 deadline timestamptz;
 board_status text;
 next_revision integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev worker only'; END IF;
 IF jsonb_typeof(p_quotes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_quotes)>320
   OR jsonb_typeof(p_settlements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_settlements)>200 THEN RAISE EXCEPTION 'Invalid futures update'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('boff-dev-futures-rules'), hashtext(p_league::text));
 SELECT * INTO STRICT league FROM public.leagues WHERE id=p_league AND nfl_season=p_season;
 SELECT * INTO saved FROM boff_dev_internal.futures_rule_versions WHERE league_id=p_league AND season=p_season ORDER BY revision DESC LIMIT 1;
 IF p_revision IS DISTINCT FROM COALESCE(saved.revision,0) THEN RAISE EXCEPTION 'Futures rules changed'; END IF;
 SELECT * INTO board FROM public.sportsbook_boards WHERE league_id=p_league AND nfl_season=p_season AND board_type='future' FOR UPDATE;
 SELECT * INTO prior FROM boff_dev_internal.futures_board_state WHERE league_id=p_league AND season=p_season;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_quotes) q WHERE q->>'kind' NOT IN ('future_champion','future_playoffs','future_first_pick','future_win_total','future_first_clinch','future_first_elimination')
   OR q->'metadata'->>'quote_key' IS NULL OR q->'metadata'->>'ui_group' IS NULL OR q->'metadata'->>'cutoff' IS NULL
   OR (q->>'kind' NOT IN ('future_first_clinch','future_first_elimination') AND NOT EXISTS(
     SELECT FROM public.teams t WHERE t.league_id=p_league AND t.id=(q->>'team_id')::uuid AND t.roster_id=(q->'metadata'->>'roster_id')::int)))
 THEN RAISE EXCEPTION 'Invalid futures quote'; END IF;
 SELECT max((q->'metadata'->>'cutoff')::timestamptz) INTO deadline FROM jsonb_array_elements(p_quotes) q;
 board_status:=CASE WHEN p_complete THEN 'closed'
  WHEN saved.rules->>'rostersReady'='true' AND deadline>clock_timestamp() THEN 'published' ELSE 'draft' END;
 hash:=md5(p_quotes::text||':'||p_revision||':'||board_status);
 IF board.id IS NULL AND deadline IS NOT NULL THEN
  INSERT INTO public.sportsbook_boards(league_id,nfl_season,league_season,market_week,board_type,opens_at,closes_at)
  VALUES(p_league,p_season,league.league_season,1,'future',LEAST(clock_timestamp(),deadline-interval '1 second'),deadline) RETURNING * INTO board;
 END IF;
 IF board.id IS NOT NULL AND deadline IS NOT NULL THEN
  next_revision:=board.revision+CASE WHEN prior.source_hash IS DISTINCT FROM hash THEN 1 ELSE 0 END;
  IF prior.source_hash IS DISTINCT FROM hash THEN
   UPDATE public.sportsbook_markets SET active=false,market_state='closed' WHERE board_id=board.id AND active;
   DELETE FROM public.sportsbook_markets m WHERE m.board_id=board.id AND m.metadata->>'dev_futures'='true'
    AND NOT EXISTS(SELECT FROM public.ticket_legs WHERE market_quote_id=m.id);
   FOR quote IN SELECT value FROM jsonb_array_elements(p_quotes) LOOP
    INSERT INTO public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,team_id,metadata,active,market_state)
    VALUES(gen_random_uuid(),board.id,(quote->'metadata'->>'ui_group')||':'||next_revision,quote->>'kind',quote->>'label',quote->>'subject',quote->>'side',
     (quote->>'line')::numeric,(quote->>'odds')::integer,(quote->>'team_id')::uuid,
     quote->'metadata'||jsonb_build_object('dev_futures',true,'revision',next_revision,'resolved',quote->'metadata'->>'result' IS NOT NULL,
     'sportsbook_policy_revision',sportsbook_private.sportsbook_policy(p_league,p_season,board.market_week)->>'revision'),
     board_status='published' AND quote->'metadata'->>'result' IS NULL AND (quote->'metadata'->>'cutoff')::timestamptz>clock_timestamp(),
     CASE WHEN quote->'metadata'->>'result' IS NOT NULL THEN 'closed' ELSE 'open' END);
   END LOOP;
  END IF;
  UPDATE public.sportsbook_boards SET status=board_status,revision=next_revision,
   closes_at=GREATEST(deadline,opens_at+interval '1 second'),source_observed_at=clock_timestamp(),quote_valid_until=clock_timestamp()+interval '75 minutes',suspension_reason=NULL
  WHERE id=board.id;
  INSERT INTO boff_dev_internal.futures_board_state VALUES(p_league,p_season,p_revision,hash)
   ON CONFLICT (league_id,season) DO UPDATE SET source_hash=excluded.source_hash,rules_revision=excluded.rules_revision;
 END IF;
 IF jsonb_array_length(p_settlements)=0 AND saved.rules->>'firstPick' IS DISTINCT FROM 'disabled' THEN RETURN; END IF;
 SELECT m.user_id INTO STRICT owner_id FROM sportsbook_private.platform_owner p JOIN public.league_memberships m ON m.id=p.membership_id;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 FOR ticket IN SELECT t.id,work.value->'legs' AS legs,
  saved.rules->>'firstPick'='disabled' AND EXISTS(SELECT FROM public.ticket_legs l
    WHERE l.ticket_id=t.id AND l.settlement_context->>'kind'='future_first_pick') AS removed
  FROM public.tickets t LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_settlements)
    WHERE value->>'id'=t.id::text) work ON true
  WHERE t.league_id=p_league AND t.nfl_season=p_season AND t.ticket_type='future' AND t.status='OPEN'
    AND (t.user_wallet_id IS NOT NULL OR work.value IS NOT NULL OR prior.rules_revision>0)
    AND (work.value IS NOT NULL OR saved.rules->>'firstPick'='disabled')
  ORDER BY t.id
 LOOP
  IF ticket.removed THEN
   PERFORM public.void_sportsbook_ticket(ticket.id,'Commissioner removed the #1 Pick market');
  ELSIF ticket.legs IS NOT NULL THEN
   PERFORM public.settle_weekly_ticket(ticket.id,ticket.legs);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.publish_dev_futures(uuid,integer,integer,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_dev_futures(uuid,integer,integer,jsonb,jsonb,boolean) TO service_role;

DO $$
DECLARE body text; anchor text := 'if exists(select 1 from public.line_refresh_runtime r';
BEGIN
 SELECT pg_get_functiondef('boff_dev_internal.place_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) INTO body;
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Dev wallet runtime guard changed'; END IF;
 EXECUTE replace(body,anchor,'if v_board.board_type<>''future'' and exists(select 1 from public.line_refresh_runtime r');
END $$;

CREATE FUNCTION public.place_dev_future(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE board public.sportsbook_boards; rule boff_dev_internal.futures_rule_versions;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Dev sign-in required'; END IF;
 SELECT * INTO STRICT board FROM public.sportsbook_boards WHERE id=p_board AND board_type='future';
 IF NOT sportsbook_private.is_member(board.league_id) THEN RAISE EXCEPTION 'Approved league mapping required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('boff-dev-futures-rules'), hashtext(board.league_id::text));
 IF EXISTS(SELECT FROM public.tickets t JOIN public.user_wallets w ON w.id=t.user_wallet_id
  WHERE t.request_key=p_request AND t.league_id=board.league_id AND w.user_id=auth.uid()) THEN
  RETURN boff_dev_internal.place_ticket(p_board,p_revision,p_picks,p_stake,p_request);
 END IF;
 SELECT * INTO rule FROM boff_dev_internal.futures_rule_versions WHERE league_id=board.league_id AND season=board.nfl_season ORDER BY revision DESC LIMIT 1;
 IF rule.rules->>'rostersReady' IS DISTINCT FROM 'true' OR NOT EXISTS(
  SELECT FROM boff_dev_internal.futures_board_state WHERE league_id=board.league_id AND season=board.nfl_season AND rules_revision=rule.revision)
 THEN RAISE EXCEPTION 'Futures rules or prices changed. Wait for the refreshed board'; END IF;
 IF EXISTS(SELECT FROM public.sportsbook_markets WHERE board_id=p_board AND id=ANY(p_picks)
   AND ((metadata->>'cutoff')::timestamptz<=clock_timestamp() OR metadata->>'dev_futures' IS DISTINCT FROM 'true'))
 THEN RAISE EXCEPTION 'A futures cutoff has passed'; END IF;
 IF EXISTS(SELECT FROM public.sportsbook_markets WHERE id=ANY(p_picks) GROUP BY metadata->>'ui_group' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Choose only one outcome per market'; END IF;
 RETURN boff_dev_internal.place_ticket(p_board,p_revision,p_picks,p_stake,p_request);
END $$;
REVOKE ALL ON FUNCTION public.place_dev_future(uuid,integer,uuid[],numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.place_dev_future(uuid,integer,uuid[],numeric,uuid) TO authenticated;

CREATE FUNCTION public.read_dev_futures(p_league uuid,p_season integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('rulesRevision',s.rules_revision,'board',jsonb_build_object('id',b.id,'revision',b.revision,'status',
  CASE WHEN s.rules_revision IS DISTINCT FROM COALESCE(v.revision,0) THEN 'draft' ELSE b.status END,'quote_valid_until',b.quote_valid_until),
  'quotes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'label',m.label,'subject',m.subject,
    'side',m.side,'line',m.line,'odds',m.odds,'team_id',m.team_id,'active',m.active,'metadata',m.metadata) ORDER BY m.subject,m.side)
   FROM public.sportsbook_markets m WHERE m.board_id=b.id AND m.metadata->>'dev_futures'='true'
   AND m.metadata->>'revision'=b.revision::text),'[]'::jsonb))
 FROM public.sportsbook_boards b
 JOIN boff_dev_internal.futures_board_state s ON s.league_id=b.league_id AND s.season=b.nfl_season
 LEFT JOIN LATERAL (SELECT revision FROM boff_dev_internal.futures_rule_versions WHERE league_id=p_league AND season=p_season ORDER BY revision DESC LIMIT 1) v ON true
 WHERE b.league_id=p_league AND b.nfl_season=p_season AND b.board_type='future'
$$;
REVOKE ALL ON FUNCTION public.read_dev_futures(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_dev_futures(uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
