DO $$ DECLARE body text; BEGIN
 IF public.application_environment_identity()->>'project_ref' <> 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.dev_credit_claim(uuid,uuid)'::regprocedure) INTO body;
 IF body NOT LIKE '%2 days 6 hours%' THEN RAISE EXCEPTION 'Credit schedule definition changed'; END IF;
 EXECUTE replace(body,'2 days 6 hours','1 day 5 hours');
END $$;
