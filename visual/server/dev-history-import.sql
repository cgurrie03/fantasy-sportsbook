DO $$ BEGIN IF application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only';END IF;END $$;
CREATE TABLE boff_dev_internal.production_import_stage(part integer PRIMARY KEY,body text NOT NULL CHECK(octet_length(body)<=262144));
CREATE TABLE boff_dev_internal.production_import_log(fingerprint text PRIMARY KEY,source_ref text NOT NULL,source_read_at timestamptz NOT NULL,imported_at timestamptz NOT NULL DEFAULT now(),counts jsonb NOT NULL);
ALTER TABLE boff_dev_internal.production_import_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.production_import_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.production_import_stage,boff_dev_internal.production_import_log FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION boff_dev_internal.import_production_history(p_fingerprint text,p_source_read_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE s jsonb;l uuid:='13121261-5398-4391-8240-000000000003';b uuid;counts jsonb;before_wallets jsonb;rel text;cols text;old_owner text:='a093dbf0-7137-432f-807f-d3fa9a017d21';dev_owner text:='d320882c-8a06-443b-a2a9-2e29a0d29cdd';
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only';END IF;
 PERFORM pg_advisory_xact_lock(20261101,17);
 SELECT i.counts INTO counts FROM boff_dev_internal.production_import_log i WHERE fingerprint=p_fingerprint;
 IF FOUND THEN RETURN counts||jsonb_build_object('duplicate',true);END IF;
 SELECT string_agg(body,'' ORDER BY part)::jsonb INTO s FROM boff_dev_internal.production_import_stage;
 IF s IS NULL OR md5(s::text) IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Source snapshot fingerprint mismatch';END IF;
 IF jsonb_array_length(s->'leagues')<>1 OR (s->'leagues'->0->>'id')::uuid<>l OR s->'leagues'->0->>'sleeper_league_id'<>'1312126153980391424' THEN RAISE EXCEPTION 'Unexpected source league';END IF;
 IF jsonb_array_length(s->'ticket_promotions')+jsonb_array_length(s->'promo_offers')+jsonb_array_length(s->'promo_claims')+jsonb_array_length(s->'promo_events')<>0 THEN RAISE EXCEPTION 'Promotion dependencies require a dedicated migration';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'tickets') t WHERE t->>'user_wallet_id' IS NOT NULL OR (t->>'league_id')::uuid<>l) THEN RAISE EXCEPTION 'Unexpected source account or league';END IF;
 SELECT board_id INTO STRICT b FROM public.dev_current_book WHERE league_id=l;
 SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) INTO before_wallets FROM public.user_wallets w WHERE w.league_id=l;
 SELECT jsonb_object_agg(key,jsonb_array_length(value)) INTO counts FROM jsonb_each(s);

 -- Historical insertion bypasses only user triggers in this transaction.
 -- Foreign keys and CHECK constraints still run. All triggers are restored
 -- before the lossless compaction pass; any failure rolls everything back.
 FOREACH rel IN ARRAY ARRAY['tickets','ticket_legs','wallets','wallet_ledger','sportsbook_boards','sportsbook_markets','balance_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER',rel);
 END LOOP;
 INSERT INTO sportsbook_private.import_batches SELECT * FROM jsonb_populate_recordset(NULL::sportsbook_private.import_batches,s->'import_batches') ON CONFLICT DO NOTHING;
 INSERT INTO public.league_memberships(id,league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role,approved_at)
 SELECT m.id,m.league_id,m.team_id,a.id,m.invited_email,m.display_name,m.sleeper_user_id,m.role,m.approved_at
 FROM jsonb_populate_recordset(NULL::public.league_memberships,s->'league_memberships') m
 LEFT JOIN auth.users a ON lower(a.email)=lower(m.invited_email) AND a.email_confirmed_at IS NOT NULL
 ON CONFLICT DO NOTHING;
 INSERT INTO public.sportsbook_boards
 SELECT x.* FROM jsonb_array_elements(s->'sportsbook_boards') r
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.sportsbook_boards,r||jsonb_build_object('status','closed','reopening_id',null,'reopening_until',null,'phase',coalesce(r->>'phase','pregame'),'content_version',coalesce((r->>'content_version')::bigint,0))) x
 WHERE NOT EXISTS(SELECT 1 FROM public.sportsbook_boards y WHERE (y.league_id,y.nfl_season,y.market_week,y.board_type)=(x.league_id,x.nfl_season,x.market_week,x.board_type))
 ON CONFLICT DO NOTHING;
 INSERT INTO public.sportsbook_markets
 SELECT x.* FROM jsonb_array_elements(s->'sportsbook_markets') r
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.sportsbook_markets,r||jsonb_build_object('active',false,'market_state',coalesce(r->>'market_state','closed'),'board_id',coalesce((SELECT id FROM public.sportsbook_boards WHERE id=(r->>'board_id')::uuid),b))) x ON CONFLICT DO NOTHING;
 INSERT INTO public.wallets SELECT * FROM jsonb_populate_recordset(NULL::public.wallets,s->'wallets') ON CONFLICT(team_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at;
 SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='public.tickets'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='' AND (s->'tickets'->0) ? attname;
 EXECUTE format('INSERT INTO public.tickets(%1$s) SELECT %1$s FROM jsonb_populate_recordset(NULL::public.tickets,$1) ON CONFLICT DO NOTHING',cols) USING s->'tickets';
 INSERT INTO public.ticket_legs SELECT * FROM jsonb_populate_recordset(NULL::public.ticket_legs,s->'ticket_legs') ON CONFLICT DO NOTHING;
 INSERT INTO public.wallet_ledger SELECT * FROM jsonb_populate_recordset(NULL::public.wallet_ledger,s->'wallet_ledger') ON CONFLICT DO NOTHING;
 INSERT INTO public.balance_events SELECT * FROM jsonb_populate_recordset(NULL::public.balance_events,s->'balance_events') ON CONFLICT DO NOTHING;
 INSERT INTO public.league_result_weeks SELECT * FROM jsonb_populate_recordset(NULL::public.league_result_weeks,s->'league_result_weeks') ON CONFLICT DO NOTHING;
 INSERT INTO public.model_config_versions SELECT * FROM jsonb_populate_recordset(NULL::public.model_config_versions,replace((s->'model_config_versions')::text,old_owner,dev_owner)::jsonb) ON CONFLICT DO NOTHING;
 INSERT INTO public.model_controls SELECT * FROM jsonb_populate_recordset(NULL::public.model_controls,replace((s->'model_controls')::text,old_owner,dev_owner)::jsonb) ON CONFLICT DO NOTHING;
 FOREACH rel IN ARRAY ARRAY['tickets','ticket_legs','wallets','wallet_ledger','sportsbook_boards','sportsbook_markets','balance_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER',rel);
 END LOOP;
 UPDATE public.ticket_legs t SET settlement_context=t.settlement_context FROM jsonb_array_elements(s->'ticket_legs') r WHERE t.id=(r->>'id')::uuid AND t.context_bundle_id IS NULL AND jsonb_typeof(t.settlement_context->'metadata')='object';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'tickets') r LEFT JOIN public.tickets t ON t.id=(r->>'id')::uuid WHERE t.id IS NULL OR to_jsonb(t) @> r IS NOT TRUE) THEN RAISE EXCEPTION 'Ticket reconciliation failed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'ticket_legs') r LEFT JOIN public.ticket_legs_with_evidence t ON t.id=(r->>'id')::uuid WHERE t.id IS NULL OR (to_jsonb(t) @> r) IS NOT TRUE OR t.settlement_context IS DISTINCT FROM nullif(r->'settlement_context','null'::jsonb)) THEN RAISE EXCEPTION 'Receipt reconciliation failed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'wallet_ledger') r LEFT JOIN public.wallet_ledger w ON w.id=(r->>'id')::uuid WHERE w.id IS NULL OR to_jsonb(w) @> r IS NOT TRUE) THEN RAISE EXCEPTION 'Credit ledger reconciliation failed';END IF;
 IF (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.user_wallets w WHERE w.league_id=l) IS DISTINCT FROM before_wallets THEN RAISE EXCEPTION 'Dev test wallets changed';END IF;
 INSERT INTO boff_dev_internal.production_import_log(fingerprint,source_ref,source_read_at,counts) VALUES(p_fingerprint,'bmvjcdgxwxqalaohpsnw',p_source_read_at,counts);
 TRUNCATE boff_dev_internal.production_import_stage;
 RETURN counts||jsonb_build_object('duplicate',false);
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.import_production_history(text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
