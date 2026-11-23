DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

DO $$
DECLARE body text; constraint_body text; updated text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT constraint_body FROM pg_constraint
 WHERE conrelid='public.sportsbook_markets'::regclass AND conname='sportsbook_markets_kind_check';
 updated:=replace(constraint_body,'''player_h2h''::text','''player_h2h''::text, ''position_group''::text');
 IF updated=constraint_body THEN RAISE EXCEPTION 'Market constraint changed'; END IF;
 ALTER TABLE public.sportsbook_markets DROP CONSTRAINT sportsbook_markets_kind_check;
 EXECUTE 'ALTER TABLE public.sportsbook_markets ADD CONSTRAINT sportsbook_markets_kind_check '||updated;

 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 updated:=replace(body,'''player_h2h''','''player_h2h'',''position_group''');
 IF body=updated THEN RAISE EXCEPTION 'Market publisher changed'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('sportsbook_private.quote_family(text)'::regprocedure) INTO body;
 updated:=replace(body,'''player_h2h''','''player_h2h'',''position_group''');
 IF body=updated THEN RAISE EXCEPTION 'Quote family definition changed'; END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('sportsbook_private.validate_extra_leg()'::regprocedure) INTO body;
 updated:=replace(body,'''player_h2h''','''player_h2h'',''position_group''');
 -- The label CASE has a scalar match and needs its own branch.
 updated:=replace(updated,'when ''player_h2h'',''position_group'' then','when ''position_group'' then ''Position Group Head to Head'' when ''player_h2h'' then');
 EXECUTE updated;
END $$;

CREATE OR REPLACE FUNCTION boff_dev_internal.check_player_quote_cutoff() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.settlement_context->'metadata'->>'cutoff' IS NOT NULL
   AND (NEW.settlement_context->'metadata'->>'cutoff')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION 'A selection has reached its cutoff'; END IF;
 RETURN NEW;
END $$;

DO $$
DECLARE body text; updated text;
BEGIN
 SELECT pg_get_functiondef('boff_dev_internal.apply_feature_settings(uuid,integer,jsonb,jsonb,integer,integer,integer,integer)'::regprocedure) INTO body;
 updated:=replace(body,'streak text,matchup_id text)','streak text,matchup_id text,"pregameProjection" numeric)');
 updated:=replace(updated,'a.seed away_seed,h.seed home_seed,','a.seed away_seed,h.seed home_seed,a."pregameProjection" away_open,h."pregameProjection" home_open,');
 updated:=replace(updated,'(''upset'',5,underdog IS NOT NULL','(''upset'',5,away_open IS NOT NULL AND home_open IS NOT NULL AND away_open<>home_open');
 updated:=replace(updated,'CASE WHEN underdog=away THEN away_seed ELSE home_seed END','CASE WHEN away_open<home_open THEN away_seed ELSE home_seed END');
 updated:=replace(updated,'CASE WHEN underdog=away THEN home_seed ELSE away_seed END','CASE WHEN away_open<home_open THEN home_seed ELSE away_seed END');
 updated:=replace(updated,'spread*100/greatest(.1,away_projection,home_projection)','abs(away_open-home_open)*100/greatest(.1,away_open,home_open)');
 updated:=replace(updated,'WHEN ''upset'' THEN q->>''team_id''=f.underdog','WHEN ''upset'' THEN q->>''team_id''=coalesce(CASE WHEN f.away_open<f.home_open THEN f.away WHEN f.home_open<f.away_open THEN f.home END,f.underdog)');
 IF updated=body OR strpos(updated,'away_open IS NOT NULL')=0 THEN RAISE EXCEPTION 'Featured rules changed'; END IF;
 EXECUTE updated;
END $$;

SELECT cron.alter_job(jobid,schedule:='* * * * *') FROM cron.job WHERE jobname='boff-dev-live-refresh';
NOTIFY pgrst,'reload schema';
