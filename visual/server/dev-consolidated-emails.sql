DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE FUNCTION public.dev_email_edition(p_league uuid,p_user uuid,p_kind text,p_week integer,p_ticket uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wallet public.user_wallets; book public.dev_current_book; board public.sportsbook_boards;
 recommendations jsonb:='[]'; tickets jsonb:='[]'; offers jsonb:='[]'; quotes jsonb:='[]'; rewards jsonb:='[]'; result_teams jsonb:='[]';
 performance jsonb:='{}'; crowd jsonb:='{}'; original_quotes jsonb:='[]'; matchup text; eligible numeric; last_claim timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Mail worker required'; END IF;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN RETURN '{}'; END IF;
 SELECT * INTO wallet FROM public.user_wallets WHERE league_id=p_league AND user_id=p_user;
 IF wallet.id IS NULL THEN RETURN '{}'; END IF;
 SELECT * INTO book FROM public.dev_current_book WHERE league_id=p_league;
 SELECT * INTO board FROM public.sportsbook_boards WHERE id=book.board_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'stake',t.stake,'odds',t.accepted_combined_odds,
  'potentialReturn',t.accepted_potential_payout,'actualReturn',t.actual_payout,'legs',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('selection',l.selection,'status',l.status,'odds',l.accepted_odds,
   'market',l.market_type,'evidence',l.result_evidence) ORDER BY l.leg_number),'[]') FROM public.ticket_legs l WHERE l.ticket_id=t.id)
 ) ORDER BY CASE WHEN t.status='OPEN' THEN 0 WHEN t.status='WON' THEN 1 ELSE 2 END,t.placed_at DESC),'[]')
 INTO tickets FROM (
  SELECT * FROM public.tickets WHERE league_id=p_league AND user_wallet_id=wallet.id AND (p_ticket IS NOT NULL OR nfl_season=board.nfl_season)
  AND (CASE WHEN p_ticket IS NOT NULL THEN id=p_ticket
   WHEN p_kind='monday_watch' THEN market_week=p_week AND ticket_type IS DISTINCT FROM 'future'
   WHEN p_kind='recap' THEN market_week=p_week ELSE false END)
  ORDER BY CASE WHEN status='OPEN' THEN 0 WHEN status='WON' THEN 1 ELSE 2 END,placed_at DESC LIMIT 100
 ) t;

 IF p_kind IN ('opening','monday_watch') AND book.valid_until>now() AND book.last_error IS NULL AND board.status='published' AND board.market_week=p_week THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('teamId',m.team_id,'matchup',m.matchup_key,'kind',m.kind,'side',m.side,
    'line',m.line,'odds',m.odds,'boost',m.boost_pct,'featured',nullif(m.featured,''),'label',m.label) ORDER BY m.matchup_key,m.kind,m.side),'[]')
   INTO quotes FROM public.sportsbook_markets m WHERE m.board_id=board.id AND m.active AND m.kind IN ('moneyline','spread','match_total')
    AND m.metadata->>'alternate' IS DISTINCT FROM 'true';
  offers:=boff_dev_internal.cached_weekly_offer_options(p_league,board.id,
   concat_ws(':',board.id,board.revision,board.content_version,book.source_hash,book.offer_schedule_hash));
  IF p_kind='monday_watch' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('label',x.label,'odds',x.odds,'matchup',x.matchup_key,'kind',x.kind)),'[]')
    INTO recommendations FROM (
     SELECT DISTINCT ON (m.metadata->>'player_id') m.label,m.odds,m.matchup_key,m.kind
     FROM public.sportsbook_markets m
     JOIN LATERAL jsonb_array_elements(book.payload->'players') p ON p.value->>'id'=m.metadata->>'player_id'
     WHERE m.board_id=board.id AND m.active AND m.market_state='open' AND m.suspension_reason IS NULL
      AND m.kind IN ('player_points','player_milestone','player_h2h') AND m.odds>=-1000
      AND (p.value->>'kickoff')::timestamptz>now()
      AND extract(isodow FROM (p.value->>'kickoff')::timestamptz AT TIME ZONE 'America/New_York')=1
     ORDER BY m.metadata->>'player_id',abs(m.odds) LIMIT 3
    ) x;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('label',replace(initcap(achievement),'_',' '),'percent',percent)),'[]')
   INTO rewards FROM boff_dev_internal.fantasy_reward_awards
   WHERE league_id=p_league AND user_id=p_user AND season=board.nfl_season AND revoked_at IS NULL AND ticket_id IS NULL
    AND (expires_at IS NULL OR expires_at>now());
 END IF;
 IF p_kind='recap' THEN
  SELECT jsonb_build_object('Won',count(*) FILTER(WHERE status='WON'),'Lost',count(*) FILTER(WHERE status='LOST'),
   'Pushed Or Voided',count(*) FILTER(WHERE status IN ('PUSH','VOIDED')),'Still Open',count(*) FILTER(WHERE status='OPEN'),
   'Net Profit',coalesce(sum(CASE WHEN status='WON' THEN actual_payout-stake WHEN status='LOST' THEN -stake ELSE 0 END),0)||' credits')
  INTO performance FROM public.tickets WHERE league_id=p_league AND user_wallet_id=wallet.id AND nfl_season=board.nfl_season AND market_week=p_week;
  SELECT results->wallet.team_id::text->>'matchup_id' INTO matchup FROM public.league_result_weeks
   WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week AND final;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.team_name,'avatar',t.avatar_url,
   'matchupId',matchup,'observed',(r.value->>'points')::numeric,'projection',(r.value->>'projection')::numeric)),'[]')
  INTO result_teams FROM public.league_result_weeks w CROSS JOIN LATERAL jsonb_each(w.results) r
   JOIN public.teams t ON t.id::text=r.key AND t.league_id=w.league_id
   WHERE w.league_id=p_league AND w.nfl_season=board.nfl_season AND w.market_week=p_week AND w.final AND r.value->>'matchup_id'=matchup;
  SELECT coalesce(jsonb_agg(jsonb_build_object('teamId',team_id,'matchup',matchup,'kind',kind,'side',side,'line',line,'odds',odds)),'[]')
   INTO original_quotes FROM public.opening_market_benchmarks
   WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week AND kind IN ('moneyline','spread','match_total')
    AND (home_team_id::text IN(SELECT value->>'id' FROM jsonb_array_elements(result_teams)) OR away_team_id::text IN(SELECT value->>'id' FROM jsonb_array_elements(result_teams)));
  SELECT jsonb_build_object('Tickets On Your Matchup',count(DISTINCT t.id),
   'Members On Your Matchup',count(DISTINCT coalesce(t.user_wallet_id::text,t.bettor_display_name)),
   'Tickets Backing You',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'team_id'=wallet.team_id::text),
   'Tickets Backing Your Opponent',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'team_id' IS NOT NULL AND l.settlement_context->>'team_id'<>wallet.team_id::text),
   'Tickets Taking The Under',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'side'='under'))
  INTO crowd FROM public.tickets t JOIN public.ticket_legs l ON l.ticket_id=t.id
   WHERE t.league_id=p_league AND t.nfl_season=board.nfl_season AND t.market_week=p_week
    AND (l.settlement_context->>'home_team_id'=wallet.team_id::text OR l.settlement_context->>'away_team_id'=wallet.team_id::text);
 END IF;
 SELECT last_claim_at INTO last_claim FROM boff_dev_internal.credit_claim_state WHERE wallet_id=wallet.id;
 eligible:=wallet.balance+coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0);
 RETURN jsonb_build_object('tickets',tickets,'quotes',quotes,'offers',offers,'rewards',rewards,'performance',performance,
  'recommendations',recommendations,'resultTeams',result_teams,'openingQuotes',original_quotes,'crowd',crowd,'balance',wallet.balance,
  'claim',CASE WHEN eligible<100 AND (last_claim IS NULL OR last_claim<=now()-interval '24 hours') THEN 50 ELSE 0 END,
  'openStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0),
  'futureStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type='future'),0));
END $$;
REVOKE ALL ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) TO service_role;

DO $$ DECLARE original text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO original;
 updated:=replace(original,'e.choices->e.kind->>''email''=''true'' AND NOT EXISTS(',
  'e.kind IN (''opening'',''settled'',''credit'') AND e.choices->e.kind->>''email''=''true'' AND NOT EXISTS(');
 updated:=replace(updated,'s.last_claim_at BETWEEN now()-interval ''24 hours'' AND now()-interval ''2 hours''',
  's.last_claim_at<=now()-interval ''24 hours''');
 IF updated=original OR updated NOT LIKE '%e.kind IN (''opening'',''settled'',''credit'')%' OR updated NOT LIKE '%s.last_claim_at<=now()-interval ''24 hours''%' THEN
  RAISE EXCEPTION 'Candidate definition changed';
 END IF;
 EXECUTE updated;
 SELECT pg_get_functiondef('public.routine_delivery_permission(uuid,boolean)'::regprocedure) INTO original;
 updated:=replace(original,'BEGIN','BEGIN
 IF EXISTS(SELECT FROM public.outbound_emails WHERE id=p_email AND kind IN (''reminder'',''reopening'')) THEN
  RETURN jsonb_build_object(''allowed'',false,''reason'',''This email type was consolidated into New Weekly Markets.'');
 END IF;');
 IF updated=original THEN RAISE EXCEPTION 'Routine permission definition changed'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
