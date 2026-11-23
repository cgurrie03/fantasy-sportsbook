DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE TABLE boff_dev_internal.notification_choices(
 league_id uuid REFERENCES public.leagues(id), user_id uuid REFERENCES auth.users(id),
 choices jsonb NOT NULL, PRIMARY KEY(league_id,user_id)
);
CREATE TABLE boff_dev_internal.notification_capture(
 league_id uuid, user_id uuid, event_key text, kind text NOT NULL,
 subject text NOT NULL, html text NOT NULL, plain_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(league_id,user_id,event_key)
);
ALTER TABLE boff_dev_internal.notification_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.notification_capture ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.notification_choices,boff_dev_internal.notification_capture FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_notification_choices(p_league uuid,p_choices jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid())
 THEN RAISE EXCEPTION 'League membership required'; END IF;
 IF p_choices IS NOT NULL THEN
  IF jsonb_typeof(p_choices)<>'object' OR octet_length(p_choices::text)>2500
   OR EXISTS(SELECT FROM jsonb_each(p_choices) e WHERE e.key NOT IN ('opening','reminder','recap','monday_watch','reopening','settled','leg','offers','reward','credit','featured')
    OR jsonb_typeof(e.value)<>'object' OR (e.value-ARRAY['email','details','push'])<>'{}' OR EXISTS(
     SELECT FROM jsonb_each(CASE WHEN jsonb_typeof(e.value)='object' THEN e.value ELSE '{}' END) v WHERE jsonb_typeof(v.value)<>'boolean'))
  THEN RAISE EXCEPTION 'Invalid notification choices'; END IF;
  INSERT INTO boff_dev_internal.notification_choices VALUES(p_league,auth.uid(),p_choices)
  ON CONFLICT(league_id,user_id) DO UPDATE SET choices=excluded.choices;
 END IF;
 RETURN coalesce((SELECT choices FROM boff_dev_internal.notification_choices WHERE league_id=p_league AND user_id=auth.uid()),'{}');
END $$;

CREATE FUNCTION public.dev_notification_candidates(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
WITH recipients AS (
 SELECT c.user_id, c.choices,l.nfl_season,b.market_week,b.revision,w.id wallet_id
 FROM boff_dev_internal.notification_choices c JOIN public.league_memberships m ON m.league_id=c.league_id AND m.user_id=c.user_id
 JOIN auth.users a ON a.id=c.user_id AND a.email_confirmed_at IS NOT NULL
 JOIN public.leagues l ON l.id=c.league_id
 JOIN public.dev_current_book live ON live.league_id=c.league_id
 JOIN public.sportsbook_boards b ON b.id=live.board_id
 LEFT JOIN public.user_wallets w ON w.league_id=c.league_id AND w.user_id=c.user_id AND w.status='approved'
 WHERE c.league_id=p_league AND EXISTS(
  SELECT FROM jsonb_each(c.choices) e WHERE e.value->>'email'='true' OR
  (e.value->>'push'='true' AND EXISTS(SELECT FROM boff_dev_internal.notification_push_devices d WHERE d.user_id=c.user_id))
 )
), events AS (
 SELECT r.*,event.kind,event.key,event.details FROM recipients r
 CROSS JOIN LATERAL (
  SELECT 'opening' kind,'opening:'||r.nfl_season||':'||r.market_week AS key,jsonb_build_object('Week',r.market_week) details
  WHERE EXISTS(SELECT FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id WHERE c.league_id=p_league AND b.status='published' AND c.valid_until>now() AND c.last_error IS NULL)
  UNION ALL
  SELECT 'offers','offers:'||r.nfl_season||':'||r.market_week,jsonb_build_object('Week',r.market_week)
  WHERE EXISTS(SELECT FROM public.dev_current_book c CROSS JOIN LATERAL jsonb_array_elements(boff_dev_internal.weekly_offer_options(c.board_id)) WHERE c.league_id=p_league)
  UNION ALL
  SELECT 'featured','featured:'||r.nfl_season||':'||r.market_week||':'||q.matchup_key||':'||q.featured,
    jsonb_build_object('Featured game',q.featured,'Week',r.market_week)
  FROM (SELECT DISTINCT m.matchup_key,m.featured FROM public.dev_current_book c JOIN public.sportsbook_markets m ON m.board_id=c.board_id
    WHERE c.league_id=p_league AND m.active AND m.boost_pct>0) q
  UNION ALL
  SELECT 'settled','settled:'||t.id,jsonb_build_object('Result',initcap(t.status),'Week',t.market_week,'Return',t.actual_payout)
  FROM public.tickets t WHERE t.user_wallet_id=r.wallet_id AND t.settled_at>now()-interval '24 hours'
  UNION ALL
  SELECT 'leg','leg:'||t.id||':'||p.won,jsonb_build_object('Winning legs',p.won,'Total legs',p.total)
  FROM public.tickets t CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE status='WON') won,count(*) total FROM public.ticket_legs WHERE ticket_id=t.id) p
  WHERE t.user_wallet_id=r.wallet_id AND t.status='OPEN' AND p.won>0 AND p.total>1
  UNION ALL
  SELECT 'reward','reward:'||a.id,jsonb_build_object('Profit boost',a.percent||'%','Week',a.week)
  FROM boff_dev_internal.fantasy_reward_awards a WHERE a.league_id=p_league AND a.user_id=r.user_id AND a.season=r.nfl_season
   AND a.week>=r.market_week-1 AND a.ticket_id IS NULL AND a.revoked_at IS NULL AND a.achievement<>'champion'
  UNION ALL
  SELECT 'credit','credit:'||s.last_claim_at,jsonb_build_object('Claim','Open Boff to see your offer')
  FROM public.user_wallets w JOIN boff_dev_internal.credit_claim_state s ON s.wallet_id=w.id
  WHERE w.id=r.wallet_id AND s.last_claim_at BETWEEN now()-interval '24 hours' AND now()-interval '2 hours'
   AND w.balance+coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=w.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0)<100
 ) event
)
 , pending AS (
 SELECT e.*,
  e.choices->e.kind->>'email'='true' AND NOT EXISTS(
   SELECT FROM boff_dev_internal.notification_capture c WHERE c.league_id=p_league AND c.user_id=e.user_id AND c.event_key=e.key
  ) capture_email,
  CASE WHEN e.choices->e.kind->>'push'='true' THEN (
   SELECT jsonb_agg(jsonb_build_object('id',d.id,'endpoint',d.endpoint,'keys',d.keys))
   FROM boff_dev_internal.notification_push_devices d WHERE d.user_id=e.user_id
   AND NOT EXISTS(SELECT FROM boff_dev_internal.notification_push_receipts r
    WHERE r.league_id=p_league AND r.device_id=d.id AND r.event_key=e.key)
  ) END devices
 FROM events e
)
SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'kind',kind,'key',key,'details',details,
 'email',capture_email,'devices',devices,'withDetails',choices->kind->'details')),'[]')
FROM (SELECT * FROM pending WHERE capture_email OR devices IS NOT NULL ORDER BY user_id,key LIMIT 30) batch
$$;

CREATE FUNCTION public.dev_capture_notification(p_league uuid,p_user uuid,p_key text,p_kind text,p_subject text,p_html text,p_text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.league_memberships m JOIN boff_dev_internal.notification_choices c
  ON c.league_id=m.league_id AND c.user_id=m.user_id WHERE m.league_id=p_league AND m.user_id=p_user
  AND c.choices->p_kind->>'email'='true') THEN RETURN; END IF;
 IF length(p_key)>200 OR octet_length(p_html)>16000 OR octet_length(p_text)>4000 THEN RAISE EXCEPTION 'Invalid notification capture'; END IF;
 INSERT INTO boff_dev_internal.notification_capture(league_id,user_id,event_key,kind,subject,html,plain_text)
 VALUES(p_league,p_user,p_key,p_kind,p_subject,p_html,p_text) ON CONFLICT DO NOTHING;

END $$;
REVOKE ALL ON FUNCTION public.dev_notification_choices(uuid,jsonb),public.dev_notification_candidates(uuid),
 public.dev_capture_notification(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_notification_choices(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dev_notification_candidates(uuid),public.dev_capture_notification(uuid,uuid,text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE INDEX dev_notification_capture_age ON boff_dev_internal.notification_capture(created_at);
CREATE FUNCTION public.dev_my_notification_samples(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',sample.kind,'subject',sample.subject,'html',sample.html,'time',sample.created_at) ORDER BY sample.created_at DESC),'[]')
 FROM (SELECT c.* FROM boff_dev_internal.notification_capture c WHERE c.league_id=p_league AND c.user_id=auth.uid()
  AND EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid()) ORDER BY c.created_at DESC LIMIT 10) sample
$$;
REVOKE ALL ON FUNCTION public.dev_my_notification_samples(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.dev_my_notification_samples(uuid) TO authenticated;
CREATE FUNCTION boff_dev_internal.trim_dev_notification_samples() RETURNS void
LANGUAGE sql SET search_path='' AS $$
 DELETE FROM boff_dev_internal.notification_capture WHERE created_at<now()-interval '45 days';
 DELETE FROM boff_dev_internal.notification_push_receipts WHERE created_at<now()-interval '45 days'
$$;
SELECT cron.schedule('boff-dev-notification-capture-retention','27 4 * * *','select boff_dev_internal.trim_dev_notification_samples()');
