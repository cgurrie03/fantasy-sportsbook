DO $$ BEGIN IF application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only';END IF;END $$;
ALTER TABLE public.dev_current_book ADD COLUMN refresh_lease_until timestamptz NOT NULL DEFAULT 'epoch';
CREATE FUNCTION public.claim_dev_pricing_refresh(p_league uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev worker only';END IF;
 UPDATE public.dev_current_book SET refresh_lease_until=clock_timestamp()+interval '45 seconds'
 WHERE league_id=p_league AND refresh_lease_until<clock_timestamp()
 AND (last_error IS NOT NULL OR observed_at<clock_timestamp()-(coalesce((payload->>'cadenceMinutes')::integer,5)*interval '1 minute'));
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_dev_pricing_refresh(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dev_pricing_refresh(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
