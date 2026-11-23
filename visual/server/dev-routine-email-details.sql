DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

-- Keep the delivery policy and its budget/freeze checks in the existing routine.
CREATE OR REPLACE FUNCTION public.routine_delivery_permission(p_email uuid,p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE decision jsonb; context jsonb; include_details boolean; queued public.outbound_emails;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Mail worker only.'; END IF;
 decision:=sportsbook_private.routine_delivery_permission_at(p_email,false,now());
 context:=decision->'context';
 IF decision->>'allowed' IS DISTINCT FROM 'true' OR context IS NULL THEN RETURN decision; END IF;

 SELECT coalesce(c.choices->(context->>'kind')->>'details'='true',false)
 INTO include_details
 FROM (SELECT 1) lookup LEFT JOIN boff_dev_internal.notification_choices c
 ON c.league_id=(context->>'league_id')::uuid AND c.user_id=(context->>'user_id')::uuid;

 SELECT * INTO STRICT queued FROM public.outbound_emails WHERE id=p_email;
 IF queued.payload IS NOT NULL AND NOT include_details
   AND queued.routine_context->>'include_details' IS DISTINCT FROM 'false' THEN
  RETURN jsonb_build_object('allowed',false,'reason','Email details were disabled before delivery. The saved message was retired.');
 END IF;
 IF p_commit THEN
  decision:=sportsbook_private.routine_delivery_permission_at(p_email,true,now());
  IF decision->>'allowed' IS DISTINCT FROM 'true' THEN RETURN decision; END IF;
 END IF;
 IF queued.payload IS NOT NULL THEN RETURN decision; END IF;
 RETURN jsonb_set(decision,'{context,include_details}',to_jsonb(include_details));
END $$;

-- Serialize preference changes with the routine delivery permission check.
CREATE OR REPLACE FUNCTION public.dev_save_communications(p_league uuid,p_choices jsonb,p_revision integer DEFAULT NULL,p_routine jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE choices jsonb; routine jsonb;
BEGIN
 IF p_routine IS NOT NULL THEN
  routine:=public.save_my_notification_preferences(p_league,p_revision,p_routine || '{"opening":false}'::jsonb);
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('notification-defaults:'||p_league,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('notification-user:'||p_league||':'||auth.uid(),0));
 END IF;
 choices:=public.dev_notification_choices(p_league,p_choices);
 RETURN jsonb_build_object('choices',choices,'routine',routine);
END $$;
NOTIFY pgrst,'reload schema';
