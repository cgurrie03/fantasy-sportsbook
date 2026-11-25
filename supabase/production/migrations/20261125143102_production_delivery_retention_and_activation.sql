BEGIN;
DO $$ BEGIN IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'bmvjcdgxwxqalaohpsnw' THEN RAISE EXCEPTION 'Production required';END IF;END $$;
CREATE OR REPLACE FUNCTION public.production_claim_communications(p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE baseline timestamptz; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production worker only';END IF;
 SELECT notifications_enabled_at INTO baseline FROM sportsbook_private.production_worker_runtime WHERE singleton AND notifications_enabled;
 IF baseline IS NULL THEN RETURN '[]';END IF;
 INSERT INTO sportsbook_private.communication_deliveries(league_id,user_id,event_key)
 SELECT c.league_id,c.user_id,c.event_key FROM boff_dev_internal.notification_capture c
 WHERE c.created_at>=baseline AND c.created_at>now()-interval '23 hours' AND c.kind IN('opening','recap','monday_watch','settled','credit','confirmation','attention','invite-existing','invite-new')
 AND NOT EXISTS(SELECT FROM sportsbook_private.communication_deliveries existing WHERE (existing.league_id,existing.user_id,existing.event_key)=(c.league_id,c.user_id,c.event_key))
 ORDER BY c.created_at LIMIT 100 ON CONFLICT DO NOTHING;
 UPDATE sportsbook_private.communication_deliveries SET status='needs_review',lease_until=NULL,last_error='Retry window expired; check provider before resending'
 WHERE status IN('pending','failed','sending') AND created_at<now()-interval '23 hours';
 -- Revalidate email verification, membership and invitation validity at delivery time.
 UPDATE sportsbook_private.communication_deliveries d SET status='skipped',last_error='Recipient no longer eligible',lease_until=NULL
 FROM boff_dev_internal.notification_capture c
 WHERE (d.league_id,d.user_id,d.event_key)=(c.league_id,c.user_id,c.event_key) AND d.status IN('pending','failed','sending') AND coalesce(d.lease_until,'-infinity')<now() AND NOT EXISTS(
 SELECT FROM auth.users u WHERE u.id=d.user_id AND u.deleted_at IS NULL AND (
 (c.kind IN('invite-existing','invite-new') AND EXISTS(SELECT FROM boff_dev_internal.member_invitations i WHERE 'invitation:'||i.id=c.event_key AND i.account_id=u.id AND i.status='pending' AND i.expires_at>now()))
 OR (u.email_confirmed_at IS NOT NULL AND EXISTS(SELECT FROM boff_dev_internal.participant_links p WHERE p.league_id=d.league_id AND p.user_id=u.id)
 AND (c.kind IN('confirmation','attention') OR EXISTS(SELECT FROM (SELECT boff_dev_internal.effective_communications(n.choices) choices FROM (SELECT 1) seed LEFT JOIN boff_dev_internal.notification_choices n ON n.league_id=d.league_id AND n.user_id=d.user_id) prefs WHERE prefs.choices->c.kind->>'email'='true')))));
 WITH due AS(SELECT id FROM sportsbook_private.communication_deliveries WHERE status IN('pending','failed','sending') AND attempts<5 AND coalesce(lease_until,'-infinity')<now() ORDER BY created_at,id LIMIT least(4,greatest(1,p_limit)) FOR UPDATE SKIP LOCKED),
 claimed AS(UPDATE sportsbook_private.communication_deliveries d SET status='sending',attempts=d.attempts+1,lease_until=now()+interval '5 minutes' FROM due WHERE d.id=due.id RETURNING d.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'recipient',u.email,'sender',l.email_sender,'subject',c.subject,'html',c.html,'plain_text',c.plain_text)),'[]')
 INTO result FROM claimed d JOIN auth.users u ON u.id=d.user_id JOIN public.leagues l ON l.id=d.league_id
 JOIN boff_dev_internal.notification_capture c ON (d.league_id,d.user_id,d.event_key)=(c.league_id,c.user_id,c.event_key);
 RETURN result;
END $body$;

CREATE OR REPLACE FUNCTION boff_dev_internal.trim_dev_notification_samples() RETURNS void LANGUAGE sql SET search_path='' AS $body$
 WITH due AS(SELECT league_id,user_id,event_key FROM boff_dev_internal.notification_capture WHERE created_at<now()-interval '45 days' AND (html<>'' OR plain_text<>'') ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED)
 UPDATE boff_dev_internal.notification_capture c SET html='',plain_text='' FROM due WHERE(c.league_id,c.user_id,c.event_key)=(due.league_id,due.user_id,due.event_key);
 WITH due AS(SELECT ctid FROM boff_dev_internal.notification_push_receipts WHERE created_at<now()-interval '45 days' LIMIT 100)
 DELETE FROM boff_dev_internal.notification_push_receipts r USING due WHERE r.ctid=due.ctid;
$body$;
REVOKE ALL ON FUNCTION boff_dev_internal.trim_dev_notification_samples() FROM PUBLIC,anon,authenticated,service_role;
UPDATE sportsbook_private.production_worker_runtime SET notifications_enabled=true,notifications_enabled_at=coalesce(notifications_enabled_at,clock_timestamp()) WHERE singleton;
SELECT cron.schedule('boff-production-communications','*/5 * * * *','select sportsbook_private.dispatch_production_communications(false);');
SELECT cron.schedule('boff-production-communication-retention','27 4 * * *','set statement_timeout=''10s''; select boff_dev_internal.trim_dev_notification_samples();');
NOTIFY pgrst,'reload schema';
COMMIT;
