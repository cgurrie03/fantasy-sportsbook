-- Already included in fresh storage-efficiencies.sql. Hosted follow-up for the
-- initial deployment: retain deduplication/PK indexes, remove unused duplicates.
DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev required'; END IF;
END $$;
ALTER TABLE public.receipt_context_values DROP CONSTRAINT IF EXISTS receipt_context_values_league_id_id_key;
ALTER TABLE public.receipt_context_bundles DROP CONSTRAINT IF EXISTS receipt_context_bundles_league_id_id_key;
