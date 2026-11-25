DO $$ BEGIN IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;END $$;
CREATE OR REPLACE FUNCTION public.dev_commissioner_members(p_league uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 RETURN jsonb_build_object('teams',coalesce((
  SELECT jsonb_agg(jsonb_build_object('teamId',t.id,'team',coalesce(nullif(source.value->>'name',''),t.team_name),'rosterId',t.roster_id,
   'memberId',m.id,
 'member',CASE WHEN m.user_id IS NULL AND EXISTS(
  SELECT FROM jsonb_array_elements(source.value->'coManagers') manager WHERE manager->>'id'=m.sleeper_user_id
 ) THEN NULL ELSE m.display_name END,
 'role',m.role,'mappedSleeperId',m.sleeper_user_id,
   'sleeperId',source.value->>'ownerId','sleeperName',coalesce(source.value->>'ownerName',source.value->'managers'->>0),
 'coManagers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',person.id,'name',person.name,'avatar',person.avatar,'accountId',link.user_id,
 'member',coalesce(link.display_name,CASE WHEN m.sleeper_user_id=person.id AND m.user_id IS NULL THEN m.display_name END),
 
  'walletStatus',wallet.status,'walletInitialized',wallet.balance IS NOT NULL,'departed',person.departed)
 ORDER BY person.departed,person.name),'[]') FROM (
   SELECT j->>'id' id,j->>'name' name,j->>'avatar' avatar,false departed
   FROM jsonb_array_elements(source.value->'coManagers') j
   UNION ALL SELECT x.sleeper_user_id,x.display_name,NULL,true FROM boff_dev_internal.co_manager_links x
   WHERE x.league_id=t.league_id AND x.team_id=t.id
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(source.value->'coManagers') j WHERE j->>'id'=x.sleeper_user_id)
  ) person LEFT JOIN boff_dev_internal.co_manager_links link
   ON link.league_id=t.league_id AND link.team_id=t.id AND link.sleeper_user_id=person.id
  LEFT JOIN public.user_wallets wallet ON wallet.league_id=t.league_id AND wallet.user_id=link.user_id)
 ,'avatar',coalesce(source.value->>'avatar',t.avatar_url),'hasAccount',m.user_id IS NOT NULL,
   'walletStatus',w.status,'walletInitialized',w.balance IS NOT NULL) ORDER BY t.roster_id)
  FROM public.teams t JOIN public.leagues l ON l.id=t.league_id
  LEFT JOIN public.league_memberships m ON m.league_id=t.league_id AND m.team_id=t.id
  LEFT JOIN public.user_wallets w ON w.league_id=t.league_id AND w.user_id=m.user_id
  LEFT JOIN public.dev_live_cache cache ON cache.key='league:'||l.sleeper_league_id
   AND cache.payload->'metadata'->>'season'=l.nfl_season::text
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(cache.payload->'metadata'->'teams')
   WHERE (value->>'rosterId')::integer=t.roster_id LIMIT 1) source ON true
  WHERE t.league_id=p_league),'[]'));
END $function$
;
CREATE OR REPLACE FUNCTION boff_dev_internal.storage_maintenance(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
 SET lock_timeout TO '500ms'
AS $function$
DECLARE lim integer:=least(100,greatest(1,coalesce(p_limit,25)));q record;fk record;protected boolean;used boolean;
 quotes integer:=0;bundles integer:=0;values_removed integer:=0;progress integer:=0;run_result jsonb;old_role text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev project required';END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('boff.storage.maintenance')) THEN RETURN jsonb_build_object('skipped','busy');END IF;
 -- Existing retention routines preserve event keys, financial rows and pending failures.
 old_role:=current_setting('request.jwt.claim.role',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 run_result:=public.cleanup_routine_payloads(lim)||public.cleanup_terminal_refresh_payloads(least(lim,10))||public.cleanup_evaluated_samples(least(lim,10));
 PERFORM set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 FOR q IN SELECT m.id FROM public.sportsbook_markets m JOIN public.sportsbook_boards b ON b.id=m.board_id
  WHERE NOT m.active AND b.closes_at<now()-interval '7 days'
   AND (b.board_type='weekly' OR (b.status='closed' AND m.metadata->>'resolved'='true' AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.league_id=b.league_id AND t.nfl_season=b.nfl_season AND t.status='OPEN')))
   AND NOT EXISTS(SELECT 1 FROM public.ticket_legs l WHERE l.market_quote_id=m.id)
  ORDER BY b.closes_at,m.id LIMIT lim FOR UPDATE OF m SKIP LOCKED LOOP
  protected:=false;
  -- Any FK reference protects a quote, even if its FK would cascade or set null.
  FOR fk IN SELECT c.conrelid::regclass AS rel,a.attname AS col FROM pg_catalog.pg_constraint c
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND c.confrelid='public.sportsbook_markets'::regclass LOOP
   EXECUTE format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) INTO used USING q.id;
   IF used THEN protected:=true;EXIT;END IF;
  END LOOP;
  IF protected OR EXISTS(SELECT 1 FROM public.promo_offers o WHERE to_jsonb(o)::text LIKE '%'||q.id::text||'%')
   OR EXISTS(SELECT 1 FROM public.sportsbook_reopening_reviews r WHERE to_jsonb(r)::text LIKE '%'||q.id::text||'%')
   OR EXISTS(SELECT 1 FROM public.line_refresh_stages s WHERE to_jsonb(s)::text LIKE '%'||q.id::text||'%') THEN CONTINUE;END IF;
  DELETE FROM public.sportsbook_markets WHERE id=q.id;quotes:=quotes+1;
 END LOOP;
 FOR q IN SELECT league_id FROM (SELECT league_id FROM public.receipt_context_bundles UNION SELECT league_id FROM public.receipt_context_values) scopes ORDER BY league_id LIMIT lim LOOP
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('boff.receipt.storage'),pg_catalog.hashtext(q.league_id::text)) THEN CONTINUE;END IF;
  WITH due AS(SELECT b.id FROM public.receipt_context_bundles b WHERE b.league_id=q.league_id AND b.created_at<now()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.ticket_legs l WHERE l.context_bundle_id=b.id) ORDER BY b.id LIMIT lim)
  DELETE FROM public.receipt_context_bundles b USING due WHERE b.id=due.id;
  GET DIAGNOSTICS lim=ROW_COUNT;bundles:=bundles+lim;lim:=least(100,greatest(1,coalesce(p_limit,25)));
  WITH due AS(SELECT v.id FROM public.receipt_context_values v WHERE v.league_id=q.league_id AND v.created_at<now()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.receipt_context_bundles b CROSS JOIN LATERAL jsonb_each(b.refs) r WHERE b.league_id=v.league_id AND (r.value#>>'{}')::bigint=v.id)
   ORDER BY v.id LIMIT lim)
  DELETE FROM public.receipt_context_values v USING due WHERE v.id=due.id;
  GET DIAGNOSTICS lim=ROW_COUNT;values_removed:=values_removed+lim;lim:=least(100,greatest(1,coalesce(p_limit,25)));
 END LOOP;
 WITH due AS(SELECT o.league_id,o.nfl_season,o.market_week FROM public.ticket_score_observations o JOIN public.leagues l ON l.id=o.league_id
  WHERE o.fetched_at<now()-interval '14 days' AND (o.nfl_season<>l.nfl_season OR o.market_week<>l.active_week)
   AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.league_id=o.league_id AND t.nfl_season=o.nfl_season AND t.market_week=o.market_week AND t.status='OPEN')
  ORDER BY o.fetched_at LIMIT lim)
 DELETE FROM public.ticket_score_observations o USING due d WHERE (o.league_id,o.nfl_season,o.market_week)=(d.league_id,d.nfl_season,d.market_week);
 GET DIAGNOSTICS progress=ROW_COUNT;
 run_result:=run_result||jsonb_build_object('obsolete_quotes',quotes,'orphan_context_bundles',bundles,'orphan_context_values',values_removed,'old_progress_rows',progress,'batch_limit',least(100,greatest(1,coalesce(p_limit,25))));
 -- pg_cron is absent in the local test engine. Hosted history is bounded too.
 IF to_regclass('cron.job_run_details') IS NOT NULL THEN
  EXECUTE $history$delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname='boff-storage-maintenance') and end_time<now()-interval '24 hours'$history$;
 END IF;
 UPDATE boff_dev_internal.storage_maintenance_state SET last_run_at=clock_timestamp(),last_result=run_result WHERE singleton;
 RETURN run_result;
END $function$
;
NOTIFY pgrst,'reload schema';
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
  SELECT 'confirmation','confirmation:'||t.id,jsonb_build_object('Week',t.market_week,'Ticket',t.id)
  FROM public.tickets t WHERE t.user_wallet_id=r.wallet_id AND t.placed_at>now()-interval '24 hours'
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

NOTIFY pgrst,'reload schema';
