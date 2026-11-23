DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE TABLE boff_dev_internal.weekly_offer_claims (
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 season integer NOT NULL,
 week integer NOT NULL,
 slot text NOT NULL CHECK(slot IN ('underdogs','favorites','duels')),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 ticket_id uuid UNIQUE REFERENCES public.tickets(id),
 percent numeric NOT NULL,
 PRIMARY KEY(league_id,season,week,slot,user_id)
);
ALTER TABLE boff_dev_internal.weekly_offer_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.weekly_offer_claims FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION boff_dev_internal.weekly_offer_options(p_board uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH book AS (
  SELECT d.payload,b.closes_at FROM public.dev_current_book d JOIN public.sportsbook_boards b ON b.id=d.board_id
  WHERE b.id=p_board AND b.status='published' AND b.opens_at<=now() AND b.closes_at>now()
   AND d.valid_until>now() AND d.last_error IS NULL
 ), matchup_deadlines AS (
  SELECT t.value->>'matchupId' AS matchup, min((p.value->>'kickoff')::timestamptz) AS kickoff
  FROM book CROSS JOIN LATERAL jsonb_array_elements(payload->'teams') t
  JOIN LATERAL jsonb_array_elements(payload->'players') p ON p.value->>'roster'=t.value->>'roster_id'
  WHERE p.value->>'kickoff' IS NOT NULL
  GROUP BY 1
 ), eligible AS (
  SELECT m.*, least(book.closes_at,COALESCE((m.metadata->>'cutoff')::timestamptz,d.kickoff,(book.payload->>'firstGame')::timestamptz)) AS deadline
  FROM book JOIN public.sportsbook_markets m ON m.board_id=p_board
  LEFT JOIN matchup_deadlines d ON d.matchup=m.matchup_key
  WHERE m.active AND m.market_state='open' AND m.suspension_reason IS NULL AND m.boost_pct=0
   AND m.matchup_key IS NOT NULL AND m.metadata->>'alternate' IS DISTINCT FROM 'true'
   AND COALESCE((m.metadata->>'cutoff')::timestamptz,d.kickoff,(book.payload->>'firstGame')::timestamptz)>now()
 ), candidates AS (
  SELECT *, CASE WHEN odds>0 THEN 1+odds/100.0 ELSE 1+100.0/abs(odds) END AS decimal_price
  FROM eligible WHERE (kind='moneyline' AND odds>0) OR (kind='spread' AND line<0)
    OR (kind='match_total' AND side IN ('over','under'))
 ), combinations AS (
  SELECT theme.slot, theme.title, theme.description, theme.percent,
   least(dog.deadline, favorite.deadline, total.deadline) AS deadline,
   dog.decimal_price*favorite.decimal_price*total.decimal_price AS base,
   (SELECT jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'odds',p.odds,'subject',p.subject,'kind',p.kind,'matchup',p.matchup_key) ORDER BY p.kind)
    FROM candidates p WHERE p.id IN (dog.id,favorite.id,total.id)) AS picks,
   dog.id AS dog_id,favorite.id AS favorite_id,total.id AS total_id
  FROM candidates dog
  JOIN candidates favorite ON favorite.kind='spread' AND favorite.matchup_key<>dog.matchup_key
  JOIN candidates total ON total.kind='match_total' AND total.matchup_key NOT IN (dog.matchup_key,favorite.matchup_key)
  JOIN (VALUES
   ('underdogs','The Scoreboard Sprint','An underdog wins, a favorite covers, and a third matchup goes over.',50,'over'),
   ('favorites','The Low-Scoring Ambush','An underdog wins, a favorite covers, and a third matchup stays under.',25,'under')
  ) theme(slot,title,description,percent,side) ON theme.side=total.side
  WHERE dog.kind='moneyline' AND dog.decimal_price*favorite.decimal_price*total.decimal_price>=6
 ), sprint AS (
  SELECT * FROM combinations WHERE slot='underdogs' ORDER BY base,deadline DESC,dog_id,favorite_id,total_id LIMIT 1
 ), ambush AS (
  SELECT c.* FROM combinations c WHERE c.slot='favorites'
  ORDER BY (EXISTS(SELECT FROM sprint s WHERE s.dog_id=c.dog_id))::integer+
           (EXISTS(SELECT FROM sprint s WHERE s.favorite_id=c.favorite_id))::integer,
           base,deadline DESC,dog_id,favorite_id,total_id LIMIT 1
 ), duel_choices AS (
  SELECT * FROM (
   SELECT e.*, CASE WHEN odds>0 THEN 1+odds/100.0 ELSE 1+100.0/abs(odds) END AS decimal_price,
    row_number() OVER(PARTITION BY matchup_key, (odds>0) ORDER BY abs(odds),deadline DESC,id) AS pick_rank
   FROM eligible e WHERE kind='player_h2h'
  ) ranked WHERE pick_rank<=3
 ), duel_combinations AS (
  SELECT a.id AS first_id,b.id AS second_id,c.id AS third_id,
   a.decimal_price*b.decimal_price*c.decimal_price AS base,
   least(a.deadline,b.deadline,c.deadline) AS deadline,
   (SELECT jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'odds',p.odds,'subject',p.subject,'kind',p.kind,'matchup',p.matchup_key) ORDER BY p.matchup_key)
    FROM duel_choices p WHERE p.id IN (a.id,b.id,c.id)) AS picks
  FROM duel_choices a
  JOIN duel_choices b ON b.matchup_key>a.matchup_key
  JOIN duel_choices c ON c.matchup_key>b.matchup_key
  WHERE a.decimal_price*b.decimal_price*c.decimal_price>=6
   AND (a.odds>0 OR b.odds>0 OR c.odds>0)
   AND (a.odds<0 OR b.odds<0 OR c.odds<0)
 ), duel_sprint AS (
  SELECT * FROM duel_combinations WHERE NOT EXISTS(SELECT FROM sprint)
  ORDER BY base,deadline DESC,first_id,second_id,third_id LIMIT 1
 ), duel_ambush AS (
  SELECT c.* FROM duel_combinations c WHERE NOT EXISTS(SELECT FROM ambush)
   AND NOT EXISTS(SELECT FROM duel_sprint s WHERE ARRAY[s.first_id,s.second_id,s.third_id]=ARRAY[c.first_id,c.second_id,c.third_id])
  ORDER BY (SELECT count(*) FROM duel_sprint s,unnest(ARRAY[s.first_id,s.second_id,s.third_id]) p(id)
   WHERE p.id=ANY(ARRAY[c.first_id,c.second_id,c.third_id])),base,deadline DESC,first_id,second_id,third_id LIMIT 1
 ), options AS (
  SELECT slot,title,description,deadline,picks,base,percent FROM sprint
  UNION ALL
  SELECT slot,title,description,deadline,picks,base,percent FROM ambush
  UNION ALL
  SELECT 'underdogs','Upset on the Undercard','Player favorites and underdogs across three fantasy matchups.',deadline,picks,base,50 FROM duel_sprint
  UNION ALL
  SELECT 'favorites','Sunday Spotlight','A second set of player duels, with favorites and underdogs in the mix.',deadline,picks,base,25 FROM duel_ambush
  UNION ALL
  SELECT 'duels','Four Corners','Pick four player duels from different fantasy matchups.',min(deadline),'[]',NULL,25 FROM eligible
  WHERE kind='player_h2h' HAVING count(DISTINCT matchup_key)>=4
 )
 SELECT COALESCE(jsonb_agg(to_jsonb(options) ORDER BY slot),'[]') FROM options
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.weekly_offer_options(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_weekly_offers(p_league uuid,p_claim text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards; options jsonb; promo jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'League membership required'; END IF;
 SELECT sb.* INTO b FROM public.dev_current_book d JOIN public.sportsbook_boards sb ON sb.id=d.board_id WHERE d.league_id=p_league;
 IF b.id IS NULL THEN RETURN '[]'; END IF;
 options:=boff_dev_internal.weekly_offer_options(b.id);
 IF p_claim IS NOT NULL THEN
  SELECT value INTO promo FROM jsonb_array_elements(options) WHERE value->>'slot'=p_claim AND p_claim='duels';
  IF promo IS NULL THEN RAISE EXCEPTION 'Offer unavailable'; END IF;
  INSERT INTO boff_dev_internal.weekly_offer_claims VALUES(p_league,b.nfl_season,b.market_week,p_claim,auth.uid(),NULL,(promo->>'percent')::numeric)
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(value||jsonb_build_object('claimed',c.user_id IS NOT NULL,'used',c.ticket_id IS NOT NULL))
  FROM jsonb_array_elements(options) o
  LEFT JOIN boff_dev_internal.weekly_offer_claims c ON (c.league_id,c.season,c.week,c.slot,c.user_id)=(p_league,b.nfl_season,b.market_week,value->>'slot',auth.uid())),'[]');
END $$;

CREATE FUNCTION public.place_dev_weekly_offer(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid,p_slot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards; promo jsonb; c boff_dev_internal.weekly_offer_claims; placed jsonb; existing uuid;
BEGIN
 SELECT * INTO STRICT b FROM public.sportsbook_boards WHERE id=p_board AND board_type='weekly';
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_member(b.league_id) THEN RAISE EXCEPTION 'League membership required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('dev-current-book'),hashtext(b.league_id::text));
 PERFORM 1 FROM public.dev_current_book WHERE board_id=b.id FOR SHARE;
 SELECT * INTO b FROM public.sportsbook_boards WHERE id=p_board FOR SHARE;
 SELECT id INTO existing FROM public.tickets WHERE request_key=p_request;
 IF existing IS NOT NULL THEN
  SELECT * INTO c FROM boff_dev_internal.weekly_offer_claims WHERE ticket_id=existing AND user_id=auth.uid() AND slot=p_slot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request already used'; END IF;
  RETURN boff_dev_internal.place_reward_ticket(p_board,p_revision,p_picks,p_stake,p_request,c.percent);
 END IF;
 SELECT value INTO promo FROM jsonb_array_elements(boff_dev_internal.weekly_offer_options(b.id)) WHERE value->>'slot'=p_slot;
 IF promo IS NULL THEN RAISE EXCEPTION 'Offer unavailable or expired'; END IF;
 IF p_slot<>'duels' THEN
  IF ARRAY(SELECT (value->>'id')::uuid FROM jsonb_array_elements(promo->'picks') ORDER BY 1)
   IS DISTINCT FROM ARRAY(SELECT unnest(p_picks) ORDER BY 1) THEN RAISE EXCEPTION 'Offer selections changed. Reload the offer'; END IF;
  INSERT INTO boff_dev_internal.weekly_offer_claims VALUES(b.league_id,b.nfl_season,b.market_week,p_slot,auth.uid(),NULL,(promo->>'percent')::numeric)
  ON CONFLICT DO NOTHING;
 ELSIF cardinality(p_picks)<4 OR EXISTS(SELECT FROM public.sportsbook_markets m WHERE m.id=ANY(p_picks)
  AND (m.kind<>'player_h2h' OR m.boost_pct>0 OR m.metadata->>'lineup_locked'='true'
    OR COALESCE((m.metadata->>'cutoff')::timestamptz,'-infinity')<=clock_timestamp()))
  OR (SELECT count(DISTINCT matchup_key) FROM public.sportsbook_markets WHERE id=ANY(p_picks))<>cardinality(p_picks)
 THEN RAISE EXCEPTION 'Choose at least four unboosted Player Head-to-Head picks from different matchups'; END IF;
 SELECT * INTO c FROM boff_dev_internal.weekly_offer_claims
 WHERE (league_id,season,week,slot,user_id)=(b.league_id,b.nfl_season,b.market_week,p_slot,auth.uid()) FOR UPDATE;
 IF NOT FOUND OR c.ticket_id IS NOT NULL THEN RAISE EXCEPTION 'Offer must be claimed and unused'; END IF;
 placed:=boff_dev_internal.place_reward_ticket(p_board,p_revision,p_picks,p_stake,p_request,c.percent);
 IF (placed->>'duplicate')::boolean THEN RAISE EXCEPTION 'Request already used'; END IF;
 UPDATE boff_dev_internal.weekly_offer_claims SET ticket_id=(placed->>'ticket_id')::uuid
 WHERE (league_id,season,week,slot,user_id)=(c.league_id,c.season,c.week,c.slot,c.user_id);
 RETURN placed;
END $$;
DO $$ DECLARE body text; anchor text := '(select percent from boff_dev_internal.fantasy_reward_awards where ticket_id=p_ticket),0)';
BEGIN
 SELECT pg_get_functiondef('sportsbook_private.user_settle_weekly_ticket(uuid,jsonb)'::regprocedure) INTO body;
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Settlement boost anchor changed'; END IF;
 EXECUTE replace(body,anchor,'(select percent from boff_dev_internal.fantasy_reward_awards where ticket_id=p_ticket),(select percent from boff_dev_internal.weekly_offer_claims where ticket_id=p_ticket),0)');
END $$;
REVOKE ALL ON FUNCTION public.dev_weekly_offers(uuid,text),public.place_dev_weekly_offer(uuid,integer,uuid[],numeric,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_weekly_offers(uuid,text),public.place_dev_weekly_offer(uuid,integer,uuid[],numeric,uuid,text) TO authenticated;

CREATE FUNCTION boff_dev_internal.check_player_quote_cutoff() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.settlement_context->>'kind'='player_h2h'
   AND NEW.settlement_context->'metadata'->>'cutoff' IS NOT NULL
   AND (NEW.settlement_context->'metadata'->>'cutoff')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION 'A player head-to-head line has closed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_dev_player_quote_cutoff BEFORE INSERT ON public.ticket_legs
FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.check_player_quote_cutoff();
NOTIFY pgrst,'reload schema';
