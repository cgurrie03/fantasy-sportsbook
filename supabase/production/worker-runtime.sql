-- Schema only. Configuration/scheduling is a separate approved cutover action.
CREATE TABLE IF NOT EXISTS sportsbook_private.production_worker_runtime(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 configured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 season integer NOT NULL CHECK(season BETWEEN 2026 AND 2100),
 opening_week integer NOT NULL CHECK(opening_week BETWEEN 1 AND 22),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 notifications_enabled boolean NOT NULL DEFAULT false,
 CHECK(NOT notifications_enabled)
);
ALTER TABLE sportsbook_private.production_worker_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sportsbook_private.production_worker_runtime FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.production_refresh_runtime() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r sportsbook_private.production_worker_runtime;state text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production worker only';END IF;
 SELECT * INTO r FROM sportsbook_private.production_worker_runtime WHERE singleton;
 SELECT c.state INTO state FROM sportsbook_private.production_release_control c WHERE singleton;
 IF r.singleton IS NULL THEN RAISE EXCEPTION 'Production worker is not configured';END IF;
 RETURN jsonb_build_object('state',state,'season',r.season,'openingWeek',r.opening_week,'baselineAt',r.configured_at,
  'tokenHash',r.token_hash,'notificationsEnabled',r.notifications_enabled);
END $$;
REVOKE ALL ON FUNCTION public.production_refresh_runtime() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_refresh_runtime() TO service_role;
