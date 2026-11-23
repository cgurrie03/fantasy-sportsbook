DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE OR REPLACE FUNCTION boff_dev_internal.email_leg_result(p_league uuid,p_season integer,p_week integer,p_context jsonb,p_actual numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text:=p_context->>'kind'; teams jsonb:='[]'; label text;
BEGIN
 IF kind IS NULL OR kind LIKE 'future_%' THEN RETURN NULL; END IF;
 IF kind IN ('moneyline','spread','winning_margin','match_total','team_total','team_milestone','weekly_high','weekly_low') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.team_name,'avatar',t.avatar_url,'score',(r.value->>'points')::numeric) ORDER BY t.id),'[]')
  INTO teams FROM public.league_result_weeks w CROSS JOIN LATERAL jsonb_each(w.results) r
  JOIN public.teams t ON t.id::text=r.key AND t.league_id=w.league_id
  WHERE w.league_id=p_league AND w.nfl_season=p_season AND w.market_week=p_week AND w.final
   AND (CASE WHEN kind IN ('weekly_high','weekly_low') THEN abs((r.value->>'points')::numeric-p_actual)<0.001
    WHEN kind IN ('team_total','team_milestone') THEN t.id::text=p_context->>'team_id'
    ELSE t.id::text IN (p_context->>'home_team_id',p_context->>'away_team_id') OR
     (p_context->>'home_team_id' IS NULL AND r.value->>'matchup_id'=w.results->(p_context->>'team_id')->>'matchup_id') END);
 ELSIF kind IN ('player_points','player_milestone','player_h2h') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.value->>'name','avatar',p.value->>'headshot')),'[]') INTO teams
   FROM public.dev_current_book b CROSS JOIN LATERAL jsonb_array_elements(b.payload->'players') p
   WHERE b.league_id=p_league AND (p.value->>'id'=p_context->'metadata'->>'player_id'
     OR (kind='player_h2h' AND p.value->>'id'=p_context->'metadata'->>'opponent_player_id'));
 END IF;
 label:=CASE WHEN kind IN ('moneyline','spread','winning_margin') THEN 'Scores'
  WHEN kind='match_total' THEN 'Match Total' WHEN kind='team_total' THEN 'Team Total'
  WHEN kind IN ('player_points','player_milestone','team_milestone','weekly_high','weekly_low') THEN 'Fantasy Points'
  WHEN kind IN ('player_h2h','position_group') THEN 'Point Difference'
  WHEN kind='weekly_average' THEN 'League Average' WHEN kind IN ('weekly_highest_score','weekly_any_200') THEN 'Highest Score'
  WHEN kind='weekly_any_below_100' THEN 'Lowest Score' WHEN kind='weekly_count_150' THEN 'Teams Scoring 150+'
  WHEN kind='weekly_count_projection' THEN 'Teams Above Projection'
  ELSE 'Result' END;
 IF label='Scores' AND jsonb_array_length(teams)=0 THEN RETURN NULL; END IF;
 IF label<>'Scores' AND p_actual IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('label',label,'value',p_actual,'teams',teams);
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.email_leg_result(uuid,integer,integer,jsonb,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION boff_dev_internal.credit_email_allowed(p_league uuid,p_user uuid,p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT FROM boff_dev_internal.notification_capture WHERE league_id=p_league AND user_id=p_user
   AND kind='opening' AND created_at>=p_now-interval '24 hours')
 AND NOT EXISTS(SELECT FROM public.outbound_emails o JOIN public.user_wallets w ON w.league_id=o.league_id AND w.team_id=o.team_id
   WHERE o.league_id=p_league AND w.user_id=p_user AND o.recipient=(SELECT email FROM auth.users WHERE id=p_user)
    AND o.kind='opening' AND ((o.status IN ('pending','sending') AND o.created_at>=p_now-interval '24 hours') OR coalesce(o.sent_at,o.created_at)>=p_now-interval '24 hours')
    AND o.status NOT IN ('failed','skipped','needs_review'))
 AND NOT EXISTS(SELECT FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id
   LEFT JOIN boff_dev_internal.notification_choices choice ON choice.league_id=c.league_id AND choice.user_id=p_user
   WHERE c.league_id=p_league AND b.status='published' AND c.valid_until>p_now AND c.last_error IS NULL
    AND boff_dev_internal.effective_communications(choice.choices)->'opening'->>'email'='true'
    AND NOT EXISTS(SELECT FROM boff_dev_internal.notification_capture seen WHERE seen.league_id=p_league AND seen.user_id=p_user
     AND seen.event_key='opening:'||b.nfl_season||':'||b.market_week))
 AND NOT EXISTS(SELECT FROM public.sportsbook_boards b
   LEFT JOIN boff_dev_internal.notification_choices choice ON choice.league_id=b.league_id AND choice.user_id=p_user
   WHERE b.league_id=p_league AND b.board_type='weekly' AND b.status IN ('draft','published')
    AND b.opens_at BETWEEN p_now-interval '24 hours' AND p_now+interval '24 hours'
    AND boff_dev_internal.effective_communications(choice.choices)->'opening'->>'email'='true'
    AND NOT EXISTS(SELECT FROM boff_dev_internal.notification_capture seen WHERE seen.league_id=p_league AND seen.user_id=p_user
     AND seen.event_key='opening:'||b.nfl_season||':'||b.market_week));
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.credit_email_allowed(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.dev_email_edition(p_league uuid,p_user uuid,p_kind text,p_week integer,p_ticket uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wallet public.user_wallets; book public.dev_current_book; board public.sportsbook_boards;
 recommendations jsonb:='[]'; tickets jsonb:='[]'; offers jsonb:='[]'; quotes jsonb:='[]'; rewards jsonb:='[]'; result_teams jsonb:='[]';
 performance jsonb:='{}'; crowd jsonb:='{}'; market_bets jsonb:='[]'; league_betting jsonb:='{}'; leader jsonb; original_quotes jsonb:='[]'; matchup text; eligible numeric; last_claim timestamptz;
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
   'market',l.market_type,'evidence',l.result_evidence,'result',boff_dev_internal.email_leg_result(t.league_id,t.nfl_season,t.market_week,l.settlement_context,l.actual_value)) ORDER BY l.leg_number),'[]') FROM public.ticket_legs l WHERE l.ticket_id=t.id)
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
   INTO quotes FROM public.sportsbook_markets m WHERE m.board_id=board.id AND m.active AND m.kind IN ('moneyline','spread','winning_margin','match_total')
    AND m.metadata->>'alternate' IS DISTINCT FROM 'true';
  offers:=boff_dev_internal.cached_weekly_offer_options(p_league,board.id,
   concat_ws(':',board.id,board.revision,board.content_version,book.source_hash,book.offer_schedule_hash));
  IF p_kind='monday_watch' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('label',x.label,'odds',x.odds,'matchup',x.matchup_key,'kind',x.kind,'headshot',x.headshot,'projection',x.projection,'kickoff',x.kickoff)),'[]')
    INTO recommendations FROM (
     SELECT DISTINCT ON (m.metadata->>'player_id') m.label,m.odds,m.matchup_key,m.kind,p.value->>'headshot' headshot,(p.value->>'projection')::numeric projection,p.value->>'kickoff' kickoff
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
   WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week AND kind IN ('moneyline','spread','winning_margin','match_total')
    AND (home_team_id::text IN(SELECT value->>'id' FROM jsonb_array_elements(result_teams)) OR away_team_id::text IN(SELECT value->>'id' FROM jsonb_array_elements(result_teams)));
  SELECT jsonb_build_object('Tickets On Your Matchup',count(DISTINCT t.id),
   'Members On Your Matchup',count(DISTINCT coalesce(t.user_wallet_id::text,t.bettor_display_name)),
   'Tickets Backing You',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'team_id'=wallet.team_id::text),
   'Tickets Backing Your Opponent',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'team_id' IS NOT NULL AND l.settlement_context->>'team_id'<>wallet.team_id::text),
   'Tickets Taking The Under',count(DISTINCT t.id) FILTER(WHERE l.settlement_context->>'side'='under'))
  INTO crowd FROM public.tickets t JOIN public.ticket_legs l ON l.ticket_id=t.id
   WHERE t.league_id=p_league AND t.nfl_season=board.nfl_season AND t.market_week=p_week
    AND (l.settlement_context->>'home_team_id'=wallet.team_id::text OR l.settlement_context->>'away_team_id'=wallet.team_id::text);
  SELECT coalesce(jsonb_agg(jsonb_build_object('market',x.market_type,'selection',x.selection,'tickets',x.tickets) ORDER BY x.market_type,x.selection),'[]')
  INTO market_bets FROM (
   SELECT l.market_type,l.selection,count(DISTINCT t.id) tickets FROM public.tickets t JOIN public.ticket_legs l ON l.ticket_id=t.id
   WHERE t.league_id=p_league AND t.nfl_season=board.nfl_season AND t.market_week=p_week
    AND l.settlement_context->>'kind' IN ('moneyline','spread','winning_margin','match_total','team_total')
    AND (l.settlement_context->>'home_team_id'=wallet.team_id::text OR l.settlement_context->>'away_team_id'=wallet.team_id::text)
   GROUP BY l.market_type,l.selection
  ) x;
  SELECT jsonb_build_object('Bets Placed',count(*),'Winning Tickets',count(*) FILTER(WHERE status='WON'),
   'Credits Wagered',round(coalesce(sum(stake),0),2)||' credits') INTO league_betting
   FROM public.tickets WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week;
  WITH counts AS (
   SELECT coalesce(nullif(bettor_display_name,''),'League Member') name,user_wallet_id,count(*) bets
   FROM public.tickets WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week
   GROUP BY user_wallet_id,bettor_display_name
  ) SELECT jsonb_build_object('Most Bets Placed',string_agg(name,' / ' ORDER BY name)||' · '||max(bets)||' bets') INTO leader
    FROM counts WHERE bets=(SELECT max(bets) FROM counts);
  IF leader->>'Most Bets Placed' IS NOT NULL THEN league_betting:=league_betting||leader; END IF;
  WITH losses AS (
   SELECT coalesce(nullif(bettor_display_name,''),'League Member') name,user_wallet_id,sum(stake) lost
   FROM public.tickets WHERE league_id=p_league AND nfl_season=board.nfl_season AND market_week=p_week AND status='LOST'
   GROUP BY user_wallet_id,bettor_display_name
  ) SELECT jsonb_build_object('Most Credits Lost',string_agg(name,' / ' ORDER BY name)||' · '||round(max(lost),2)||' credits') INTO leader
    FROM losses WHERE lost=(SELECT max(lost) FROM losses);
  IF leader->>'Most Credits Lost' IS NOT NULL THEN league_betting:=league_betting||leader; END IF;
  SELECT jsonb_build_object('Longest Winning Ticket',coalesce(nullif(t.bettor_display_name,''),'League Member')||' · '||legs.total||'-leg · '||
   CASE WHEN t.accepted_combined_odds>0 THEN '+' ELSE '' END||t.accepted_combined_odds) INTO leader
   FROM public.tickets t CROSS JOIN LATERAL (SELECT count(*) total FROM public.ticket_legs WHERE ticket_id=t.id) legs
   WHERE t.league_id=p_league AND t.nfl_season=board.nfl_season AND t.market_week=p_week AND t.status='WON'
   ORDER BY legs.total DESC,t.actual_payout-t.stake DESC,t.id LIMIT 1;
  IF leader IS NOT NULL THEN league_betting:=league_betting||leader; END IF;
 END IF;
 SELECT last_claim_at INTO last_claim FROM boff_dev_internal.credit_claim_state WHERE wallet_id=wallet.id;
 eligible:=wallet.balance+coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0);
 RETURN jsonb_build_object('tickets',tickets,'quotes',quotes,'offers',offers,'rewards',rewards,'performance',performance,
  'recommendations',recommendations,'marketBets',market_bets,'leagueBetting',league_betting,'resultTeams',result_teams,'openingQuotes',original_quotes,'crowd',crowd,'balance',wallet.balance,
  'claim',CASE WHEN eligible>=100 THEN 0
   WHEN last_claim IS NULL OR last_claim < ((date_trunc('week',(now() AT TIME ZONE 'America/New_York')-interval '2 days 6 hours')+interval '2 days 6 hours') AT TIME ZONE 'America/New_York')
    OR last_claim<=now()-interval '24 hours' THEN 50
   WHEN last_claim<=now()-interval '2 hours' THEN 10 ELSE 0 END,
  'openStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0),
  'futureStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type='future'),0));
END $$;
REVOKE ALL ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) TO service_role;

DO $$ DECLARE original text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO original;
 updated:=replace(original,'e.kind IN (''opening'',''settled'',''credit'') AND',
  'e.kind IN (''opening'',''settled'',''credit'') AND (e.kind<>''credit'' OR boff_dev_internal.credit_email_allowed(p_league,e.user_id)) AND');
 IF updated=original THEN RAISE EXCEPTION 'Candidate definition changed'; END IF;
 EXECUTE updated;
 SELECT pg_get_functiondef('public.dev_capture_notification(uuid,uuid,text,text,text,text,text)'::regprocedure) INTO original;
 updated:=replace(original,'BEGIN','BEGIN
 IF p_kind=''credit'' AND NOT boff_dev_internal.credit_email_allowed(p_league,p_user) THEN RETURN; END IF;');
 updated:=replace(updated,'octet_length(p_html)>24000 OR octet_length(p_text)>8000','octet_length(p_html)>96000 OR octet_length(p_text)>16000');
 IF updated=original OR updated NOT LIKE '%octet_length(p_html)>96000%' THEN RAISE EXCEPTION 'Capture definition changed'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
