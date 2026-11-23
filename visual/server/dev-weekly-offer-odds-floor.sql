DO $$ DECLARE body text; updated text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
 SELECT pg_get_functiondef('boff_dev_internal.weekly_offer_options(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'WHERE m.active AND m.market_state=', 'WHERE m.odds>=-1000 AND m.active AND m.market_state=');
 IF updated=body THEN RAISE EXCEPTION 'Offer selection definition changed'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.place_dev_weekly_offer(uuid,integer,uuid[],numeric,uuid,text)'::regprocedure) INTO body;
 updated:=replace(body,' SELECT value INTO promo FROM jsonb_array_elements(boff_dev_internal.weekly_offer_options(b.id))', $guard$
 IF EXISTS(SELECT FROM public.sportsbook_markets WHERE board_id=b.id AND id=ANY(p_picks) AND odds < -1000)
 THEN RAISE EXCEPTION 'Weekly offers require each pick to have odds of -1000 or longer'; END IF;
 SELECT value INTO promo FROM jsonb_array_elements(boff_dev_internal.weekly_offer_options(b.id))
 $guard$);
 IF updated=body THEN RAISE EXCEPTION 'Offer placement definition changed'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
