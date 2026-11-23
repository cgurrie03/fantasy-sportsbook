DO $$ DECLARE original text; updated text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
  RAISE EXCEPTION 'Development project required';
 END IF;
 SELECT pg_get_functiondef('public.dev_capture_notification(uuid,uuid,text,text,text,text,text)'::regprocedure) INTO original;
 updated:=replace(replace(original,'octet_length(p_html)>16000','octet_length(p_html)>24000'),
  'octet_length(p_text)>4000','octet_length(p_text)>8000');
 IF updated NOT LIKE '%octet_length(p_html)>24000%' OR updated NOT LIKE '%octet_length(p_text)>8000%' THEN
  RAISE EXCEPTION 'Notification capture size definition changed';
 END IF;
 EXECUTE updated;
END $$;
