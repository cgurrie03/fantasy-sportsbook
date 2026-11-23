DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
END $$;

CREATE FUNCTION boff_dev_internal.communication_details(p_choices jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT count(*) FILTER(WHERE value->>'details'='true')=11
 FROM jsonb_each(coalesce(p_choices,'{}'))
$$;

CREATE FUNCTION boff_dev_internal.effective_communications(p_choices jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_object_agg(kind,jsonb_strip_nulls(jsonb_build_object(
  'email',coalesce((p_choices->kind->>'email')::boolean,true),
  'push',CASE WHEN push THEN coalesce((p_choices->kind->>'push')::boolean,true) END,
  'details',boff_dev_internal.communication_details(p_choices)
 )))
 FROM (VALUES ('opening',true),('reminder',false),('recap',false),('monday_watch',false),
  ('reopening',false),('settled',true),('leg',true),('offers',true),('reward',true),('credit',true),('featured',true)) kinds(kind,push)
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.communication_details(jsonb),boff_dev_internal.effective_communications(jsonb) FROM PUBLIC, anon, authenticated, service_role;

DO $$ DECLARE body text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.dev_notification_choices(uuid,jsonb)'::regprocedure) INTO body;
 updated:=replace(body,'RETURN coalesce((SELECT choices FROM boff_dev_internal.notification_choices WHERE league_id=p_league AND user_id=auth.uid()),''{}'');',
  'RETURN boff_dev_internal.effective_communications((SELECT choices FROM boff_dev_internal.notification_choices WHERE league_id=p_league AND user_id=auth.uid()));');
 IF updated=body THEN RAISE EXCEPTION 'Notification preference definition changed'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_notification_candidates(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'SELECT c.user_id, c.choices,','SELECT m.user_id, effective.choices,');
 updated:=replace(updated,'FROM boff_dev_internal.notification_choices c JOIN boff_dev_internal.participant_links m ON m.league_id=c.league_id AND m.user_id=c.user_id',
  'FROM (SELECT DISTINCT league_id,user_id FROM boff_dev_internal.participant_links WHERE league_id=p_league AND user_id IS NOT NULL) m
   LEFT JOIN boff_dev_internal.notification_choices c ON m.league_id=c.league_id AND m.user_id=c.user_id
   CROSS JOIN LATERAL (SELECT boff_dev_internal.effective_communications(c.choices) AS choices) effective');
 updated:=replace(replace(replace(updated,'a.id=c.user_id','a.id=m.user_id'),'l.id=c.league_id','l.id=m.league_id'),'live.league_id=c.league_id','live.league_id=m.league_id');
 updated:=replace(updated,'w.league_id=c.league_id AND w.user_id=c.user_id','w.league_id=m.league_id AND w.user_id=m.user_id');
 updated:=replace(updated,'WHERE c.league_id=p_league AND EXISTS(','WHERE m.league_id=p_league AND EXISTS(');
 updated:=replace(replace(updated,'jsonb_each(c.choices) e','jsonb_each(effective.choices) e'),'d.user_id=c.user_id','d.user_id=m.user_id');
 updated:=replace(updated,'''Return'',t.actual_payout','''Return'',t.actual_payout||'' credits''');
 updated:=replace(updated,'''Featured game'',q.featured','''Featured Game'',q.featured');
 IF updated NOT LIKE '%jsonb_each(effective.choices)%' OR updated NOT LIKE '%SELECT m.user_id, effective.choices,%' THEN
  RAISE EXCEPTION 'Notification candidate definition changed';
 END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.dev_capture_notification(uuid,uuid,text,text,text,text,text)'::regprocedure) INTO body;
 updated:=replace(body,'participant_links m JOIN boff_dev_internal.notification_choices c','participant_links m LEFT JOIN boff_dev_internal.notification_choices c');
 updated:=replace(updated,'c.choices->p_kind->>''email''=''true''','boff_dev_internal.effective_communications(c.choices)->p_kind->>''email''=''true''');
 IF updated NOT LIKE '%LEFT JOIN boff_dev_internal.notification_choices%' OR updated NOT LIKE '%effective_communications(c.choices)%' THEN
  RAISE EXCEPTION 'Notification capture definition changed';
 END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('public.routine_delivery_permission(uuid,boolean)'::regprocedure) INTO body;
 updated:=replace(body,'coalesce(c.choices->(context->>''kind'')->>''details''=''true'',false)','boff_dev_internal.communication_details(c.choices)');
 IF updated=body THEN RAISE EXCEPTION 'Routine email detail definition changed'; END IF;
 EXECUTE updated;
END $$;

CREATE FUNCTION public.dev_owner_filtered_email_log(p_league uuid,p_member uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 RETURN (
  WITH members AS MATERIALIZED (
   SELECT DISTINCT ON(m.user_id) m.user_id AS id,m.display_name AS name,u.email
   FROM boff_dev_internal.participant_links m JOIN auth.users u ON u.id=m.user_id
   WHERE m.league_id=p_league
   ORDER BY m.user_id,m.display_name
  ), logs AS (
   (SELECT 'event' AS source,c.event_key||':'||c.user_id AS id,c.kind,c.subject,u.email AS recipient,
    'captured' AS status,0 AS attempts,NULL::text AS error,c.created_at AS time,c.kind<>'signin' AND c.html<>'' AS "hasPreview"
    FROM boff_dev_internal.notification_capture c LEFT JOIN auth.users u ON u.id=c.user_id
    WHERE c.league_id=p_league AND (p_member IS NULL OR c.user_id=p_member)
     AND (p_status IS NULL OR p_status='captured')
    ORDER BY c.created_at DESC,c.event_key LIMIT 50)
   UNION ALL
   (SELECT 'outbox',e.id::text,e.kind,c.payload->>'subject',e.recipient,e.status,e.attempts,e.last_error,
    coalesce(e.sent_at,c.created_at,e.terminal_at,e.created_at),
    e.kind<>'signin' AND c.payload->>'html' IS NOT NULL
    FROM public.outbound_emails e LEFT JOIN sportsbook_private.development_mail_captures c ON c.email_id=e.id
    WHERE e.league_id=p_league AND (p_status IS NULL OR e.status=p_status)
     AND (p_member IS NULL OR EXISTS(SELECT FROM members m WHERE m.id=p_member AND (
      coalesce(e.staff_user_id::text,e.routine_context->>'user_id',m.id::text)=m.id::text
      AND (e.staff_user_id=m.id OR e.routine_context->>'user_id'=m.id::text OR lower(e.recipient)=lower(m.email))
     )))
    ORDER BY coalesce(e.sent_at,c.created_at,e.terminal_at,e.created_at) DESC,e.id LIMIT 50)
  ), recent AS (SELECT * FROM logs ORDER BY time DESC,id LIMIT 50)
  SELECT jsonb_build_object(
   'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM members),'[]'),
   'logs',coalesce((SELECT jsonb_agg(to_jsonb(recent) ORDER BY time DESC,id) FROM recent),'[]'))
 );
END $$;
REVOKE ALL ON FUNCTION public.dev_owner_filtered_email_log(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_owner_filtered_email_log(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
