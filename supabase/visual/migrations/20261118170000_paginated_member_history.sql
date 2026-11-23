DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE FUNCTION public.dev_ticket_history_page(p_league uuid,p_mine boolean DEFAULT false,p_status text DEFAULT 'All',
 p_week integer DEFAULT NULL,p_participant uuid DEFAULT NULL,p_search text DEFAULT '',p_sort text DEFAULT 'newest',
 p_cursor jsonb DEFAULT NULL,p_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; descending_order boolean:=p_sort IN('newest','stake-high'); pattern text;
BEGIN
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL)
 OR NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'Verified league membership required'; END IF;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR p_sort NOT IN('newest','oldest','stake-high','stake-low')
 OR p_status NOT IN('All','Open','Won','Lost','Push','Voided') OR length(p_search)>100
 OR (p_week IS NOT NULL AND p_week NOT BETWEEN 1 AND 18)
 OR (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object' OR NOT p_cursor ? 'value' OR NOT p_cursor ? 'id'))
 THEN RAISE EXCEPTION 'Invalid history parameters'; END IF;
 pattern:='%'||replace(replace(replace(p_search,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 WITH scope AS NOT MATERIALIZED (
  SELECT t.* FROM public.tickets t WHERE t.league_id=p_league AND
   (NOT p_mine OR t.user_wallet_id IN(SELECT id FROM public.user_wallets WHERE league_id=p_league AND user_id=auth.uid()))
 ), filtered AS NOT MATERIALIZED (
  SELECT t.*,CASE WHEN p_sort IN('stake-high','stake-low') THEN t.stake ELSE extract(epoch FROM t.placed_at) END AS page_value
  FROM scope t WHERE (p_status='All' OR t.status=upper(p_status)) AND (p_week IS NULL OR t.market_week=p_week)
  AND (p_participant IS NULL OR t.user_wallet_id=p_participant)
  AND (p_search='' OR t.id::text ILIKE pattern OR EXISTS(SELECT FROM public.ticket_legs l WHERE l.ticket_id=t.id AND (l.selection ILIKE pattern OR l.matchup ILIKE pattern)))
 ), candidates AS MATERIALIZED (
  SELECT * FROM filtered t WHERE p_cursor IS NULL OR
   (descending_order AND (t.page_value,t.id)<((p_cursor->>'value')::numeric,(p_cursor->>'id')::uuid)) OR
   (NOT descending_order AND (t.page_value,t.id)>((p_cursor->>'value')::numeric,(p_cursor->>'id')::uuid))
  ORDER BY CASE WHEN descending_order THEN page_value END DESC,CASE WHEN NOT descending_order THEN page_value END ASC,
   CASE WHEN descending_order THEN id END DESC,CASE WHEN NOT descending_order THEN id END ASC LIMIT p_size+1
 ), numbered AS (
  SELECT *,row_number() OVER(ORDER BY CASE WHEN descending_order THEN page_value END DESC,CASE WHEN NOT descending_order THEN page_value END ASC,
   CASE WHEN descending_order THEN id END DESC,CASE WHEN NOT descending_order THEN id END ASC) AS n FROM candidates
 ), page AS (
  SELECT n.*,coalesce((SELECT jsonb_agg(to_jsonb(l)-'source_record' ORDER BY l.leg_number) FROM public.ticket_legs l WHERE l.ticket_id=n.id),'[]') AS legs
  FROM numbered n WHERE n.n<=p_size
 )
 SELECT jsonb_build_object(
  'tickets',coalesce((SELECT jsonb_agg((to_jsonb(t)-'page_value'-'n'-'legs'-'source_record'-'policy_snapshot'-'sportsbook_policy_snapshot')||jsonb_build_object('ticket_legs',legs) ORDER BY n) FROM page t),'[]'),
  'next',CASE WHEN (SELECT count(*) FROM candidates)>p_size THEN (SELECT jsonb_build_object('value',page_value::text,'id',id) FROM page ORDER BY n DESC LIMIT 1) ELSE NULL END,
  'summary',(SELECT jsonb_build_object('count',count(*),'openStake',coalesce(sum(stake) FILTER(WHERE status='OPEN'),0)) FROM scope),
  'weeks',coalesce((SELECT jsonb_agg(w ORDER BY w DESC) FROM(SELECT DISTINCT market_week AS w FROM scope)x),'[]'),
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM
    (SELECT user_wallet_id AS id,max(coalesce(bettor_display_name,'Historical Participant')) AS name FROM scope WHERE user_wallet_id IS NOT NULL GROUP BY user_wallet_id)x),'[]')
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dev_ticket_history_page(uuid,boolean,text,integer,uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_ticket_history_page(uuid,boolean,text,integer,uuid,text,text,jsonb,integer) TO authenticated;

CREATE FUNCTION public.dev_balance_history_page(p_league uuid,p_cursor jsonb DEFAULT NULL,p_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL)
 OR NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'Verified league membership required'; END IF;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR
 (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object' OR NOT p_cursor ? 'time' OR NOT p_cursor ? 'id'))
 THEN RAISE EXCEPTION 'Invalid history parameters'; END IF;
 WITH candidates AS MATERIALIZED (
  SELECT e.id,e.reason,e.kind,e.amount,e.balance_after,e.created_at FROM public.user_wallet_entries e
  JOIN public.user_wallets w ON w.id=e.wallet_id WHERE w.league_id=p_league AND w.user_id=auth.uid() AND
  (p_cursor IS NULL OR (e.created_at,e.id)<((p_cursor->>'time')::timestamptz,(p_cursor->>'id')::uuid))
  ORDER BY e.created_at DESC,e.id DESC LIMIT p_size+1
 ), page AS(SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_size)
 SELECT jsonb_build_object('entries',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,id DESC) FROM page p),'[]'),
 'next',CASE WHEN (SELECT count(*) FROM candidates)>p_size THEN
 (SELECT jsonb_build_object('time',created_at,'id',id) FROM page ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dev_balance_history_page(uuid,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_balance_history_page(uuid,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
