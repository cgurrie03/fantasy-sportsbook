BEGIN;
DO $$ BEGIN IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'bmvjcdgxwxqalaohpsnw' THEN RAISE EXCEPTION 'Production required';END IF;END $$;

-- Preparation uses immutable accepted tickets, independently of scoring refresh.
CREATE OR REPLACE FUNCTION public.production_confirmation_contexts(p_ticket uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE baseline timestamptz; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production worker only';END IF;
 SELECT notifications_enabled_at INTO baseline FROM sportsbook_private.production_worker_runtime WHERE singleton AND notifications_enabled;
 IF baseline IS NULL THEN RETURN '[]';END IF;
 WITH due AS (
  SELECT t.id,t.league_id,t.market_week,w.user_id,w.team_id,l.name,l.sleeper_league_id,l.avatar_url,c.payload
  FROM public.tickets t JOIN public.user_wallets w ON w.id=t.user_wallet_id AND w.league_id=t.league_id
  JOIN auth.users u ON u.id=w.user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
  JOIN public.leagues l ON l.id=t.league_id
  LEFT JOIN public.dev_current_book c ON c.league_id=t.league_id
  WHERE t.placed_at>=baseline AND t.placed_at>now()-interval '23 hours' AND (p_ticket IS NULL OR t.id=p_ticket)
   AND EXISTS(SELECT FROM boff_dev_internal.participant_links p WHERE p.league_id=t.league_id AND p.user_id=w.user_id)
   AND NOT EXISTS(SELECT FROM boff_dev_internal.notification_capture n WHERE n.league_id=t.league_id AND n.user_id=w.user_id AND n.event_key='confirmation:'||t.id)
  ORDER BY t.placed_at,t.id LIMIT 4
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('ticketId',d.id,'leagueId',d.league_id,'userId',d.user_id,'teamId',d.team_id,
  'leagueName',d.name,'path','/'||d.sleeper_league_id,'week',d.market_week,
  'payload',jsonb_build_object('teams',coalesce(d.payload->'teams','[]'),'leagueAvatar',coalesce(d.payload->'leagueAvatar',to_jsonb(d.avatar_url))),
  'edition',public.dev_email_edition(d.league_id,d.user_id,'confirmation',d.market_week,d.id))),'[]') INTO result FROM due d;
 RETURN result;
END $body$;
REVOKE ALL ON FUNCTION public.production_confirmation_contexts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_confirmation_contexts(uuid) TO service_role;

-- pg_net starts only after commit, when every accepted leg is available.
CREATE OR REPLACE FUNCTION sportsbook_private.dispatch_ticket_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE credential text;
BEGIN
 IF NOT sportsbook_private.release_environment_ready() OR NEW.user_wallet_id IS NULL OR NOT EXISTS(
  SELECT FROM sportsbook_private.production_worker_runtime WHERE singleton AND notifications_enabled AND NEW.placed_at>=notifications_enabled_at
 ) THEN RETURN NEW;END IF;
 SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name='boff_production_refresh_2026_11';
 IF credential IS NULL THEN RETURN NEW;END IF;
 PERFORM net.http_post(url:='https://sportsbook.coopergurrie.com/api/notification-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||credential),
  body:=jsonb_build_object('action','confirmation','ticketId',NEW.id),timeout_milliseconds:=60000);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Sending outages must never roll back a successfully accepted wager.
 RAISE WARNING 'Ticket confirmation deferred to scheduled retry';
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION sportsbook_private.dispatch_ticket_confirmation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS dispatch_ticket_confirmation ON public.tickets;
CREATE TRIGGER dispatch_ticket_confirmation AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION sportsbook_private.dispatch_ticket_confirmation();

-- A lightweight independent fallback handles transient dispatch/preparation errors.
SELECT cron.schedule('boff-production-communications','* * * * *','select sportsbook_private.dispatch_production_communications(false);');
NOTIFY pgrst,'reload schema';
COMMIT;
