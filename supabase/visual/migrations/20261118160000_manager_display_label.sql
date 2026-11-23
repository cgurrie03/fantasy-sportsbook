DO $$ DECLARE body text; BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('boff_dev_internal.sleeper_manager_status(uuid,uuid,boolean)'::regprocedure) INTO body;
 IF strpos(body,'''Solo Manager''')=0 THEN RAISE EXCEPTION 'Manager label definition changed'; END IF;
 EXECUTE replace(body,'''Solo Manager''','''Manager''');
END $$;
