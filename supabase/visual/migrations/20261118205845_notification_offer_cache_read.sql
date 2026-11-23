-- Reuse the published offer cache during notification eligibility checks.
-- No scheduler, recipient, preference, or notification timing changes.
DO $migration$
DECLARE definition text;updated text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;
 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO definition;
 updated:=replace(definition,
 'CROSS JOIN LATERAL jsonb_array_elements(boff_dev_internal.weekly_offer_options(c.board_id)) WHERE c.league_id=p_league',
 'JOIN public.sportsbook_boards ob ON ob.id=c.board_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(
   (SELECT oc.offers FROM boff_dev_internal.weekly_offer_cache oc WHERE oc.league_id=p_league
    AND oc.input_version=concat_ws('':'',ob.id,ob.revision,ob.content_version,c.source_hash,c.offer_schedule_hash)
    AND oc.next_cutoff>now()),
   boff_dev_internal.weekly_offer_options(c.board_id))) WHERE c.league_id=p_league');
 IF updated=definition OR updated NOT LIKE '%oc.next_cutoff>now()%' THEN RAISE EXCEPTION 'Candidate definition changed';END IF;
 EXECUTE updated;
END $migration$;
