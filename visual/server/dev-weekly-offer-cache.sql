DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
END $$;

CREATE TABLE boff_dev_internal.weekly_offer_cache (
 league_id uuid PRIMARY KEY REFERENCES public.leagues(id) ON DELETE CASCADE,
 input_version text NOT NULL,
 next_cutoff timestamptz NOT NULL,
 offers jsonb NOT NULL CHECK (octet_length(offers::text) <= 32768)
);
ALTER TABLE boff_dev_internal.weekly_offer_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.weekly_offer_cache FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.dev_current_book ADD COLUMN offer_schedule_hash text;
CREATE FUNCTION boff_dev_internal.hash_offer_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.offer_schedule_hash IS NULL OR NEW.payload IS DISTINCT FROM OLD.payload THEN
  NEW.offer_schedule_hash:=md5(jsonb_build_array(
   NEW.payload->'firstGame',
   (SELECT jsonb_agg(jsonb_build_array(t->'matchupId',t->'roster_id') ORDER BY t->>'roster_id') FROM jsonb_array_elements(NEW.payload->'teams') t),
   (SELECT jsonb_agg(jsonb_build_array(p->'roster',p->'kickoff') ORDER BY p->>'roster',p->>'kickoff') FROM jsonb_array_elements(NEW.payload->'players') p)
  )::text);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.hash_offer_schedule() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER hash_offer_schedule BEFORE INSERT OR UPDATE OF payload ON public.dev_current_book
FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.hash_offer_schedule();
UPDATE public.dev_current_book SET payload=payload WHERE offer_schedule_hash IS NULL;

CREATE FUNCTION boff_dev_internal.cached_weekly_offer_options(p_league uuid, p_board uuid, p_version text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cached boff_dev_internal.weekly_offer_cache;
DECLARE options jsonb;
DECLARE cutoff timestamptz;
BEGIN
 SELECT * INTO cached FROM boff_dev_internal.weekly_offer_cache WHERE league_id=p_league;
 IF cached.input_version=p_version AND cached.next_cutoff>now() THEN RETURN cached.offers; END IF;

 PERFORM pg_advisory_xact_lock(hashtext('dev-weekly-offer-cache'), hashtext(p_league::text));
 SELECT * INTO cached FROM boff_dev_internal.weekly_offer_cache WHERE league_id=p_league;
 IF cached.input_version=p_version AND cached.next_cutoff>now() THEN RETURN cached.offers; END IF;

 options:=boff_dev_internal.weekly_offer_options(p_board);
 SELECT coalesce(min(times.cutoff),'infinity'::timestamptz) INTO cutoff
 FROM (
  SELECT (m.metadata->>'cutoff')::timestamptz AS cutoff
  FROM public.sportsbook_markets m
  WHERE m.board_id=p_board AND m.active AND m.kind IN ('moneyline','spread','match_total','player_h2h','player_milestone')
  UNION ALL
  SELECT (p.value->>'kickoff')::timestamptz
  FROM public.dev_current_book b CROSS JOIN LATERAL jsonb_array_elements(b.payload->'players') p
  WHERE b.league_id=p_league AND b.board_id=p_board
  UNION ALL
  SELECT (o.value->>'deadline')::timestamptz FROM jsonb_array_elements(options) o
 ) times
 WHERE times.cutoff>now();
 INSERT INTO boff_dev_internal.weekly_offer_cache(league_id,input_version,next_cutoff,offers)
 VALUES(p_league,p_version,cutoff,options)
 ON CONFLICT(league_id) DO UPDATE SET
  input_version=excluded.input_version,next_cutoff=excluded.next_cutoff,offers=excluded.offers;
 RETURN options;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.cached_weekly_offer_options(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.dev_weekly_offer_changes(p_league uuid, p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards;
DECLARE input_version text;
DECLARE offers jsonb := '[]';
DECLARE version text;
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'League membership required'; END IF;
 SELECT sb.* INTO b FROM public.dev_current_book d
 JOIN public.sportsbook_boards sb ON sb.id=d.board_id
 WHERE d.league_id=p_league AND sb.status='published' AND sb.opens_at<=now()
  AND sb.closes_at>now() AND d.valid_until>now() AND d.last_error IS NULL;
 IF b.id IS NOT NULL THEN
  SELECT concat_ws(':',b.id,b.revision,b.content_version,d.source_hash,d.offer_schedule_hash)
  INTO input_version FROM public.dev_current_book d WHERE d.league_id=p_league AND d.board_id=b.id;
  IF input_version IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(o.value || jsonb_build_object('claimed',c.user_id IS NOT NULL,'used',c.ticket_id IS NOT NULL)
     ORDER BY o.position),'[]') INTO offers
   FROM jsonb_array_elements(boff_dev_internal.cached_weekly_offer_options(p_league,b.id,input_version))
    WITH ORDINALITY o(value,position)
   LEFT JOIN boff_dev_internal.weekly_offer_claims c
     ON (c.league_id,c.season,c.week,c.slot,c.user_id)=(p_league,b.nfl_season,b.market_week,o.value->>'slot',auth.uid());
  END IF;
 END IF;
 version:=md5(offers::text);
 RETURN CASE WHEN version=p_version THEN jsonb_build_object('version',version)
  ELSE jsonb_build_object('version',version,'offers',offers) END;
END $$;
REVOKE ALL ON FUNCTION public.dev_weekly_offer_changes(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dev_weekly_offer_changes(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
