DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs'
 OR public.application_environment_identity()->>'environment' IS DISTINCT FROM 'development' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
SELECT cron.schedule('boff-storage-maintenance','17 * * * *',
 'select boff_dev_internal.storage_maintenance(50);');
