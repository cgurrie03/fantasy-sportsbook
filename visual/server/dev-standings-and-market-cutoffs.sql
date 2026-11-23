DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE FUNCTION public.dev_owner_leagues() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'season',nfl_season) ORDER BY name,id)
  FROM public.leagues),'[]');
END $$;
REVOKE ALL ON FUNCTION public.dev_owner_leagues() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_owner_leagues() TO authenticated;

CREATE FUNCTION public.dev_standings_wallets(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'teamId',w.team_id,'name',m.display_name,'balance',w.balance,
  'sleeperId',m.sleeper_user_id,'tickets',stats.tickets,'WON',stats.won,'LOST',stats.lost,
  'stake',stats.stake,'OPEN',stats.open,'profit',stats.profit)), '[]')
 FROM public.user_wallets w JOIN public.leagues l ON l.id=w.league_id
 JOIN public.league_memberships m ON m.league_id=w.league_id AND m.user_id=w.user_id AND m.team_id=w.team_id
 CROSS JOIN LATERAL (
  SELECT count(*) AS tickets,count(*) FILTER (WHERE t.status='WON') AS won,count(*) FILTER (WHERE t.status='LOST') AS lost,
    coalesce(sum(t.stake) FILTER (WHERE t.status IN ('WON','LOST')),0) AS stake,
    coalesce(sum(t.stake) FILTER (WHERE t.status='OPEN'),0) AS open,
    coalesce(sum(CASE WHEN t.status='WON' THEN coalesce(t.actual_payout,t.accepted_potential_payout)-t.stake
      WHEN t.status='LOST' THEN -t.stake ELSE 0 END),0) AS profit
  FROM public.tickets t
  WHERE t.league_id=w.league_id AND t.nfl_season=l.nfl_season AND
    (t.user_wallet_id=w.id OR (t.user_wallet_id IS NULL AND t.team_id=w.team_id AND t.bettor_display_name=m.display_name))
 ) stats
 WHERE w.league_id=p_league AND w.status='approved' AND sportsbook_private.is_member(p_league)
$$;
REVOKE ALL ON FUNCTION public.dev_standings_wallets(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_standings_wallets(uuid) TO authenticated;

DO $$ DECLARE body text; anchor text:='BETWEEN 36 AND 1000'; BEGIN
 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Weekly pricing cap changed'; END IF;
 EXECUTE replace(body,anchor,'BETWEEN 36 AND 3000');
END $$;

CREATE OR REPLACE FUNCTION boff_dev_internal.check_player_quote_cutoff() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (NEW.settlement_context->>'kind' IN ('player_h2h','player_points','player_milestone') OR NEW.settlement_context->>'kind' LIKE 'weekly_%')
   AND NEW.settlement_context->'metadata'->>'cutoff' IS NOT NULL
   AND (NEW.settlement_context->'metadata'->>'cutoff')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION 'A selection has reached its cutoff'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.dev_weekly_snapshot(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('book',to_jsonb(b),'board',to_jsonb(s),'quotes',
    coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id)
      FROM public.sportsbook_markets q WHERE q.board_id=s.id AND q.active),'[]'))
 FROM public.dev_current_book b JOIN public.sportsbook_boards s ON s.id=b.board_id
 WHERE b.league_id=p_league
$$;
REVOKE ALL ON FUNCTION public.dev_weekly_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dev_weekly_snapshot(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
