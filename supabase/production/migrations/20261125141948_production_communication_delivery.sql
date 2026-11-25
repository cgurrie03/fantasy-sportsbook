BEGIN;
DO $$ BEGIN IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'bmvjcdgxwxqalaohpsnw' THEN RAISE EXCEPTION 'Production required';END IF;END $$;
ALTER TABLE sportsbook_private.production_worker_runtime ADD COLUMN IF NOT EXISTS notifications_enabled_at timestamptz;
DO $$ DECLARE c record;BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='sportsbook_private.production_worker_runtime'::regclass AND pg_get_constraintdef(oid) LIKE '%NOT notifications_enabled%' LOOP EXECUTE format('ALTER TABLE sportsbook_private.production_worker_runtime DROP CONSTRAINT %I',c.conname);END LOOP;END $$;
CREATE TABLE sportsbook_private.communication_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),league_id uuid NOT NULL REFERENCES public.leagues,user_id uuid NOT NULL REFERENCES auth.users,event_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','needs_review','skipped')),
 attempts integer NOT NULL DEFAULT 0,provider_id text,last_error text,created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,lease_until timestamptz,
 UNIQUE(league_id,user_id,event_key));
ALTER TABLE sportsbook_private.communication_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sportsbook_private.communication_deliveries FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX communication_delivery_due ON sportsbook_private.communication_deliveries(status,lease_until,created_at) WHERE status IN('pending','failed','sending');
CREATE FUNCTION public.production_claim_communications(p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE baseline timestamptz; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production worker only';END IF;
 SELECT notifications_enabled_at INTO baseline FROM sportsbook_private.production_worker_runtime WHERE singleton AND notifications_enabled;
 IF baseline IS NULL THEN RETURN '[]';END IF;
 INSERT INTO sportsbook_private.communication_deliveries(league_id,user_id,event_key)
 SELECT c.league_id,c.user_id,c.event_key FROM boff_dev_internal.notification_capture c
 WHERE c.created_at>=baseline AND c.created_at>now()-interval '23 hours' AND c.kind IN('opening','recap','monday_watch','settled','credit','confirmation','attention','invite-existing','invite-new')
 ORDER BY c.created_at LIMIT 100 ON CONFLICT DO NOTHING;
 UPDATE sportsbook_private.communication_deliveries SET status='needs_review',lease_until=NULL,last_error='Retry window expired; check provider before resending'
 WHERE status IN('pending','failed','sending') AND created_at<now()-interval '23 hours';
 -- Revalidate email verification, membership and invitation validity at delivery time.
 UPDATE sportsbook_private.communication_deliveries d SET status='skipped',last_error='Recipient no longer eligible',lease_until=NULL
 FROM boff_dev_internal.notification_capture c
 WHERE (d.league_id,d.user_id,d.event_key)=(c.league_id,c.user_id,c.event_key) AND d.status IN('pending','failed') AND NOT EXISTS(
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
CREATE FUNCTION public.production_finish_communication(p_id uuid,p_provider text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker only';END IF;
 UPDATE sportsbook_private.communication_deliveries SET status=CASE WHEN p_provider IS NOT NULL THEN 'sent' WHEN attempts>=5 THEN 'needs_review' ELSE 'failed' END,
 provider_id=p_provider,last_error=left(p_error,160),sent_at=CASE WHEN p_provider IS NOT NULL THEN now() END,lease_until=CASE WHEN p_provider IS NULL THEN now()+interval '5 minutes' END WHERE id=p_id AND status='sending';
END $body$;
REVOKE ALL ON FUNCTION public.production_claim_communications(integer),public.production_finish_communication(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_claim_communications(integer),public.production_finish_communication(uuid,text,text) TO service_role;
CREATE FUNCTION sportsbook_private.dispatch_production_communications(p_health boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE credential text; request_id bigint;
BEGIN
 IF NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production required';END IF;
 SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name='boff_production_refresh_2026_11';
 IF credential IS NULL THEN RAISE EXCEPTION 'Worker credential unavailable';END IF;
 SELECT net.http_post(url:='https://sportsbook.coopergurrie.com/api/notification-delivery',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||credential),body:=jsonb_build_object('action',CASE WHEN p_health THEN 'health' ELSE 'deliver' END),timeout_milliseconds:=60000) INTO request_id;
 RETURN request_id;
END $body$;
REVOKE ALL ON FUNCTION sportsbook_private.dispatch_production_communications(boolean) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
