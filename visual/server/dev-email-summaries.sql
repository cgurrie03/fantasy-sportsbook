DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
END $$;

CREATE FUNCTION public.dev_email_event_summary(p_league uuid,p_user uuid,p_kind text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ticket_id uuid;
DECLARE summary jsonb;
DECLARE book record;
DECLARE offers jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Mail worker required'; END IF;
 IF p_kind IN ('settled','leg') THEN
  IF split_part(p_key,':',1) IS DISTINCT FROM p_kind OR split_part(p_key,':',2) !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   THEN RETURN '{}'; END IF;
  ticket_id:=split_part(p_key,':',2)::uuid;
  SELECT jsonb_build_object('Ticket',left(t.id::text,8),'Week',t.market_week,'Stake',t.stake||' credits',
   'Ticket Odds',CASE WHEN t.accepted_combined_odds>0 THEN '+' ELSE '' END||t.accepted_combined_odds)
   || coalesce((
    SELECT jsonb_object_agg('Leg '||leg.leg_number,
     left(leg.selection,145)||' · '||initcap(leg.status)||' · '||
      CASE WHEN leg.accepted_odds>0 THEN '+' ELSE '' END||leg.accepted_odds ORDER BY leg.leg_number)
    FROM public.ticket_legs leg WHERE leg.ticket_id=t.id
   ),'{}')
  INTO summary
  FROM public.tickets t JOIN public.user_wallets w ON w.id=t.user_wallet_id
  WHERE t.id=ticket_id AND t.league_id=p_league AND w.league_id=p_league AND w.user_id=p_user
   AND (p_kind<>'settled' OR t.settled_at IS NOT NULL);
  RETURN coalesce(summary,'{}');
 END IF;

 IF p_kind NOT IN ('opening','offers') THEN RETURN '{}'; END IF;
 SELECT b.id,b.market_week,concat_ws(':',b.id,b.revision,b.content_version,d.source_hash,d.offer_schedule_hash) AS version
 INTO book FROM public.dev_current_book d JOIN public.sportsbook_boards b ON b.id=d.board_id
 WHERE d.league_id=p_league AND b.status='published' AND b.opens_at<=now()
  AND b.closes_at>now() AND d.valid_until>now() AND d.last_error IS NULL;
 IF NOT FOUND THEN RETURN '{}'; END IF;
 offers:=boff_dev_internal.cached_weekly_offer_options(p_league,book.id,book.version);
 SELECT coalesce(jsonb_object_agg('Offer '||o.ordinality,
  left(o.value->>'title',100)||' · '||(o.value->>'percent')||'% Profit Boost'||
  coalesce((SELECT ' · '||string_agg(left(leg->>'label',80),', ' ORDER BY n)
   FROM jsonb_array_elements(o.value->'picks') WITH ORDINALITY p(leg,n)),'')),'{}')
 INTO summary FROM jsonb_array_elements(offers) WITH ORDINALITY o(value,ordinality);
 RETURN jsonb_build_object('Week',book.market_week)||summary;
END $$;
REVOKE ALL ON FUNCTION public.dev_email_event_summary(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_email_event_summary(uuid,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
