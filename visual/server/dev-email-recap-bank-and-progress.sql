DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE OR REPLACE FUNCTION boff_dev_internal.email_matchup_context(p_league uuid,p_season integer,p_week integer,p_context jsonb,p_live boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE teams jsonb:='[]'; current_scores boolean:=false; key text;
BEGIN
 IF p_context->>'home_team_id' IS NULL AND p_context->>'away_team_id' IS NULL AND p_context->>'team_id' IS NULL THEN RETURN NULL; END IF;
 IF p_context->>'kind' LIKE 'future_%' OR p_context->>'kind' LIKE 'weekly_%' THEN RETURN NULL; END IF;
 IF p_live THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.value->>'id','name',t.value->>'name','avatar',t.value->>'avatar','score',t.value->'observed') ORDER BY t.value->>'id'),'[]')
   INTO teams FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id
   CROSS JOIN LATERAL jsonb_array_elements(c.payload->'teams') t
   WHERE c.league_id=p_league AND b.nfl_season=p_season AND b.market_week=p_week AND c.valid_until>now() AND c.last_error IS NULL
    AND jsonb_typeof(t.value->'observed')='number'
    AND (t.value->>'id' IN (p_context->>'home_team_id',p_context->>'away_team_id') OR
     (p_context->>'home_team_id' IS NULL AND t.value->>'matchupId'=(SELECT v->>'matchupId' FROM jsonb_array_elements(c.payload->'teams') v WHERE v->>'id'=p_context->>'team_id' LIMIT 1)));
  current_scores:=jsonb_array_length(teams)=2;
 END IF;
 IF NOT current_scores THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.team_name,'avatar',t.avatar_url,'score',r.value->'points') ORDER BY t.id),'[]')
   INTO teams FROM public.league_result_weeks w CROSS JOIN LATERAL jsonb_each(w.results) r
   JOIN public.teams t ON t.id::text=r.key AND t.league_id=w.league_id
   WHERE w.league_id=p_league AND w.nfl_season=p_season AND w.market_week=p_week AND w.final
    AND (t.id::text IN (p_context->>'home_team_id',p_context->>'away_team_id') OR
     (p_context->>'home_team_id' IS NULL AND r.value->>'matchup_id'=w.results->(p_context->>'team_id')->>'matchup_id'));
 END IF;
 IF jsonb_array_length(teams)<>2 THEN RETURN NULL; END IF;
 SELECT p_season||':'||p_week||':'||string_agg(value->>'id',':' ORDER BY value->>'id') INTO key FROM jsonb_array_elements(teams);
 RETURN jsonb_build_object('key',key,'current',current_scores,'teams',teams);
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.email_matchup_context(uuid,integer,integer,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION boff_dev_internal.email_open_leg_result(p_league uuid,p_season integer,p_week integer,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text:=p_context->>'kind'; game jsonb; teams jsonb:='[]'; payload jsonb; value numeric; label text; ids jsonb; target text; count_found integer; group_score numeric;
BEGIN
 game:=boff_dev_internal.email_matchup_context(p_league,p_season,p_week,p_context,true);
 IF kind IN ('moneyline','spread','winning_margin') THEN
  IF game IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('label','Scores','current',game->'current','teams',game->'teams');
 ELSIF kind='match_total' THEN
  IF game IS NULL THEN RETURN NULL; END IF;
  SELECT sum((v->>'score')::numeric) INTO value FROM jsonb_array_elements(game->'teams') v;
  RETURN jsonb_build_object('label','Match Total','current',game->'current','value',value,'teams',game->'teams');
 END IF;
 SELECT c.payload INTO payload FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id
  WHERE c.league_id=p_league AND b.nfl_season=p_season AND b.market_week=p_week AND c.valid_until>now() AND c.last_error IS NULL;
 IF payload IS NULL THEN RETURN NULL; END IF;
 IF kind IN ('team_total','team_milestone') THEN
  SELECT jsonb_build_array(jsonb_build_object('name',v->>'name','avatar',v->>'avatar','score',v->'observed')),(v->>'observed')::numeric INTO teams,value
   FROM jsonb_array_elements(payload->'teams') v WHERE v->>'id'=p_context->>'team_id' AND jsonb_typeof(v->'observed')='number' LIMIT 1;
  label:=CASE WHEN kind='team_total' THEN 'Team Total' ELSE 'Fantasy Points' END;
 ELSIF kind IN ('player_points','player_milestone','player_h2h') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',v->>'name','avatar',v->>'headshot','score',v->'current') ORDER BY v->>'id'),'[]') INTO teams
   FROM jsonb_array_elements(payload->'players') v WHERE jsonb_typeof(v->'current')='number' AND
    (v->>'id'=p_context->'metadata'->>'player_id' OR (kind='player_h2h' AND v->>'id'=p_context->'metadata'->>'opponent_player_id'));
  IF jsonb_array_length(teams)<>(CASE WHEN kind='player_h2h' THEN 2 ELSE 1 END) THEN RETURN NULL; END IF;
  IF kind='player_h2h' THEN label:='Scores'; ELSE label:='Fantasy Points';value:=(teams->0->>'score')::numeric; END IF;
 ELSIF kind='position_group' THEN
  FOREACH target IN ARRAY ARRAY['home','away'] LOOP
   ids:=p_context->'metadata'->(target||'_player_ids');
   IF jsonb_typeof(ids) IS DISTINCT FROM 'array' OR jsonb_array_length(ids)=0 THEN RETURN NULL; END IF;
   SELECT count(*),sum((v->>'current')::numeric) INTO count_found,group_score FROM jsonb_array_elements(payload->'players') v
    WHERE jsonb_typeof(v->'current')='number' AND v->>'id' IN (SELECT jsonb_array_elements_text(ids));
   IF count_found<>jsonb_array_length(ids) THEN RETURN NULL; END IF;
   SELECT teams||jsonb_build_array(jsonb_build_object('name',v->>'name','avatar',v->>'avatar','score',group_score)) INTO teams
    FROM jsonb_array_elements(payload->'teams') v WHERE v->>'id'=p_context->>(target||'_team_id') LIMIT 1;
  END LOOP;
  label:='Scores';
 ELSIF kind IN ('weekly_average','weekly_highest_score','weekly_high','weekly_low','weekly_any_200','weekly_any_below_100','weekly_count_150','weekly_count_projection') THEN
  IF kind='weekly_count_projection' THEN
   IF p_context->'metadata'->'projection_targets' IS NULL THEN RETURN NULL; END IF;
   SELECT count(*) FILTER(WHERE (v->>'observed')::numeric>(p_context->'metadata'->'projection_targets'->>(v->>'id'))::numeric) INTO value FROM jsonb_array_elements(payload->'teams') v;
   label:='Teams Above Projection';
  ELSE
   SELECT CASE WHEN kind='weekly_average' THEN avg((v->>'observed')::numeric)
    WHEN kind='weekly_count_150' THEN count(*) FILTER(WHERE (v->>'observed')::numeric>=150)
    WHEN kind IN ('weekly_low','weekly_any_below_100') THEN min((v->>'observed')::numeric)
    ELSE max((v->>'observed')::numeric) END INTO value FROM jsonb_array_elements(payload->'teams') v WHERE jsonb_typeof(v->'observed')='number';
   label:=CASE WHEN kind='weekly_average' THEN 'League Average' WHEN kind='weekly_count_150' THEN 'Teams Scoring 150+'
    WHEN kind IN ('weekly_low','weekly_any_below_100') THEN 'Lowest Score' ELSE 'Highest Score' END;
  END IF;
 ELSE RETURN NULL;
 END IF;
 IF teams IS NULL OR (value IS NULL AND label<>'Scores') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('label',label,'current',true,'value',value,'teams',teams);
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.email_open_leg_result(uuid,integer,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.dev_email_edition(p_league uuid,p_user uuid,p_kind text,p_week integer,p_ticket uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wallet public.user_wallets; book public.dev_current_book; board public.sportsbook_boards;
 recommendations jsonb:='[]'; tickets jsonb:='[]'; offers jsonb:='[]'; quotes jsonb:='[]'; rewards jsonb:='[]'; result_teams jsonb:='[]';
 performance jsonb:='{}'; crowd jsonb:='{}'; market_bets jsonb:='[]'; league_betting jsonb:='{}'; leader jsonb; recap_stats jsonb:='{}'; metric jsonb; original_quotes jsonb:='[]'; matchup text; eligible numeric; last_claim timestamptz;
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
   'market',l.market_type,'evidence',l.result_evidence,'game',boff_dev_internal.email_matchup_context(t.league_id,t.nfl_season,t.market_week,l.settlement_context,l.status='OPEN'),'result',CASE WHEN l.status='OPEN' THEN boff_dev_internal.email_open_leg_result(t.league_id,t.nfl_season,t.market_week,l.settlement_context) ELSE boff_dev_internal.email_leg_result(t.league_id,t.nfl_season,t.market_week,l.settlement_context,l.actual_value) END) ORDER BY l.leg_number),'[]') FROM public.ticket_legs l WHERE l.ticket_id=t.id)
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
  SELECT jsonb_build_object('teamId',t.id,'name',t.team_name,'score',(r.value->>'points')::numeric,
   'previousRecord',(SELECT max((v.value->>'points')::numeric) FROM public.league_result_weeks prev CROSS JOIN LATERAL jsonb_each(prev.results) v
    WHERE prev.league_id=p_league AND prev.nfl_season=board.nfl_season AND prev.market_week<p_week AND prev.final)) INTO metric
   FROM public.league_result_weeks w CROSS JOIN LATERAL jsonb_each(w.results) r JOIN public.teams t ON t.id::text=r.key AND t.league_id=w.league_id
   WHERE w.league_id=p_league AND w.nfl_season=board.nfl_season AND w.market_week=p_week AND w.final
   ORDER BY (r.value->>'points')::numeric DESC,t.id LIMIT 1;
  IF metric IS NOT NULL THEN recap_stats:=recap_stats||jsonb_build_object('highScorer',metric); END IF;
  WITH pairs AS (
   SELECT a.key id_a,b.key id_b,a.value a,b.value b FROM public.league_result_weeks w
    CROSS JOIN LATERAL jsonb_each(w.results) a JOIN LATERAL jsonb_each(w.results) b ON a.value->>'matchup_id'=b.value->>'matchup_id' AND a.key<b.key
    WHERE w.league_id=p_league AND w.nfl_season=board.nfl_season AND w.market_week=p_week AND w.final
  ) SELECT jsonb_build_object('winner',CASE WHEN (p.a->>'points')::numeric>(p.b->>'points')::numeric THEN ta.team_name ELSE tb.team_name END,
   'loser',CASE WHEN (p.a->>'points')::numeric>(p.b->>'points')::numeric THEN tb.team_name ELSE ta.team_name END,
   'winnerScore',greatest((p.a->>'points')::numeric,(p.b->>'points')::numeric),'loserScore',least((p.a->>'points')::numeric,(p.b->>'points')::numeric),
   'margin',abs((p.a->>'points')::numeric-(p.b->>'points')::numeric)) INTO metric
   FROM pairs p JOIN public.teams ta ON ta.id::text=p.id_a AND ta.league_id=p_league JOIN public.teams tb ON tb.id::text=p.id_b AND tb.league_id=p_league
   WHERE (p.a->>'points')::numeric<>(p.b->>'points')::numeric ORDER BY abs((p.a->>'points')::numeric-(p.b->>'points')::numeric),p.id_a LIMIT 1;
  IF metric IS NOT NULL THEN recap_stats:=recap_stats||jsonb_build_object('closestMatchup',metric); END IF;
  SELECT jsonb_build_object('winner',ta.team_name,'loser',tb.team_name,'winnerScore',(a.value->>'points')::numeric,
   'loserScore',(b.value->>'points')::numeric,'odds',q.odds) INTO metric
   FROM public.league_result_weeks w CROSS JOIN LATERAL jsonb_each(w.results) a
    JOIN LATERAL jsonb_each(w.results) b ON a.value->>'matchup_id'=b.value->>'matchup_id' AND a.key<>b.key
    JOIN public.teams ta ON ta.id::text=a.key AND ta.league_id=w.league_id JOIN public.teams tb ON tb.id::text=b.key AND tb.league_id=w.league_id
    JOIN public.opening_market_benchmarks q ON q.league_id=w.league_id AND q.nfl_season=w.nfl_season AND q.market_week=w.market_week AND q.team_id::text=a.key AND q.kind='moneyline' AND q.odds>0
   WHERE w.league_id=p_league AND w.nfl_season=board.nfl_season AND w.market_week=p_week AND w.final
    AND (a.value->>'points')::numeric>(b.value->>'points')::numeric ORDER BY q.odds DESC,ta.id LIMIT 1;
  IF metric IS NOT NULL THEN recap_stats:=recap_stats||jsonb_build_object('biggestUpset',metric); END IF;
  SELECT recap_stats||jsonb_build_object('tiedMatchups',count(*)) INTO recap_stats FROM public.league_result_weeks w
   CROSS JOIN LATERAL jsonb_each(w.results) a JOIN LATERAL jsonb_each(w.results) b ON a.value->>'matchup_id'=b.value->>'matchup_id' AND a.key<b.key
   WHERE w.league_id=p_league AND w.nfl_season=board.nfl_season AND w.market_week=p_week AND w.final AND (a.value->>'points')::numeric=(b.value->>'points')::numeric;
  SELECT jsonb_build_object('name',coalesce(nullif(t.bettor_display_name,''),'League Member'),'profit',t.actual_payout-t.stake,'legs',legs.total,'odds',t.accepted_combined_odds) INTO metric
   FROM public.tickets t CROSS JOIN LATERAL(SELECT count(*) total FROM public.ticket_legs WHERE ticket_id=t.id) legs
   WHERE t.league_id=p_league AND t.nfl_season=board.nfl_season AND t.market_week=p_week AND t.status='WON'
   ORDER BY t.actual_payout-t.stake DESC,t.id LIMIT 1;
  IF metric IS NOT NULL THEN recap_stats:=recap_stats||jsonb_build_object('largestWin',metric); END IF;
 END IF;
 SELECT last_claim_at INTO last_claim FROM boff_dev_internal.credit_claim_state WHERE wallet_id=wallet.id;
 eligible:=wallet.balance+coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0);
 RETURN jsonb_build_object('tickets',tickets,'quotes',quotes,'offers',offers,'rewards',rewards,'performance',performance,
  'recommendations',recommendations,'marketBets',market_bets,'leagueBetting',league_betting,'recapStats',recap_stats,'resultTeams',result_teams,'openingQuotes',original_quotes,'crowd',crowd,'balance',wallet.balance,
  'claim',CASE WHEN eligible>=100 THEN 0
   WHEN last_claim IS NULL OR last_claim < ((date_trunc('week',(now() AT TIME ZONE 'America/New_York')-interval '2 days 6 hours')+interval '2 days 6 hours') AT TIME ZONE 'America/New_York')
    OR last_claim<=now()-interval '24 hours' THEN 50
   WHEN last_claim<=now()-interval '2 hours' THEN 10 ELSE 0 END,
  'openStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0),
  'futureStakes',coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=wallet.id AND status='OPEN' AND ticket_type='future'),0));
END $$;
REVOKE ALL ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_email_edition(uuid,uuid,text,integer,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
