-- CUTOVER TOOLING ONLY. Install after the schema upgrade; no function is invoked here.
-- Raw worker credentials are generated inside Vault, never printed or embedded in cron.
BEGIN;
CREATE OR REPLACE FUNCTION sportsbook_private.dispatch_production_refresh(p_warmup boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE credential text;state text;request_id bigint;
BEGIN
 IF NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production environment required';END IF;
 SELECT c.state INTO state FROM sportsbook_private.production_release_control c WHERE singleton;
 IF (p_warmup AND state<>'prepared') OR (NOT p_warmup AND state<>'active') THEN RAISE EXCEPTION 'Refresh mode does not match release state';END IF;
 IF EXISTS(SELECT FROM cron.job WHERE active AND jobname='sportsbook-weekly-worker') THEN RAISE EXCEPTION 'Legacy dispatcher still active';END IF;
 SELECT s.decrypted_secret INTO credential FROM vault.decrypted_secrets s WHERE s.name='boff_production_refresh_2026_11';
 IF credential IS NULL OR NOT EXISTS(SELECT FROM sportsbook_private.production_worker_runtime r WHERE singleton AND r.token_hash=encode(extensions.digest(credential,'sha256'),'hex')) THEN RAISE EXCEPTION 'Production worker credential mismatch';END IF;
 SELECT net.http_post(url:='https://bmvjcdgxwxqalaohpsnw.supabase.co/functions/v1/boff-production-live-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||credential),
  body:=jsonb_build_object('action',CASE WHEN p_warmup THEN 'warmup' ELSE 'scheduled' END),timeout_milliseconds:=10000) INTO request_id;
 RETURN request_id;
END $$;
CREATE OR REPLACE FUNCTION sportsbook_private.configure_production_worker(p_season integer,p_week integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE credential text;r sportsbook_private.production_worker_runtime;job_id bigint;expected_command text:='select sportsbook_private.dispatch_production_refresh(false);';
BEGIN
 PERFORM pg_advisory_xact_lock(20261101,17);
 IF NOT sportsbook_private.release_environment_ready() OR NOT EXISTS(SELECT FROM sportsbook_private.production_release_control WHERE singleton AND state='prepared') THEN RAISE EXCEPTION 'Prepared Production release required';END IF;
 IF p_season NOT BETWEEN 2026 AND 2100 OR p_week NOT BETWEEN 1 AND 22 OR p_season IS NULL OR p_week IS NULL THEN RAISE EXCEPTION 'Reviewed current season/week required';END IF;
 IF EXISTS(SELECT FROM cron.job WHERE active AND jobname IN('sportsbook-weekly-worker','boff-production-live-refresh'))
  OR EXISTS(SELECT FROM public.leagues WHERE id='13121261-5398-4391-8240-000000000003' AND operations_enabled)
  OR EXISTS(SELECT FROM public.weekly_schedule WHERE league_id='13121261-5398-4391-8240-000000000003' AND automation_enabled)
  OR EXISTS(SELECT FROM public.automation_jobs WHERE league_id='13121261-5398-4391-8240-000000000003' AND status NOT IN('done','canceled'))
 THEN RAISE EXCEPTION 'Fence legacy scheduling and retire reviewed jobs first';END IF;
 IF NOT EXISTS(SELECT FROM sportsbook_private.production_wallet_runs) THEN RAISE EXCEPTION 'Reviewed wallet migration required';END IF;
 SELECT * INTO r FROM sportsbook_private.production_worker_runtime WHERE singleton;
 IF r.singleton IS NOT NULL AND (r.season<>p_season OR r.opening_week<>p_week) THEN RAISE EXCEPTION 'Worker baseline changed; explicit review required';END IF;
 SELECT s.decrypted_secret INTO credential FROM vault.decrypted_secrets s WHERE s.name='boff_production_refresh_2026_11';
 IF credential IS NULL THEN
  IF r.singleton IS NOT NULL THEN RAISE EXCEPTION 'Existing worker credential missing';END IF;
  credential:=encode(extensions.gen_random_bytes(32),'hex');
  PERFORM vault.create_secret(credential,'boff_production_refresh_2026_11','Production refresh credential; no mail activation');
 END IF;
 IF r.singleton IS NOT NULL AND r.token_hash<>encode(extensions.digest(credential,'sha256'),'hex') THEN RAISE EXCEPTION 'Worker credential changed';END IF;
 INSERT INTO sportsbook_private.production_worker_runtime(singleton,season,opening_week,token_hash)
 VALUES(true,p_season,p_week,encode(extensions.digest(credential,'sha256'),'hex')) ON CONFLICT DO NOTHING;
 INSERT INTO public.dev_live_cache(key,payload,next_refresh_at,lease_until) VALUES
  ('control',jsonb_build_object('tokenHash',encode(extensions.digest(credential,'sha256'),'hex')),'epoch','epoch'),
  ('nfl','{}','epoch','epoch'),('league:1312126153980391424','{}','epoch','epoch') ON CONFLICT(key) DO NOTHING;
 IF NOT EXISTS(SELECT FROM public.dev_live_cache WHERE key='control' AND payload->>'tokenHash'=encode(extensions.digest(credential,'sha256'),'hex')) THEN RAISE EXCEPTION 'Existing control cache does not match Production credential';END IF;
 SELECT jobid INTO job_id FROM cron.job WHERE jobname='boff-production-live-refresh';
 IF job_id IS NOT NULL AND NOT EXISTS(SELECT FROM cron.job WHERE jobid=job_id AND command=expected_command AND schedule='* * * * *' AND NOT active) THEN RAISE EXCEPTION 'Production scheduler definition changed';END IF;
 IF job_id IS NULL THEN
  job_id:=cron.schedule('boff-production-live-refresh','* * * * *',expected_command);
  PERFORM cron.alter_job(job_id,active:=false);
 END IF;
 RETURN jsonb_build_object('configured',true,'season',p_season,'openingWeek',p_week,'schedulerActive',false,'mailEnabled',false);
END $$;
CREATE OR REPLACE FUNCTION sportsbook_private.activate_production_worker(p_expected_board uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r sportsbook_private.production_worker_runtime;job_id bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(20261101,17);
 IF NOT sportsbook_private.release_environment_ready() THEN RAISE EXCEPTION 'Production environment required';END IF;
 SELECT * INTO STRICT r FROM sportsbook_private.production_worker_runtime WHERE singleton;
 IF NOT EXISTS(SELECT FROM sportsbook_private.league_launch_approvals WHERE league_id='13121261-5398-4391-8240-000000000003') THEN RAISE EXCEPTION 'Platform owner launch approval required';END IF;
 IF EXISTS(SELECT FROM cron.job WHERE active AND jobname='sportsbook-weekly-worker') THEN RAISE EXCEPTION 'Legacy dispatcher still active';END IF;
 IF NOT EXISTS(SELECT FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id
  WHERE c.league_id='13121261-5398-4391-8240-000000000003' AND b.id=p_expected_board AND b.revision=p_expected_revision
   AND b.nfl_season=r.season AND b.market_week=r.opening_week AND b.status='published'
   AND c.valid_until>clock_timestamp() AND c.last_error IS NULL) THEN RAISE EXCEPTION 'Reviewed fresh current board required';END IF;
 IF NOT EXISTS(SELECT FROM sportsbook_private.production_wallet_runs) OR EXISTS(SELECT FROM public.automation_jobs
  WHERE league_id='13121261-5398-4391-8240-000000000003' AND status NOT IN('done','canceled')) THEN RAISE EXCEPTION 'Reviewed financial/job transition required';END IF;
 SELECT jobid INTO STRICT job_id FROM cron.job WHERE jobname='boff-production-live-refresh'
  AND command='select sportsbook_private.dispatch_production_refresh(false);' AND schedule='* * * * *';
 UPDATE public.leagues SET active_week=r.opening_week,operations_enabled=true WHERE id='13121261-5398-4391-8240-000000000003';
 UPDATE sportsbook_private.production_release_control SET state='active' WHERE singleton;
 PERFORM cron.alter_job(job_id,active:=true);
 RETURN jsonb_build_object('active',true,'board',p_expected_board,'revision',p_expected_revision,'mailEnabled',false);
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.dispatch_production_refresh(boolean),sportsbook_private.configure_production_worker(integer,integer),
 sportsbook_private.activate_production_worker(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
