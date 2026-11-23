DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE FUNCTION public.dev_save_communications(p_league uuid,p_choices jsonb,p_revision integer DEFAULT NULL,p_routine jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE choices jsonb; routine jsonb;
BEGIN
 IF p_routine IS NOT NULL THEN
  routine:=public.save_my_notification_preferences(p_league,p_revision,p_routine || '{"opening":false}'::jsonb);
 END IF;
 choices:=public.dev_notification_choices(p_league,p_choices);
 RETURN jsonb_build_object('choices',choices,'routine',routine);
END $$;

CREATE FUNCTION public.dev_owner_email_log(p_league uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 RETURN coalesce((
  SELECT jsonb_agg(to_jsonb(log) ORDER BY log.time DESC,log.id) FROM (
   (SELECT 'event' AS source, c.event_key||':'||c.user_id AS id, c.kind, c.subject,
    u.email AS recipient, 'captured' AS status, 0 AS attempts, NULL::text AS error, c.created_at AS time
    FROM boff_dev_internal.notification_capture c LEFT JOIN auth.users u ON u.id=c.user_id
    WHERE c.league_id=p_league ORDER BY c.created_at DESC LIMIT 50)
   UNION ALL
   (SELECT 'outbox', e.id::text, e.kind, c.payload->>'subject', e.recipient, e.status, e.attempts, e.last_error,
    coalesce(e.sent_at,c.created_at,e.terminal_at,e.created_at)
    FROM public.outbound_emails e LEFT JOIN sportsbook_private.development_mail_captures c ON c.email_id=e.id
    WHERE e.league_id=p_league ORDER BY e.created_at DESC LIMIT 50)
   ORDER BY time DESC LIMIT 50
  ) log
 ),'[]'::jsonb);
END $$;

CREATE FUNCTION public.dev_owner_captured_email(p_league uuid,p_source text,p_id text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required'; END IF;
 IF p_source='event' THEN
  RETURN (SELECT c.html FROM boff_dev_internal.notification_capture c
    WHERE league_id=p_league AND user_id::text=split_part(p_id,':',-1)
    AND event_key=left(p_id,length(p_id)-37));
 ELSIF p_source='outbox' THEN
  RETURN (SELECT c.payload->>'html' FROM public.outbound_emails e
   JOIN sportsbook_private.development_mail_captures c ON c.email_id=e.id
   WHERE e.id::text=p_id AND e.league_id=p_league AND e.kind<>'signin');
 END IF;
 RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.dev_save_communications(uuid,jsonb,integer,jsonb),public.dev_owner_email_log(uuid),public.dev_owner_captured_email(uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_save_communications(uuid,jsonb,integer,jsonb),public.dev_owner_email_log(uuid),public.dev_owner_captured_email(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dev_my_notification_samples(uuid) FROM authenticated;
NOTIFY pgrst,'reload schema';
