DO $$ DECLARE body text; updated text; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.dev_commissioner_members(uuid)'::regprocedure) INTO body;
 updated:=replace(body,'''member'',m.display_name,', $primary$
 'member',CASE WHEN m.user_id IS NULL AND EXISTS(
  SELECT FROM jsonb_array_elements(source.value->'coManagers') manager WHERE manager->>'id'=m.sleeper_user_id
 ) THEN NULL ELSE m.display_name END,
 $primary$);
 updated:=replace(updated,'''member'',link.display_name,', $co$
 'member',coalesce(link.display_name,CASE WHEN m.sleeper_user_id=person.id AND m.user_id IS NULL THEN m.display_name END),
 $co$);
 IF updated=body THEN RAISE EXCEPTION 'Missing manager directory hooks'; END IF;
 EXECUTE updated;
 SELECT pg_get_functiondef('public.dev_change_co_manager(uuid,uuid,text,uuid,text,text)'::regprocedure) INTO body;
 updated:=replace(body,'(user_id=account.id OR invited_email=lower(account.email)))',
  '(user_id=account.id OR (invited_email=lower(account.email) AND (user_id IS NOT NULL OR team_id<>p_team OR sleeper_user_id IS DISTINCT FROM p_sleeper))))');
 IF updated=body THEN RAISE EXCEPTION 'Missing co-manager placeholder hook'; END IF;
 EXECUTE updated;
END $$;
NOTIFY pgrst,'reload schema';
