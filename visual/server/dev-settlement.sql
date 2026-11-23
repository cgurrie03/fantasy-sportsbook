DO $$ BEGIN IF application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only';END IF;END $$;
CREATE FUNCTION public.settle_dev_ticket(p_ticket uuid,p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tickets;owner_id uuid;old_sub text;result jsonb;BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev result worker only';END IF;
 PERFORM pg_advisory_xact_lock_shared(20261101,17);
 SELECT * INTO STRICT t FROM public.tickets WHERE id=p_ticket;
 IF t.league_id<>'13121261-5398-4391-8240-000000000003' OR t.user_wallet_id IS NULL OR t.ticket_type='future' THEN RAISE EXCEPTION 'Only new dev weekly tickets settle here';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sportsbook_boards WHERE league_id=t.league_id AND nfl_season=t.nfl_season AND market_week=t.market_week AND board_type='weekly' AND closes_at+interval '6 hours'<=clock_timestamp()) THEN RAISE EXCEPTION 'Weekly settlement window not reached';END IF;
 SELECT m.user_id INTO STRICT owner_id FROM sportsbook_private.platform_owner p JOIN public.league_memberships m ON m.id=p.membership_id;
 old_sub:=current_setting('request.jwt.claim.sub',true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=sportsbook_private.user_settle_weekly_ticket(p_ticket,p_results);
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.settle_dev_ticket(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dev_ticket(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
