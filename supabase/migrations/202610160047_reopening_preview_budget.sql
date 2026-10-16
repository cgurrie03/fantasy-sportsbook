-- A complete four-category review contains the same immutable quote metadata
-- as publication. Give only this server-only save the scoped archival budget;
-- keep membership, provenance, freshness checks and grants unchanged.
alter function public.stage_reopening_review(uuid,integer,integer,timestamptz,timestamptz,text,jsonb,jsonb,jsonb) set statement_timeout='90s';
alter function public.stage_reopening_review(uuid,integer,integer,timestamptz,timestamptz,text,jsonb,jsonb,jsonb) set work_mem='16MB';
