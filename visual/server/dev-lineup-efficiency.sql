DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE TABLE public.dev_lineup_efficiency (
 league_id uuid REFERENCES public.leagues(id), season integer, week integer CHECK (week BETWEEN 1 AND 18),
 totals jsonb NOT NULL CHECK (jsonb_typeof(totals)='object' AND octet_length(totals::text)<=8192),
 PRIMARY KEY (league_id,season,week)
);
ALTER TABLE public.dev_lineup_efficiency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dev_lineup_efficiency FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT ON public.dev_lineup_efficiency TO service_role;
