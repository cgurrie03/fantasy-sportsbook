DO $$ BEGIN IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;END $$;
CREATE FUNCTION boff_dev_internal.activity_rows(p_league uuid)
RETURNS TABLE(event_id text,event_at timestamptz,event_type text,label text,member_id uuid,member_name text,actor_id uuid,actor_name text,ticket_id uuid,week integer,details jsonb)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT 'placed:'||t.id,t.placed_at,'TicketPlaced','Ticket Placed',coalesce(w.user_id,t.team_id),
 coalesce(t.bettor_display_name,w.display_name,team.team_name||' · Historical Team'),NULL::uuid,'Member',t.id,t.market_week,
 jsonb_build_object('Stake',t.stake,'Accepted Odds',t.accepted_combined_odds,'Current Status',t.status)
 FROM public.tickets t JOIN public.teams team ON team.id=t.team_id LEFT JOIN public.user_wallets w ON w.id=t.user_wallet_id WHERE t.league_id=p_league
 UNION ALL
 SELECT 'settled:'||t.id,t.settled_at,CASE WHEN t.status='VOIDED' THEN 'TicketVoided' ELSE 'TicketSettled' END,
 CASE WHEN t.status='VOIDED' THEN 'Ticket Voided' ELSE 'Ticket Settled' END,coalesce(w.user_id,t.team_id),
 coalesce(t.bettor_display_name,w.display_name,team.team_name||' · Historical Team'),NULL::uuid,'Settlement',t.id,t.market_week,
 jsonb_build_object('Result',t.status,'Return',t.actual_payout,'Net Profit',t.net_profit)
 FROM public.tickets t JOIN public.teams team ON team.id=t.team_id LEFT JOIN public.user_wallets w ON w.id=t.user_wallet_id
 WHERE t.league_id=p_league AND t.settled_at IS NOT NULL AND t.status<>'OPEN'
 UNION ALL
 SELECT 'credit:'||e.id,e.created_at,'Credits',
 CASE e.kind WHEN 'claim' THEN 'Credits Claimed' WHEN 'opening' THEN 'Starting Credits' WHEN 'adjustment' THEN 'Credits Adjusted'
 WHEN 'payout' THEN 'Payout Credited' WHEN 'refund' THEN 'Credits Returned' ELSE initcap(replace(e.kind,'_',' ')) END,
 w.user_id,w.display_name,NULL::uuid,'Wallet Record',e.ticket_id,t.market_week,
 jsonb_build_object('Amount',e.amount,'Balance Before',e.balance_before,'Balance After',e.balance_after,'Reason',e.reason)
 FROM public.user_wallet_entries e JOIN public.user_wallets w ON w.id=e.wallet_id LEFT JOIN public.tickets t ON t.id=e.ticket_id
 WHERE e.league_id=p_league AND e.kind<>'wager'
 UNION ALL
 SELECT 'admin:'||a.id,a.created_at,
 CASE WHEN a.category~'(correct|settle|void)' THEN 'Correction' WHEN a.category~'(member|invitation)' THEN 'Membership'
 WHEN a.category~'(rule|policy|futures|featured|rival|reward)' THEN 'Rules' ELSE 'Administration' END,
 initcap(replace(a.category,'_',' ')),a.actor_id,coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=a.league_id AND p.user_id=a.actor_id),'Administrator'),
 a.actor_id,coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=a.league_id AND p.user_id=a.actor_id),'Administrator'),
 CASE WHEN coalesce(a.after_value->>'ticket_id',a.before_value->>'ticket_id')~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN coalesce(a.after_value->>'ticket_id',a.before_value->>'ticket_id')::uuid END,
 CASE WHEN coalesce(a.after_value->>'market_week',a.before_value->>'market_week')~'^[0-9]{1,2}$' THEN coalesce(a.after_value->>'market_week',a.before_value->>'market_week')::integer END,
 jsonb_build_object('Category',a.category,'Reason',a.reason)
 FROM public.admin_change_log a WHERE a.league_id=p_league
 UNION ALL
 SELECT 'staff:'||a.id,a.created_at,'Membership','Staff Access Changed',a.subject_id,
 coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=a.league_id AND p.user_id=a.subject_id),'League Staff'),
 a.actor_id,coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=a.league_id AND p.user_id=a.actor_id),'Administrator'),
 NULL::uuid,NULL::integer,jsonb_build_object('Reason',a.reason,'Previous Role',a.before_value->>'role','New Role',a.after_value->>'role')
 FROM public.league_staff_audit a WHERE a.league_id=p_league
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.activity_rows(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.dev_commissioner_activity(p_league uuid,p_type text DEFAULT 'All',p_member uuid DEFAULT NULL,p_week integer DEFAULT NULL,
 p_from date DEFAULT NULL,p_until date DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Verified commissioner or platform owner required';END IF;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR p_type IS NULL OR p_type NOT IN('All','TicketPlaced','TicketSettled','TicketVoided','Credits','Correction','Membership','Rules','Administration')
 OR (p_week IS NOT NULL AND p_week NOT BETWEEN 1 AND 18) OR (p_from IS NOT NULL AND p_until IS NOT NULL AND p_from>p_until)
 OR (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object' OR length(p_cursor::text)>256 OR NOT p_cursor?'time' OR NOT p_cursor?'id'))
 THEN RAISE EXCEPTION 'Invalid activity filters';END IF;
 WITH source AS MATERIALIZED(SELECT * FROM boff_dev_internal.activity_rows(p_league)),filtered AS(
 SELECT * FROM source WHERE (p_type='All' OR event_type=p_type) AND (p_member IS NULL OR member_id=p_member OR actor_id=p_member)
 AND(p_week IS NULL OR week=p_week) AND(p_from IS NULL OR event_at>=p_from::timestamp AT TIME ZONE 'America/New_York')
 AND(p_until IS NULL OR event_at<(p_until+1)::timestamp AT TIME ZONE 'America/New_York')
 ),candidates AS MATERIALIZED(
 SELECT * FROM filtered WHERE p_cursor IS NULL OR(event_at,event_id)<((p_cursor->>'time')::timestamptz,p_cursor->>'id')
 ORDER BY event_at DESC,event_id DESC LIMIT p_size+1
 ),page AS(SELECT * FROM candidates ORDER BY event_at DESC,event_id DESC LIMIT p_size)
 SELECT jsonb_build_object('events',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY event_at DESC,event_id DESC) FROM page p),'[]'),
 'next',CASE WHEN(SELECT count(*) FROM candidates)>p_size THEN(SELECT jsonb_build_object('time',event_at,'id',event_id) FROM page ORDER BY event_at ASC,event_id ASC LIMIT 1) ELSE NULL END,
 'count',(SELECT count(*) FROM filtered),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM(
 SELECT member_id AS id,max(member_name) AS name FROM source WHERE member_id IS NOT NULL GROUP BY member_id)x),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dev_commissioner_activity(uuid,text,uuid,integer,date,date,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_commissioner_activity(uuid,text,uuid,integer,date,date,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
