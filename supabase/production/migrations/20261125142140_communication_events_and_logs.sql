CREATE OR REPLACE FUNCTION public.dev_notification_candidates(p_league uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH recipients AS (
 SELECT m.user_id, effective.choices,l.nfl_season,b.market_week,b.revision,w.id wallet_id,w.team_id
 FROM (SELECT DISTINCT league_id,user_id FROM boff_dev_internal.participant_links WHERE league_id=p_league AND user_id IS NOT NULL) m
   LEFT JOIN boff_dev_internal.notification_choices c ON m.league_id=c.league_id AND m.user_id=c.user_id
   CROSS JOIN LATERAL (SELECT boff_dev_internal.effective_communications(c.choices) AS choices) effective
 JOIN auth.users a ON a.id=m.user_id AND a.email_confirmed_at IS NOT NULL
 JOIN public.leagues l ON l.id=m.league_id
 JOIN public.dev_current_book live ON live.league_id=m.league_id
 JOIN public.sportsbook_boards b ON b.id=live.board_id
 LEFT JOIN public.user_wallets w ON w.league_id=m.league_id AND w.user_id=m.user_id AND w.status='approved'
 WHERE m.league_id=p_league AND EXISTS(
  SELECT FROM jsonb_each(effective.choices) e WHERE e.value->>'email'='true' OR
  (e.value->>'push'='true' AND EXISTS(SELECT FROM boff_dev_internal.notification_push_devices d WHERE d.user_id=m.user_id))
 )
), events AS (
 SELECT r.*,event.kind,event.key,event.details FROM recipients r
 CROSS JOIN LATERAL (
  SELECT 'opening' kind,'opening:'||r.nfl_season||':'||r.market_week AS key,jsonb_build_object('Week',r.market_week) details
  WHERE EXISTS(SELECT FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id WHERE c.league_id=p_league AND b.status='published' AND c.valid_until>now() AND c.last_error IS NULL)
  UNION ALL
  SELECT 'offers','offers:'||r.nfl_season||':'||r.market_week,jsonb_build_object('Week',r.market_week)
  WHERE EXISTS(SELECT FROM public.dev_current_book c JOIN public.sportsbook_boards ob ON ob.id=c.board_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(
   (SELECT oc.offers FROM boff_dev_internal.weekly_offer_cache oc WHERE oc.league_id=p_league
    AND oc.input_version=concat_ws(':',ob.id,ob.revision,ob.content_version,c.source_hash,c.offer_schedule_hash)
    AND oc.next_cutoff>now()),
   boff_dev_internal.weekly_offer_options(c.board_id))) WHERE c.league_id=p_league)
  UNION ALL
  SELECT 'featured','featured:'||r.nfl_season||':'||r.market_week||':'||q.matchup_key||':'||q.featured,
    jsonb_build_object('Featured Game',q.featured,'Week',r.market_week)
  FROM (SELECT DISTINCT m.matchup_key,m.featured FROM public.dev_current_book c JOIN public.sportsbook_markets m ON m.board_id=c.board_id
    WHERE c.league_id=p_league AND m.active AND m.boost_pct>0) q
  UNION ALL
  SELECT 'settled','settled:'||t.id,jsonb_build_object('Result',initcap(t.status),'Week',t.market_week,'Return',t.actual_payout||' credits')
  FROM public.tickets t WHERE (t.user_wallet_id=r.wallet_id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes legacy WHERE legacy.ticket_id=t.id AND legacy.wallet_id=r.wallet_id)) AND t.settled_at>now()-interval '24 hours'
  UNION ALL
  SELECT 'leg','leg:'||t.id||':'||p.won,jsonb_build_object('Winning legs',p.won,'Total legs',p.total)
  FROM public.tickets t CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE status='WON') won,count(*) total FROM public.ticket_legs WHERE ticket_id=t.id) p
  WHERE (t.user_wallet_id=r.wallet_id OR EXISTS(SELECT FROM sportsbook_private.production_legacy_routes legacy WHERE legacy.ticket_id=t.id AND legacy.wallet_id=r.wallet_id)) AND t.status='OPEN' AND p.won>0 AND p.total>1
  UNION ALL
  SELECT 'reward','reward:'||a.id,jsonb_build_object('Profit boost',a.percent||'%','Week',a.week)
  FROM boff_dev_internal.fantasy_reward_awards a WHERE a.league_id=p_league AND a.user_id=r.user_id AND a.season=r.nfl_season
   AND a.week>=r.market_week-1 AND a.ticket_id IS NULL AND a.revoked_at IS NULL AND a.achievement<>'champion'
  UNION ALL
  SELECT 'confirmation','confirmation:'||t.id,jsonb_build_object('Week',t.market_week,'Ticket',t.id)
  FROM public.tickets t WHERE t.user_wallet_id=r.wallet_id AND t.placed_at>coalesce((SELECT notifications_enabled_at FROM sportsbook_private.production_worker_runtime WHERE singleton),now())
  UNION ALL
  SELECT 'recap','recap:'||r.nfl_season||':'||(r.market_week-1),jsonb_build_object('Week',r.market_week-1)
  WHERE r.market_week>1 AND ((extract(isodow from now() AT TIME ZONE 'America/New_York')=2 AND extract(hour from now() AT TIME ZONE 'America/New_York')>=5) OR (extract(isodow from now() AT TIME ZONE 'America/New_York')=3 AND extract(hour from now() AT TIME ZONE 'America/New_York')<5))
  AND EXISTS(SELECT FROM public.league_result_weeks x WHERE x.league_id=p_league AND x.nfl_season=r.nfl_season AND x.market_week=r.market_week-1 AND x.final)
  UNION ALL
  SELECT 'monday_watch','monday_watch:'||r.nfl_season||':'||r.market_week,jsonb_build_object('Week',r.market_week)
  WHERE extract(isodow from now() AT TIME ZONE 'America/New_York')=1 AND extract(hour from now() AT TIME ZONE 'America/New_York')>=16
  AND EXISTS(SELECT FROM public.tickets t WHERE t.user_wallet_id=r.wallet_id AND t.market_week=r.market_week AND t.status='OPEN')
  UNION ALL
  SELECT 'credit','credit:'||s.last_claim_at,jsonb_build_object('Claim','Open Boff to see your offer')
  FROM public.user_wallets w JOIN boff_dev_internal.credit_claim_state s ON s.wallet_id=w.id
  WHERE w.id=r.wallet_id AND s.last_claim_at<=now()-interval '24 hours'
   AND w.balance+coalesce((SELECT sum(stake) FROM public.tickets WHERE user_wallet_id=w.id AND status='OPEN' AND ticket_type IS DISTINCT FROM 'future'),0)<100
 ) event
)
 , pending AS (
 SELECT e.*,
  e.kind IN ('opening','settled','credit','confirmation','recap','monday_watch') AND (e.kind<>'credit' OR boff_dev_internal.credit_email_allowed(p_league,e.user_id)) AND (e.kind='confirmation' OR e.choices->e.kind->>'email'='true') AND NOT EXISTS(
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
SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'teamId',team_id,'kind',kind,'key',key,'details',details,
 'email',capture_email,'devices',devices,'withDetails',choices->kind->'details')),'[]')
FROM (SELECT * FROM pending WHERE capture_email OR devices IS NOT NULL ORDER BY user_id,key LIMIT 30) batch
$function$
;
CREATE OR REPLACE FUNCTION public.dev_capture_notification(p_league uuid, p_user uuid, p_key text, p_kind text, p_subject text, p_html text, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_kind='credit' AND NOT boff_dev_internal.credit_email_allowed(p_league,p_user) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT FROM boff_dev_internal.participant_links m LEFT JOIN boff_dev_internal.notification_choices c
  ON c.league_id=m.league_id AND c.user_id=m.user_id WHERE m.league_id=p_league AND m.user_id=p_user
  AND (p_kind='confirmation' OR boff_dev_internal.effective_communications(c.choices)->p_kind->>'email'='true')) THEN RETURN; END IF;
 IF length(p_key)>200 OR octet_length(p_html)>96000 OR octet_length(p_text)>16000 THEN RAISE EXCEPTION 'Invalid notification capture'; END IF;
 INSERT INTO boff_dev_internal.notification_capture(league_id,user_id,event_key,kind,subject,html,plain_text)
 VALUES(p_league,p_user,p_key,p_kind,p_subject,p_html,p_text) ON CONFLICT DO NOTHING;

END $function$
;
CREATE OR REPLACE FUNCTION public.dev_owner_filtered_email_log(p_league uuid, p_member uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 RETURN (
  WITH members AS MATERIALIZED (
   SELECT DISTINCT ON(m.user_id) m.user_id AS id,m.display_name AS name,u.email
   FROM boff_dev_internal.participant_links m JOIN auth.users u ON u.id=m.user_id
   WHERE m.league_id=p_league
   ORDER BY m.user_id,m.display_name
  ), logs AS (
   (SELECT 'event' AS source,c.event_key||':'||c.user_id AS id,c.kind,c.subject,u.email AS recipient,
    coalesce(delivery.status,'captured') AS status,coalesce(delivery.attempts,0) AS attempts,delivery.last_error AS error,coalesce(delivery.sent_at,c.created_at) AS time,c.kind<>'signin' AND c.html<>'' AS "hasPreview"
    FROM boff_dev_internal.notification_capture c LEFT JOIN auth.users u ON u.id=c.user_id LEFT JOIN sportsbook_private.communication_deliveries delivery ON (delivery.league_id,delivery.user_id,delivery.event_key)=(c.league_id,c.user_id,c.event_key)
    WHERE c.league_id=p_league AND (p_member IS NULL OR c.user_id=p_member)
     AND (p_status IS NULL OR p_status=coalesce(delivery.status,'captured'))
    ORDER BY c.created_at DESC,c.event_key LIMIT 50)
   UNION ALL
   (SELECT 'outbox',e.id::text,e.kind,c.payload->>'subject',e.recipient,e.status,e.attempts,e.last_error,
    coalesce(e.sent_at,c.created_at,e.terminal_at,e.created_at),
    e.kind<>'signin' AND c.payload->>'html' IS NOT NULL
    FROM public.outbound_emails e LEFT JOIN sportsbook_private.development_mail_captures c ON c.email_id=e.id
    WHERE e.league_id=p_league AND (p_status IS NULL OR e.status=p_status)
     AND (p_member IS NULL OR EXISTS(SELECT FROM members m WHERE m.id=p_member AND (
      coalesce(e.staff_user_id::text,e.routine_context->>'user_id',m.id::text)=m.id::text
      AND (e.staff_user_id=m.id OR e.routine_context->>'user_id'=m.id::text OR lower(e.recipient)=lower(m.email))
     )))
    ORDER BY coalesce(e.sent_at,c.created_at,e.terminal_at,e.created_at) DESC,e.id LIMIT 50)
  ), recent AS (SELECT * FROM logs ORDER BY time DESC,id LIMIT 50)
  SELECT jsonb_build_object(
   'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM members),'[]'),
   'logs',coalesce((SELECT jsonb_agg(to_jsonb(recent) ORDER BY time DESC,id) FROM recent),'[]'))
 );
END $function$
;
NOTIFY pgrst,'reload schema';
