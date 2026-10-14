begin;
-- Board replacement validates and writes hundreds of quotes atomically.
-- Scope its budget to these RPCs; do not raise browser/role/global timeouts.
alter function public.worker_operation(uuid,text,jsonb) set statement_timeout='45s';
alter function public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text) set statement_timeout='45s';
alter function public.save_future_board(uuid,uuid,jsonb,text) set statement_timeout='45s';
alter function public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb) set statement_timeout='20s';
alter function public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text) set work_mem='16MB';
alter function public.save_future_board(uuid,uuid,jsonb,text) set work_mem='16MB';
commit;
