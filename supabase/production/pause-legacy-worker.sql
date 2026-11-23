-- CUTOVER ACTION ONLY, after owner release approval. Not executed during preparation.
-- Reverify this command hash against Production immediately before use.
BEGIN;
DO $$DECLARE actual text;BEGIN
 SELECT md5(command) INTO actual FROM cron.job WHERE jobid=1 AND jobname='sportsbook-weekly-worker';
 IF actual IS DISTINCT FROM '04eda187d974f1240fd24cb562bc6e1a' THEN RAISE EXCEPTION 'Legacy worker changed; review the current Production job before pausing';END IF;
 PERFORM cron.alter_job(1,active:=false);
END $$;
COMMIT;
